/**
 * SRD 5.2.1-compatible engine — shared types.
 *
 * These types live entirely in the deterministic engine layer. They do
 * not import from the DB, the LLM client, or anywhere else: the engine
 * runs as pure functions over plain data and is fully serializable.
 *
 * No proprietary D&D content (settings, monsters, names) is encoded
 * here — only mechanics and class names from the System Reference
 * Document open license.
 */

/** Six core ability scores — abbreviations match SRD usage. */
export type Ability = "str" | "dex" | "con" | "int" | "wis" | "cha";

export interface AbilityScores {
  str: number;
  dex: number;
  con: number;
  int: number;
  wis: number;
  cha: number;
}

export interface Proficiencies {
  saves?: Ability[];
  skills?: string[];
}

/** A character sheet at rest (between encounters). */
export interface Character {
  id: string;
  name: string;
  level: number;
  className: string;          // must be in SRD_CLASSES
  abilities: AbilityScores;
  proficiencies?: Proficiencies;
  hp_max: number;
  hp_current: number;
  hp_temp?: number;
  ac: number;
  conditions?: string[];
}

/** A character (or monster) participating in a single encounter. */
export interface Combatant {
  id: string;
  name: string;
  initiative_bonus: number;
  hp_max: number;
  hp_current: number;
  hp_temp?: number;
  ac: number;
  conditions?: string[];
}

export interface InitiativeEntry {
  id: string;
  initiative: number;         // d20 + bonus
  natural: number;            // raw d20 face
  bonus: number;              // bonus added to the d20
}

/**
 * Encounter state. Pure JSON — no Dates, no functions. Whoever owns the
 * encounter (DB row, in-memory test, etc.) wraps this with an external
 * id; the engine itself does not generate ids.
 */
export interface Encounter {
  round: number;              // 1-indexed
  turn_index: number;         // pointer into `order`
  order: InitiativeEntry[];   // sorted desc by initiative, with ties broken
  combatants: Record<string, Combatant>;
}

/** A single attack option a character can use (weapon, spell attack, etc.). */
export interface Attack {
  name: string;
  ability: Ability;           // which ability mod is added to the attack roll
  proficient: boolean;        // adds proficiency bonus on top
  attackBonus?: number;       // extra static bonus (e.g. magic weapon +1)
  damageDice: string;         // e.g. "1d8" or "2d6+1"
  damageBonus?: number;       // extra static damage bonus (separate from formula modifier)
  damageType?: string;        // "slashing" | "fire" | etc.
}

export interface Item {
  id: string;
  name: string;
  quantity: number;
  weight: number;             // per-unit weight (lb)
  equipped?: boolean;
}

export interface Inventory {
  items: Item[];
}

/** Random number generator: must return a number in [0, 1). */
export type RNG = () => number;
