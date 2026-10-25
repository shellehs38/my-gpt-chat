import { CLOUD_STORAGE_KEY, decodeSnapshot, hasWorkspaceContent, workspaceHash, type CloudIndex, type Revision, type Snapshot } from "./drive-workspace-contract";
import { decodeWorkspace, saveWorkspace, type Workspace } from "./workspace-storage";

type Journal = { version: 1; base?: string; hash?: string; pending?: { snapshot: Snapshot; ticket?: string }; paused?: boolean; restoreOnResume?: boolean };
export type AutosaveState = { status: "checking" | "saving" | "saved" | "ready" | "offline" | "error" | "authorization_required" | "conflict" | "paused"; message: string; revisions: Revision[]; heads: Revision[] };
type CloudStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;
const OUTBOX_PREFIX = `${CLOUD_STORAGE_KEY}.pending.`;
type Dependencies = { storage: CloudStorage; fetch: typeof fetch; getWorkspace: () => Workspace; restore: (workspace: Workspace) => void; notify: (state: AutosaveState) => void };
type CloudReply = CloudIndex & { snapshot?: Snapshot; revision?: Revision; ticket?: string };
class RequestError extends Error { constructor(message: string, public code: string) { super(message); } }
function outboxKeys(storage: CloudStorage): string[] {
  return Array.from({ length: storage.length }, (_, index) => storage.key(index))
    .filter((key): key is string => Boolean(key?.startsWith(OUTBOX_PREFIX)));
}
function hasPauseMarker(storage: CloudStorage): boolean {
  const raw = storage.getItem(CLOUD_STORAGE_KEY);
  if (!raw) return false;
  try {
    const value = JSON.parse(raw) as Partial<Journal>;
    return value.version === 1 && value.paused === true;
  } catch { return false; }
}
/** Remove every local payload while retaining only a pause marker; cloud snapshots remain immutable in Drive. */
export function clearDriveAutosaveLocalData(storage: CloudStorage): void {
  storage.setItem(CLOUD_STORAGE_KEY, JSON.stringify({ version: 1, paused: true } satisfies Journal));
  for (const key of outboxKeys(storage)) storage.removeItem(key);
}
/** One queued operation, durable before network writes. The cloud consists of immutable, linked snapshots. */
export class DriveAutosave {
  private journal: Journal = { version: 1 };
  private busy = false;
  private lifetime = new AbortController();
  private disposed = false;
  private ready = false;
  private timer?: ReturnType<typeof setTimeout>;
  private retry = 0;
  private generation = 0;
  private index: CloudIndex = { heads: [], revisions: [] };
  private status: AutosaveState["status"] = "checking";
  constructor(private deps: Dependencies) {
    const raw = deps.storage.getItem(CLOUD_STORAGE_KEY);
    if (raw) {
      const j = JSON.parse(raw) as Journal;
      if (j.version !== 1 || j.base !== undefined && typeof j.base !== "string" || j.hash !== undefined && !/^[a-f0-9]{64}$/.test(j.hash)) throw new Error("Не удалось прочитать журнал автосохранения. Экспортируйте локальный проект.");
      if (j.pending) { j.pending.snapshot = decodeSnapshot(j.pending.snapshot); if (j.pending.ticket !== undefined && typeof j.pending.ticket !== "string") throw new Error("Некорректный журнал сохранения."); }
      this.journal = j;
    }
  }
  private emit(status: AutosaveState["status"], message: string) {
    this.status = status;
    if (!this.disposed) this.deps.notify({ status, message, ...this.index });
  }
  private adoptExternalPause(): boolean {
    if (this.journal.paused) return true;
    if (!hasPauseMarker(this.deps.storage)) return false;
    this.generation++;
    this.journal = { version: 1, paused: true };
    clearTimeout(this.timer);
    this.emit("paused", "Автосохранение приостановлено после очистки локальных данных в другой вкладке. Облачные версии сохранены.");
    return true;
  }
  private persist(resuming = false): boolean {
    // A pause marker is shared by every open tab and cannot be overwritten by a stale in-memory journal.
    if (!resuming && this.adoptExternalPause()) return false;
    // Each operation has its own durable record: another tab cannot overwrite its payload/ticket.
    if (this.journal.pending) this.deps.storage.setItem(OUTBOX_PREFIX + this.journal.pending.snapshot.operationId, JSON.stringify(this.journal.pending));
    const { pending: _pending, ...baseline } = this.journal;
    this.deps.storage.setItem(CLOUD_STORAGE_KEY, JSON.stringify(baseline));
    return true;
  }
  private recoverPending() {
    if (this.journal.pending) return;
    const storage = this.deps.storage;
    const keys = outboxKeys(storage).sort();
    if (!keys.length) return;
    const raw = storage.getItem(keys[0]);
    if (!raw) return;
    const pending = JSON.parse(raw) as NonNullable<Journal["pending"]>;
    pending.snapshot = decodeSnapshot(pending.snapshot);
    if (keys[0] !== OUTBOX_PREFIX + pending.snapshot.operationId || pending.ticket !== undefined && typeof pending.ticket !== "string") throw new Error("Не удалось прочитать очередь сохранения. Экспортируйте локальный проект.");
    this.journal.pending = pending;
  }
  private async locked(work: () => Promise<void>) {
    if (typeof navigator !== "undefined" && navigator.locks) {
      await navigator.locks.request("svoi-builder-drive-autosave", () => this.disposed ? undefined : work());
    } else await work();
  }
  async sync() { try { if (!this.busy && !this.disposed) await this.locked(() => this.performSync()); } catch (error) { if (!this.disposed) this.failure(error); } }
  async restoreVersion(id: string) { try { if (!this.busy && !this.disposed) await this.locked(() => this.performRestore(id)); } catch (error) { if (!this.disposed) this.failure(error); } }
  private async request(body: unknown): Promise<CloudReply> {
    const response = await this.deps.fetch("/api/drive/workspace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store", signal: AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(55_000)]) });
    const data = await response.json();
    if (this.disposed) throw new Error("Операция завершена после закрытия страницы.");
    if (!response.ok) throw new RequestError(typeof data.error === "string" ? data.error : "Сохранение не подтверждено.", response.status === 401 ? "login_required" : data.code ?? "unavailable");
    if (!Array.isArray(data.heads) || !Array.isArray(data.revisions)) throw new Error("Некорректный ответ хранилища.");
    return data as CloudReply;
  }
  private failure(error: unknown) {
    if (this.adoptExternalPause()) return;
    const code = error instanceof RequestError ? error.code : "unavailable";
    this.emit(code === "authorization_required" ? "authorization_required" : "error", error instanceof Error ? error.message : "Изменения остаются в браузере. Drive пока недоступен.");
    if (!["authorization_required", "login_required", "integrity", "history_damaged", "history_limit", "invalid_ticket"].includes(code)) {
      this.schedule(Math.min(60_000, 5000 * 2 ** Math.min(this.retry++, 4)));
    }
  }
  private schedule(delay = 2500) {
    if (this.disposed || this.adoptExternalPause()) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.sync(); }, delay);
  }
  changed() {
    this.generation++;
    if (this.adoptExternalPause()) return;
    if (this.journal.restoreOnResume) { this.journal.restoreOnResume = false; try { if (!this.persist()) return; } catch (error) { this.failure(error); return; } }
    if (this.status === "conflict" || this.status === "authorization_required") return;
    this.emit("saving", "Изменения сохранены в браузере. Ожидаю автосохранения в Drive…");
    this.schedule();
  }
  private async adopt(data: CloudReply, expectedGeneration: number): Promise<boolean> {
    if (!data.snapshot || !data.revision || this.generation !== expectedGeneration || this.disposed || this.adoptExternalPause()) return false;
    const workspace = decodeWorkspace(JSON.stringify(data.snapshot.workspace));
    // Store locally before replacing the visible state. If quota blocks this, preserve the screen.
    const hash = await workspaceHash(workspace);
    if (this.generation !== expectedGeneration || this.disposed || this.adoptExternalPause()) return false;
    saveWorkspace(this.deps.storage, workspace);
    this.journal.base = data.revision.id; this.journal.hash = hash;
    this.journal.restoreOnResume = false; this.persist(); this.deps.restore(workspace); return true;
  }
  private async uploadPending(): Promise<CloudReply | undefined> {
    if (this.adoptExternalPause()) return;
    const pending = this.journal.pending;
    if (!pending) return;
    if (!this.persist()) return;
    this.emit("saving", "Сохраняю проект в Google Drive…");
    if (!pending.ticket) {
      const reserved = await this.request({ action: "reserve", snapshot: pending.snapshot });
      if (this.adoptExternalPause()) return;
      if (!reserved.ticket) throw new Error("Drive не подготовил задание сохранения.");
      pending.ticket = reserved.ticket;
      // Never send an upload until the allocated ID and exact payload are durable in this browser.
      if (!this.persist()) return;
    }
    const data = await this.request({ action: "save", ticket: pending.ticket, snapshot: pending.snapshot });
    if (this.adoptExternalPause()) return;
    if (!data.revision) throw new Error("Drive не подтвердил сохранённую версию.");
    this.index = { heads: data.heads, revisions: data.revisions };
    this.journal.base = data.revision.id; this.journal.hash = await workspaceHash(pending.snapshot.workspace);
    this.journal.pending = undefined; this.persist(); this.deps.storage.removeItem(OUTBOX_PREFIX + pending.snapshot.operationId); this.retry = 0;
    return data;
  }
  private async performSync() {
    if (this.disposed || this.busy) return;
    if (this.adoptExternalPause()) { this.emit("paused", "Автосохранение приостановлено после очистки локальных данных. Облачные версии сохранены."); return; }
    this.busy = true;
    try {
      if (typeof navigator !== "undefined" && navigator.onLine === false) { this.emit("offline", "Нет интернета. Изменения сохранены в браузере и отправятся при восстановлении связи."); return; }
      const generation = this.generation;
      const hashBeforeRecovery = this.journal.hash;
      this.emit("checking", "Проверяю автосохранение в Google Drive…");
      // Complete the exact old operation first, even if the user has since edited the workspace.
      this.recoverPending();
      for (let n = 0; n < 20 && this.journal.pending; n++) { await this.uploadPending(); this.recoverPending(); }
      if (this.journal.pending) { this.schedule(1000); return; }
      if (this.disposed || this.journal.paused) return;
      const data = await this.request({ action: "load" });
      if (this.adoptExternalPause()) return;
      this.index = { heads: data.heads, revisions: data.revisions };
      this.ready = true;
      const localGeneration = this.generation;
      const local = this.deps.getWorkspace(); const hash = await workspaceHash(local);
      if (this.disposed || this.journal.paused) return;
      const head = data.heads.length === 1 ? data.heads[0] : undefined;
      const remoteHash = data.snapshot ? await workspaceHash(data.snapshot.workspace) : undefined;
      if (this.generation !== localGeneration) { this.emit("saving", "Появились новые правки. Сохраняю их следующими…"); this.schedule(); return; }
      if (head && data.snapshot && remoteHash === hash) {
        this.journal.base = head.id; this.journal.hash = hash; this.persist();
        this.emit("saved", "Сохранено в Google Drive. Диалог, черновик, сметы и правки доступны при следующем входе."); return;
      }
      const unchanged = this.journal.hash === hash || hashBeforeRecovery === hash;
      const freshEmpty = !this.journal.base && !hasWorkspaceContent(local);
      if (head && data.snapshot && (unchanged || freshEmpty || this.journal.restoreOnResume && !hasWorkspaceContent(local)) && this.generation === generation) {
        if (await this.adopt(data, generation)) this.emit("saved", "Проект восстановлен из Google Drive. Автосохранение включено.");
        else this.schedule();
        return;
      }
      if (data.heads.length > 1 && unchanged) {
        this.emit("conflict", "На устройствах появились разные версии. Они сохранены в Drive. Выберите версию для продолжения ниже."); return;
      }
      if (!hasWorkspaceContent(local) && !this.journal.base && !data.heads.length) {
        this.emit("ready", "Автосохранение включено. Первый проект появится в Drive после ввода данных."); return;
      }
      if (this.status === "conflict") return;
      // A stale base creates a preserved branch. No operation overwrites an existing snapshot.
      const next = decodeSnapshot({ schemaVersion: 1, operationId: crypto.randomUUID(), parents: this.journal.base ? [this.journal.base] : [], workspace: decodeWorkspace(JSON.stringify(local)) });
      this.journal.pending = { snapshot: next }; this.persist();
      const saved = await this.uploadPending();
      if (!saved || this.disposed) return;
      if (saved.heads.length !== 1 || saved.heads[0].id !== saved.revision?.id) {
        this.emit("conflict", "Сохранены разные версии проекта. Выберите нужную ниже; остальные останутся в истории Drive.");
      } else if (localGeneration === this.generation && await workspaceHash(this.deps.getWorkspace()) === this.journal.hash && localGeneration === this.generation) {
        this.emit("saved", "Сохранено в Google Drive. Диалог, черновик, сметы и правки доступны при следующем входе.");
      } else { this.emit("saving", "Сохраняю следующие изменения…"); this.schedule(); }
    } catch (error) { if (!this.disposed) this.failure(error); }
    finally { this.busy = false; }
  }
  /** Explicit recovery creates a new version with every current branch as a parent. */
  private async performRestore(id: string) {
    if (this.busy || this.disposed || this.journal.pending || this.adoptExternalPause()) return;
    this.busy = true; const generation = this.generation;
    try {
      this.emit("checking", "Восстанавливаю выбранную версию…");
      const data = await this.request({ action: "load", id });
      if (this.adoptExternalPause()) return;
      if (!data.snapshot || !data.revision || this.generation !== generation) throw new Error("Во время восстановления появились новые правки. Они сохранены локально; повторите выбор версии.");
      // Preserve even unsent current edits as an immutable snapshot before a recovery replaces the screen.
      if (await workspaceHash(this.deps.getWorkspace()) !== this.journal.hash) {
        this.journal.pending = { snapshot: decodeSnapshot({ schemaVersion: 1, operationId: crypto.randomUUID(), parents: this.journal.base ? [this.journal.base] : [], workspace: decodeWorkspace(JSON.stringify(this.deps.getWorkspace())) }) }; this.persist();
        await this.uploadPending();
      }
      const current = await this.request({ action: "load" });
      if (this.adoptExternalPause()) return;
      if (this.generation !== generation) throw new Error("Появились новые правки. Повторите восстановление.");
      this.journal.pending = { snapshot: decodeSnapshot({ schemaVersion: 1, operationId: crypto.randomUUID(), parents: current.heads.map(r => r.id), workspace: data.snapshot.workspace }) }; this.persist();
      const saved = await this.uploadPending();
      if (saved && this.generation === generation && await this.adopt({ ...saved, snapshot: data.snapshot }, generation)) {
        this.index = { heads: saved.heads, revisions: saved.revisions };
        this.emit(saved.heads.length === 1 ? "saved" : "conflict", saved.heads.length === 1 ? "Выбранная версия восстановлена и сохранена в Drive. Предыдущие версии остаются в истории." : "Другое устройство внесло изменения. Выберите версию ещё раз.");
      } else this.schedule();
    } catch (error) { if (!this.disposed) this.failure(error); }
    finally { this.busy = false; }
  }
  pause() {
    clearDriveAutosaveLocalData(this.deps.storage);
    this.generation++;
    this.journal = { version: 1, paused: true };
    clearTimeout(this.timer);
    this.emit("paused", "Локальные данные и очередь отправки очищены. Облачные версии сохранены; автосохранение приостановлено.");
  }
  resume() { try { this.journal.paused = false; this.journal.restoreOnResume = true; this.persist(true); void this.sync(); } catch (error) { this.failure(error); } }
  isBusy() { return this.busy; }
  canRestore() { return this.ready && !this.busy && !this.journal.pending; }
  dispose() { this.disposed = true; this.lifetime.abort(); clearTimeout(this.timer); }
}
