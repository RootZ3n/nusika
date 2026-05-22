import { test } from "node:test";
import assert from "node:assert/strict";
import {
  abilityModifier,
  proficiencyBonusForLevel,
  abilityCheck,
  savingThrow,
  attackRoll,
  damageRoll,
} from "../server/srd/checks.js";
import type { Attack, Character } from "../server/srd/types.js";

function makeRng(values: number[]): () => number {
  let i = 0;
  return () => {
    if (i >= values.length) throw new Error(`rng exhausted at index ${i}`);
    return values[i++]!;
  };
}

const fighter: Character = {
  id: "pc1",
  name: "Test Fighter",
  level: 5,
  className: "fighter",
  abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 10, cha: 8 },
  proficiencies: { saves: ["str", "con"] },
  hp_max: 44,
  hp_current: 44,
  ac: 16,
};

const longsword: Attack = {
  name: "Longsword",
  ability: "str",
  proficient: true,
  damageDice: "1d8",
  damageBonus: 0,
  damageType: "slashing",
};

test("abilityModifier matches the SRD table at the boundaries", () => {
  assert.equal(abilityModifier(1), -5);
  assert.equal(abilityModifier(7), -2);
  assert.equal(abilityModifier(9), -1);
  assert.equal(abilityModifier(10), 0);
  assert.equal(abilityModifier(11), 0);
  assert.equal(abilityModifier(12), 1);
  assert.equal(abilityModifier(16), 3);
  assert.equal(abilityModifier(20), 5);
  assert.equal(abilityModifier(30), 10);
  assert.throws(() => abilityModifier(NaN), /finite/);
});

test("proficiencyBonusForLevel follows the +2/+3/+4/+5/+6 progression", () => {
  assert.equal(proficiencyBonusForLevel(1), 2);
  assert.equal(proficiencyBonusForLevel(4), 2);
  assert.equal(proficiencyBonusForLevel(5), 3);
  assert.equal(proficiencyBonusForLevel(8), 3);
  assert.equal(proficiencyBonusForLevel(9), 4);
  assert.equal(proficiencyBonusForLevel(12), 4);
  assert.equal(proficiencyBonusForLevel(13), 5);
  assert.equal(proficiencyBonusForLevel(16), 5);
  assert.equal(proficiencyBonusForLevel(17), 6);
  assert.equal(proficiencyBonusForLevel(20), 6);
  assert.throws(() => proficiencyBonusForLevel(0), /out of range/);
  assert.throws(() => proficiencyBonusForLevel(21), /out of range/);
});

test("abilityCheck sums ability mod (+ optional proficiency) and compares to DC", () => {
  // STR 16 → +3. Level 5 fighter proficient → +3. d20 rng=0.45 → floor(9)+1 = 10.
  // total = 10 + 3 + 3 = 16. DC 15 → success.
  const check = abilityCheck(fighter, "str", 15, { proficient: true }, makeRng([0.45]));
  assert.equal(check.natural, 10);
  assert.equal(check.total, 16);
  assert.equal(check.dc, 15);
  assert.equal(check.success, true);
  assert.equal(check.ability, "str");
});

test("abilityCheck failure when total < DC", () => {
  // d20 rng=0 → natural 1. STR 16 = +3. total = 1 + 3 = 4. DC 15 → fail.
  const check = abilityCheck(fighter, "str", 15, {}, makeRng([0]));
  assert.equal(check.natural, 1);
  assert.equal(check.total, 4);
  assert.equal(check.success, false);
});

test("savingThrow uses character save proficiency by default", () => {
  // Fighter is proficient in STR saves; level 5 prof = +3; STR mod = +3.
  // d20 rng=0.5 → 11. total = 11 + 3 + 3 = 17. DC 15 → success.
  const save = savingThrow(fighter, "str", 15, {}, makeRng([0.5]));
  assert.equal(save.natural, 11);
  assert.equal(save.total, 17);
  assert.equal(save.success, true);
});

test("savingThrow without proficiency does not add the prof bonus", () => {
  // CHA save: fighter has no CHA save proficiency. CHA 8 → -1.
  // rng=0.5 → 11. total = 11 + (-1) = 10.
  const save = savingThrow(fighter, "cha", 12, {}, makeRng([0.5]));
  assert.equal(save.natural, 11);
  assert.equal(save.total, 10);
  assert.equal(save.success, false);
});

test("attackRoll natural 20 is a crit and an automatic hit even against high AC", () => {
  // d20 rng=0.999 → 20.
  const r = attackRoll(fighter, longsword, { ac: 99 }, {}, makeRng([0.999]));
  assert.equal(r.natural, 20);
  assert.equal(r.crit, true);
  assert.equal(r.miss, false);
  assert.equal(r.hit, true, "natural 20 always hits regardless of AC");
});

test("attackRoll natural 1 is an automatic miss even with huge bonuses", () => {
  // d20 rng=0 → natural 1. STR +3, prof +3 → total 7. AC 5 would normally hit, but nat 1 misses.
  const r = attackRoll(fighter, longsword, { ac: 5 }, {}, makeRng([0]));
  assert.equal(r.natural, 1);
  assert.equal(r.crit, false);
  assert.equal(r.miss, true);
  assert.equal(r.hit, false);
});

test("attackRoll normal hit when total >= AC", () => {
  // rng=0.5 → 11. STR +3, prof +3 → total 17. AC 16 → hit, no crit.
  const r = attackRoll(fighter, longsword, { ac: 16 }, {}, makeRng([0.5]));
  assert.equal(r.natural, 11);
  assert.equal(r.total, 17);
  assert.equal(r.hit, true);
  assert.equal(r.crit, false);
});

test("damageRoll on a hit uses dice + bonus + ability mod", () => {
  // 1d8 rng=0.5 → 5. damageBonus 0; abilityModifier +3 → total 5+3 = 8.
  const r = damageRoll(longsword, { abilityModifier: 3 }, makeRng([0.5]));
  assert.deepEqual(r.rolls, [5]);
  assert.equal(r.crit, false);
  assert.equal(r.total, 8);
  assert.equal(r.damageType, "slashing");
});

test("damageRoll on crit doubles the dice but NOT the modifier", () => {
  // 1d8 → roll twice on crit. rng=[0.99, 0.5] → 8 and 5 = 13. ability mod +3 (not doubled). total 16.
  const r = damageRoll(longsword, { crit: true, abilityModifier: 3 }, makeRng([0.99, 0.5]));
  assert.equal(r.rolls.length, 2, "crit should roll the dice twice");
  assert.deepEqual(r.rolls, [8, 5]);
  assert.equal(r.damageBonus, 3, "modifier still applies once, not doubled");
  assert.equal(r.total, 13 + 3);
  assert.equal(r.crit, true);
});

test("damageRoll respects formula's static modifier and floors at 0", () => {
  const cantrip: Attack = {
    name: "Sad Cantrip",
    ability: "int",
    proficient: false,
    damageDice: "1d4-2",
    damageType: "force",
  };
  // rng=0 → 1. modifier -2. ability mod +0. total = max(0, 1 + (-2)) = 0
  const r = damageRoll(cantrip, {}, makeRng([0]));
  assert.equal(r.total, 0, "negative damage clamps to 0");
});
