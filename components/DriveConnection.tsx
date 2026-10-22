"use client";

import { useEffect, useRef, useState } from "react";

type Connection = { status: string; message: string };
export default function DriveConnection() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/drive/connection", { cache: "no-store", signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (typeof data.status !== "string" || typeof data.message !== "string") throw new Error();
      setConnection({ status: data.status, message: data.message });
    }).catch(() => {
      if (!controller.signal.aborted) setConnection({ status: "unavailable", message: "Не удалось проверить настройки Google Drive." });
    });
    return () => controller.abort();
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
      const data = await response.json();
      if (!response.ok) {
        const message = typeof data.message === "string" ? data.message : typeof data.error === "string" ? data.error : "Не удалось подключить Google Drive.";
        setConnection({ status: typeof data.status === "string" ? data.status : "unavailable", message });
        return;
      }
      if (typeof data.status !== "string" || typeof data.message !== "string") throw new Error();
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
  return <section className="panel storage-panel" aria-label="Подключение Google Drive">
    <h2>Google Drive</h2>
    <p role="status" aria-live="polite">{connection?.message ?? "Проверяю настройки подключения…"}</p>
    <p>После входа в Google вернитесь на эту страницу и нажмите «Проверить подключение». Сохранение проекта пока работает через экспорт файла.</p>
    <div className="action-row">
      <button type="button" className="primary-button" disabled={busy || unavailable} onClick={() => void run("authorize")}>Подключить Google Drive</button>
      <button type="button" className="secondary-button" disabled={busy || unavailable} onClick={() => void run("check")}>Проверить подключение</button>
    </div>
  </section>;
}
