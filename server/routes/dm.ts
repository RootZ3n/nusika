/**
 * Dungeon Master mode — deterministic state and rules routes.
 *
 * Slice 4B intentionally has no narration, no LLM calls, and no web UI.
 * Every state mutation (HP, XP, conditions, initiative, dice results)
 * goes through server/srd/* engine functions and lands in
 * magister_dm_events as an append-only audit trail.
 *
 * Determinism: routes use the module-private `activeRng` for all rolls.
 * Tests can install a deterministic RNG via __setDmRngForTesting and
 * must call __resetDmRngForTesting in their `finally` so production
 * traffic never sees a stuck seam.
 */

import type { FastifyInstance } from "fastify";
import {
  type MagisterDB,
  type DmAbilityScores,
  type DmCampaign,
  type DmCampaignStatus,
  type DmCharacter,
  type DmEvent,
  type DmEventKind,
  type DmHitDice,
  DM_CAMPAIGN_STATUSES,
} from "../db.js";
import {
  abilityCheck,
  abilityModifier,
  advanceTurn,
  addCondition as srdAddCondition,
  applyDamage as srdApplyDamage,
  applyHealing as srdApplyHealing,
  attackRoll,
  createEncounter,
  hitDieForClass,
  maxHpAtLevelOne,
  proficiencyBonusForLevel,
  removeCondition as srdRemoveCondition,
  rollDice,
  savingThrow,
  SRD_CLASSES,
  type Ability,
  type Attack,
  type Character as SrdCharacter,
  type Combatant,
  type Encounter,
  type RNG,
} from "../srd/index.js";

// ── Test seam ────────────────────────────────────────────────────────────────

let activeRng: RNG = Math.random;

export function __setDmRngForTesting(rng: RNG): void { activeRng = rng; }
export function __resetDmRngForTesting(): void { activeRng = Math.random; }

// ── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_ABILITIES: DmAbilityScores = {
  str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8, // SRD standard array
};

const ABILITIES_SET = new Set(["str", "dex", "con", "int", "wis", "cha"]);
const STATUS_SET = new Set<DmCampaignStatus>(DM_CAMPAIGN_STATUSES);
const ALLOWED_INTENTS = new Set([
  "check", "save", "attack", "damage", "heal",
  "condition_add", "condition_remove", "end_turn",
]);

function isAbility(x: unknown): x is Ability {
  return typeof x === "string" && ABILITIES_SET.has(x);
}

function isAbilityScores(x: unknown): x is DmAbilityScores {
  if (!x || typeof x !== "object") return false;
  for (const k of ["str","dex","con","int","wis","cha"]) {
    const v = (x as Record<string, unknown>)[k];
    if (typeof v !== "number" || !Number.isFinite(v)) return false;
  }
  return true;
}

// ── Body shapes ──────────────────────────────────────────────────────────────

interface CreateCampaignBody { title?: string; setting_blurb?: string }
interface PatchCampaignBody {
  title?: string;
  setting_blurb?: string | null;
  status?: string;
  current_scene?: string | null;
  quest_state?: Record<string, unknown>;
  world_memory?: unknown[];
}
interface CreateCharacterBody {
  name?: string;
  ancestry?: string;
  class_name?: string;
  background?: string;
  abilities?: DmAbilityScores;
  proficiencies?: { saves?: string[]; skills?: string[] };
  ac?: number;
  speed?: number;
  inventory?: unknown[];
}
interface RollBody { formula?: string; label?: string }
interface CombatantBody {
  id?: string;
  name?: string;
  hp_current?: number;
  hp_max?: number;
  ac?: number;
  initiative_bonus?: number;
  dex?: number;
  conditions?: string[];
  hp_temp?: number;
}
interface EncounterBody { combatants?: CombatantBody[] }
interface TurnBody { intent?: string; args?: Record<string, unknown> }
interface RestBody { kind?: string; spendHitDice?: number }

// ── Helpers ──────────────────────────────────────────────────────────────────

function characterToSrdCharacter(c: DmCharacter): SrdCharacter {
  return {
    id: c.id,
    name: c.name,
    level: c.level,
    className: c.class_name,
    abilities: c.abilities,
    ...(c.proficiencies?.saves && c.proficiencies.saves.length > 0
      ? { proficiencies: { saves: c.proficiencies.saves.filter(isAbility) as Ability[] } }
      : {}),
    hp_max: c.hp_max,
    hp_current: c.hp_current,
    ...(c.hp_temp ? { hp_temp: c.hp_temp } : {}),
    ac: c.ac,
    ...(c.conditions.length > 0 ? { conditions: c.conditions } : {}),
  };
}

function characterToCombatant(c: DmCharacter): Combatant {
  return {
    id: c.id,
    name: c.name,
    initiative_bonus: abilityModifier(c.abilities.dex),
    hp_max: c.hp_max,
    hp_current: c.hp_current,
    ...(c.hp_temp ? { hp_temp: c.hp_temp } : {}),
    ac: c.ac,
    ...(c.conditions.length > 0 ? { conditions: c.conditions } : {}),
  };
}

function bodyToCombatant(b: CombatantBody, idx: number): Combatant | string {
  if (!b || typeof b !== "object") return `combatant[${idx}] is not an object`;
  if (typeof b.id !== "string" || !b.id.trim()) return `combatant[${idx}] missing id`;
  if (typeof b.name !== "string" || !b.name.trim()) return `combatant[${idx}] missing name`;
  if (typeof b.hp_max !== "number" || b.hp_max < 1) return `combatant[${idx}] hp_max must be >= 1`;
  if (typeof b.hp_current !== "number" || b.hp_current < 0) return `combatant[${idx}] hp_current must be >= 0`;
  if (typeof b.ac !== "number") return `combatant[${idx}] ac must be a number`;

  let initBonus: number;
  if (typeof b.initiative_bonus === "number") {
    initBonus = b.initiative_bonus;
  } else if (typeof b.dex === "number") {
    initBonus = abilityModifier(b.dex);
  } else {
    initBonus = 0;
  }

  const out: Combatant = {
    id: b.id, name: b.name, initiative_bonus: initBonus,
    hp_max: b.hp_max, hp_current: b.hp_current, ac: b.ac,
    ...(b.hp_temp ? { hp_temp: b.hp_temp } : {}),
    ...(b.conditions && Array.isArray(b.conditions) && b.conditions.length > 0
      ? { conditions: b.conditions }
      : {}),
  };
  return out;
}

// ── Routes ───────────────────────────────────────────────────────────────────

export async function registerDmRoutes(app: FastifyInstance, db: MagisterDB): Promise<void> {
  // POST /magister/dm/campaigns
  app.post<{ Body: CreateCampaignBody }>("/magister/dm/campaigns", async (req, reply) => {
    const title = (req.body?.title ?? "").trim();
    if (!title) return reply.status(400).send({ ok: false, error: "title required" });
    const campaign = db.createDmCampaign({
      title,
      ...(req.body?.setting_blurb ? { settingBlurb: req.body.setting_blurb } : {}),
    });
    db.appendDmEvent({
      campaignId: campaign.id,
      kind: "campaign_created",
      payload: { title: campaign.title },
    });
    return reply.status(201).send({ ok: true, campaign });
  });

  // GET /magister/dm/campaigns
  app.get<{ Querystring: { limit?: string } }>("/magister/dm/campaigns", async (req, reply) => {
    const limit = Math.min(200, Math.max(1, Number.parseInt(req.query?.limit ?? "50", 10) || 50));
    return reply.send({ ok: true, campaigns: db.listDmCampaigns({ limit }) });
  });

  // GET /magister/dm/campaigns/:id
  app.get<{ Params: { id: string }; Querystring: { events?: string } }>(
    "/magister/dm/campaigns/:id",
    async (req, reply) => {
      const campaign = db.getDmCampaign(req.params.id);
      if (!campaign) return reply.status(404).send({ ok: false, error: "Campaign not found" });
      const limit = Math.min(200, Math.max(1, Number.parseInt(req.query?.events ?? "50", 10) || 50));
      const events = db.listDmEvents(req.params.id, { limit });
      const character = db.getDmCharacter(req.params.id);
      return reply.send({ ok: true, campaign, character, events });
    },
  );

  // DELETE /magister/dm/campaigns/:id — hard delete.
  // Cascades through FK ON DELETE CASCADE to characters and events.
  // The lossless option (status="archived"-ish) is PATCH … {status:"complete"}.
  app.delete<{ Params: { id: string } }>(
    "/magister/dm/campaigns/:id",
    async (req, reply) => {
      if (!db.getDmCampaign(req.params.id)) {
        return reply.status(404).send({ ok: false, error: "Campaign not found" });
      }
      const removed = db.deleteDmCampaign(req.params.id);
      if (!removed) return reply.status(404).send({ ok: false, error: "Campaign not found" });
      return reply.send({ ok: true, deleted: true, id: req.params.id });
    },
  );

  // PATCH /magister/dm/campaigns/:id
  app.patch<{ Params: { id: string }; Body: PatchCampaignBody }>(
    "/magister/dm/campaigns/:id",
    async (req, reply) => {
      const campaign = db.getDmCampaign(req.params.id);
      if (!campaign) return reply.status(404).send({ ok: false, error: "Campaign not found" });
      const body = req.body ?? {};
      if (body.status !== undefined && !STATUS_SET.has(body.status as DmCampaignStatus)) {
        return reply.status(400).send({
          ok: false, error: `status must be one of: ${[...STATUS_SET].join(", ")}`,
        });
      }
      if (body.title !== undefined && body.title.trim() === "") {
        return reply.status(400).send({ ok: false, error: "title cannot be empty" });
      }

      const patch: Parameters<MagisterDB["patchDmCampaign"]>[1] = {};
      const eventPayload: Record<string, unknown> = {};
      if (body.title !== undefined && body.title !== campaign.title) {
        patch.title = body.title.trim(); eventPayload.title = patch.title;
      }
      if (body.setting_blurb !== undefined && body.setting_blurb !== campaign.setting_blurb) {
        patch.setting_blurb = body.setting_blurb; eventPayload.setting_blurb = body.setting_blurb;
      }
      if (body.status !== undefined && body.status !== campaign.status) {
        patch.status = body.status as DmCampaignStatus; eventPayload.status = patch.status;
      }
      if (body.current_scene !== undefined && body.current_scene !== campaign.current_scene) {
        patch.current_scene = body.current_scene; eventPayload.current_scene = body.current_scene;
      }
      if (body.quest_state !== undefined) {
        patch.quest_state = body.quest_state; eventPayload.quest_state = body.quest_state;
      }
      if (body.world_memory !== undefined) {
        patch.world_memory = body.world_memory; eventPayload.world_memory = body.world_memory;
      }

      const updated = db.patchDmCampaign(req.params.id, patch);
      if (Object.keys(eventPayload).length > 0) {
        db.appendDmEvent({
          campaignId: req.params.id,
          kind: "campaign_updated",
          payload: eventPayload,
        });
      }
      return reply.send({ ok: true, campaign: updated });
    },
  );

  // POST /magister/dm/campaigns/:id/character
  app.post<{ Params: { id: string }; Body: CreateCharacterBody }>(
    "/magister/dm/campaigns/:id/character",
    async (req, reply) => {
      const campaign = db.getDmCampaign(req.params.id);
      if (!campaign) return reply.status(404).send({ ok: false, error: "Campaign not found" });
      const existing = db.getDmCharacter(req.params.id);
      if (existing) return reply.status(409).send({
        ok: false, error: "Campaign already has a character", character: existing,
      });

      const body = req.body ?? {};
      const name = (body.name ?? "").trim();
      const ancestry = (body.ancestry ?? "").trim();
      const className = (body.class_name ?? "").trim().toLowerCase();
      if (!name) return reply.status(400).send({ ok: false, error: "name required" });
      if (!ancestry) return reply.status(400).send({ ok: false, error: "ancestry required" });
      if (!className) return reply.status(400).send({ ok: false, error: "class_name required" });
      if (!(SRD_CLASSES as readonly string[]).includes(className)) {
        return reply.status(400).send({
          ok: false,
          error: `class_name must be one of: ${SRD_CLASSES.join(", ")}`,
        });
      }

      const abilities = body.abilities && isAbilityScores(body.abilities)
        ? body.abilities
        : { ...DEFAULT_ABILITIES };
      const conMod = abilityModifier(abilities.con);
      const dexMod = abilityModifier(abilities.dex);
      const hpMax = maxHpAtLevelOne(className, conMod);
      const die = `d${hitDieForClass(className)}`;
      const hitDice: DmHitDice = { die, total: 1, remaining: 1 };
      const ac = typeof body.ac === "number" ? body.ac : 10 + dexMod;
      const speed = typeof body.speed === "number" ? body.speed : 30;

      const character = db.createDmCharacter(req.params.id, {
        name, ancestry, className,
        ...(body.background ? { background: body.background } : {}),
        abilities,
        ...(body.proficiencies ? { proficiencies: body.proficiencies } : {}),
        hp_max: hpMax,
        hit_dice: hitDice,
        ac, speed,
        ...(body.inventory ? { inventory: body.inventory } : {}),
      });
      // Slice 4B: prof bonus is fixed at 2 (level 1). Stays in sync with the engine
      // if/when level changes — patching is the route layer's responsibility.
      const _profBonus = proficiencyBonusForLevel(1);
      void _profBonus;

      db.appendDmEvent({
        campaignId: req.params.id,
        kind: "character_created",
        payload: {
          character_id: character.id,
          name: character.name,
          class_name: character.class_name,
          ancestry: character.ancestry,
          hp_max: character.hp_max,
          ac: character.ac,
        },
      });
      return reply.status(201).send({ ok: true, character });
    },
  );

  // GET /magister/dm/campaigns/:id/character
  app.get<{ Params: { id: string } }>(
    "/magister/dm/campaigns/:id/character",
    async (req, reply) => {
      const campaign = db.getDmCampaign(req.params.id);
      if (!campaign) return reply.status(404).send({ ok: false, error: "Campaign not found" });
      const character = db.getDmCharacter(req.params.id);
      if (!character) return reply.status(404).send({ ok: false, error: "No character for this campaign" });
      return reply.send({ ok: true, character });
    },
  );

  // POST /magister/dm/campaigns/:id/roll
  app.post<{ Params: { id: string }; Body: RollBody }>(
    "/magister/dm/campaigns/:id/roll",
    async (req, reply) => {
      const campaign = db.getDmCampaign(req.params.id);
      if (!campaign) return reply.status(404).send({ ok: false, error: "Campaign not found" });
      const formula = (req.body?.formula ?? "").toString();
      if (!formula) return reply.status(400).send({ ok: false, error: "formula required" });
      let result;
      try {
        result = rollDice(formula, activeRng);
      } catch (err) {
        return reply.status(400).send({
          ok: false, error: err instanceof Error ? err.message : String(err),
        });
      }
      const event = db.appendDmEvent({
        campaignId: req.params.id,
        kind: "roll",
        payload: {
          ...(req.body?.label ? { label: req.body.label } : {}),
          formula: result.formula,
          total: result.total,
          rolls: result.rolls,
          modifier: result.modifier,
          breakdown: result.breakdown,
        },
      });
      return reply.send({ ok: true, result, event });
    },
  );

  // POST /magister/dm/campaigns/:id/encounter
  app.post<{ Params: { id: string }; Body: EncounterBody }>(
    "/magister/dm/campaigns/:id/encounter",
    async (req, reply) => {
      const campaign = db.getDmCampaign(req.params.id);
      if (!campaign) return reply.status(404).send({ ok: false, error: "Campaign not found" });
      const raw = Array.isArray(req.body?.combatants) ? req.body.combatants : [];
      if (raw.length === 0) return reply.status(400).send({ ok: false, error: "at least one combatant required" });

      const combatants: Combatant[] = [];
      for (let i = 0; i < raw.length; i++) {
        const v = bodyToCombatant(raw[i]!, i);
        if (typeof v === "string") return reply.status(400).send({ ok: false, error: v });
        combatants.push(v);
      }

      const encounter = createEncounter(combatants, activeRng);
      db.patchDmCampaign(req.params.id, {
        encounter_state: encounter as unknown as Record<string, unknown>,
      });
      const event = db.appendDmEvent({
        campaignId: req.params.id,
        kind: "encounter_start",
        payload: { combatants: combatants.map(c => c.id), order: encounter.order.map(o => o.id) },
      });
      return reply.send({ ok: true, encounter, event });
    },
  );

  // GET /magister/dm/campaigns/:id/encounter
  app.get<{ Params: { id: string } }>(
    "/magister/dm/campaigns/:id/encounter",
    async (req, reply) => {
      const campaign = db.getDmCampaign(req.params.id);
      if (!campaign) return reply.status(404).send({ ok: false, error: "Campaign not found" });
      return reply.send({ ok: true, encounter: campaign.encounter_state });
    },
  );

  // POST /magister/dm/campaigns/:id/turn
  app.post<{ Params: { id: string }; Body: TurnBody }>(
    "/magister/dm/campaigns/:id/turn",
    async (req, reply) => {
      const campaign = db.getDmCampaign(req.params.id);
      if (!campaign) return reply.status(404).send({ ok: false, error: "Campaign not found" });
      const intent = String(req.body?.intent ?? "");
      if (!ALLOWED_INTENTS.has(intent)) {
        return reply.status(400).send({
          ok: false, error: `intent must be one of: ${[...ALLOWED_INTENTS].join(", ")}`,
        });
      }
      const args = (req.body?.args ?? {}) as Record<string, unknown>;

      const character = db.getDmCharacter(req.params.id);
      const events: DmEvent[] = [];

      switch (intent) {
        case "check":
        case "save": {
          if (!character) return reply.status(400).send({ ok: false, error: "no character on campaign" });
          const ability = args.ability;
          const dc = args.dc;
          if (!isAbility(ability)) return reply.status(400).send({ ok: false, error: "args.ability required" });
          if (typeof dc !== "number") return reply.status(400).send({ ok: false, error: "args.dc must be a number" });
          const opts = {
            ...(typeof args.bonus === "number" ? { bonus: args.bonus } : {}),
            ...(args.advantage ? { advantage: true } : {}),
            ...(args.disadvantage ? { disadvantage: true } : {}),
            ...(typeof args.proficient === "boolean" ? { proficient: args.proficient } : {}),
          };
          const srdChar = characterToSrdCharacter(character);
          const result = intent === "check"
            ? abilityCheck(srdChar, ability, dc, opts, activeRng)
            : savingThrow(srdChar, ability, dc, opts, activeRng);
          events.push(db.appendDmEvent({
            campaignId: req.params.id,
            kind: intent as DmEventKind,
            payload: {
              ability, dc,
              total: result.total, natural: result.natural, success: result.success,
              breakdown: result.breakdown,
              ...(opts.advantage ? { advantage: true } : {}),
              ...(opts.disadvantage ? { disadvantage: true } : {}),
            },
          }));
          return reply.send({ ok: true, events, result });
        }

        case "attack": {
          if (!character) return reply.status(400).send({ ok: false, error: "no character on campaign" });
          const attack = args.attack as Attack | undefined;
          const target = args.target as { ac: number } | undefined;
          if (!attack || typeof attack !== "object" || !attack.name || !attack.ability || !attack.damageDice) {
            return reply.status(400).send({ ok: false, error: "args.attack with name/ability/damageDice required" });
          }
          if (!target || typeof target !== "object" || typeof target.ac !== "number") {
            return reply.status(400).send({ ok: false, error: "args.target.ac required" });
          }
          const opts = {
            ...(typeof args.bonus === "number" ? { bonus: args.bonus } : {}),
            ...(args.advantage ? { advantage: true } : {}),
            ...(args.disadvantage ? { disadvantage: true } : {}),
          };
          const srdChar = characterToSrdCharacter(character);
          const result = attackRoll(srdChar, attack, target, opts, activeRng);
          events.push(db.appendDmEvent({
            campaignId: req.params.id,
            kind: "attack",
            payload: {
              attack: attack.name, ability: attack.ability,
              total: result.total, natural: result.natural,
              hit: result.hit, crit: result.crit, miss: result.miss,
              ac: target.ac,
              breakdown: result.breakdown,
            },
          }));
          return reply.send({ ok: true, events, result });
        }

        case "damage":
        case "heal": {
          const targetId = args.target_id as string | undefined;
          const amountRaw = args.amount;
          if (typeof amountRaw !== "number" || amountRaw < 0) {
            return reply.status(400).send({ ok: false, error: "args.amount must be a number >= 0" });
          }
          const result = applyHpDelta(db, campaign, character, targetId, intent, amountRaw);
          if ("error" in result) return reply.status(result.status).send({ ok: false, error: result.error });
          events.push(db.appendDmEvent({
            campaignId: req.params.id,
            kind: intent as DmEventKind,
            payload: { target_id: result.targetId, amount: amountRaw, hp_current: result.hp_current, hp_temp: result.hp_temp },
          }));
          return reply.send({ ok: true, events, character: db.getDmCharacter(req.params.id), encounter: db.getDmCampaign(req.params.id)?.encounter_state ?? null });
        }

        case "condition_add":
        case "condition_remove": {
          const targetId = args.target_id as string | undefined;
          const condition = args.condition;
          if (typeof condition !== "string" || !condition.trim()) {
            return reply.status(400).send({ ok: false, error: "args.condition required" });
          }
          const result = applyConditionDelta(db, campaign, character, targetId, intent, condition);
          if ("error" in result) return reply.status(result.status).send({ ok: false, error: result.error });
          events.push(db.appendDmEvent({
            campaignId: req.params.id,
            kind: intent as DmEventKind,
            payload: { target_id: result.targetId, condition, conditions: result.conditions },
          }));
          return reply.send({ ok: true, events, character: db.getDmCharacter(req.params.id), encounter: db.getDmCampaign(req.params.id)?.encounter_state ?? null });
        }

        case "end_turn": {
          if (!campaign.encounter_state) {
            return reply.status(400).send({ ok: false, error: "no active encounter on campaign" });
          }
          const enc = campaign.encounter_state as unknown as Encounter;
          const next = advanceTurn(enc);
          db.patchDmCampaign(req.params.id, { encounter_state: next as unknown as Record<string, unknown> });
          events.push(db.appendDmEvent({
            campaignId: req.params.id,
            kind: "end_turn",
            payload: {
              prev_turn_index: enc.turn_index,
              next_turn_index: next.turn_index,
              round: next.round,
              wrapped: next.round !== enc.round,
            },
          }));
          return reply.send({ ok: true, events, encounter: next });
        }

        default:
          return reply.status(400).send({ ok: false, error: `unhandled intent: ${intent}` });
      }
    },
  );

  // POST /magister/dm/campaigns/:id/rest
  app.post<{ Params: { id: string }; Body: RestBody }>(
    "/magister/dm/campaigns/:id/rest",
    async (req, reply) => {
      const campaign = db.getDmCampaign(req.params.id);
      if (!campaign) return reply.status(404).send({ ok: false, error: "Campaign not found" });
      const character = db.getDmCharacter(req.params.id);
      if (!character) return reply.status(404).send({ ok: false, error: "No character for this campaign" });
      const kind = req.body?.kind;
      if (kind !== "short" && kind !== "long") {
        return reply.status(400).send({ ok: false, error: "kind must be 'short' or 'long'" });
      }
      const events: DmEvent[] = [];

      if (kind === "long") {
        const updated = db.patchDmCharacter(character.id, {
          hp_current: character.hp_max,
          hp_temp: 0,
          death_saves: { successes: 0, failures: 0 },
          hit_dice: { ...character.hit_dice, remaining: character.hit_dice.total },
        });
        events.push(db.appendDmEvent({
          campaignId: req.params.id,
          kind: "rest",
          payload: {
            kind: "long",
            hp_restored_to: character.hp_max,
            hit_dice_restored_to: character.hit_dice.total,
          },
        }));
        return reply.send({ ok: true, events, character: updated });
      }

      // Short rest. Append the event always; spend hit dice only if asked.
      const spend = req.body?.spendHitDice;
      if (spend !== undefined) {
        if (!Number.isInteger(spend) || spend < 1) {
          return reply.status(400).send({ ok: false, error: "spendHitDice must be a positive integer" });
        }
        if (spend > character.hit_dice.remaining) {
          return reply.status(400).send({
            ok: false, error: `only ${character.hit_dice.remaining} hit dice remaining`,
          });
        }
        const conMod = abilityModifier(character.abilities.con);
        const formula = `${spend}${character.hit_dice.die}`;
        const roll = rollDice(formula, activeRng);
        const heal = roll.total + conMod * spend;
        const newHp = Math.min(character.hp_max, character.hp_current + Math.max(0, heal));
        const updated = db.patchDmCharacter(character.id, {
          hp_current: newHp,
          hit_dice: { ...character.hit_dice, remaining: character.hit_dice.remaining - spend },
        });
        events.push(db.appendDmEvent({
          campaignId: req.params.id,
          kind: "rest",
          payload: {
            kind: "short",
            spent: spend,
            formula,
            roll: roll.total,
            con_mod_per_die: conMod,
            heal,
            hp_after: newHp,
          },
        }));
        return reply.send({ ok: true, events, character: updated });
      }

      events.push(db.appendDmEvent({
        campaignId: req.params.id,
        kind: "rest",
        payload: { kind: "short" },
      }));
      return reply.send({ ok: true, events, character });
    },
  );

  // GET /magister/dm/campaigns/:id/log
  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    "/magister/dm/campaigns/:id/log",
    async (req, reply) => {
      const campaign = db.getDmCampaign(req.params.id);
      if (!campaign) return reply.status(404).send({ ok: false, error: "Campaign not found" });
      const limit = Math.min(500, Math.max(1, Number.parseInt(req.query?.limit ?? "100", 10) || 100));
      return reply.send({ ok: true, events: db.listDmEvents(req.params.id, { limit }) });
    },
  );
}

// ── Internal helpers for damage/heal/condition routing ──────────────────────

interface HpResult { targetId: string; hp_current: number; hp_temp: number }
interface IntentError { error: string; status: number }

function applyHpDelta(
  db: MagisterDB,
  campaign: DmCampaign,
  character: DmCharacter | null,
  targetId: string | undefined,
  kind: "damage" | "heal",
  amount: number,
): HpResult | IntentError {
  // No target: default to the campaign's character.
  const resolvedId = targetId ?? character?.id;
  if (!resolvedId) return { error: "no target_id and no character on campaign", status: 400 };

  if (character && resolvedId === character.id) {
    const combatant: Combatant = {
      id: character.id, name: character.name,
      initiative_bonus: 0,
      hp_max: character.hp_max, hp_current: character.hp_current,
      ...(character.hp_temp ? { hp_temp: character.hp_temp } : {}),
      ac: character.ac,
    };
    const next = kind === "damage" ? srdApplyDamage(combatant, amount) : srdApplyHealing(combatant, amount);
    db.patchDmCharacter(character.id, {
      hp_current: next.hp_current,
      hp_temp: next.hp_temp ?? 0,
    });
    return { targetId: character.id, hp_current: next.hp_current, hp_temp: next.hp_temp ?? 0 };
  }

  // Otherwise look in the encounter.
  if (!campaign.encounter_state) return { error: `target_id ${resolvedId} not found`, status: 404 };
  const enc = campaign.encounter_state as unknown as Encounter;
  const target = enc.combatants[resolvedId];
  if (!target) return { error: `target_id ${resolvedId} not in encounter`, status: 404 };
  const next = kind === "damage" ? srdApplyDamage(target, amount) : srdApplyHealing(target, amount);
  const updated: Encounter = {
    ...enc,
    combatants: { ...enc.combatants, [resolvedId]: next },
  };
  db.patchDmCampaign(campaign.id, { encounter_state: updated as unknown as Record<string, unknown> });
  return { targetId: resolvedId, hp_current: next.hp_current, hp_temp: next.hp_temp ?? 0 };
}

interface ConditionResult { targetId: string; conditions: string[] }

function applyConditionDelta(
  db: MagisterDB,
  campaign: DmCampaign,
  character: DmCharacter | null,
  targetId: string | undefined,
  kind: "condition_add" | "condition_remove",
  condition: string,
): ConditionResult | IntentError {
  const resolvedId = targetId ?? character?.id;
  if (!resolvedId) return { error: "no target_id and no character on campaign", status: 400 };

  if (character && resolvedId === character.id) {
    const combatant: Combatant = {
      id: character.id, name: character.name, initiative_bonus: 0,
      hp_max: character.hp_max, hp_current: character.hp_current,
      ac: character.ac,
      ...(character.conditions.length > 0 ? { conditions: character.conditions } : {}),
    };
    const next = kind === "condition_add"
      ? srdAddCondition(combatant, condition)
      : srdRemoveCondition(combatant, condition);
    const conditions = next.conditions ?? [];
    db.patchDmCharacter(character.id, { conditions });
    return { targetId: character.id, conditions };
  }

  if (!campaign.encounter_state) return { error: `target_id ${resolvedId} not found`, status: 404 };
  const enc = campaign.encounter_state as unknown as Encounter;
  const target = enc.combatants[resolvedId];
  if (!target) return { error: `target_id ${resolvedId} not in encounter`, status: 404 };
  const next = kind === "condition_add"
    ? srdAddCondition(target, condition)
    : srdRemoveCondition(target, condition);
  const updated: Encounter = {
    ...enc,
    combatants: { ...enc.combatants, [resolvedId]: next },
  };
  db.patchDmCampaign(campaign.id, { encounter_state: updated as unknown as Record<string, unknown> });
  return { targetId: resolvedId, conditions: next.conditions ?? [] };
}
