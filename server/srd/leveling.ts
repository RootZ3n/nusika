/**
 * Leveling — XP table, hit dice per class, level-1 HP, average HP gain.
 *
 * SRD-compatible only. The class list and hit-die mapping come from the
 * SRD class table; XP thresholds are from the SRD encounter-building
 * guidance. No proprietary content.
 */

export { proficiencyBonusForLevel } from "./checks.js";

/**
 * SRD class names, lowercase. Anything outside this list is rejected by
 * hitDieForClass / maxHpAtLevelOne / averageHpGain.
 */
export const SRD_CLASSES = [
  "barbarian",
  "bard",
  "cleric",
  "druid",
  "fighter",
  "monk",
  "paladin",
  "ranger",
  "rogue",
  "sorcerer",
  "warlock",
  "wizard",
] as const;

export type SrdClass = (typeof SRD_CLASSES)[number];

const HIT_DICE: Record<SrdClass, number> = {
  barbarian: 12,
  bard: 8,
  cleric: 8,
  druid: 8,
  fighter: 10,
  monk: 8,
  paladin: 10,
  ranger: 10,
  rogue: 8,
  sorcerer: 6,
  warlock: 8,
  wizard: 6,
};

/**
 * SRD XP threshold for each character level (the XP needed to *be* at
 * that level). Index 0 = level 1.
 */
const XP_THRESHOLDS: readonly number[] = [
  0,       //  1
  300,     //  2
  900,     //  3
  2700,    //  4
  6500,    //  5
  14000,   //  6
  23000,   //  7
  34000,   //  8
  48000,   //  9
  64000,   // 10
  85000,   // 11
  100000,  // 12
  120000,  // 13
  140000,  // 14
  165000,  // 15
  195000,  // 16
  225000,  // 17
  265000,  // 18
  305000,  // 19
  355000,  // 20
];

function normalizeClass(className: string): SrdClass {
  const lower = className.trim().toLowerCase();
  if (!(SRD_CLASSES as readonly string[]).includes(lower)) {
    throw new Error(`Unknown SRD class: ${className}. Allowed: ${SRD_CLASSES.join(", ")}`);
  }
  return lower as SrdClass;
}

export function xpThresholdForLevel(level: number): number {
  if (!Number.isInteger(level) || level < 1 || level > XP_THRESHOLDS.length) {
    throw new Error(`level out of range (1-${XP_THRESHOLDS.length}): ${level}`);
  }
  return XP_THRESHOLDS[level - 1]!;
}

/**
 * Highest level whose XP threshold is <= the supplied total. XP < 0 is
 * rejected; XP at or above the level-20 threshold returns 20.
 */
export function levelForXp(xp: number): number {
  if (typeof xp !== "number" || !Number.isFinite(xp) || xp < 0) {
    throw new Error("xp must be a finite number >= 0");
  }
  let level = 1;
  for (let i = 0; i < XP_THRESHOLDS.length; i++) {
    if (xp >= XP_THRESHOLDS[i]!) level = i + 1;
    else break;
  }
  return level;
}

export function hitDieForClass(className: string): number {
  return HIT_DICE[normalizeClass(className)];
}

/**
 * Max HP at level 1 = max of the class's hit die + Constitution modifier.
 * (SRD: a level-1 character takes the max of their first hit die.)
 */
export function maxHpAtLevelOne(className: string, conModifier: number): number {
  if (!Number.isInteger(conModifier)) {
    throw new Error("conModifier must be an integer");
  }
  return hitDieForClass(className) + conModifier;
}

/**
 * Average HP gain per level after level 1 (SRD shortcut: floor(die/2)+1+CON).
 * Negative results are clamped to 1 (a character cannot lose HP on level-up).
 */
export function averageHpGain(className: string, conModifier: number): number {
  if (!Number.isInteger(conModifier)) {
    throw new Error("conModifier must be an integer");
  }
  const die = hitDieForClass(className);
  return Math.max(1, Math.floor(die / 2) + 1 + conModifier);
}
