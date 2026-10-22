"use client";

import { useEffect, useRef, useState } from "react";

type Connection = { status: string; message: string };
async function readConnection(response: Response): Promise<Connection & { authorizationUrl?: string }> {
  const data = await response.json();
  if (!data || typeof data !== "object") throw new Error();
  if (!response.ok) {
    const message = typeof data.message === "string" ? data.message : typeof data.error === "string" ? data.error : "Не удалось проверить Google Drive.";
    return { status: ["setup_required", "authorization_required"].includes(data.status) ? data.status : "unavailable", message };
  }
  if (typeof data.status !== "string" || typeof data.message !== "string") throw new Error();
  return { status: data.status, message: data.message, ...(typeof data.authorizationUrl === "string" ? { authorizationUrl: data.authorizationUrl } : {}) };
}
export default function DriveConnection() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    async function checkExistingConnection() {
      if (inFlight.current || controller.signal.aborted) return;
      inFlight.current = true; setBusy(true);
      setConnection({ status: "checking", message: "Проверяю сохранённое подключение Google Drive…" });
      try {
        let data = await readConnection(await fetch("/api/drive/connection", { cache: "no-store", signal: controller.signal }));
        if (data.status === "unchecked" && !controller.signal.aborted) {
          // Check the saved owner grant, never silently start a new OAuth flow.
          data = await readConnection(await fetch("/api/drive/connection", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "check" }),
            cache: "no-store", signal: controller.signal,
          }));
        }
        if (!controller.signal.aborted) setConnection({ status: data.status, message: data.message });
      } catch {
        if (!controller.signal.aborted) setConnection({ status: "unavailable", message: "Не удалось проверить Google Drive. Проверьте связь и повторите проверку." });
      } finally {
        if (!controller.signal.aborted) { inFlight.current = false; setBusy(false); }
      }
    }
    void checkExistingConnection();
    const onReturn = (event: PageTransitionEvent) => { if (event.persisted) void checkExistingConnection(); };
    window.addEventListener("pageshow", onReturn);
    return () => { controller.abort(); inFlight.current = false; window.removeEventListener("pageshow", onReturn); };
  }, []);
  async function run(action: "authorize" | "check") {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true);
    // A previous successful check must not remain visible during a failed retry.
    setConnection({ status: "checking", message: action === "authorize" ? "Готовлю подключение Google…" : "Проверяю доступ к Google Drive…" });
    try {
      const response = await fetch("/api/drive/connection", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }), cache: "no-store",
      });
      const data = await readConnection(response);
      setConnection({ status: data.status, message: data.message });
      if (action === "authorize" && typeof data.authorizationUrl === "string") {
        const url = new URL(data.authorizationUrl);
        if (url.protocol !== "https:" || url.hostname !== "connect.vercel.com" || url.port || url.username || url.password) throw new Error();
        window.location.assign(url.href);
      }
    } catch { setConnection({ status: "unavailable", message: "Подключение не подтверждено. Проверьте связь и повторите попытку." }); }
    finally { inFlight.current = false; setBusy(false); }
  }
  const unavailable = !connection || connection.status === "setup_required";
  const connected = connection?.status === "connected";
  return <section className="panel storage-panel" aria-label="Подключение Google Drive">
    <h2>Google Drive</h2>
    <p role="status" aria-live="polite">{connection?.message ?? "Проверяю настройки подключения…"}</p>
    <p>{connected ? "Повторно подключать Google при каждом входе не нужно." : "Помощник проверяет подключение при открытии. Если потребуется вход в Google, появится кнопка подключения."} Сохранение проекта пока работает через экспорт файла.</p>
    <div className="action-row">
      {connection?.status === "authorization_required" && <button type="button" className="primary-button" disabled={busy} onClick={() => void run("authorize")}>Подключить Google Drive</button>}
      <button type="button" className="secondary-button" disabled={busy || unavailable} onClick={() => void run("check")}>Проверить подключение</button>
    </div>
  </section>;
}
