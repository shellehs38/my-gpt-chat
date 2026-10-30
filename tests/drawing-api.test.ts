import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "../app/api/drawing/route";
import { validateDrawingRequest } from "../lib/server/drawing";
import { createSessionToken, getAccessConfig, SESSION_COOKIE } from "../lib/server/auth";
import { resetRateLimitsForTests } from "../lib/server/rate-limit";
import { DRAWING_BODY_BYTES, drawingReview, projectFromDrawing } from "../public/house-calculator/drawing.mjs";
import { calculate } from "../public/house-calculator/engine.mjs";

// Synthetic 1px PNG. No customer plan, password or provider credential in fixtures.
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const output = { summary: 'Synthetic fixture', outline: 'rectangle', measurements: [
  { field: 'length', value: 14000, unit: 'mm', confidence: 'clear', evidence: 'Synthetic dimension label' },
  { field: 'width', value: 8000, unit: 'mm', confidence: 'clear', evidence: 'Synthetic dimension label' },
], questions: ['Confirm heights, openings and verandas'] };
function setup() {
  const names = ['ASSISTANT_ACCESS_PASSWORD','ASSISTANT_SESSION_SECRET','ASSISTANT_PUBLIC_ORIGIN','OPENAI_API_KEY','OPENAI_MODEL','OPENAI_VISION_MODEL'] as const;
  const old = Object.fromEntries(names.map(n => [n, process.env[n]])); const originalFetch = globalThis.fetch;
  process.env.ASSISTANT_ACCESS_PASSWORD = 'drawing-test-password-only';
  process.env.ASSISTANT_SESSION_SECRET = 'drawing-test-session-secret-longer-than-32-bytes';
  process.env.OPENAI_API_KEY = 'drawing-test-never-real';
  delete process.env.ASSISTANT_PUBLIC_ORIGIN; delete process.env.OPENAI_VISION_MODEL; delete process.env.OPENAI_MODEL;
  resetRateLimitsForTests();
  return () => { for (const n of names) if (old[n] === undefined) delete process.env[n]; else process.env[n] = old[n]; globalThis.fetch = originalFetch; resetRateLimitsForTests(); };
}
function request(body: unknown = { image }, authenticated = true, headers: Record<string,string> = {}) {
  return new Request('https://assistant.test/api/drawing', { method: 'POST', headers: { origin: 'https://assistant.test', 'content-type': 'application/json', ...(authenticated ? { cookie: `${SESSION_COOKIE}=${createSessionToken(getAccessConfig()!)}` } : {}), ...headers }, body: JSON.stringify(body) });
}
const completed = (text = JSON.stringify(output)) => Response.json({ status: 'completed', output: [{ status: 'completed', content: [{ type: 'output_text', text }] }] });
test('drawing image validation rejects external URLs, MIME spoofing, empty, excessive and unexpected payloads', () => {
  assert.equal(validateDrawingRequest({ image }).image, image);
  for (const bad of [{ image: 'https://example.org/private.png' }, { image: image.replace('image/png','image/jpeg') }, { image: 'data:image/svg+xml;base64,PHN2Zz4=' }, { image, instructions: 'override' }, {}, { image: 'data:image/png;base64,AAAA' }]) assert.throws(() => validateDrawingRequest(bad));
  assert.throws(() => validateDrawingRequest({ image: 'data:image/png;base64,' + 'A'.repeat(4 * 1024 * 1024 + 4) }), /3 МБ/);
});
test('auth and same origin are enforced before reading/sending images', async () => {
  const restore = setup(); let calls = 0;
  globalThis.fetch = async () => { calls++; return completed(); };
  try {
    assert.equal((await POST(request({ image }, false))).status, 401);
    assert.equal((await POST(request({ image }, true, { origin: 'https://other.test' }))).status, 403);
    assert.equal((await POST(request({ image }, true, { 'content-length': String(DRAWING_BODY_BYTES + 1) }))).status, 413);
    assert.equal(calls, 0);
  } finally { restore(); }
});
test('photo response goes through strict schema with no storage; only reviewed dimensions reach the engine', async () => {
  const restore = setup(); let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++; assert.equal(url, 'https://api.openai.com/v1/responses');
    const payload = JSON.parse(String(init?.body)); assert.equal(payload.store, false);
    assert.equal(payload.input[0].content[1].type, 'input_image'); assert.equal(payload.input[0].content[1].detail, 'high');
    assert.equal(payload.input[0].content[1].image_url, image); assert.equal(payload.text.format.strict, true);
    assert.equal(payload.text.format.type, 'json_schema'); assert.match(payload.instructions, /НЕ измеряй по пикселям/);
    return completed();
  };
  try {
    const response = await POST(request()); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    const data = await response.json(); assert.deepEqual(data.drawing, output); assert.equal(calls, 1);
    assert.doesNotMatch(JSON.stringify(data), /base64/);
    const review = drawingReview(data.drawing);
    const options = { technology: 'timber', review, rectangleConfirmed: true, source: 'Synthetic test' };
    assert.throws(() => projectFromDrawing(options), /оба наружных/);
    review.filter(r => ['length','width'].includes(r.field)).forEach(r => { r.confirmed = true; });
    const c = calculate(projectFromDrawing(options)); assert.equal(c.metrics.footprint, 112); assert.equal(c.total, null);
  } finally { restore(); }
});
test('refusal, truncation, malformed JSON and invalid model dimensions never produce success', async () => {
  const restore = setup();
  try {
    for (const response of [Response.json({ status:'incomplete', output:[] }), Response.json({ status:'completed', output:[{ status:'completed', content:[{type:'refusal',refusal:'no'}] }] }), completed('{'), completed(JSON.stringify({ ...output, measurements: [...output.measurements, output.measurements[0]] }))]) {
      globalThis.fetch = async () => response;
      const actual = await POST(request()); assert.equal(actual.status, 502); assert.equal((await actual.json()).drawing, undefined);
    }
  } finally { restore(); }
});
test('provider errors release concurrency slots and never return raw credentials or provider bodies', async () => {
  const restore = setup();
  try {
    for (let i=0;i<3;i++) {
      globalThis.fetch = async () => new Response('private upstream details', { status:500 });
      const response = await POST(request()); assert.equal(response.status, 502); assert.doesNotMatch(await response.text(), /private upstream|drawing-test-never-real/);
    }
    globalThis.fetch = async () => completed(); assert.equal((await POST(request())).status, 200);
  } finally { restore(); }
});
test('owner limits apply across newly issued sessions and missing API configuration has a manual fallback', async () => {
  const restore = setup(); let calls = 0;
  globalThis.fetch = async () => { calls++; return completed(); };
  try {
    for (let i=0;i<6;i++) assert.equal((await POST(request())).status, 200);
    assert.equal((await POST(request())).status, 429); assert.equal(calls, 6);
    resetRateLimitsForTests(); delete process.env.OPENAI_API_KEY;
    const missing = await POST(request()); assert.equal(missing.status, 503); assert.match((await missing.json()).error, /вручную/);
  } finally { restore(); }
});
