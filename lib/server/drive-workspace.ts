import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { getToken, NoValidTokenError, UserAuthorizationRequiredError } from "@vercel/connect";
import { NextResponse } from "next/server";
import { getAccessConfig, readSession } from "./auth";
import { connectorUid, driveTokenParams } from "./drive-connect";
import { BodyError, errorResponse, isSameOriginWrite, readJsonBody } from "./http";
import { takeRateLimit } from "./rate-limit";
import { decodeSnapshot, DRIVE_FILE_ID, MAX_CLOUD_BYTES, snapshotText, type CloudIndex, type Revision, type Snapshot } from "../drive-workspace-contract";

const API = "https://www.googleapis.com/drive/v3/files";
const NAMESPACE = "svoi_builder_autosave_v1";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const FIELDS = "id,mimeType,size,sha256Checksum,createdTime,parents,appProperties,trashed";
type Metadata = { id: string; mimeType: string; size?: string; sha256Checksum?: string; createdTime: string; parents?: string[]; trashed?: boolean; appProperties: Record<string, string> };
type Ticket = { id: string; folder: string; hash: string };
type Dependencies = { getToken: typeof getToken; fetch: typeof fetch };
class CloudError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
const digest = (raw: string) => createHash("sha256").update(raw).digest("hex");
const tagged = (meta: Metadata, kind: string) => meta.appProperties?.namespace === NAMESPACE && meta.appProperties?.subject === "owner" && meta.appProperties?.kind === kind && !meta.trashed;
function revision(meta: Metadata): Revision {
  const p = meta.appProperties;
  const parents = Array.from({ length: 8 }, (_, i) => p[`parent${i}`]).filter(Boolean);
  if (!tagged(meta, "snapshot") || meta.mimeType !== "application/json" || !DRIVE_FILE_ID.test(meta.id) ||
      !/^[a-f0-9]{64}$/.test(p.hash) || !Number.isFinite(Date.parse(meta.createdTime)) || parents.some(id => !DRIVE_FILE_ID.test(id)) || parents.includes(meta.id)) throw new CloudError(502, "integrity", "Не удалось проверить облачную историю. Локальные данные сохранены.");
  return { id: meta.id, createdAt: meta.createdTime, hash: p.hash, parents, label: (p.label ?? "Проект").slice(0, 100) };
}
function seal(ticket: Ticket, key: Buffer): string {
  const raw = Buffer.from(JSON.stringify(ticket)).toString("base64url");
  return `${raw}.${createHmac("sha256", key).update(`drive-upload-v1:${raw}`).digest("base64url")}`;
}
function unseal(value: unknown, key: Buffer): Ticket {
  try {
    if (typeof value !== "string" || value.length > 2048) throw new Error();
    const parts = value.split(".");
    if (parts.length !== 2) throw new Error();
    const expected = createHmac("sha256", key).update(`drive-upload-v1:${parts[0]}`).digest();
    const actual = Buffer.from(parts[1], "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error();
    const ticket = JSON.parse(Buffer.from(parts[0], "base64url").toString());
    if (!DRIVE_FILE_ID.test(ticket.id) || !DRIVE_FILE_ID.test(ticket.folder) || !/^[a-f0-9]{64}$/.test(ticket.hash)) throw new Error();
    return ticket;
  } catch { throw new CloudError(400, "invalid_ticket", "Не удалось проверить задание сохранения. Локальная копия не удалена."); }
}

/** Immutable versions: no PATCH, delete, trash or arbitrary URL/credential supplied by the browser. */
export function createDriveWorkspaceHandler(deps: Dependencies = { getToken, fetch: (...args) => fetch(...args) }) {
  return async function POST(request: Request) {
    if (!isSameOriginWrite(request)) return errorResponse("Запрос должен быть отправлен с сайта помощника.", 403);
    const config = getAccessConfig();
    if (!config || !readSession(request, config)) return errorResponse("Войдите в помощника.", 401);
    const connector = connectorUid();
    if (!connector) return errorResponse("Google Drive не настроен на сервере.", 503);
    try {
      const body = await readJsonBody(request, MAX_CLOUD_BYTES + 10000) as Record<string, unknown>;
      if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.action !== "string" || !["load", "reserve", "save"].includes(body.action)) throw new BodyError(400, "Некорректное действие.");
      const allowed = body.action === "load" ? ["action", "id"] : body.action === "reserve" ? ["action", "snapshot"] : ["action", "snapshot", "ticket"];
      if (Object.keys(body).some(key => !allowed.includes(key)) || (body.id !== undefined && (typeof body.id !== "string" || !DRIVE_FILE_ID.test(body.id)))) throw new BodyError(400, "Некорректный запрос.");
      let snapshot: Snapshot | undefined;
      if (body.action !== "load") {
        try { snapshot = decodeSnapshot(body.snapshot); } catch (e) { throw new BodyError(400, e instanceof Error ? e.message : "Некорректный проект."); }
      }
      // Validate the reservation before obtaining credentials or making any provider call.
      const ticket = body.action === "save" ? unseal(body.ticket, config.signingKey) : undefined;
      const raw = snapshot ? snapshotText(snapshot) : "";
      if (ticket && ticket.hash !== digest(raw)) throw new BodyError(400, "Содержимое задания изменилось. Локальные данные сохранены.");
      if (!takeRateLimit("drive:workspace:owner", 120, 5 * 60_000)) return errorResponse("Сохранение приостановлено на минуту из-за частых запросов.", 429, { "Retry-After": "60" });
      const token = await deps.getToken(connector, driveTokenParams());
      async function call(url: string, init: RequestInit = {}, permitConflict = false): Promise<Response> {
        const headers = new Headers(init.headers); headers.set("Authorization", `Bearer ${token}`);
        const response = await deps.fetch(url, { ...init, headers, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000) });
        if (response.ok || permitConflict && response.status === 409) return response;
        if (response.status === 401) throw new CloudError(403, "authorization_required", "Требуется повторное подключение Google Drive.");
        if (response.status === 403) {
          // Quota errors must not force another consent flow.
          const text = await response.text();
          if (!/rateLimitExceeded|userRateLimitExceeded|quotaExceeded|storageQuotaExceeded/.test(text)) throw new CloudError(403, "authorization_required", "Google не разрешил доступ. Проверьте подключение Drive.");
        }
        throw new CloudError(502, "unavailable", "Google Drive временно недоступен. Изменения остаются в браузере; сохранение повторится.");
      }
      async function metadata(id: string): Promise<Metadata> {
        return (await call(`${API}/${id}?fields=${FIELDS}`)).json();
      }
      async function list(kind: "snapshot" | "folder"): Promise<Metadata[]> {
        const files: Metadata[] = []; let page: string | undefined;
        do {
          const query = new URLSearchParams({ q: `trashed = false and appProperties has { key='namespace' and value='${NAMESPACE}' } and appProperties has { key='subject' and value='owner' } and appProperties has { key='kind' and value='${kind}' }`, spaces: "drive", pageSize: "1000", fields: `nextPageToken,incompleteSearch,files(${FIELDS})` });
          if (page) query.set("pageToken", page);
          const data = await (await call(`${API}?${query}`)).json();
          if (!Array.isArray(data.files) || data.incompleteSearch) throw new CloudError(502, "integrity", "Drive вернул неполную историю. Сохранение приостановлено.");
          files.push(...data.files); page = data.nextPageToken;
          if (page && files.length >= 10000) throw new CloudError(503, "history_limit", "Облачная история требует обслуживания. Экспортируйте локальный проект.");
        } while (page);
        return files;
      }
      async function index(): Promise<CloudIndex> {
        const revisions = (await list("snapshot")).map(revision).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
        const parents = new Set(revisions.flatMap(r => r.parents));
        // Missing ancestors (e.g. an externally trashed file) are never silently accepted.
        const ids = new Set(revisions.map(r => r.id));
        if (revisions.some(r => r.parents.some(id => !ids.has(id)))) throw new CloudError(409, "history_damaged", "В Drive отсутствует часть истории. Восстановите удалённые версии из корзины Drive; локальные данные сохранены.");
        const heads = revisions.filter(r => !parents.has(r.id));
        if (revisions.length && !heads.length || heads.length > 8) throw new CloudError(409, "history_damaged", "Нужно проверить облачную историю. Локальные данные сохранены.");
        return { heads, revisions: revisions.slice(0, 30) };
      }
      async function read(id: string) {
        const meta = await metadata(id); const rev = revision(meta);
        if (Number(meta.size) > MAX_CLOUD_BYTES || !meta.parents || meta.parents.length !== 1) throw new CloudError(502, "integrity", "Облачная копия не прошла проверку размера или папки.");
        const folder = await metadata(meta.parents[0]);
        if (!tagged(folder, "folder") || folder.mimeType !== FOLDER_MIME) throw new CloudError(403, "integrity", "Файл находится вне папки автосохранения.");
        const response = await call(`${API}/${id}?alt=media`);
        const decoded = await readJsonBody(new Request("https://internal.invalid", { method: "POST", body: response.body, duplex: "half" } as RequestInit), MAX_CLOUD_BYTES);
        const value = decodeSnapshot(decoded); const content = snapshotText(value);
        if (digest(content) !== rev.hash || Number(meta.size) !== Buffer.byteLength(content) || meta.sha256Checksum && meta.sha256Checksum !== rev.hash || value.parents.join() !== rev.parents.sort().join() || value.operationId !== meta.appProperties.operation) throw new CloudError(502, "integrity", "Облачная копия не прошла проверку содержимого. Локальные данные сохранены.");
        return { revision: rev, snapshot: value, folder: folder.id };
      }
      const json = (value: unknown) => NextResponse.json(value, { headers: { "Cache-Control": "no-store" } });
      if (body.action === "load") {
        const current = await index();
        const id = body.id as string | undefined ?? (current.heads.length === 1 ? current.heads[0].id : undefined);
        const loaded = id ? await read(id) : null;
        return json({ ...current, ...(loaded ? { snapshot: loaded.snapshot, revision: loaded.revision } : {}) });
      }
      if (body.action === "reserve") {
        const current = await index();
        // The parent may be an older known version, allowing offline forks without overwrites.
        for (const parent of snapshot!.parents) revision(await metadata(parent));
        let folders = (await list("folder")).filter(f => tagged(f, "folder") && f.mimeType === FOLDER_MIME).sort((a, b) => a.createdTime.localeCompare(b.createdTime) || a.id.localeCompare(b.id));
        if (!folders.length) {
          const created: Metadata = await (await call(API + `?fields=${FIELDS}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "СВОИ ЛЮДИ — автосохранение помощника", mimeType: FOLDER_MIME, appProperties: { namespace: NAMESPACE, subject: "owner", kind: "folder" } }) })).json();
          if (!tagged(created, "folder") || !DRIVE_FILE_ID.test(created.id)) throw new CloudError(502, "integrity", "Не удалось проверить папку Drive.");
          folders = [created];
        }
        const generated = await (await call(`${API}/generateIds?count=1&space=drive&type=files`)).json();
        if (!Array.isArray(generated.ids) || !DRIVE_FILE_ID.test(generated.ids[0])) throw new CloudError(502, "integrity", "Не удалось подготовить сохранение.");
        // Domain-separated HMAC is stable across login sessions; retry tickets contain no provider credential.
        return json({ ticket: seal({ id: generated.ids[0], folder: folders[0].id, hash: digest(raw) }, config.signingKey), ...current });
      }
      const properties: Record<string, string> = { namespace: NAMESPACE, subject: "owner", kind: "snapshot", hash: ticket!.hash, operation: snapshot!.operationId, label: Array.from(snapshot!.workspace.draft || snapshot!.workspace.documents.at(-1)?.prompt || "Проект").slice(0, 24).join("") };
      snapshot!.parents.forEach((id, i) => { properties[`parent${i}`] = id; });
      const boundary = `svoi_${randomUUID()}`;
      const meta = { id: ticket!.id, name: `Помощник — ${new Date().toISOString().replace(/[:.]/g, "-")} — ${snapshot!.operationId.slice(0, 8)}.json`, mimeType: "application/json", parents: [ticket!.folder], appProperties: properties };
      const multipart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${raw}\r\n--${boundary}--\r\n`;
      // Google documents 409 on retry of an already-created pre-generated ID. Always read it back.
      await call(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id`, { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body: multipart }, true);
      const checked = await read(ticket!.id);
      if (checked.folder !== ticket!.folder || checked.revision.hash !== ticket!.hash) throw new CloudError(502, "integrity", "Сохранение не подтверждено. Задание оставлено для повторной проверки.");
      const current = await index();
      // A successful write may be briefly absent from Drive's search index. Never report it as synced yet.
      if (!current.heads.some(r => r.id === ticket!.id) && !current.revisions.some(r => r.id === ticket!.id)) throw new CloudError(503, "index_pending", "Файл записан; ожидаю подтверждения истории Drive.");
      return json({ ...current, revision: checked.revision });
    } catch (error) {
      if (error instanceof BodyError) return errorResponse(error.message, error.status);
      if (error instanceof CloudError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: { "Cache-Control": "no-store" } });
      if (error instanceof NoValidTokenError || error instanceof UserAuthorizationRequiredError) return NextResponse.json({ error: "Подключите Google Drive, чтобы возобновить автосохранение.", code: "authorization_required" }, { status: 403, headers: { "Cache-Control": "no-store" } });
      return errorResponse("Не удалось подтвердить сохранение в Drive. Изменения остаются в браузере; повторите позже.", 502);
    }
  };
}
