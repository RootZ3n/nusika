import { test } from "node:test";
import assert from "node:assert/strict";
import { getProductNarrator, VARROS } from "../server/lib/narrator.js";

test("getProductNarrator returns Varros by default", () => {
  const n = getProductNarrator();
  assert.equal(n.id, "varros");
  assert.equal(n.name, "Varros");
  assert.ok(n.greeting_idle.length > 0);
  assert.ok(n.greeting_active.length > 0);
});

test("VARROS constant is exported and stable", () => {
  assert.equal(VARROS.id, "varros");
});
