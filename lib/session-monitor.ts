type SessionEventTarget = Pick<EventTarget, "addEventListener" | "removeEventListener">;
type SessionDocument = SessionEventTarget & { visibilityState: DocumentVisibilityState };

type SessionMonitorDependencies = {
  window: SessionEventTarget;
  document: SessionDocument;
  isAuthenticated: () => boolean;
  check: () => Promise<boolean>;
  onExpired: () => void;
  onError: (error: unknown) => void;
  intervalMs?: number;
};

/** Revalidates an open owner session without overlapping requests. */
export function startSessionMonitor(deps: SessionMonitorDependencies) {
  let stopped = false;
  let pending: Promise<void> | null = null;
  const check = () => {
    if (stopped || !deps.isAuthenticated()) return Promise.resolve();
    if (pending) return pending;
    const request = deps.check()
      .then((authenticated) => {
        if (!stopped && deps.isAuthenticated() && !authenticated) deps.onExpired();
      })
      .catch((error) => { if (!stopped && deps.isAuthenticated()) deps.onError(error); })
      .finally(() => { if (pending === request) pending = null; });
    pending = request;
    return request;
  };
  const onFocus: EventListener = () => { void check(); };
  const onPageShow: EventListener = () => { void check(); };
  const onVisibility: EventListener = () => { if (deps.document.visibilityState === "visible") void check(); };
  deps.window.addEventListener("focus", onFocus);
  deps.window.addEventListener("pageshow", onPageShow);
  deps.document.addEventListener("visibilitychange", onVisibility);
  const timer = setInterval(() => { if (deps.document.visibilityState === "visible") void check(); }, deps.intervalMs ?? 60_000);
  return {
    check,
    stop() {
      stopped = true;
      clearInterval(timer);
      deps.window.removeEventListener("focus", onFocus);
      deps.window.removeEventListener("pageshow", onPageShow);
      deps.document.removeEventListener("visibilitychange", onVisibility);
    },
  };
}
