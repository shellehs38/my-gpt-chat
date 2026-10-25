import test from "node:test";
import assert from "node:assert/strict";
import { startSessionMonitor } from "../lib/session-monitor";

class VisibleDocument extends EventTarget {
  visibilityState: DocumentVisibilityState = "visible";
}

test("session monitor coalesces checks and locks an expired visible session", async () => {
  const browser = new EventTarget();
  const document = new VisibleDocument();
  let active = true, calls = 0, expired = 0;
  let release!: (authenticated: boolean) => void;
  const firstResult = new Promise<boolean>(resolve => { release = resolve; });
  const monitor = startSessionMonitor({
    window: browser,
    document,
    isAuthenticated: () => active,
    check: async () => { calls++; return calls === 1 ? firstResult : false; },
    onExpired: () => { expired++; active = false; },
    onError: error => { throw error; },
    intervalMs: 60_000,
  });
  try {
    const first = monitor.check();
    assert.equal(monitor.check(), first);
    browser.dispatchEvent(new Event("focus"));
    assert.equal(calls, 1);
    release(true); await first;

    document.visibilityState = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 1);

    document.visibilityState = "visible";
    browser.dispatchEvent(new Event("pageshow"));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 2);
    assert.equal(expired, 1);

    browser.dispatchEvent(new Event("focus"));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 2);
  } finally { monitor.stop(); }
});

