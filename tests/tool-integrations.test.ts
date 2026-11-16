import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
type Item = { id: string; repository: string; kind: string; status: string; condition: string };
const read = (p: string) => readFileSync(join(root, p), "utf8");

test("third-party integration catalog is complete and non-duplicating", () => {
  const doc = JSON.parse(read("tools/integrations/catalog.json")) as { integrations: Item[]; policy: string };
  assert.equal(doc.integrations.length, 13);
  assert.equal(new Set(doc.integrations.map(x => x.id)).size, 13);
  assert.equal(new Set(doc.integrations.map(x => x.repository)).size, 13);
  for (const item of doc.integrations) {
    assert.match(item.repository, /^[\w.-]+\/[\w.-]+$/);
    assert.ok(item.status.length > 8 && item.condition.length > 15);
  }
  assert.match(doc.policy, /Production disabled/);
});

test("isolated installers are opt-in and preserve production", () => {
  for (const tool of ["markitdown", "docling", "mem0", "browser-use"]) {
    const req = "tools/integrations/python/requirements-" + tool + ".txt";
    assert.ok(existsSync(join(root, req)), req);
    assert.match(read(req), /==/);
  }
  assert.ok(existsSync(join(root, "tools/integrations/python/extract.py")));
  const e2e = JSON.parse(read("tools/integrations/playwright/package.json")) as { devDependencies: Record<string, string> };
  assert.equal(e2e.devDependencies["@playwright/test"], "1.65.1");
  const workflow = read(".github/workflows/integrations-smoke.yml");
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /railway up|vercel deploy --prod|N8N_ENCRYPTION_KEY\s*:/);
});
