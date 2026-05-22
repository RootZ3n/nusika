/**
 * Dice — formula parsing and rolls.
 *
 * Pure functions. The optional `rng` argument lets tests inject a
 * deterministic generator returning [0, 1); production callers can omit
 * it to use Math.random.
 *
 * Strict regex-based parsing — never eval. Hard caps on count and die
 * size so a malicious or buggy caller can't drag the process down.
 */

import type { RNG } from "./types.js";

export interface DiceRollResult {
  formula: string;
  total: number;
  rolls: number[];
  modifier: number;
  /** The raw d20 face when the roll is 1d20; undefined otherwise. */
  natural?: number;
  /** Human-readable breakdown — useful for logs, receipts, narration prompts. */
  breakdown: string;
}

export interface ParsedDice {
  count: number;
  die: number;
  modifier: number;
}

export interface D20Options {
  /** Single static modifier to add to the roll. */
  modifier?: number;
  /** Proficiency bonus to add (counted separately for clarity). */
  proficiency?: number;
  /** Additional bonuses (situational, magical, etc.). */
  bonuses?: number[];
  advantage?: boolean;
  disadvantage?: boolean;
}

/**
 * Match `{count?}d{die}{+/-mod?}` exactly. No whitespace inside, no extra
 * characters anywhere. We anchor with ^ and $ so anything else fails.
 */
const DICE_RE = /^(\d*)d(\d+)([+-]\d+)?$/;

const MAX_DICE_COUNT = 100;
const MAX_DIE_SIZE = 1000;

export function parseDiceFormula(formula: string): ParsedDice {
  if (typeof formula !== "string") {
    throw new Error("Dice formula must be a string");
  }
  const trimmed = formula.trim().toLowerCase();
  const m = DICE_RE.exec(trimmed);
  if (!m) throw new Error(`Invalid dice formula: ${formula}`);
  const count = m[1] === "" ? 1 : Number.parseInt(m[1]!, 10);
  const die = Number.parseInt(m[2]!, 10);
  const modifier = m[3] ? Number.parseInt(m[3], 10) : 0;
  if (!Number.isInteger(count) || count < 1 || count > MAX_DICE_COUNT) {
    throw new Error(`Dice count out of range (1-${MAX_DICE_COUNT}): ${count}`);
  }
  if (!Number.isInteger(die) || die < 2 || die > MAX_DIE_SIZE) {
    throw new Error(`Die size out of range (2-${MAX_DIE_SIZE}): ${die}`);
  }
  return { count, die, modifier };
}

/** Roll a single die of the given size using the supplied rng. */
export function rollOne(die: number, rng: RNG): number {
  return Math.floor(rng() * die) + 1;
}

function formatModifier(mod: number): string {
  if (mod === 0) return "";
  return ` ${mod > 0 ? "+" : "-"} ${Math.abs(mod)}`;
}

export function rollDice(formula: string, rng: RNG = Math.random): DiceRollResult {
  const { count, die, modifier } = parseDiceFormula(formula);
  const rolls: number[] = [];
  for (let i = 0; i < count; i++) rolls.push(rollOne(die, rng));
  const sum = rolls.reduce((a, b) => a + b, 0);
  const total = sum + modifier;
  const result: DiceRollResult = {
    formula,
    total,
    rolls,
    modifier,
    breakdown: `[${rolls.join(", ")}]${formatModifier(modifier)} = ${total}`,
  };
  if (count === 1 && die === 20) result.natural = rolls[0]!;
  return result;
}

function combinedModifier(options: D20Options): number {
  return (options.modifier ?? 0)
    + (options.proficiency ?? 0)
    + (options.bonuses ?? []).reduce((a, b) => a + b, 0);
}

/**
 * Roll 1d20 with the configured modifier. If both advantage and
 * disadvantage are set, they cancel and a straight roll is made.
 */
export function rollD20(options: D20Options = {}, rng: RNG = Math.random): DiceRollResult {
  const adv = !!options.advantage && !options.disadvantage;
  const dis = !!options.disadvantage && !options.advantage;
  if (adv) return rollWithAdvantage(options, rng);
  if (dis) return rollWithDisadvantage(options, rng);

  const natural = rollOne(20, rng);
  const mod = combinedModifier(options);
  const total = natural + mod;
  return {
    formula: "1d20",
    total,
    rolls: [natural],
    modifier: mod,
    natural,
    breakdown: `[${natural}]${formatModifier(mod)} = ${total}`,
  };
}

export function rollWithAdvantage(options: D20Options = {}, rng: RNG = Math.random): DiceRollResult {
  const a = rollOne(20, rng);
  const b = rollOne(20, rng);
  const natural = Math.max(a, b);
  const mod = combinedModifier(options);
  const total = natural + mod;
  return {
    formula: "1d20 advantage",
    total,
    rolls: [a, b],
    modifier: mod,
    natural,
    breakdown: `adv[${a}, ${b}] take ${natural}${formatModifier(mod)} = ${total}`,
  };
}

export function rollWithDisadvantage(options: D20Options = {}, rng: RNG = Math.random): DiceRollResult {
  const a = rollOne(20, rng);
  const b = rollOne(20, rng);
  const natural = Math.min(a, b);
  const mod = combinedModifier(options);
  const total = natural + mod;
  return {
    formula: "1d20 disadvantage",
    total,
    rolls: [a, b],
    modifier: mod,
    natural,
    breakdown: `dis[${a}, ${b}] take ${natural}${formatModifier(mod)} = ${total}`,
  };
}
