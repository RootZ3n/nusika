/**
 * Checks — ability checks, saving throws, attack rolls, damage rolls.
 *
 * Pure functions; takes characters/attacks as plain data and returns
 * structured results. No DB, no LLM, no narration. The DM mode's route
 * layer composes these into encounter events.
 */

import type { Ability, Attack, Character, RNG } from "./types.js";
import { parseDiceFormula, rollD20, rollOne, type DiceRollResult } from "./dice.js";

export function abilityModifier(score: number): number {
  if (typeof score !== "number" || !Number.isFinite(score)) {
    throw new Error("ability score must be a finite number");
  }
  return Math.floor((score - 10) / 2);
}

/**
 * SRD-style proficiency bonus by character level (1-20).
 *
 *   1-4  → +2
 *   5-8  → +3
 *   9-12 → +4
 *   13-16 → +5
 *   17-20 → +6
 */
export function proficiencyBonusForLevel(level: number): number {
  if (!Number.isInteger(level) || level < 1 || level > 20) {
    throw new Error(`level out of range (1-20): ${level}`);
  }
  if (level <= 4) return 2;
  if (level <= 8) return 3;
  if (level <= 12) return 4;
  if (level <= 16) return 5;
  return 6;
}

export interface CheckOptions {
  /** Whether the proficiency bonus should apply (default: false for ability checks). */
  proficient?: boolean;
  /** Situational static bonus to add to the roll (e.g. bardic inspiration). */
  bonus?: number;
  advantage?: boolean;
  disadvantage?: boolean;
}

export interface CheckResult extends DiceRollResult {
  ability: Ability;
  dc: number;
  success: boolean;
}

export function abilityCheck(
  character: Pick<Character, "abilities" | "level">,
  ability: Ability,
  dc: number,
  options: CheckOptions = {},
  rng: RNG = Math.random,
): CheckResult {
  const mod = abilityModifier(character.abilities[ability]);
  const prof = options.proficient ? proficiencyBonusForLevel(character.level) : 0;
  const sit = options.bonus ?? 0;
  const result = rollD20({
    modifier: mod + sit,
    proficiency: prof,
    ...(options.advantage ? { advantage: true } : {}),
    ...(options.disadvantage ? { disadvantage: true } : {}),
  }, rng);
  return { ...result, ability, dc, success: result.total >= dc };
}

/**
 * Saving throw. Proficiency comes from `character.proficiencies.saves` by
 * default, but can be forced on/off via `options.proficient`.
 */
export function savingThrow(
  character: Pick<Character, "abilities" | "level" | "proficiencies">,
  ability: Ability,
  dc: number,
  options: CheckOptions = {},
  rng: RNG = Math.random,
): CheckResult {
  const profByCharacter = character.proficiencies?.saves?.includes(ability) ?? false;
  const proficient = options.proficient ?? profByCharacter;
  return abilityCheck(character, ability, dc, { ...options, proficient }, rng);
}

export interface AttackResult {
  natural: number;
  total: number;
  rolls: number[];
  hit: boolean;
  crit: boolean;
  miss: boolean;          // automatic miss on natural 1
  ac: number;
  ability: Ability;
  attackName: string;
  breakdown: string;
}

/**
 * d20 + ability mod (+ proficiency if proficient) (+ static bonuses) vs target AC.
 * Natural 20 → automatic crit (always hits). Natural 1 → automatic miss.
 */
export function attackRoll(
  attacker: Pick<Character, "abilities" | "level">,
  attack: Attack,
  target: { ac: number },
  options: CheckOptions = {},
  rng: RNG = Math.random,
): AttackResult {
  const mod = abilityModifier(attacker.abilities[attack.ability]);
  const prof = attack.proficient ? proficiencyBonusForLevel(attacker.level) : 0;
  const extra = attack.attackBonus ?? 0;
  const sit = options.bonus ?? 0;
  const result = rollD20({
    modifier: mod + extra + sit,
    proficiency: prof,
    ...(options.advantage ? { advantage: true } : {}),
    ...(options.disadvantage ? { disadvantage: true } : {}),
  }, rng);
  const natural = result.natural ?? result.rolls[0]!;
  const crit = natural === 20;
  const miss = natural === 1;
  const hit = !miss && (crit || result.total >= target.ac);
  return {
    natural,
    total: result.total,
    rolls: result.rolls,
    hit,
    crit,
    miss,
    ac: target.ac,
    ability: attack.ability,
    attackName: attack.name,
    breakdown: result.breakdown,
  };
}

export interface DamageOptions {
  /** When true, dice are rolled twice (SRD crit rule: dice double, modifiers don't). */
  crit?: boolean;
  /** Ability modifier to add to damage (usually attacker's ability mod for the weapon). */
  abilityModifier?: number;
  /** Additional bonus (e.g. rage damage). */
  bonus?: number;
}

export interface DamageResult {
  total: number;
  rolls: number[];
  damageDice: string;
  damageBonus: number;
  damageType: string | undefined;
  crit: boolean;
  breakdown: string;
}

export function damageRoll(
  attack: Attack,
  options: DamageOptions = {},
  rng: RNG = Math.random,
): DamageResult {
  const parsed = parseDiceFormula(attack.damageDice);
  const crit = !!options.crit;
  const totalDice = crit ? parsed.count * 2 : parsed.count;
  const rolls: number[] = [];
  for (let i = 0; i < totalDice; i++) rolls.push(rollOne(parsed.die, rng));
  const diceSum = rolls.reduce((a, b) => a + b, 0);
  // Modifiers do NOT double on crit (per SRD); the formula's static mod still applies once.
  const damageBonus = parsed.modifier
    + (attack.damageBonus ?? 0)
    + (options.abilityModifier ?? 0)
    + (options.bonus ?? 0);
  const total = Math.max(0, diceSum + damageBonus);
  const sign = damageBonus === 0 ? "" : ` ${damageBonus > 0 ? "+" : "-"} ${Math.abs(damageBonus)}`;
  return {
    total,
    rolls,
    damageDice: attack.damageDice,
    damageBonus,
    damageType: attack.damageType,
    crit,
    breakdown: `[${rolls.join(", ")}]${sign} = ${total}${crit ? " (crit)" : ""}`,
  };
}
