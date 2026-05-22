import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseDiceFormula,
  rollDice,
  rollD20,
  rollWithAdvantage,
  rollWithDisadvantage,
} from "../server/srd/dice.js";

/**
 * Build a deterministic RNG that yields the supplied [0,1) values in order.
 * `rollOne(die, rng)` computes floor(rng() * die) + 1, so:
 *   rng=0     → face 1
 *   rng=0.5   → face floor(0.5 * die) + 1
 *   rng=0.999 → face `die`
 */
function makeRng(values: number[]): () => number {
  let i = 0;
  return () => {
    if (i >= values.length) throw new Error(`rng exhausted at index ${i}`);
    return values[i++]!;
  };
}

test("parseDiceFormula handles common forms", () => {
  assert.deepEqual(parseDiceFormula("d20"),    { count: 1, die: 20, modifier: 0 });
  assert.deepEqual(parseDiceFormula("1d20"),   { count: 1, die: 20, modifier: 0 });
  assert.deepEqual(parseDiceFormula("2d6+3"),  { count: 2, die: 6,  modifier: 3 });
  assert.deepEqual(parseDiceFormula("1d8-1"),  { count: 1, die: 8,  modifier: -1 });
  assert.deepEqual(parseDiceFormula("4d4+4"),  { count: 4, die: 4,  modifier: 4 });
  assert.deepEqual(parseDiceFormula("  D20 "), { count: 1, die: 20, modifier: 0 }, "leading/trailing space + uppercase ok");
});

test("parseDiceFormula rejects garbage and unsafe inputs", () => {
  assert.throws(() => parseDiceFormula("hello"),         /Invalid/);
  assert.throws(() => parseDiceFormula("d"),             /Invalid/);
  assert.throws(() => parseDiceFormula("2d6+"),          /Invalid/);
  assert.throws(() => parseDiceFormula("2d6 + 3"),       /Invalid/, "no whitespace inside");
  assert.throws(() => parseDiceFormula("eval(1+1)"),     /Invalid/);
  assert.throws(() => parseDiceFormula("'; DROP TABLE"), /Invalid/);
  assert.throws(() => parseDiceFormula("(2*100)d20"),    /Invalid/);
  assert.throws(() => parseDiceFormula("1d1"),           /Die size/, "d1 below min");
  assert.throws(() => parseDiceFormula("0d6"),           /Dice count/, "zero dice rejected");
  assert.throws(() => parseDiceFormula("999d6"),         /Dice count/, "above 100 dice rejected");
  // @ts-expect-error — non-string input
  assert.throws(() => parseDiceFormula(20),              /must be a string/);
});

test("rollDice 2d6+3 with deterministic rng", () => {
  // rng=[0.0, 0.5] over d6: floor(0*6)+1=1, floor(0.5*6)+1=4 → 1+4 = 5, +3 mod = 8
  const result = rollDice("2d6+3", makeRng([0.0, 0.5]));
  assert.equal(result.formula, "2d6+3");
  assert.deepEqual(result.rolls, [1, 4]);
  assert.equal(result.modifier, 3);
  assert.equal(result.total, 8);
  assert.match(result.breakdown, /\[1, 4\] \+ 3 = 8/);
  assert.equal(result.natural, undefined, "natural only set on 1d20");
});

test("rollDice 1d8-1 honors negative modifier", () => {
  // rng=0.99 → floor(0.99*8)+1 = 7 + 1 = 8 ... wait floor(7.92) = 7, +1 = 8. -1 mod = 7
  const result = rollDice("1d8-1", makeRng([0.99]));
  assert.equal(result.rolls[0], 8);
  assert.equal(result.modifier, -1);
  assert.equal(result.total, 7);
  assert.match(result.breakdown, /\[8\] - 1 = 7/);
});

test("rollD20 with rng=0 returns natural 1", () => {
  const r = rollD20({ modifier: 5 }, makeRng([0]));
  assert.equal(r.natural, 1);
  assert.deepEqual(r.rolls, [1]);
  assert.equal(r.total, 6);
  assert.equal(r.modifier, 5);
});

test("rollD20 with rng=0.999 returns natural 20", () => {
  const r = rollD20({}, makeRng([0.999]));
  assert.equal(r.natural, 20);
  assert.equal(r.total, 20);
});

test("rollD20 combines modifier + proficiency + bonuses", () => {
  // rng=0.25 → floor(0.25 * 20) + 1 = 6
  const r = rollD20({ modifier: 3, proficiency: 2, bonuses: [1, 1] }, makeRng([0.25]));
  assert.equal(r.natural, 6);
  assert.equal(r.modifier, 3 + 2 + 1 + 1);
  assert.equal(r.total, 6 + 7);
});

test("rollWithAdvantage takes the higher of two d20s", () => {
  // 0.5 → 11; 0.99 → 20. Take 20.
  const r = rollWithAdvantage({ modifier: 0 }, makeRng([0.5, 0.99]));
  assert.equal(r.natural, 20);
  assert.deepEqual(r.rolls, [11, 20]);
  assert.equal(r.total, 20);
});

test("rollWithDisadvantage takes the lower of two d20s", () => {
  const r = rollWithDisadvantage({ modifier: 0 }, makeRng([0.5, 0.99]));
  assert.equal(r.natural, 11);
  assert.equal(r.total, 11);
});

test("rollD20 with both advantage and disadvantage cancels to a straight roll", () => {
  // Only one rng value should be consumed if they cancel.
  const r = rollD20({ advantage: true, disadvantage: true, modifier: 0 }, makeRng([0.0]));
  assert.equal(r.natural, 1);
  assert.equal(r.rolls.length, 1);
});
