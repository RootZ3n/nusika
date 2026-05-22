/**
 * SRD engine — public barrel.
 *
 * Slice 4A: deterministic mechanics only (dice, checks, combat,
 * leveling, inventory). No DB, no routes, no UI, no LLM. Slice 4B
 * will plug these into a DM route layer.
 */

export type {
  Ability,
  AbilityScores,
  Proficiencies,
  Character,
  Combatant,
  InitiativeEntry,
  Encounter,
  Attack,
  Item,
  Inventory,
  RNG,
} from "./types.js";

export {
  parseDiceFormula,
  rollOne,
  rollDice,
  rollD20,
  rollWithAdvantage,
  rollWithDisadvantage,
} from "./dice.js";
export type { DiceRollResult, ParsedDice, D20Options } from "./dice.js";

export {
  abilityModifier,
  proficiencyBonusForLevel,
  abilityCheck,
  savingThrow,
  attackRoll,
  damageRoll,
} from "./checks.js";
export type {
  CheckOptions,
  CheckResult,
  AttackResult,
  DamageOptions,
  DamageResult,
} from "./checks.js";

export {
  rollInitiative,
  sortInitiative,
  createEncounter,
  getCurrentTurn,
  advanceTurn,
  applyDamage,
  applyHealing,
  addCondition,
  removeCondition,
} from "./combat.js";

export {
  SRD_CLASSES,
  xpThresholdForLevel,
  levelForXp,
  hitDieForClass,
  maxHpAtLevelOne,
  averageHpGain,
} from "./leveling.js";
export type { SrdClass } from "./leveling.js";

export {
  addItem,
  removeItem,
  equipItem,
  unequipItem,
  totalWeight,
  carryingCapacity,
  isEncumbered,
} from "./inventory.js";
