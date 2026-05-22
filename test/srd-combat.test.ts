import { test } from "node:test";
import assert from "node:assert/strict";
import {
  rollInitiative,
  sortInitiative,
  createEncounter,
  getCurrentTurn,
  advanceTurn,
  applyDamage,
  applyHealing,
  addCondition,
  removeCondition,
} from "../server/srd/combat.js";
import type { Combatant } from "../server/srd/types.js";

function makeRng(values: number[]): () => number {
  let i = 0;
  return () => {
    if (i >= values.length) throw new Error(`rng exhausted at index ${i}`);
    return values[i++]!;
  };
}

const goblin: Combatant = {
  id: "g1", name: "Goblin", initiative_bonus: 2,
  hp_max: 7, hp_current: 7, ac: 13,
};
const fighter: Combatant = {
  id: "f1", name: "Fighter", initiative_bonus: 1,
  hp_max: 30, hp_current: 30, ac: 16,
};
const cleric: Combatant = {
  id: "c1", name: "Cleric", initiative_bonus: 0,
  hp_max: 22, hp_current: 22, ac: 15,
};

test("rollInitiative produces one entry per combatant with bonus applied", () => {
  // For three combatants, three rng values.
  const entries = rollInitiative([goblin, fighter, cleric], makeRng([0.0, 0.5, 0.99]));
  assert.equal(entries.length, 3);
  assert.deepEqual(entries.map(e => e.id), ["g1", "f1", "c1"]);
  // Goblin: nat 1, +2 → 3. Fighter: nat 11, +1 → 12. Cleric: nat 20, +0 → 20.
  assert.equal(entries[0]!.initiative, 3);
  assert.equal(entries[1]!.initiative, 12);
  assert.equal(entries[2]!.initiative, 20);
});

test("sortInitiative orders descending and breaks ties deterministically", () => {
  // Two entries with identical initiative; tie-break by natural desc, then id asc.
  const order = sortInitiative([
    { id: "z", initiative: 15, natural: 14, bonus: 1 },
    { id: "a", initiative: 15, natural: 14, bonus: 1 },
    { id: "m", initiative: 15, natural: 12, bonus: 3 },
    { id: "q", initiative: 22, natural: 22, bonus: 0 },
  ]);
  assert.deepEqual(order.map(o => o.id), ["q", "a", "z", "m"]);
});

test("createEncounter returns an encounter with sorted order and round=1", () => {
  // Same rng values as the rollInitiative test → same numbers, sorted desc:
  //   c1 (20), f1 (12), g1 (3)
  const enc = createEncounter([goblin, fighter, cleric], makeRng([0.0, 0.5, 0.99]));
  assert.equal(enc.round, 1);
  assert.equal(enc.turn_index, 0);
  assert.deepEqual(enc.order.map(o => o.id), ["c1", "f1", "g1"]);
  assert.equal(Object.keys(enc.combatants).length, 3);
});

test("createEncounter is JSON-serializable", () => {
  const enc = createEncounter([goblin, fighter], makeRng([0.0, 0.5]));
  const round = JSON.parse(JSON.stringify(enc));
  assert.deepEqual(round, enc);
});

test("getCurrentTurn returns the active combatant", () => {
  const enc = createEncounter([goblin, fighter, cleric], makeRng([0.0, 0.5, 0.99]));
  const turn = getCurrentTurn(enc);
  assert.ok(turn);
  assert.equal(turn!.combatant.id, "c1");
  assert.equal(turn!.round, 1);
});

test("advanceTurn cycles through entries and bumps the round on wrap", () => {
  let enc = createEncounter([goblin, fighter, cleric], makeRng([0.0, 0.5, 0.99]));
  assert.equal(getCurrentTurn(enc)!.combatant.id, "c1");

  enc = advanceTurn(enc);
  assert.equal(getCurrentTurn(enc)!.combatant.id, "f1");
  assert.equal(enc.round, 1);

  enc = advanceTurn(enc);
  assert.equal(getCurrentTurn(enc)!.combatant.id, "g1");

  enc = advanceTurn(enc);
  assert.equal(getCurrentTurn(enc)!.combatant.id, "c1", "wraps back to first slot");
  assert.equal(enc.round, 2, "round increments on wrap");
});

test("getCurrentTurn returns null on an empty encounter", () => {
  const enc = createEncounter([], makeRng([]));
  assert.equal(getCurrentTurn(enc), null);
  // advanceTurn is a no-op on empty too.
  assert.deepEqual(advanceTurn(enc), enc);
});

test("applyDamage drains temp HP first before hp_current", () => {
  const t: Combatant = { ...goblin, hp_current: 7, hp_temp: 5 };
  // 4 damage: temp absorbs 4, hp_current untouched.
  const after = applyDamage(t, 4);
  assert.equal(after.hp_temp, 1);
  assert.equal(after.hp_current, 7);

  // 4 more damage: temp absorbs 1, hp_current loses 3.
  const after2 = applyDamage(after, 4);
  assert.equal(after2.hp_temp, 0);
  assert.equal(after2.hp_current, 4);
});

test("applyDamage clamps hp_current at 0", () => {
  const after = applyDamage({ ...goblin, hp_current: 3 }, 10);
  assert.equal(after.hp_current, 0);
});

test("applyDamage rejects negative amounts and is a no-op for zero", () => {
  assert.throws(() => applyDamage(goblin, -1), />= 0/);
  const z = applyDamage(goblin, 0);
  assert.deepEqual(z, { ...goblin });
});

test("applyHealing tops up to hp_max but never exceeds it", () => {
  const wounded: Combatant = { ...fighter, hp_current: 5 };
  assert.equal(applyHealing(wounded, 10).hp_current, 15);
  assert.equal(applyHealing(wounded, 999).hp_current, fighter.hp_max, "healing capped at hp_max");
  assert.equal(applyHealing({ ...fighter, hp_current: fighter.hp_max }, 5).hp_current, fighter.hp_max);
});

test("applyHealing does not affect hp_temp", () => {
  const t: Combatant = { ...fighter, hp_current: 10, hp_temp: 4 };
  const healed = applyHealing(t, 5);
  assert.equal(healed.hp_current, 15);
  assert.equal(healed.hp_temp, 4, "temp HP unchanged by healing");
});

test("addCondition normalizes case and stays unique + sorted", () => {
  let c: Combatant = { ...goblin };
  c = addCondition(c, "Prone");
  c = addCondition(c, "POISONED");
  c = addCondition(c, "prone"); // duplicate after normalization
  assert.deepEqual(c.conditions, ["poisoned", "prone"]);
});

test("removeCondition is a no-op when absent and matches case-insensitively", () => {
  const c: Combatant = { ...goblin, conditions: ["prone", "poisoned"] };
  const a = removeCondition(c, "PRONE");
  assert.deepEqual(a.conditions, ["poisoned"]);
  const b = removeCondition(a, "stunned");
  assert.deepEqual(b.conditions, ["poisoned"]);
});
