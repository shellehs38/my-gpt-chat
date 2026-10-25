"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { LEDGER_PENDING_STORAGE_KEY } from "@/lib/ledger-contract";
import type { LedgerClient, LedgerCommand, LedgerReply, LedgerSelection, LedgerStatus } from "@/lib/ledger-contract";
import styles from "./BusinessLedger.module.css";

const setupUrl = "https://vercel.com/shellehs38/my-gpt-chat/settings/environment-variables";
const spreadsheetUrl = "https://docs.google.com/spreadsheets/d/1-frD3ABf1G-IH1cd31Fktb9NY2XPLg05VGLOwSsgA2U/edit?gid=0";
type PendingRecord = { version: 1; payload: Extract<LedgerCommand, { kind: "message" }>; stage: "pending" | "choice"; createdAt: number };
function parsePending(raw: string): PendingRecord {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object") throw new Error("Invalid pending command");
  const pending = value as PendingRecord;
  const payload = pending.payload;
  if (pending.version !== 1 || !["pending", "choice"].includes(pending.stage) || !Number.isFinite(pending.createdAt) || !payload || payload.kind !== "message" || typeof payload.message !== "string" || !payload.message.trim() || payload.message.length > 10000 || typeof payload.requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.requestId)) throw new Error("Invalid pending command");
  if (payload.selection && (typeof payload.selection !== "object" || Object.values(payload.selection).some((id) => typeof id !== "string"))) throw new Error("Invalid pending selection");
  return pending;
}
const fullName = (client: LedgerClient) => [client.surname, client.givenName].filter(Boolean).join(" ");
function money(value: string | null): string {
  if (value === null || value === "") return "Не предоставлено";
  const decimal = value.replace(/\s/g, "").replace(",", ".").match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
  if (!decimal) return `${value} ₽`;
  const whole = decimal[2].replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0");
  return `${decimal[1]}${whole},${(decimal[3] ?? "").padEnd(2, "0")} ₽`;
}
function requestId(): string {
  if (typeof globalThis.crypto?.randomUUID !== "function") throw new Error("Для безопасной отправки откройте сайт по HTTPS в актуальном браузере.");
  return globalThis.crypto.randomUUID();
}
async function responseBody(response: Response): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid response");
    return value as Record<string, unknown>;
  }
  catch { throw new Error("Сервер вернул непонятный ответ. Результат записи не подтверждён; повторите тот же запрос."); }
}

function ledgerReply(data: Record<string, unknown>): LedgerReply {
  const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
  const strings = (value: unknown, fields: string[]) => record(value) && fields.every((field) => typeof value[field] === "string");
  const client = (value: unknown) => strings(value, ["id", "surname", "givenName", "phone", "comment"]);
  const object = (value: unknown) => strings(value, ["id", "clientId", "clientName", "address", "workType", "status", "comment"]) && record(value) && ["priceRub", "recordedExpenseRub", "preliminaryProfitRub"].every((field) => value[field] === null || typeof value[field] === "string");
  const expense = (value: unknown) => strings(value, ["id", "date", "objectId", "clientId", "description", "amountRub", "category", "comment"]);
  if (typeof data.message !== "string" || !record(data.selection) || Object.entries(data.selection).some(([key, value]) => !["clientId", "objectId"].includes(key) || typeof value !== "string") ||
    data.clients !== undefined && (!Array.isArray(data.clients) || !data.clients.every(client)) ||
    data.objects !== undefined && (!Array.isArray(data.objects) || !data.objects.every(object)) ||
    data.expenses !== undefined && (!Array.isArray(data.expenses) || !data.expenses.every(expense)) ||
    data.currentObject !== undefined && !object(data.currentObject) ||
    data.needsChoice !== undefined && !["client", "object"].includes(String(data.needsChoice)) ||
    data.applied !== undefined && typeof data.applied !== "boolean" ||
    data.operationId !== undefined && typeof data.operationId !== "string") throw new Error("Сервер не подтвердил структуру результата. Черновик сохранён; проверьте тот же запрос.");
  if (data.applied === true && (typeof data.operationId !== "string" || !data.operationId.trim() || typeof data.selection.clientId !== "string" || !data.selection.clientId)) throw new Error("Сервер не вернул подтверждение операции. Проверьте тот же запрос; черновик сохранён.");
  return data as unknown as LedgerReply;
}

/** Owner-only workspace. Session storage keeps only the last unfinished command for idempotent recovery. */
export default function BusinessLedger({ onBusyChange }: { onBusyChange?: (busy: boolean) => void } = {}) {
  const [status, setStatus] = useState<LedgerStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState("");
  const [draft, setDraft] = useState("");
  const [selection, setSelection] = useState<LedgerSelection>({});
  const [reply, setReply] = useState<LedgerReply | null>(null);
  const [knownClients, setKnownClients] = useState<LedgerClient[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [failed, setFailed] = useState<LedgerCommand | null>(null);
  const [pending, setPending] = useState<PendingRecord | null>(null);
  const [recovered, setRecovered] = useState(false);
  const [storageWarning, setStorageWarning] = useState("");
  const pendingRef = useRef<PendingRecord | null>(null);
  const busyCallback = useRef(onBusyChange);
  busyCallback.current = onBusyChange;
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const identity = useRef<{ message: string; requestId: string } | null>(null);
  const statusRequest = useRef(0);

  function persistPending(record: PendingRecord) {
    pendingRef.current = record; setPending(record);
    try { window.sessionStorage.setItem(LEDGER_PENDING_STORAGE_KEY, JSON.stringify(record)); }
    catch { setStorageWarning("Браузер не сохранил незавершённую команду. Не закрывайте вкладку до подтверждения результата; при сбое используйте тот же запрос здесь."); }
  }
  function clearPending() {
    pendingRef.current = null; setPending(null); setRecovered(false);
    try { window.sessionStorage.removeItem(LEDGER_PENDING_STORAGE_KEY); }
    catch { setStorageWarning("Хранилище вкладки недоступно. Перед новой записью после перезагрузки проверьте предыдущую операцию в таблице."); }
  }
  async function refreshStatus() {
    const current = ++statusRequest.current;
    setStatusLoading(true); setStatusError("");
    try {
      const response = await fetch("/api/ledger", { cache: "no-store" });
      const data = await responseBody(response);
      if (!response.ok) throw new Error(response.status === 401 ? "Сессия владельца не распознана. Вернитесь на главную страницу сайта и войдите снова." : response.status === 403 ? "Сервер отклонил доступ. Проверьте вход владельца." : response.status >= 500 ? "Ошибка сервера при проверке. Данные таблицы не изменены. Повторите проверку позже." : typeof data.error === "string" ? data.error : "Не удалось проверить подключение таблицы.");
      if (typeof data.configured !== "boolean" || typeof data.message !== "string") throw new Error("Сервер не подтвердил состояние подключения.");
      if (mounted.current && current === statusRequest.current) setStatus({ configured: data.configured, message: data.message, spreadsheetUrl: typeof data.spreadsheetUrl === "string" ? data.spreadsheetUrl : spreadsheetUrl });
    } catch (cause) {
      if (mounted.current && current === statusRequest.current) { setStatus(null); setStatusError(cause instanceof Error ? cause.message : "Не удалось проверить подключение."); }
    } finally { if (mounted.current && current === statusRequest.current) setStatusLoading(false); }
  }
  useEffect(() => {
    mounted.current = true;
    try {
      const raw = window.sessionStorage.getItem(LEDGER_PENDING_STORAGE_KEY);
      if (raw) {
        const restored = parsePending(raw);
        pendingRef.current = restored; setPending(restored); setRecovered(true); setFailed(restored.payload);
        setDraft(restored.payload.message); setSelection(restored.payload.selection ?? {});
        identity.current = { message: restored.payload.message, requestId: restored.payload.requestId };
      }
    } catch { setStorageWarning("Не удалось прочитать незавершённую команду этой вкладки. Перед повторным расходом проверьте журнал в таблице; не закрывайте вкладку до результата."); }
    void refreshStatus();
    return () => { mounted.current = false; statusRequest.current++; };
    // Status is fetched on authenticated mount; refreshing is an explicit owner action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function send(payload: LedgerCommand) {
    if (inFlight.current || status?.configured !== true) return;
    // An uncertain write may only be retried unchanged until an explicit new command.
    const existing = pendingRef.current;
    if (payload.kind === "message" && existing?.stage === "pending" && JSON.stringify(existing.payload) !== JSON.stringify(payload)) {
      setError("Сначала проверьте предыдущий запрос или явно начните новую команду. Предыдущая запись могла сохраниться."); return;
    }
    inFlight.current = true; setBusy(true); busyCallback.current?.(true); setError("");
    // Keep the immutable original payload for an uncertain network/server result.
    const snapshot: LedgerCommand = JSON.parse(JSON.stringify(payload));
    if (snapshot.kind === "message") persistPending({ version: 1, payload: snapshot, stage: "pending", createdAt: existing?.createdAt ?? Date.now() });
    try {
      const response = await fetch("/api/ledger", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(snapshot) });
      const data = await responseBody(response);
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Не удалось выполнить команду. Результат записи не подтверждён.");
      const result = ledgerReply(data);
      if (result.applied === true && result.operationId !== snapshot.requestId) throw new Error("Сервер подтвердил другую операцию. Черновик сохранён; проверьте тот же запрос.");
      if (!mounted.current) return;
      setReply(result); setSelection(result.selection); setFailed(null);
      if (Array.isArray(result.clients)) setKnownClients((previous) => [...previous.filter((client) => !result.clients!.some((next) => next.id === client.id)), ...result.clients!]);
      if (snapshot.kind === "message") {
        if (result.needsChoice) persistPending({ version: 1, payload: snapshot, stage: "choice", createdAt: existing?.createdAt ?? Date.now() });
        else clearPending();
        if (result.applied === true) {
          setDraft((current) => current.trim() === snapshot.message ? "" : current);
          if (identity.current?.requestId === snapshot.requestId) identity.current = null;
        }
      }
      // A choice updates context only. The original expense draft and its UUID remain intact.
    } catch (cause) {
      if (mounted.current) { setError(cause instanceof Error ? cause.message : "Не удалось выполнить команду."); setFailed(snapshot); }
    } finally { inFlight.current = false; busyCallback.current?.(false); if (mounted.current) setBusy(false); }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || inFlight.current) return;
    try {
      if (identity.current?.message !== message) identity.current = { message, requestId: requestId() };
      void send({ kind: "message", message, requestId: identity.current.requestId, selection: { ...selection } });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось подготовить команду."); }
  }
  function choose(clientId?: string, objectId?: string) {
    if (inFlight.current) return;
    try { void send({ kind: "select", clientId, objectId, requestId: requestId() }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось выбрать объект."); }
  }
  function updateDraft(value: string) {
    if (identity.current && identity.current.message !== value.trim()) identity.current = null;
    setDraft(value);
  }
  function newCommand() {
    if (pendingRef.current?.stage === "pending" && !window.confirm("Предыдущая запись могла сохраниться. Начать новую команду? Для безопасного повтора сначала можно проверить предыдущий запрос.")) return;
    clearPending(); setDraft(""); identity.current = null; setError(""); setFailed(null);
  }
  const currentClient = knownClients.find((client) => client.id === selection.clientId);
  const currentObject = reply?.currentObject && reply.currentObject.id === selection.objectId ? reply.currentObject : reply?.objects?.find((object) => object.id === selection.objectId);
  const expenses = reply?.expenses?.filter((expense) => !selection.objectId || expense.objectId === selection.objectId);
  const enabled = status?.configured === true && !statusLoading;
  const hasChoice = reply?.needsChoice !== undefined;

  return <section className={styles.ledger} aria-labelledby="business-ledger-title">
    <header className={styles.heading}><div><p className={styles.eyebrow}>БАЗА КОМПАНИИ</p><h2 id="business-ledger-title">Клиенты, объекты и расходы</h2><p>Найдите клиента по фамилии или телефону, выберите объект и внесите расход.</p></div><button className={styles.secondary} type="button" disabled={statusLoading || busy} onClick={() => void refreshStatus()}>Обновить подключение</button></header>
    {statusLoading && <p className={styles.status} role="status">Проверяю Google Sheets без изменения данных…</p>}
    {statusError && <div className={styles.error} role="alert"><strong>Проверка подключения не удалась</strong><p>{statusError}</p><p>Оставайтесь в разделе «Бизнес и продажи» и нажмите «Обновить подключение». Не открывайте адрес /api/ledger отдельно.</p></div>}
    {storageWarning && <p className={styles.warning} role="status">{storageWarning}</p>}
    {recovered && pending && <div className={styles.recovery}><strong>Есть незавершённая команда этой вкладки</strong><p>Она не отправлялась повторно автоматически. Проверьте её с прежним номером операции, чтобы избежать двойной записи.</p><button className={styles.secondary} type="button" disabled={busy || !enabled} onClick={() => void send(pending.payload)}>Проверить предыдущий запрос</button></div>}
    {status && <div className={status.configured ? styles.connected : styles.status} role="status"><strong>{status.configured ? "Google Sheets подключён" : "Google Sheets не подключён"}</strong><p>{status.message}</p>{!status.configured && <p>Проверьте доступ сервисного аккаунта к рабочей таблице и названия листов. Ничего не записывайте до устранения ошибки.</p>}</div>}
    {status?.configured === false && <div className={styles.setup}><h3>Подключите таблицу к сайту</h3><p>Вход в Google Drive внутри ChatGPT не передаёт доступ этому сайту. Нужна отдельная настройка сервера владельцем.</p><details><summary>Как подключить один раз</summary><ol><li>В Google Cloud включите Google Sheets API и создайте сервисный аккаунт. Получите его JSON-ключ.</li><li>В <a href={setupUrl} target="_blank" rel="noopener noreferrer">настройках текущего проекта Vercel</a> сохраните JSON в серверную переменную <code>GOOGLE_SERVICE_ACCOUNT_JSON</code> для Production.</li><li>В <a href={spreadsheetUrl} target="_blank" rel="noopener noreferrer">рабочей Google Таблице</a> выдайте доступ редактора адресу <code>client_email</code> из этого JSON.</li><li>Повторно разверните текущий проект в Vercel, затем нажмите «Обновить подключение» здесь.</li></ol><p>Ключ вводится только в защищённых настройках Vercel. В чат и поле команды его отправлять не нужно.</p></details></div>}
    <div className={styles.context} aria-label="Выбранный клиент и объект"><div><span className={styles.label}>Клиент</span><strong>{currentClient ? fullName(currentClient) : currentObject?.clientName || (selection.clientId ? "Клиент выбран" : "Ещё не выбран")}</strong>{currentClient?.phone && <span>{currentClient.phone}</span>}</div><div><span className={styles.label}>Объект</span><strong>{currentObject?.address || (selection.objectId ? "Объект выбран" : "Ещё не выбран")}</strong>{currentObject?.workType && <span>{currentObject.workType}</span>}</div></div>
    {reply?.needsChoice === "client" && <div className={styles.choices}><h3>Уточните клиента</h3><p>Есть несколько совпадений. Расход ещё не записан.</p>{reply.clients?.map((client) => <button type="button" className={styles.choice} key={client.id} disabled={busy || !enabled || pending?.stage === "pending"} onClick={() => choose(client.id)}><strong>{fullName(client)}</strong><span>{client.phone || "Телефон не указан"}</span></button>)}</div>}
    {(reply?.needsChoice === "object" || (reply?.objects && reply.objects.length > 1)) && <div className={styles.choices}><h3>Выберите объект</h3>{reply.needsChoice === "object" && <p>Сначала выберите адрес. Расход ещё не записан.</p>}{reply.objects?.map((object) => <button type="button" className={styles.choice} key={object.id} aria-pressed={selection.objectId === object.id} disabled={busy || !enabled || pending?.stage === "pending"} onClick={() => choose(object.clientId, object.id)}><strong>{object.address || "Адрес не указан"}</strong><span>{[object.clientName, object.workType, object.status].filter(Boolean).join(" · ")}</span></button>)}</div>}
    <form onSubmit={submit} className={styles.form}><label htmlFor="ledger-command">Команда помощнику</label><textarea id="ledger-command" value={draft} onChange={(event) => updateDraft(event.target.value)} maxLength={10000} rows={4} disabled={!enabled || busy} placeholder={'Например: «Иванов» или «Внеси расходы: сегодня доставка 2 000 рублей»'} /><p className={styles.hint}>Можно надиктовать команду микрофоном клавиатуры.</p><p className={styles.hint}>{hasChoice ? "Исходная команда сохранена. После выбора отправьте её явно — расход не добавляется автоматически." : selection.objectId ? "Объект выбран. Для следующего расхода повторять фамилию не нужно." : "Если клиентов или объектов несколько, помощник предложит выбрать. Пример в поле ничего не создаёт."}</p><div className={styles.actions}><button className={styles.primary} type="submit" disabled={!enabled || busy || !draft.trim()}>{busy ? "Выполняю команду…" : "Отправить команду"}</button><button className={styles.secondary} type="button" disabled={busy || (!draft && !pending)} onClick={newCommand}>Новая команда</button></div></form>
    {busy && <p className={styles.status} role="status">Проверяю данные на сервере. Не отправляйте эту операцию параллельно в другом окне.</p>}
    {error && <div className={styles.error} role="alert"><strong>Результат не подтверждён</strong><p>{error}</p>{failed && <><p>Для повтора используется та же операция. Данные команды сохранены до её изменения.</p><button className={styles.secondary} type="button" disabled={busy || !enabled} onClick={() => void send(failed)}>Повторить тот же запрос</button></>}</div>}
    {reply && <section className={styles.reply} aria-label="Ответ базы"><h3>Ответ по таблице</h3><p role="status" className={styles.replyText}>{reply.message}</p>{currentObject && <><dl className={styles.summary}><div><dt>Цена клиенту</dt><dd>{money(currentObject.priceRub)}</dd></div><div><dt>Внесённые расходы</dt><dd>{money(currentObject.recordedExpenseRub)}</dd></div><div><dt>Разница по внесённым расходам</dt><dd>{money(currentObject.preliminaryProfitRub)}</dd></div></dl><p className={styles.hint}>Разница предварительная: учитывает только внесённые расходы. Цена договора не подтверждает получение оплаты; это не чистая прибыль после налогов.</p></>}{expenses !== undefined && <div className={styles.expenses}><h3>Расходы из ответа сервера</h3>{expenses.length ? <ul>{expenses.map((expense) => <li key={expense.id}><div><strong>{expense.description}</strong><span>{[expense.date, expense.category].filter(Boolean).join(" · ")}</span>{expense.comment && <span>{expense.comment}</span>}</div><b>{money(expense.amountRub)}</b></li>)}</ul> : <p>В полученном списке расходов для выбранного объекта записей нет.</p>}</div>}</section>}
    <p className={styles.footer}><a href={spreadsheetUrl} target="_blank" rel="noopener noreferrer">Открыть рабочую таблицу</a> · В хранилище текущей вкладки остаётся только одна незавершённая команда для безопасного повтора. После подтверждения она удаляется; журнал и ключи здесь не сохраняются.</p>
  </section>;
}
