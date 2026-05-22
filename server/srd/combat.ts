/**
 * Combat — initiative, encounter state, turn cursor, damage/healing/conditions.
 *
 * All functions are pure: they take state in and return new state out.
 * Encounter objects are plain serializable JSON — they round-trip
 * losslessly through JSON.stringify/parse, which is what the eventual
 * DM route layer will rely on.
 */

import type { Combatant, Encounter, InitiativeEntry, RNG } from "./types.js";
import { rollD20 } from "./dice.js";

/**
 * Roll initiative for each combatant: 1d20 + initiative_bonus. Returns
 * one entry per combatant in the supplied order; sorting is a separate
 * step so callers can inspect raw rolls before the order shuffles.
 */
export function rollInitiative(
  combatants: Combatant[],
  rng: RNG = Math.random,
): InitiativeEntry[] {
  return combatants.map(c => {
    const r = rollD20({ modifier: c.initiative_bonus }, rng);
    return {
      id: c.id,
      initiative: r.total,
      natural: r.natural ?? r.rolls[0]!,
      bonus: c.initiative_bonus,
    };
  });
}

/**
 * Sort initiative entries descending. Ties break by natural roll
 * descending, then by id ascending (stable, deterministic).
 */
export function sortInitiative(entries: InitiativeEntry[]): InitiativeEntry[] {
  return [...entries].sort((a, b) => {
    if (b.initiative !== a.initiative) return b.initiative - a.initiative;
    if (b.natural !== a.natural) return b.natural - a.natural;
    return a.id.localeCompare(b.id);
  });
}

/**
 * Build a fresh Encounter at round 1 with combatants in initiative order.
 * Combatants are shallow-cloned so subsequent damage/heal calls don't
 * mutate the caller's input.
 */
export function createEncounter(
  combatants: Combatant[],
  rng: RNG = Math.random,
): Encounter {
  const order = sortInitiative(rollInitiative(combatants, rng));
  const map: Record<string, Combatant> = {};
  for (const c of combatants) map[c.id] = { ...c };
  return { round: 1, turn_index: 0, order, combatants: map };
}

/**
 * Resolve the active turn. Returns null when the encounter is empty or
 * the current entry has no matching combatant (which would indicate a
 * bug in caller code; we don't crash).
 */
export function getCurrentTurn(encounter: Encounter): {
  combatant: Combatant;
  entry: InitiativeEntry;
  round: number;
} | null {
  if (encounter.order.length === 0) return null;
  const entry = encounter.order[encounter.turn_index];
  if (!entry) return null;
  const combatant = encounter.combatants[entry.id];
  if (!combatant) return null;
  return { combatant, entry, round: encounter.round };
}

/**
 * Move to the next initiative slot. When the last slot finishes, the
 * round increments and the cursor wraps to 0.
 */
export function advanceTurn(encounter: Encounter): Encounter {
  if (encounter.order.length === 0) return encounter;
  let next = encounter.turn_index + 1;
  let round = encounter.round;
  if (next >= encounter.order.length) {
    next = 0;
    round += 1;
  }
  return { ...encounter, turn_index: next, round };
}

/**
 * Apply damage to a combatant. Temp HP absorbs damage first; only
 * spillover reduces hp_current. hp_current never drops below 0.
 */
export function applyDamage(target: Combatant, amount: number): Combatant {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("damage amount must be a finite number >= 0");
  }
  if (amount === 0) return { ...target };

  let remaining = Math.floor(amount);
  let temp = target.hp_temp ?? 0;
  if (temp > 0) {
    const absorbed = Math.min(temp, remaining);
    temp -= absorbed;
    remaining -= absorbed;
  }
  const newHp = Math.max(0, target.hp_current - remaining);
  return { ...target, hp_current: newHp, hp_temp: temp };
}

/**
 * Heal a combatant up to but not exceeding hp_max. Healing 0 is a no-op.
 * Note: per SRD, temp HP is not affected by healing.
 */
export function applyHealing(target: Combatant, amount: number): Combatant {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("healing amount must be a finite number >= 0");
  }
  if (amount === 0) return { ...target };
  const newHp = Math.min(target.hp_max, target.hp_current + Math.floor(amount));
  return { ...target, hp_current: newHp };
}

/**
 * Add a condition. Condition list stays sorted and unique so equality
 * checks (including JSON serialization round-trips) are stable.
 */
export function addCondition(target: Combatant, condition: string): Combatant {
  const norm = condition.trim().toLowerCase();
  if (!norm) throw new Error("condition cannot be empty");
  const set = new Set(target.conditions ?? []);
  set.add(norm);
  return { ...target, conditions: [...set].sort() };
}

export function removeCondition(target: Combatant, condition: string): Combatant {
  const norm = condition.trim().toLowerCase();
  const next = (target.conditions ?? []).filter(c => c !== norm);
  return { ...target, conditions: next };
}
