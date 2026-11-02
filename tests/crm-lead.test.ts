import { strict as assert } from "node:assert";
import { test } from "node:test";
import { leadStatusLabel, validateLeadDraft } from "../lib/crm/lead";

const valid = { name: "Иван", phone: "+7 999 123-45-67", channel: "Сайт", workType: "Фасад", address: "Иркутск", notes: "" };

test("valid lead accepted and trimmed", () => {
  const result = validateLeadDraft({ ...valid, name: "  Иван  " });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.name, "Иван");
});
test("reject missing contact identity", () => {
  const result = validateLeadDraft({ ...valid, name: "", phone: "" });
  assert.equal(result.ok, false);
});
test("reject invalid phone", () => {
  const result = validateLeadDraft({ ...valid, phone: "abc" });
  assert.equal(result.ok, false);
});
test("reject oversized notes", () => {
  const result = validateLeadDraft({ ...valid, notes: "x".repeat(2001) });
  assert.equal(result.ok, false);
});
test("status labels", () => {
  assert.equal(leadStatusLabel("new"), "Новая");
  assert.equal(leadStatusLabel("won"), "Договор");
});
