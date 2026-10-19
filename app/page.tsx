"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { calculateEstimateDocument, createDocumentId, displayedCell, formatEstimateProse, formatKopecks, parseEstimateDocument, serializeEstimateDocument, updateEstimateCell } from "@/lib/estimate";
import type { CalculatedTable, EstimateDocument, EstimateRow, EstimateTable } from "@/lib/estimate";
import { buildChatPayload, decodeWorkspace, emptyWorkspace, loadWorkspace, saveWorkspace, MAX_WORKSPACE_BYTES, WORKSPACE_STORAGE_KEY } from "@/lib/workspace-storage";
import type { ChatPayload, FacadeOptions, Mode, Workspace } from "@/lib/workspace-storage";
import { MAX_MESSAGE_LENGTH, MAX_HISTORY_MESSAGE_LENGTH, MAX_BODY_BYTES } from "@/lib/chat-contract";
import BusinessLedger from "@/components/BusinessLedger";

const modes: { id: Mode; label: string; description: string; prompt: string }[] = [
  { id: "general", label: "Общий помощник", description: "Дом, стройка и организация работ", prompt: "Опиши задачу, объект или вопрос по строительству." },
  { id: "estimate", label: "Смета и расчёты", description: "Материалы, работы, количество и стоимость", prompt: "Например: помоги составить смету. Сначала уточни недостающие исходные данные." },
  { id: "engineering", label: "Технологии и конструкции", description: "Фундаменты, стены, подпорные стены, кровля", prompt: "Опиши конструкцию и исходные данные. Укажи, какие сведения ещё необходимы для безопасной оценки." },
  { id: "facade", label: "Фасады", description: "Сайдинг, панели, утепление и подсистемы", prompt: "Опиши дом, площадь фасада, облицовку и необходимость утепления." },
  { id: "business", label: "Бизнес и продажи", description: "Клиенты, объекты и запись расходов в таблицу", prompt: "Назовите клиента или поручите внести расходы." },
  { id: "documents", label: "Документы", description: "Коммерческие предложения, договоры и акты", prompt: "Укажи вид документа, стороны, объект, объём работ и известные условия." },
];
type AuthState = { authenticated: boolean; configured: boolean };
const bytes = (value: unknown) => new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value)).byteLength;
function download(content: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function TableEditor({ table, calculation, onEdit }: { table: EstimateTable; calculation: CalculatedTable; onEdit: (tableId: string, rowId: string, index: number, value: string) => void }) {
  const extraSum = calculation.hasCalculation && calculation.sumIndex < 0;
  const headers = extraSum ? [...table.headers, "Сумма, руб. (расчёт)"] : table.headers;
  const value = (row: EstimateRow, index: number) => {
    if (index < table.headers.length) return displayedCell(row, index, calculation);
    const result = calculation.rows.find((item) => item.rowId === row.id)!;
    return result.kind === "section" ? "" : result.amountKopecks === null ? "Не рассчитано" : `${formatKopecks(result.amountKopecks)}${result.complete ? "" : " (неполно)"}`;
  };
  const field = (row: EstimateRow, index: number, mobile: boolean) => {
    const readOnly = index === calculation.sumIndex && calculation.hasCalculation || index >= table.headers.length;
    return <textarea className="estimate-card-input" aria-label={`${table.title}, строка ${table.rows.indexOf(row) + 1}: ${headers[index]}`} data-cell-id={`${row.id}:${index}`} value={value(row, index)} readOnly={readOnly} rows={mobile ? Math.min(5, Math.max(1, Math.ceil(value(row, index).length / 25))) : 2} inputMode={index === calculation.quantityIndex || index === calculation.priceIndex ? "decimal" : "text"} maxLength={2000} onChange={(event) => onEdit(table.id, row.id, index, event.target.value)} />;
  };
  return <section className="estimate-table" aria-label={`Таблица: ${table.title}`}>
    <div className="desktop-table-scroll"><table><thead><tr>{headers.map((header, index) => <th key={index} scope="col">{header}</th>)}</tr></thead><tbody>{table.rows.map((row) => <tr key={row.id} data-row-id={row.id}>{headers.map((_, index) => <td key={index}>{field(row, index, false)}</td>)}</tr>)}</tbody></table></div>
    <div className="mobile-table-cards">{table.rows.map((row) => <section className="mobile-table-card" key={row.id} data-row-id={row.id}>{headers.map((header, index) => <div className="mobile-table-field" key={index}><span className="mobile-table-label">{header}</span><div className="mobile-table-value">{field(row, index, true)}</div></div>)}</section>)}</div>
    {calculation.hasCalculation && <p className={`calculation-summary ${calculation.complete ? "" : "calculation-incomplete"}`}><strong>{calculation.complete ? "Арифметический итог" : "Известная часть"}: {formatKopecks(calculation.knownTotalKopecks)} ₽.</strong> {calculation.complete ? "Рассчитано из количества и цены каждой позиции. Проверьте объёмы и актуальность цен." : "Полный итог не определён. Заполните количество и цену всех позиций; неизвестные значения не равны нулю."}</p>}
  </section>;
}
function DocumentEditor({ document, onEdit }: { document: EstimateDocument; onEdit: (tableId: string, rowId: string, index: number, value: string) => void }) {
  const calculation = useMemo(() => calculateEstimateDocument(document), [document]);
  return <div className="markdown-content">{document.blocks.map((block) => block.type === "table" ? <TableEditor key={block.id} table={block} calculation={calculation.tables.find((item) => item.tableId === block.id)!} onEdit={onEdit} /> : <ReactMarkdown key={block.id} remarkPlugins={[remarkGfm]}>{formatEstimateProse(block.text, calculation.hasCalculation)}</ReactMarkdown>)}</div>;
}

export default function Home() {
  const [workspace, setWorkspace] = useState<Workspace>(emptyWorkspace);
  const [hydrated, setHydrated] = useState(false);
  const [storageBlocked, setStorageBlocked] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [authError, setAuthError] = useState("");
  const [password, setPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ledgerBusy, setLedgerBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const inFlight = useRef(false);
  useEffect(() => {
    try { setWorkspace(loadWorkspace(window.localStorage)); }
    catch (cause) { setStorageError(cause instanceof Error ? cause.message : "Хранилище браузера недоступно."); setStorageBlocked(true); }
    setHydrated(true);
    let cancelled = false;
    fetch("/api/auth", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error("Не удалось проверить доступ. Обновите страницу.");
      const data = await response.json();
      if (!cancelled) setAuth({ authenticated: data.authenticated === true, configured: data.configured === true });
    }).catch((cause) => { if (!cancelled) { setAuthError(cause instanceof Error ? cause.message : "Не удалось проверить доступ."); setAuth({ configured: false, authenticated: false }); } });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!hydrated || storageBlocked) return;
    const timer = setTimeout(() => { try { saveWorkspace(window.localStorage, workspace); setStorageError(""); } catch { setStorageError("Не удалось сохранить проект в этом браузере. Экспортируйте резервную копию перед закрытием."); } }, 250);
    return () => clearTimeout(timer);
  }, [workspace, hydrated, storageBlocked]);
  // Flush the latest edits when the browser navigates away instead of losing the debounce window.
  useEffect(() => {
    const flush = () => { if (hydrated && !storageBlocked) { try { saveWorkspace(window.localStorage, workspace); } catch { /* Existing project is retained; status is reported by the normal save path. */ } } };
    window.addEventListener("pagehide", flush); return () => window.removeEventListener("pagehide", flush);
  }, [workspace, hydrated, storageBlocked]);
  const selectedMode = modes.find((item) => item.id === workspace.mode) ?? modes[0];
  const current = workspace.documents.find((item) => item.id === workspace.activeDocumentId);
  async function login(event: FormEvent) {
    event.preventDefault(); if (authLoading) return;
    setAuthLoading(true); setAuthError("");
    try { const response = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Не удалось войти."); setAuth({ authenticated: data.authenticated === true, configured: data.configured === true }); setPassword(""); }
    catch (cause) { setAuthError(cause instanceof Error ? cause.message : "Не удалось войти."); }
    finally { setAuthLoading(false); }
  }
  async function logout() {
    try { const response = await fetch("/api/auth", { method: "DELETE" }); if (!response.ok) throw new Error("Не удалось завершить сессию."); setAuth((value) => value ? { ...value, authenticated: false } : value); setPassword(""); }
    catch (cause) { setAuthError(cause instanceof Error ? cause.message : "Не удалось выйти."); }
  }
  async function sendPayload(payload: ChatPayload) {
    if (inFlight.current || !auth?.authenticated) return;
    if (payload.message.length > MAX_MESSAGE_LENGTH || bytes(payload) > MAX_BODY_BYTES) { setError("Запрос слишком велик. Сократите сообщение или сохраните смету отдельно."); return; }
    inFlight.current = true; setLoading(true); setError(""); setNotice("");
    setWorkspace((value) => ({ ...value, failedRequest: payload }));
    try {
      const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json();
      if (!response.ok) { if (response.status === 401) setAuth((value) => value ? { ...value, authenticated: false } : value); throw new Error(data.error || "Ошибка запроса."); }
      if (typeof data.reply !== "string" || !data.reply.trim()) throw new Error("Помощник не вернул ответ. Предыдущие данные сохранены.");
      const id = createDocumentId(); const document = parseEstimateDocument(data.reply, id);
      setWorkspace((value) => ({ ...value, draft: value.draft === payload.message ? "" : value.draft, failedRequest: undefined, messages: [...value.messages, { id: createDocumentId(), role: "user" as const, content: payload.message }, { id: createDocumentId(), role: "assistant" as const, content: data.reply, documentId: id }], documents: [...value.documents, { id, createdAt: new Date().toISOString(), mode: payload.mode, prompt: payload.message, document }], activeDocumentId: id }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось получить ответ. Смета и правки сохранены."); }
    finally { inFlight.current = false; setLoading(false); }
  }
  function submit(event: FormEvent) { event.preventDefault(); const message = workspace.draft.trim(); if (message) void sendPayload(buildChatPayload(workspace, message)); }
  function editCell(tableId: string, rowId: string, index: number, value: string) {
    setWorkspace((previous) => ({ ...previous, documents: previous.documents.map((version) => version.id === previous.activeDocumentId ? { ...version, document: updateEstimateCell(version.document, tableId, rowId, index, value) } : version) }));
  }
  function snapshot() {
    if (!current) return;
    const id = createDocumentId();
    const version = { ...current, id, createdAt: new Date().toISOString(), document: parseEstimateDocument(serializeEstimateDocument(current.document), id) };
    setWorkspace((value) => ({ ...value, documents: [...value.documents, version], activeDocumentId: id })); setNotice("Версия сохранена в этом браузере.");
  }
  function requestRevision() {
    if (!current) return;
    const payload = buildChatPayload(workspace, "Проверь текущую отредактированную смету. Сохрани все позиции, варианты, единицы и примечания; не добавляй вымышленные цены. Уточни только недостающие данные и верни полную смету.");
    const content = serializeEstimateDocument(current.document);
    if (content.length > MAX_HISTORY_MESSAGE_LENGTH) { setError("Смета слишком велика для одного запроса. Экспортируйте её и разбейте проверку по разделам."); return; }
    void sendPayload(payload);
  }
  async function importWorkspace(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    try {
      if (file.size > MAX_WORKSPACE_BYTES) throw new Error("Файл проекта слишком велик. Максимум — 5 МБ.");
      const imported = decodeWorkspace(await file.text());
      if (!window.confirm("Заменить локальный проект данными из файла? Текущий проект можно предварительно экспортировать.")) return;
      // Validate and successfully save the replacement before changing the visible workspace.
      saveWorkspace(window.localStorage, imported);
      setWorkspace(imported); setStorageBlocked(false); setStorageError(""); setError(""); setNotice("Проект восстановлен из файла в этом браузере.");
    } catch (cause) { setStorageError(cause instanceof Error ? cause.message : "Не удалось прочитать файл. Текущий проект сохранён."); }
    finally { input.value = ""; }
  }
  function clearWorkspace() {
    if (!window.confirm("Удалить диалог и все версии из этого браузера? Сначала можно экспортировать резервную копию.")) return;
    try { window.localStorage.removeItem(WORKSPACE_STORAGE_KEY); setStorageBlocked(false); setWorkspace(emptyWorkspace()); setStorageError(""); setError(""); setNotice("Локальные данные удалены."); } catch { setStorageError("Браузер не разрешил удалить данные."); }
  }
  async function copyAnswer() {
    if (!current) return;
    try { await navigator.clipboard.writeText(serializeEstimateDocument(current.document)); setNotice("Скопирована текущая версия с вашими правками и пересчитанными суммами."); }
    catch { setNotice("Копирование недоступно в этом браузере. Используйте «Скачать смету»."); }
  }
  return <main className="app-shell">
    <header className="hero"><div className="brand-mark" aria-hidden="true">СП</div><div><p className="eyebrow">СТРОИТЕЛЬНЫЙ ПОМОЩНИК</p><h1>«СВОИ ЛЮДИ»</h1><p className="subtitle">Помощник для строительного бизнеса в Иркутске</p></div></header>
    {!auth && <p className="status" role="status">Проверяю доступ…</p>}
    {auth && !auth.authenticated && <section className="panel auth-panel"><h2>Вход владельца</h2>{auth.configured ? <form onSubmit={login}><label className="field-label" htmlFor="access-password">Пароль помощника</label><input id="access-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required maxLength={256} /><button className="primary-button" disabled={authLoading || !password} type="submit">{authLoading ? "Проверяю…" : "Войти"}</button></form> : <p>Сервис ещё не настроен. Обратитесь к администратору.</p>}{authError && <p className="error-box" role="alert">{authError}</p>}</section>}
    {auth?.authenticated && <>
      <section className="panel"><div className="section-heading"><div><h2>Выберите направление</h2><p>Это помогает помощнику точнее учитывать задачу.</p></div><button type="button" className="secondary-button" onClick={logout} disabled={loading || ledgerBusy}>Выйти</button></div><div className="mode-grid">{modes.map((item) => <button className={workspace.mode === item.id ? "mode-card selected" : "mode-card"} type="button" key={item.id} onClick={() => setWorkspace((value) => ({ ...value, mode: item.id }))} aria-pressed={workspace.mode === item.id}><span className="mode-title">{item.label}</span><span className="mode-description">{item.description}</span></button>)}</div></section>
      <div hidden={workspace.mode !== "business"}><BusinessLedger onBusyChange={setLedgerBusy} /></div>
      <section className="panel chat-panel" style={workspace.mode === "business" ? { display: "none" } : undefined}><div className="section-heading"><div><p className="eyebrow">ТЕКУЩИЙ РЕЖИМ</p><h2>{selectedMode.label}</h2><p>{selectedMode.description}</p></div></div>
        {(workspace.mode === "estimate" || workspace.mode === "facade") && <div className="variant-select"><label className="field-label" htmlFor="facade-options">Варианты фасада</label><select id="facade-options" value={workspace.facadeOptions} onChange={(event) => setWorkspace((value) => ({ ...value, facadeOptions: event.target.value as FacadeOptions }))}><option value="auto">Определить по запросу</option><option value="without">Без утепления</option><option value="with">С утеплением</option><option value="both">Сравнить оба варианта</option></select></div>}
        <form onSubmit={submit}><label className="field-label" htmlFor="message">Опишите задачу</label><textarea id="message" value={workspace.draft} onChange={(event) => setWorkspace((value) => ({ ...value, draft: event.target.value }))} placeholder={selectedMode.prompt} rows={5} maxLength={MAX_MESSAGE_LENGTH} /><div className="form-footer"><span className="hint">{workspace.draft.length}/{MAX_MESSAGE_LENGTH} символов. Предыдущие вопросы учитываются.</span><button className="primary-button" type="submit" disabled={loading || !workspace.draft.trim() || !hydrated}>{loading ? "Готовлю ответ…" : "Отправить вопрос"}</button></div></form>
        {loading && <div className="status" role="status">Анализирую задачу. Предыдущая смета и правки остаются доступными.</div>}
        {error && <div className="error-box" role="alert"><strong>Не удалось получить ответ</strong><p>{error}</p>{workspace.failedRequest && <button className="secondary-button" type="button" disabled={loading} onClick={() => void sendPayload(workspace.failedRequest!)}>Повторить тот же запрос</button>}</div>}
        {!error && !loading && workspace.failedRequest && <div className="status"><p>Предыдущий запрос не завершён. Смета и внесённые правки сохранены.</p><button className="secondary-button" type="button" onClick={() => void sendPayload(workspace.failedRequest!)}>Повторить тот же запрос</button></div>}
        {notice && <p className="status" role="status">{notice}</p>}
        {current && <article className="answer"><div className="answer-heading"><span className="answer-dot" /><h3>Ответ помощника</h3></div><label className="field-label version-label" htmlFor="document-version">Сохранённая версия</label><select id="document-version" value={current.id} onChange={(event) => setWorkspace((value) => ({ ...value, activeDocumentId: event.target.value }))}>{workspace.documents.map((version, index) => <option key={version.id} value={version.id}>Версия {index + 1} · {new Date(version.createdAt).toLocaleString("ru-RU")} · {version.prompt.slice(0, 48)}</option>)}</select><DocumentEditor document={current.document} onEdit={editCell} />
          {current.document.blocks.some((block) => block.type === "table") && <div className="estimate-edit-actions"><p>Меняйте поля таблицы или карточек. Единицы измерения сохраняются; суммы рассчитываются автоматически. Неизвестная цена требует уточнения.</p><button className="primary-button" type="button" disabled={loading} onClick={requestRevision}>Проверить текущую смету с помощником</button></div>}
          <div className="action-row"><button className="secondary-button" type="button" onClick={copyAnswer}>Копировать ответ</button><button className="secondary-button" type="button" onClick={() => download(serializeEstimateDocument(current.document), "smeta.md", "text/markdown;charset=utf-8")}>Скачать смету</button><button className="secondary-button" type="button" onClick={snapshot}>Сохранить отдельную версию</button></div></article>}
        {workspace.messages.length > 0 && <details className="conversation-history"><summary>История диалога ({workspace.messages.length})</summary>{workspace.messages.map((item) => <div className="history-message" key={item.id}><strong>{item.role === "user" ? "Вы" : "Помощник"}</strong><p>{item.content}</p>{item.documentId && workspace.documents.some((version) => version.id === item.documentId) && <button className="secondary-button" type="button" onClick={() => setWorkspace((value) => ({ ...value, activeDocumentId: item.documentId! }))}>Открыть сохранённый ответ</button>}</div>)}</details>}
      </section>
    </>}
    <section className="panel storage-panel" style={auth?.authenticated && workspace.mode === "business" ? { display: "none" } : undefined}><h2>Сохранение проекта</h2><p>Диалог, версии и правки сохраняются только в этом браузере на этом устройстве. На общем компьютере после работы экспортируйте нужное и очистите данные.</p>{storageError && <p className="error-box" role="alert">{storageError}</p>}<div className="action-row"><button type="button" className="secondary-button" disabled={!hydrated} onClick={() => { try { const content = storageBlocked ? window.localStorage.getItem(WORKSPACE_STORAGE_KEY) ?? JSON.stringify(workspace) : JSON.stringify(workspace); download(content, "builder-workspace.json", "application/json"); } catch { setStorageError("Не удалось экспортировать данные браузера."); } }}>Экспортировать проект</button><label className="secondary-button import-button">Восстановить из файла<input aria-label="Восстановить проект из файла" type="file" accept="application/json,.json" disabled={loading || !hydrated} onChange={importWorkspace} /></label><button type="button" className="secondary-button" disabled={loading || !hydrated} onClick={clearWorkspace}>Очистить локальные данные</button></div></section>
    <footer className="footer">Проверяйте исходные данные, цены и технические требования перед выполнением работ. Расчёты несущих конструкций требуют проверки специалистом.</footer>
  </main>;
}
