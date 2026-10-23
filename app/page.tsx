"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { calculateEstimateDocument, createDocumentId, displayedCell, formatEstimateProse, formatKopecks, parseEstimateDocument, serializeEstimateDocument, updateEstimateCell } from "@/lib/estimate";
import type { CalculatedTable, EstimateDocument, EstimateRow, EstimateTable } from "@/lib/estimate";
import { activeModeDocument, appendModeReply, buildChatPayload, decodeWorkspace, emptyWorkspace, loadWorkspace, modeDocuments, modeMessages, pendingModeRequest, recordModeRequest, saveWorkspace, switchWorkspaceMode, MAX_WORKSPACE_BYTES, WORKSPACE_STORAGE_KEY } from "@/lib/workspace-storage";
import type { ChatPayload, FacadeOptions, Mode, Workspace } from "@/lib/workspace-storage";
import { ASSISTANT_MODES as modes, revisionRequest } from "@/lib/assistant-modes";
import { MAX_MESSAGE_LENGTH, MAX_HISTORY_MESSAGE_LENGTH, MAX_BODY_BYTES } from "@/lib/chat-contract";
import BusinessLedger from "@/components/BusinessLedger";
import DriveConnection from "@/components/DriveConnection";
import type { DriveAutosave } from "@/lib/drive-autosave";
import { brandedDocumentHtml, brandedMarkdown, COMPANY_LOGO_URL, loadCompanyLogo } from "@/lib/document-branding";

type AuthState = { authenticated: boolean; configured: boolean };
const bytes = (value: unknown) => new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value)).byteLength;
function download(content: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function TableEditor({ table, calculation, onEdit, calculate = true }: { table: EstimateTable; calculation: CalculatedTable; calculate?: boolean; onEdit: (tableId: string, rowId: string, index: number, value: string) => void }) {
  const hasCalculation = calculate && calculation.hasCalculation;
  const extraSum = hasCalculation && calculation.sumIndex < 0;
  const headers = extraSum ? [...table.headers, "Сумма, руб. (расчёт)"] : table.headers;
  const value = (row: EstimateRow, index: number) => {
    if (index < table.headers.length) return calculate ? displayedCell(row, index, calculation) : row.cells[index] ?? "";
    const result = calculation.rows.find((item) => item.rowId === row.id)!;
    return result.kind === "section" ? "" : result.amountKopecks === null ? "Не рассчитано" : `${formatKopecks(result.amountKopecks)}${result.complete ? "" : " (неполно)"}`;
  };
  const field = (row: EstimateRow, index: number, mobile: boolean) => {
    const readOnly = index === calculation.sumIndex && hasCalculation || index >= table.headers.length;
    return <textarea className="estimate-card-input" aria-label={`${table.title}, строка ${table.rows.indexOf(row) + 1}: ${headers[index]}`} data-cell-id={`${row.id}:${index}`} value={value(row, index)} readOnly={readOnly} rows={mobile ? Math.min(5, Math.max(1, Math.ceil(value(row, index).length / 25))) : 2} inputMode={index === calculation.quantityIndex || index === calculation.priceIndex ? "decimal" : "text"} maxLength={2000} onChange={(event) => onEdit(table.id, row.id, index, event.target.value)} />;
  };
  return <section className="estimate-table" aria-label={`Таблица: ${table.title}`}>
    <div className="desktop-table-scroll"><table><thead><tr>{headers.map((header, index) => <th key={index} scope="col">{header}</th>)}</tr></thead><tbody>{table.rows.map((row) => <tr key={row.id} data-row-id={row.id}>{headers.map((_, index) => <td key={index}>{field(row, index, false)}</td>)}</tr>)}</tbody></table></div>
    <div className="mobile-table-cards">{table.rows.map((row) => <section className="mobile-table-card" key={row.id} data-row-id={row.id}>{headers.map((header, index) => <div className="mobile-table-field" key={index}><span className="mobile-table-label">{header}</span><div className="mobile-table-value">{field(row, index, true)}</div></div>)}</section>)}</div>
    {hasCalculation && <p className={`calculation-summary ${calculation.complete ? "" : "calculation-incomplete"}`}><strong>{calculation.complete ? "Арифметический итог" : "Известная часть"}: {formatKopecks(calculation.knownTotalKopecks)} ₽.</strong> {calculation.complete ? "Рассчитано из количества и цены каждой позиции. Проверьте объёмы и актуальность цен." : "Полный итог не определён. Заполните количество и цену всех позиций; неизвестные значения не равны нулю."}</p>}
  </section>;
}
function DocumentEditor({ document, onEdit, calculate = true }: { document: EstimateDocument; calculate?: boolean; onEdit: (tableId: string, rowId: string, index: number, value: string) => void }) {
  const calculation = useMemo(() => calculateEstimateDocument(document), [document]);
  return <div className="markdown-content">{document.blocks.map((block) => block.type === "table" ? <TableEditor key={block.id} table={block} calculation={calculation.tables.find((item) => item.tableId === block.id)!} onEdit={onEdit} calculate={calculate} /> : <ReactMarkdown key={block.id} remarkPlugins={[remarkGfm]}>{formatEstimateProse(block.text, calculate && calculation.hasCalculation)}</ReactMarkdown>)}</div>;
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
  const [pendingMode, setPendingMode] = useState<Mode | null>(null);
  const [businessView, setBusinessView] = useState<"accounting" | "sales">("accounting");
  const loading = pendingMode === workspace.mode;
  const requestBusy = pendingMode !== null;
  const [ledgerBusy, setLedgerBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<Mode, string>>>({});
  const [notices, setNotices] = useState<Partial<Record<Mode, string>>>({});
  const error = errors[workspace.mode] ?? "";
  const notice = notices[workspace.mode] ?? "";
  function setError(message: string, mode = workspace.mode) { setErrors(values => ({ ...values, [mode]: message })); }
  function setNotice(message: string, mode = workspace.mode) { setNotices(values => ({ ...values, [mode]: message })); }
  const inFlight = useRef(false);
  const exportInFlight = useRef(false);
  const cloud = useRef<DriveAutosave | null>(null);
  const documentContent = useRef<HTMLDivElement>(null);
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
  const current = activeModeDocument(workspace);
  const versions = modeDocuments(workspace);
  const messages = useMemo(() => modeMessages(workspace), [workspace.messages, workspace.documents, workspace.mode, workspace.legacyMode]);
  const failedRequest = pendingModeRequest(workspace);
  const currentCalculation = useMemo(() => current && current.calculation !== "none" ? calculateEstimateDocument(current.document) : undefined, [current]);
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
    if (payload.message.length > MAX_MESSAGE_LENGTH || bytes(payload) > MAX_BODY_BYTES) { setError("Запрос слишком велик. Сократите сообщение или экспортируйте документ отдельно."); return; }
    inFlight.current = true; setPendingMode(payload.mode); setError("", payload.mode); setNotice("", payload.mode);
    setWorkspace(value => recordModeRequest(value, payload));
    try {
      const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json();
      if (!response.ok) { if (response.status === 401) setAuth((value) => value ? { ...value, authenticated: false } : value); throw new Error(data.error || "Ошибка запроса."); }
      if (typeof data.reply !== "string" || !data.reply.trim()) throw new Error("Помощник не вернул ответ. Предыдущие данные сохранены.");
      const id = createDocumentId();
      const calculation = data.calculation === "estimate" || data.calculation === "none" ? data.calculation
        : payload.mode === "estimate" || payload.mode === "facade" ? "estimate" : "none";
      const document = parseEstimateDocument(data.reply, id, calculation !== "none");
      const version = { id, createdAt: new Date().toISOString(), mode: payload.mode, prompt: payload.message, document, calculation: calculation as "estimate" | "none" };
      const userId = createDocumentId(), assistantId = createDocumentId();
      setWorkspace(value => appendModeReply(value, payload, version, data.reply, userId, assistantId));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось получить ответ. Предыдущие данные сохранены.", payload.mode); }
    finally { inFlight.current = false; setPendingMode(null); }
  }
  function submit(event: FormEvent) { event.preventDefault(); const message = workspace.draft.trim(); if (message) void sendPayload(buildChatPayload(workspace, message)); }
  function editCell(tableId: string, rowId: string, index: number, value: string) {
    setWorkspace((previous) => ({ ...previous, documents: previous.documents.map((version) => version.id === current?.id && version.mode === workspace.mode ? { ...version, document: updateEstimateCell(version.document, tableId, rowId, index, value) } : version) }));
  }
  function snapshot() {
    if (!current) return;
    const id = createDocumentId();
    const version = { ...current, id, createdAt: new Date().toISOString(), document: parseEstimateDocument(serializeEstimateDocument(current.document, current.calculation !== "none"), id, current.calculation !== "none") };
    setWorkspace((value) => ({ ...value, documents: [...value.documents, version], activeDocumentId: id })); setNotice("Версия сохранена в этом браузере.");
  }
  function requestRevision() {
    if (!current) return;
    const prompt = revisionRequest(workspace.mode, current.document, current.calculation !== "none");
    const payload = buildChatPayload(workspace, prompt);
    const content = serializeEstimateDocument(current.document, current.calculation !== "none");
    if (content.length > MAX_HISTORY_MESSAGE_LENGTH) { setError("Документ слишком велик для одного запроса. Экспортируйте его и разбейте проверку по разделам."); return; }
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
      setWorkspace(imported); setStorageBlocked(false); setStorageError(""); setErrors({}); setNotices({ [imported.mode]: "Проект восстановлен из файла в этом браузере." });
    } catch (cause) { setStorageError(cause instanceof Error ? cause.message : "Не удалось прочитать файл. Текущий проект сохранён."); }
    finally { input.value = ""; }
  }
  function clearWorkspace() {
    if (!window.confirm("Удалить диалог и все версии из этого браузера? Сначала можно экспортировать резервную копию.")) return;
    try { cloud.current?.pause(); window.localStorage.removeItem(WORKSPACE_STORAGE_KEY); setStorageBlocked(false); setWorkspace(emptyWorkspace()); setStorageError(""); setErrors({}); setNotices({ general: "Локальные данные удалены." }); } catch { setStorageError("Браузер не разрешил удалить данные."); }
  }
  async function copyAnswer() {
    if (!current) return;
    try { await navigator.clipboard.writeText(brandedMarkdown(serializeEstimateDocument(current.document, current.calculation !== "none"), window.location.origin)); setNotice("Скопирована текущая версия с вашими правками и ссылкой на логотип. Для файла со встроенным изображением используйте «Скачать документ с логотипом»."); }
    catch { setNotice("Копирование недоступно в этом браузере. Используйте «Скачать текст»."); }
  }
  async function downloadBrandedDocument() {
    if (!current || !documentContent.current || exportInFlight.current) return;
    exportInFlight.current = true; setExportBusy(true); setNotice("");
    const source = documentContent.current;
    const snapshot = source.cloneNode(true) as HTMLDivElement;
    const inputs = source.querySelectorAll("textarea");
    snapshot.querySelectorAll("textarea").forEach((input, index) => { input.value = inputs[index].value; });
    const title = modes.find((item) => item.id === current.mode)?.label ?? "Документ";
    const versionDate = new Date(current.createdAt).toLocaleString("ru-RU", { timeZone: "Asia/Irkutsk" });
    try {
      const logo = await loadCompanyLogo();
      download(brandedDocumentHtml(snapshot, logo, title, versionDate), "svoi-lyudi-document.html", "text/html;charset=utf-8");
      setNotice("Документ со встроенным логотипом скачан в HTML. Откройте файл в браузере; через меню печати его можно сохранить в PDF.");
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : "Не удалось подготовить документ с логотипом. Повторите выгрузку."); }
    finally { exportInFlight.current = false; setExportBusy(false); }
  }
  return <main className="app-shell">
    <header className="hero"><img className="company-logo" src={COMPANY_LOGO_URL} width={1672} height={941} alt="Логотип СВОИ ЛЮДИ" /><div><h1 className="eyebrow">СТРОИТЕЛЬНЫЙ ПОМОЩНИК</h1><p className="subtitle">Помощник для строительного бизнеса в Иркутске</p></div></header>
    {!auth && <p className="status" role="status">Проверяю доступ…</p>}
    {auth && !auth.authenticated && <section className="panel auth-panel"><h2>Вход владельца</h2>{auth.configured ? <form onSubmit={login}><label className="field-label" htmlFor="access-password">Пароль помощника</label><input id="access-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required maxLength={256} /><button className="primary-button" disabled={authLoading || !password} type="submit">{authLoading ? "Проверяю…" : "Войти"}</button></form> : <p>Сервис ещё не настроен. Обратитесь к администратору.</p>}{authError && <p className="error-box" role="alert">{authError}</p>}</section>}
    {auth?.authenticated && <>
      <section className="panel"><div className="section-heading"><div><h2>Выберите направление</h2><p>Это помогает помощнику точнее учитывать задачу.</p></div><button type="button" className="secondary-button" onClick={logout} disabled={requestBusy || ledgerBusy}>Выйти</button></div><div className="mode-grid">{modes.map((item) => <button className={workspace.mode === item.id ? "mode-card selected" : "mode-card"} type="button" key={item.id} onClick={() => setWorkspace(value => switchWorkspaceMode(value, item.id))} aria-pressed={workspace.mode === item.id}><span className="mode-title">{item.label}</span><span className="mode-description">{item.description}</span></button>)}</div></section>
      {workspace.mode === "business" && <section className="panel"><h2>Бизнес и продажи</h2><div className="action-row" role="group" aria-label="Разделы бизнеса"><button type="button" className={businessView === "accounting" ? "primary-button" : "secondary-button"} aria-pressed={businessView === "accounting"} onClick={() => setBusinessView("accounting")}>Клиенты и учёт</button><button type="button" className={businessView === "sales" ? "primary-button" : "secondary-button"} aria-pressed={businessView === "sales"} onClick={() => setBusinessView("sales")}>Продажи и развитие</button></div><p>{businessView === "accounting" ? "Клиенты, объекты и расходы: чтение и запись в рабочую таблицу." : "Консультации по продажам, переговорам и привлечению заказов. Сообщения здесь не записывают клиентов или расходы в таблицу."}</p></section>}
      <div hidden={workspace.mode !== "business" || businessView !== "accounting"}><BusinessLedger onBusyChange={setLedgerBusy} /></div>
      <section className="panel chat-panel" style={workspace.mode === "business" && businessView === "accounting" ? { display: "none" } : undefined}><div className="section-heading"><div><p className="eyebrow">ТЕКУЩИЙ РЕЖИМ</p><h2>{selectedMode.label}</h2><p>{selectedMode.description}</p></div></div>
        {workspace.mode === "facade" && <div className="variant-select"><label className="field-label" htmlFor="facade-options">Варианты фасада</label><select id="facade-options" value={workspace.facadeOptions} onChange={(event) => setWorkspace((value) => ({ ...value, facadeOptions: event.target.value as FacadeOptions }))}><option value="auto">Определить по запросу</option><option value="without">Без утепления</option><option value="with">С утеплением</option><option value="both">Сравнить оба варианта</option></select></div>}
        <p>У этой вкладки свой диалог, черновик и сохранённые ответы.</p>
        <div className="action-row" aria-label="Примеры задач">{selectedMode.examples.map(example => <button type="button" className="secondary-button" key={example} onClick={() => setWorkspace(value => ({ ...value, draft: example }))}>{example}</button>)}</div>
        {pendingMode && pendingMode !== workspace.mode && <p className="status" role="status">Выполняется запрос во вкладке «{modes.find(item => item.id === pendingMode)?.label}». Здесь можно подготовить черновик.</p>}
        <form onSubmit={submit}><label className="field-label" htmlFor="message">Опишите задачу</label><textarea id="message" value={workspace.draft} onChange={(event) => setWorkspace((value) => ({ ...value, draft: event.target.value }))} placeholder={selectedMode.prompt} rows={5} maxLength={MAX_MESSAGE_LENGTH} /><div className="form-footer"><span className="hint">{workspace.draft.length}/{MAX_MESSAGE_LENGTH} символов. Предыдущие вопросы учитываются.</span><button className="primary-button" type="submit" disabled={requestBusy || !workspace.draft.trim() || !hydrated}>{loading ? "Готовлю ответ…" : "Отправить вопрос"}</button></div></form>
        {loading && <div className="status" role="status">Анализирую задачу. Предыдущий ответ и правки остаются доступными.</div>}
        {error && <div className="error-box" role="alert"><strong>Не удалось получить ответ</strong><p>{error}</p>{failedRequest && <button className="secondary-button" type="button" disabled={requestBusy} onClick={() => void sendPayload(failedRequest!)}>Повторить тот же запрос</button>}</div>}
        {!error && !loading && failedRequest && <div className="status"><p>Предыдущий запрос не завершён. Ответы и внесённые правки сохранены в этой вкладке.</p><button className="secondary-button" type="button" onClick={() => void sendPayload(failedRequest!)}>Повторить тот же запрос</button></div>}
        {notice && <p className="status" role="status">{notice}</p>}
        {current && <article className="answer"><img className="document-logo" src={COMPANY_LOGO_URL} width={1672} height={941} alt="Логотип СВОИ ЛЮДИ на документе" /><div className="answer-heading"><span className="answer-dot" /><h3>Ответ помощника</h3></div><label className="field-label version-label" htmlFor="document-version">Сохранённая версия</label><select id="document-version" value={current.id} onChange={(event) => setWorkspace((value) => ({ ...value, activeDocumentId: event.target.value }))}>{versions.map((version, index) => <option key={version.id} value={version.id}>Версия {index + 1} · {new Date(version.createdAt).toLocaleString("ru-RU")} · {version.prompt.slice(0, 48)}</option>)}</select><div ref={documentContent}><DocumentEditor document={current.document} onEdit={editCell} calculate={current.calculation !== "none"} /></div>
          <div className="estimate-edit-actions">{currentCalculation?.hasCalculation && <p>Меняйте поля таблицы или карточек. Единицы измерения сохраняются; суммы рассчитываются автоматически. Неизвестная цена требует уточнения.</p>}<button className="primary-button" type="button" disabled={requestBusy} onClick={requestRevision}>{selectedMode.revisionLabel}</button></div>
          <div className="action-row"><button className="secondary-button" type="button" disabled={exportBusy} onClick={() => void downloadBrandedDocument()}>{exportBusy ? "Готовлю файл с логотипом…" : "Скачать документ с логотипом"}</button><button className="secondary-button" type="button" onClick={copyAnswer}>Копировать ответ</button><button className="secondary-button" type="button" onClick={() => download(brandedMarkdown(serializeEstimateDocument(current.document, current.calculation !== "none"), window.location.origin), `builder-${workspace.mode}.md`, "text/markdown;charset=utf-8")}>Скачать текст</button><button className="secondary-button" type="button" onClick={snapshot}>Сохранить отдельную версию</button></div></article>}
        {messages.length > 0 && <details className="conversation-history"><summary>История вкладки ({messages.length})</summary>{messages.map((item) => <div className="history-message" key={item.id}><strong>{item.role === "user" ? "Вы" : "Помощник"}</strong><p>{item.content}</p>{item.documentId && versions.some((version) => version.id === item.documentId) && <button className="secondary-button" type="button" onClick={() => setWorkspace((value) => ({ ...value, activeDocumentId: item.documentId! }))}>Открыть сохранённый ответ</button>}</div>)}</details>}
      </section>
    </>}
    <section className="panel storage-panel" style={auth?.authenticated && workspace.mode === "business" && businessView === "accounting" ? { display: "none" } : undefined}><h2>Сохранение проекта</h2><p>Диалог, версии и правки сохраняются в браузере и автоматически отправляются в подключённый Google Drive. Статус облачной копии показан ниже. Экспорт файла остаётся резервным способом сохранения.</p>{storageError && <p className="error-box" role="alert">{storageError}</p>}<div className="action-row"><button type="button" className="secondary-button" disabled={!hydrated} onClick={() => { try { const content = storageBlocked ? window.localStorage.getItem(WORKSPACE_STORAGE_KEY) ?? JSON.stringify(workspace) : JSON.stringify(workspace); download(content, "builder-workspace.json", "application/json"); } catch { setStorageError("Не удалось экспортировать данные браузера."); } }}>Экспортировать проект</button><label className="secondary-button import-button">Восстановить из файла<input aria-label="Восстановить проект из файла" type="file" accept="application/json,.json" disabled={requestBusy || !hydrated} onChange={importWorkspace} /></label><button type="button" className="secondary-button" disabled={requestBusy || !hydrated} onClick={clearWorkspace}>Очистить локальные данные</button></div></section>
    {auth?.authenticated && hydrated && !storageBlocked && <DriveConnection workspace={workspace} onRestore={setWorkspace} onRegister={controller => { cloud.current = controller; }} />}
    <footer className="footer">Проверяйте исходные данные, цены и технические требования перед выполнением работ. Расчёты несущих конструкций требуют проверки специалистом.</footer>
  </main>;
}
