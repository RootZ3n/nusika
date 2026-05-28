import { test } from "node:test";
import assert from "node:assert/strict";
import { getProductNarrator, PEH } from "../server/lib/narrator.js";

test("getProductNarrator returns Peh by default", () => {
  const n = getProductNarrator();
  assert.equal(n.id, "peh");
  assert.equal(n.name, "Peh");
  assert.ok(n.greeting_idle.length > 0);
  assert.ok(n.greeting_active.length > 0);
});

test("PEH constant is exported and stable", () => {
  assert.equal(PEH.id, "peh");
});
