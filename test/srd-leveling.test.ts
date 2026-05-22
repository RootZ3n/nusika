import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SRD_CLASSES,
  xpThresholdForLevel,
  levelForXp,
  hitDieForClass,
  maxHpAtLevelOne,
  averageHpGain,
  proficiencyBonusForLevel,
} from "../server/srd/leveling.js";

test("xpThresholdForLevel matches SRD spot checks", () => {
  assert.equal(xpThresholdForLevel(1), 0);
  assert.equal(xpThresholdForLevel(2), 300);
  assert.equal(xpThresholdForLevel(5), 6500);
  assert.equal(xpThresholdForLevel(11), 85000);
  assert.equal(xpThresholdForLevel(20), 355000);
  assert.throws(() => xpThresholdForLevel(0), /out of range/);
  assert.throws(() => xpThresholdForLevel(21), /out of range/);
});

test("levelForXp picks the highest level whose threshold is <= xp", () => {
  assert.equal(levelForXp(0), 1);
  assert.equal(levelForXp(299), 1);
  assert.equal(levelForXp(300), 2);
  assert.equal(levelForXp(899), 2);
  assert.equal(levelForXp(900), 3);
  assert.equal(levelForXp(355_000), 20);
  assert.equal(levelForXp(999_999_999), 20, "caps at level 20");
  assert.throws(() => levelForXp(-1), />= 0/);
  assert.throws(() => levelForXp(NaN), /finite/);
});

test("hitDieForClass maps every SRD class correctly", () => {
  const expected: Record<string, number> = {
    barbarian: 12, bard: 8, cleric: 8, druid: 8,
    fighter: 10, monk: 8, paladin: 10, ranger: 10,
    rogue: 8, sorcerer: 6, warlock: 8, wizard: 6,
  };
  for (const cls of SRD_CLASSES) {
    assert.equal(hitDieForClass(cls), expected[cls], `hit die mismatch for ${cls}`);
  }
  // Case-insensitive
  assert.equal(hitDieForClass("Fighter"), 10);
  assert.equal(hitDieForClass("WIZARD"), 6);
});

test("hitDieForClass rejects unknown classes", () => {
  assert.throws(() => hitDieForClass("artificer"), /Unknown SRD class/);
  assert.throws(() => hitDieForClass(""), /Unknown SRD class/);
  assert.throws(() => hitDieForClass("blood-hunter"), /Unknown SRD class/);
});

test("maxHpAtLevelOne = hit die + CON modifier", () => {
  assert.equal(maxHpAtLevelOne("fighter", 2), 12, "d10 + 2");
  assert.equal(maxHpAtLevelOne("wizard",  0), 6,  "d6 + 0");
  assert.equal(maxHpAtLevelOne("barbarian", 3), 15, "d12 + 3");
  assert.throws(() => maxHpAtLevelOne("fighter", 1.5), /integer/);
});

test("averageHpGain = floor(die/2) + 1 + CON, clamped at 1", () => {
  assert.equal(averageHpGain("fighter", 2), 8,  "(10/2)+1+2 = 8");
  assert.equal(averageHpGain("wizard",  0), 4,  "(6/2)+1+0 = 4");
  assert.equal(averageHpGain("barbarian", 3), 10, "(12/2)+1+3 = 10");
  assert.equal(averageHpGain("wizard", -10), 1, "negative result clamps at 1");
});

test("proficiencyBonusForLevel re-export from leveling matches checks impl", () => {
  // Sanity check that the re-export shipped.
  assert.equal(proficiencyBonusForLevel(1), 2);
  assert.equal(proficiencyBonusForLevel(20), 6);
});
