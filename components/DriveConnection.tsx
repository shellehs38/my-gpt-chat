"use client";

import { useEffect, useRef, useState } from "react";
import { DriveAutosave, type AutosaveState } from "@/lib/drive-autosave";
import type { Workspace } from "@/lib/workspace-storage";

type Props = { workspace: Workspace; onRestore: (workspace: Workspace) => void; onRegister: (controller: DriveAutosave | null) => void };
export default function DriveConnection({ workspace, onRestore, onRegister }: Props) {
  const [state, setState] = useState<AutosaveState>({ status: "checking", message: "Проверяю автосохранение…", heads: [], revisions: [] });
  const [authorizing, setAuthorizing] = useState(false);
  const engine = useRef<DriveAutosave | null>(null);
  const latest = useRef(workspace);
  const previous = useRef(workspace);
  const restore = useRef(onRestore);
  const register = useRef(onRegister);
  useEffect(() => { latest.current = workspace; restore.current = onRestore; register.current = onRegister; });
  useEffect(() => {
    let controller: DriveAutosave;
    try {
      controller = new DriveAutosave({ storage: window.localStorage, fetch: (...args) => fetch(...args), getWorkspace: () => latest.current,
        restore: value => { latest.current = value; previous.current = value; restore.current(value); }, notify: setState });
    } catch (error) { setState(previous => ({ ...previous, status: "error", message: error instanceof Error ? error.message : "Хранилище браузера недоступно. Экспортируйте проект." })); return; }
    engine.current = controller; register.current(controller); void controller.sync();
    const retry = () => { if (document.visibilityState !== "hidden") void controller.sync(); };
    const onReturn = (event: PageTransitionEvent) => { if (event.persisted) retry(); };
    window.addEventListener("online", retry); window.addEventListener("pageshow", onReturn); document.addEventListener("visibilitychange", retry);
    // Read other-device changes only while this tab is visible; requests are serialized by the controller.
    const timer = setInterval(retry, 60_000);
    return () => { clearInterval(timer); controller.dispose(); engine.current = null; register.current(null); window.removeEventListener("online", retry); window.removeEventListener("pageshow", onReturn); document.removeEventListener("visibilitychange", retry); };
  }, []);
  useEffect(() => { if (previous.current !== workspace) { previous.current = workspace; engine.current?.changed(); } }, [workspace]);
  async function authorize() {
    if (authorizing) return;
    setAuthorizing(true);
    try {
      const response = await fetch("/api/drive/connection", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "authorize" }), cache: "no-store" });
      const data = await response.json();
      if (!response.ok || typeof data.authorizationUrl !== "string") throw new Error(data.message ?? data.error ?? "Не удалось начать подключение.");
      const url = new URL(data.authorizationUrl);
      if (url.protocol !== "https:" || url.hostname !== "connect.vercel.com" || url.port || url.username || url.password) throw new Error("Не удалось проверить адрес подключения.");
      window.location.assign(url.href);
    } catch (error) { setState(previous => ({ ...previous, status: "error", message: error instanceof Error ? error.message : "Не удалось подключить Google." })); }
    finally { setAuthorizing(false); }
  }
  function restoreVersion(id: string) {
    if (!engine.current?.canRestore() || !window.confirm("Восстановить выбранную версию? Текущий проект и предыдущие версии останутся в истории Google Drive.")) return;
    void engine.current.restoreVersion(id);
  }
  const busy = state.status === "checking" || state.status === "saving" || authorizing;
  return <section className="panel storage-panel" aria-label="Автосохранение Google Drive">
    <h2>Автосохранение в Google Drive</h2>
    <p role="status" aria-live="polite">{state.message}</p>
    <p>Сохраняются диалог, черновик, версии смет и ваши правки. Без интернета копия остаётся в браузере. Дождитесь надписи «Сохранено в Google Drive» перед закрытием страницы.</p>
    <div className="action-row">
      {state.status === "authorization_required" && <button type="button" className="primary-button" disabled={authorizing} onClick={() => void authorize()}>Подключить Google Drive</button>}
      <button type="button" className="secondary-button" disabled={busy || !engine.current} onClick={() => state.status === "paused" ? engine.current?.resume() : void engine.current?.sync()}>{state.status === "paused" ? "Возобновить и загрузить из Drive" : "Сохранить и проверить сейчас"}</button>
    </div>
    {state.status === "conflict" && <div className="error-box"><p>Выберите проект для продолжения:</p>{state.heads.map((revision, index) => <button type="button" className="secondary-button" key={revision.id} onClick={() => restoreVersion(revision.id)}>Версия {index + 1}: {revision.label} · {new Date(revision.createdAt).toLocaleString("ru-RU")}</button>)}</div>}
    {state.revisions.length > 0 && <details><summary>История автосохранения (последние {state.revisions.length})</summary><p>Выбранная копия восстановится как новая версия. История не удаляется.</p><div className="action-row">{state.revisions.map(revision => <button type="button" className="secondary-button" key={revision.id} disabled={busy} onClick={() => restoreVersion(revision.id)}>Восстановить: {revision.label} · {new Date(revision.createdAt).toLocaleString("ru-RU")}</button>)}</div></details>}
  </section>;
}
