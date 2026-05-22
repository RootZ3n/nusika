import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import Fastify from "fastify";
import { MagisterDB } from "../server/db.js";
import { registerAllRoutes } from "../server/routes/index.js";
import { __setDmRngForTesting, __resetDmRngForTesting } from "../server/routes/dm.js";

function makeRng(values: number[]): () => number {
  let i = 0;
  return () => {
    if (i >= values.length) throw new Error(`rng exhausted at index ${i}`);
    return values[i++]!;
  };
}

async function bootApp() {
  const dir = mkdtempSync(join(tmpdir(), "magister-dm-"));
  const db = new MagisterDB(join(dir, "test.db"));
  const app = Fastify({ logger: false });
  await registerAllRoutes(app, db);
  return {
    app, db,
    cleanup: async () => {
      await app.close();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function makeCampaign(app: Awaited<ReturnType<typeof bootApp>>["app"], title = "Test Campaign") {
  const res = await app.inject({
    method: "POST", url: "/magister/dm/campaigns",
    payload: { title },
  });
  return res.json().campaign as { id: string; title: string };
}

async function makeFighter(app: Awaited<ReturnType<typeof bootApp>>["app"], campaignId: string) {
  return await app.inject({
    method: "POST", url: `/magister/dm/campaigns/${campaignId}/character`,
    payload: { name: "Korr", ancestry: "human", class_name: "fighter" },
  });
}

// ── Campaigns ────────────────────────────────────────────────────────────────

test("POST /dm/campaigns creates a campaign and appends a campaign_created event", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const res = await app.inject({
      method: "POST", url: "/magister/dm/campaigns",
      payload: { title: "Foothills of Marric" },
    });
    assert.equal(res.statusCode, 201);
    const c = res.json().campaign;
    assert.equal(c.title, "Foothills of Marric");
    assert.equal(c.status, "active");
    assert.equal(typeof c.id, "string");

    const log = await app.inject({ method: "GET", url: `/magister/dm/campaigns/${c.id}/log` });
    const events = log.json().events as Array<{ kind: string }>;
    assert.equal(events.length, 1);
    assert.equal(events[0]!.kind, "campaign_created");
  } finally {
    await cleanup();
  }
});

test("POST /dm/campaigns rejects empty title", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const res = await app.inject({
      method: "POST", url: "/magister/dm/campaigns",
      payload: { title: "  " },
    });
    assert.equal(res.statusCode, 400);
  } finally {
    await cleanup();
  }
});

test("GET /dm/campaigns lists newest first", async () => {
  const { app, cleanup } = await bootApp();
  try {
    await app.inject({ method: "POST", url: "/magister/dm/campaigns", payload: { title: "first" } });
    await delay(5);
    await app.inject({ method: "POST", url: "/magister/dm/campaigns", payload: { title: "second" } });
    const res = await app.inject({ method: "GET", url: "/magister/dm/campaigns" });
    const list = res.json().campaigns as Array<{ title: string }>;
    assert.equal(list[0]!.title, "second");
  } finally {
    await cleanup();
  }
});

test("GET /dm/campaigns/:id includes character and events; 404 unknown id", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const c = await makeCampaign(app);
    await makeFighter(app, c.id);
    const got = await app.inject({ method: "GET", url: `/magister/dm/campaigns/${c.id}` });
    assert.equal(got.statusCode, 200);
    const body = got.json();
    assert.equal(body.campaign.id, c.id);
    assert.equal(body.character.name, "Korr");
    assert.ok(body.events.length >= 2, "campaign_created + character_created");

    const missing = await app.inject({ method: "GET", url: "/magister/dm/campaigns/no-such-id" });
    assert.equal(missing.statusCode, 404);
  } finally {
    await cleanup();
  }
});

test("PATCH /dm/campaigns/:id status=complete sets completed_at and emits campaign_updated", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const c = await makeCampaign(app);
    const patch = await app.inject({
      method: "PATCH", url: `/magister/dm/campaigns/${c.id}`,
      payload: { status: "complete", current_scene: "Final stand on the bridge" },
    });
    assert.equal(patch.statusCode, 200);
    const updated = patch.json().campaign;
    assert.equal(updated.status, "complete");
    assert.ok(typeof updated.completed_at === "string");
    assert.equal(updated.current_scene, "Final stand on the bridge");

    const log = await app.inject({ method: "GET", url: `/magister/dm/campaigns/${c.id}/log` });
    const kinds = (log.json().events as Array<{ kind: string }>).map(e => e.kind);
    assert.ok(kinds.includes("campaign_updated"));
  } finally {
    await cleanup();
  }
});

test("PATCH /dm/campaigns/:id rejects invalid status", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const c = await makeCampaign(app);
    const res = await app.inject({
      method: "PATCH", url: `/magister/dm/campaigns/${c.id}`,
      payload: { status: "abandoned" },
    });
    assert.equal(res.statusCode, 400);
  } finally {
    await cleanup();
  }
});

// ── Characters ───────────────────────────────────────────────────────────────

test("POST .../character creates with computed HP, hit_dice, AC, prof_bonus", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const c = await makeCampaign(app);
    const res = await makeFighter(app, c.id);
    assert.equal(res.statusCode, 201);
    const ch = res.json().character;
    // Default abilities standard array: STR15 DEX14 CON13 INT12 WIS10 CHA8 → con mod = +1
    // Fighter d10 + 1 = 11 hp_max
    assert.equal(ch.class_name, "fighter");
    assert.equal(ch.level, 1);
    assert.equal(ch.proficiency_bonus, 2);
    assert.equal(ch.hp_max, 11);
    assert.equal(ch.hp_current, 11);
    assert.equal(ch.hit_dice.die, "d10");
    assert.equal(ch.hit_dice.total, 1);
    assert.equal(ch.hit_dice.remaining, 1);
    // Default AC = 10 + dex mod (DEX 14 → +2) = 12
    assert.equal(ch.ac, 12);
    assert.equal(ch.speed, 30);
    assert.deepEqual(ch.death_saves, { successes: 0, failures: 0 });
  } finally {
    await cleanup();
  }
});

test("POST .../character rejects non-SRD class", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const c = await makeCampaign(app);
    const res = await app.inject({
      method: "POST", url: `/magister/dm/campaigns/${c.id}/character`,
      payload: { name: "X", ancestry: "human", class_name: "artificer" },
    });
    assert.equal(res.statusCode, 400);
    assert.match(res.json().error, /class_name must be one of/);
  } finally {
    await cleanup();
  }
});

test("POST .../character rejects second character with 409", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const c = await makeCampaign(app);
    await makeFighter(app, c.id);
    const second = await app.inject({
      method: "POST", url: `/magister/dm/campaigns/${c.id}/character`,
      payload: { name: "Mira", ancestry: "human", class_name: "wizard" },
    });
    assert.equal(second.statusCode, 409);
  } finally {
    await cleanup();
  }
});

test("GET .../character returns 404 when none, 200 when present", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const c = await makeCampaign(app);
    const noChar = await app.inject({ method: "GET", url: `/magister/dm/campaigns/${c.id}/character` });
    assert.equal(noChar.statusCode, 404);
    await makeFighter(app, c.id);
    const got = await app.inject({ method: "GET", url: `/magister/dm/campaigns/${c.id}/character` });
    assert.equal(got.statusCode, 200);
  } finally {
    await cleanup();
  }
});

// ── Rolls ────────────────────────────────────────────────────────────────────

test("POST .../roll appends roll event with deterministic RNG", async () => {
  const { app, cleanup } = await bootApp();
  __setDmRngForTesting(makeRng([0])); // d20 → natural 1
  try {
    const c = await makeCampaign(app);
    const res = await app.inject({
      method: "POST", url: `/magister/dm/campaigns/${c.id}/roll`,
      payload: { formula: "1d20+3", label: "perception" },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.result.total, 4); // natural 1 + 3
    assert.equal(body.event.kind, "roll");
    assert.equal((body.event.payload as { label: string }).label, "perception");
  } finally {
    __resetDmRngForTesting();
    await cleanup();
  }
});

test("POST .../roll rejects invalid formula with 400", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const c = await makeCampaign(app);
    const res = await app.inject({
      method: "POST", url: `/magister/dm/campaigns/${c.id}/roll`,
      payload: { formula: "DROP TABLE" },
    });
    assert.equal(res.statusCode, 400);
  } finally {
    await cleanup();
  }
});

// ── Encounter ────────────────────────────────────────────────────────────────

test("encounter create + get + end_turn advances and wraps the round", async () => {
  const { app, cleanup } = await bootApp();
  // Three combatants, three d20 rolls. We want order [g1, f1, c1] after sort.
  // initiative_bonus: g1=2, f1=1, c1=0
  // rng=[0.99, 0.5, 0.0]:
  //   g1: nat 20 + 2 = 22
  //   f1: nat 11 + 1 = 12
  //   c1: nat 1 + 0 = 1
  __setDmRngForTesting(makeRng([0.99, 0.5, 0.0]));
  try {
    const c = await makeCampaign(app);
    const start = await app.inject({
      method: "POST", url: `/magister/dm/campaigns/${c.id}/encounter`,
      payload: {
        combatants: [
          { id: "g1", name: "Goblin", initiative_bonus: 2, hp_max: 7, hp_current: 7, ac: 13 },
          { id: "f1", name: "Fighter", initiative_bonus: 1, hp_max: 30, hp_current: 30, ac: 16 },
          { id: "c1", name: "Cleric", initiative_bonus: 0, hp_max: 22, hp_current: 22, ac: 15 },
        ],
      },
    });
    assert.equal(start.statusCode, 200);
    const enc = start.json().encounter;
    assert.deepEqual(enc.order.map((o: { id: string }) => o.id), ["g1", "f1", "c1"]);
    assert.equal(enc.round, 1);
    assert.equal(enc.turn_index, 0);

    const got = await app.inject({ method: "GET", url: `/magister/dm/campaigns/${c.id}/encounter` });
    assert.equal(got.json().encounter.order[0].id, "g1");

    // end_turn three times → round should bump to 2 on the third call.
    let res = await app.inject({
      method: "POST", url: `/magister/dm/campaigns/${c.id}/turn`,
      payload: { intent: "end_turn", args: {} },
    });
    assert.equal(res.json().encounter.turn_index, 1);
    assert.equal(res.json().encounter.round, 1);
    res = await app.inject({
      method: "POST", url: `/magister/dm/campaigns/${c.id}/turn`,
      payload: { intent: "end_turn", args: {} },
    });
    assert.equal(res.json().encounter.turn_index, 2);
    res = await app.inject({
      method: "POST", url: `/magister/dm/campaigns/${c.id}/turn`,
      payload: { intent: "end_turn", args: {} },
    });
    assert.equal(res.json().encounter.turn_index, 0);
    assert.equal(res.json().encounter.round, 2, "round wraps after the last slot");
  } finally {
    __resetDmRngForTesting();
    await cleanup();
  }
});

test("encounter requires at least one combatant", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const c = await makeCampaign(app);
    const res = await app.inject({
      method: "POST", url: `/magister/dm/campaigns/${c.id}/encounter`,
      payload: { combatants: [] },
    });
    assert.equal(res.statusCode, 400);
  } finally {
    await cleanup();
  }
});

// ── Turn intents ─────────────────────────────────────────────────────────────

test("turn intent=check uses character ability + DC, deterministic RNG", async () => {
  const { app, cleanup } = await bootApp();
  // STR 15 → +2 mod. Default fighter, level 1. d20 rng=0.5 → natural 11. total = 11 + 2 = 13.
  // DC 12 → success. DC 14 → fail.
  __setDmRngForTesting(makeRng([0.5, 0.5]));
  try {
    const c = await makeCampaign(app);
    await makeFighter(app, c.id);

    const ok = await app.inject({
      method: "POST", url: `/magister/dm/campaigns/${c.id}/turn`,
      payload: { intent: "check", args: { ability: "str", dc: 12 } },
    });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.json().result.success, true);
    assert.equal(ok.json().result.total, 13);

    const fail = await app.inject({
      method: "POST", url: `/magister/dm/campaigns/${c.id}/turn`,
      payload: { intent: "check", args: { ability: "str", dc: 14 } },
    });
    assert.equal(fail.json().result.success, false);
  } finally {
    __resetDmRngForTesting();
    await cleanup();
  }
});

test("turn intent=save with character save proficiency adds prof bonus", async () => {
  const { app, cleanup } = await bootApp();
  // d20 rng=0.5 → 11. STR mod +2. Save proficient (set on character) → +2 prof. total 15.
  __setDmRngForTesting(makeRng([0.5]));
  try {
    const c = await makeCampaign(app);
    await app.inject({
      method: "POST", url: `/magister/dm/campaigns/${c.id}/character`,
      payload: {
        name: "Korr", ancestry: "human", class_name: "fighter",
        proficiencies: { saves: ["str", "con"] },
      },
    });
    const res = await app.inject({
      method: "POST", url: `/magister/dm/campaigns/${c.id}/turn`,
      payload: { intent: "save", args: { ability: "str", dc: 15 } },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().result.total, 15);
    assert.equal(res.json().result.success, true);
  } finally {
    __resetDmRngForTesting();
    await cleanup();
  }
});

test("turn intent=damage drops character hp_current; healing tops back up but not over hp_max", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const c = await makeCampaign(app);
    await makeFighter(app, c.id); // hp_max 11

    const dmg = await app.inject({
      method: "POST", url: `/magister/dm/campaigns/${c.id}/turn`,
      payload: { intent: "damage", args: { amount: 4 } },
    });
    assert.equal(dmg.statusCode, 200);
    assert.equal(dmg.json().character.hp_current, 7);

    const heal = await app.inject({
      method: "POST", url: `/magister/dm/campaigns/${c.id}/turn`,
      payload: { intent: "heal", args: { amount: 999 } },
    });
    assert.equal(heal.json().character.hp_current, 11, "healing capped at hp_max");
  } finally {
    await cleanup();
  }
});

test("turn intent=condition_add and condition_remove update character", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const c = await makeCampaign(app);
    await makeFighter(app, c.id);
    const add = await app.inject({
      method: "POST", url: `/magister/dm/campaigns/${c.id}/turn`,
      payload: { intent: "condition_add", args: { condition: "Prone" } },
    });
    assert.deepEqual(add.json().character.conditions, ["prone"]);
    const remove = await app.inject({
      method: "POST", url: `/magister/dm/campaigns/${c.id}/turn`,
      payload: { intent: "condition_remove", args: { condition: "PRONE" } },
    });
    assert.deepEqual(remove.json().character.conditions, []);
  } finally {
    await cleanup();
  }
});

test("turn rejects unknown intent with 400", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const c = await makeCampaign(app);
    const res = await app.inject({
      method: "POST", url: `/magister/dm/campaigns/${c.id}/turn`,
      payload: { intent: "summon_dragon", args: {} },
    });
    assert.equal(res.statusCode, 400);
  } finally {
    await cleanup();
  }
});

test("turn intent=damage targets a combatant in the encounter when target_id matches", async () => {
  const { app, cleanup } = await bootApp();
  __setDmRngForTesting(makeRng([0.99, 0.5])); // 2 combatants, 2 initiative rolls
  try {
    const c = await makeCampaign(app);
    await app.inject({
      method: "POST", url: `/magister/dm/campaigns/${c.id}/encounter`,
      payload: {
        combatants: [
          { id: "g1", name: "Goblin", initiative_bonus: 2, hp_max: 7, hp_current: 7, ac: 13 },
          { id: "g2", name: "Goblin 2", initiative_bonus: 1, hp_max: 7, hp_current: 7, ac: 13 },
        ],
      },
    });
    const res = await app.inject({
      method: "POST", url: `/magister/dm/campaigns/${c.id}/turn`,
      payload: { intent: "damage", args: { target_id: "g1", amount: 5 } },
    });
    assert.equal(res.statusCode, 200);
    const enc = res.json().encounter;
    assert.equal(enc.combatants.g1.hp_current, 2);
    assert.equal(enc.combatants.g2.hp_current, 7, "untouched combatant unaffected");
  } finally {
    __resetDmRngForTesting();
    await cleanup();
  }
});

// ── Rest ─────────────────────────────────────────────────────────────────────

test("long rest restores HP, clears temp HP, resets death saves and hit dice", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const c = await makeCampaign(app);
    await makeFighter(app, c.id); // hp_max 11

    // Hurt the character first.
    await app.inject({
      method: "POST", url: `/magister/dm/campaigns/${c.id}/turn`,
      payload: { intent: "damage", args: { amount: 7 } },
    });
    let got = await app.inject({ method: "GET", url: `/magister/dm/campaigns/${c.id}/character` });
    assert.equal(got.json().character.hp_current, 4);

    const rest = await app.inject({
      method: "POST", url: `/magister/dm/campaigns/${c.id}/rest`,
      payload: { kind: "long" },
    });
    assert.equal(rest.statusCode, 200);
    const ch = rest.json().character;
    assert.equal(ch.hp_current, 11);
    assert.equal(ch.hp_temp, 0);
    assert.deepEqual(ch.death_saves, { successes: 0, failures: 0 });
    assert.equal(ch.hit_dice.remaining, ch.hit_dice.total);
  } finally {
    await cleanup();
  }
});

test("short rest without spendHitDice appends event but does not change HP", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const c = await makeCampaign(app);
    await makeFighter(app, c.id);
    await app.inject({
      method: "POST", url: `/magister/dm/campaigns/${c.id}/turn`,
      payload: { intent: "damage", args: { amount: 4 } },
    });
    const rest = await app.inject({
      method: "POST", url: `/magister/dm/campaigns/${c.id}/rest`,
      payload: { kind: "short" },
    });
    assert.equal(rest.statusCode, 200);
    assert.equal(rest.json().character.hp_current, 7, "no auto-heal on plain short rest");
    const events = rest.json().events as Array<{ kind: string; payload: { kind: string } }>;
    assert.equal(events[0]!.kind, "rest");
    assert.equal(events[0]!.payload.kind, "short");
  } finally {
    await cleanup();
  }
});

test("short rest with spendHitDice rolls deterministically and heals", async () => {
  const { app, cleanup } = await bootApp();
  // Hit die for fighter is d10. rng=0.5 → floor(5)+1 = 6. CON mod for default abilities = +1.
  // Heal = 6 + 1 = 7.
  __setDmRngForTesting(makeRng([0.5]));
  try {
    const c = await makeCampaign(app);
    await makeFighter(app, c.id); // hp_max 11
    await app.inject({
      method: "POST", url: `/magister/dm/campaigns/${c.id}/turn`,
      payload: { intent: "damage", args: { amount: 9 } },
    }); // hp = 2
    const rest = await app.inject({
      method: "POST", url: `/magister/dm/campaigns/${c.id}/rest`,
      payload: { kind: "short", spendHitDice: 1 },
    });
    assert.equal(rest.statusCode, 200);
    const ch = rest.json().character;
    assert.equal(ch.hp_current, 9, "2 + 7 = 9");
    assert.equal(ch.hit_dice.remaining, 0);
    const payload = (rest.json().events as Array<{ payload: Record<string, unknown> }>)[0]!.payload;
    assert.equal(payload.spent, 1);
    assert.equal(payload.heal, 7);
  } finally {
    __resetDmRngForTesting();
    await cleanup();
  }
});

test("short rest rejects spending more hit dice than remaining", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const c = await makeCampaign(app);
    await makeFighter(app, c.id); // remaining = 1
    const res = await app.inject({
      method: "POST", url: `/magister/dm/campaigns/${c.id}/rest`,
      payload: { kind: "short", spendHitDice: 5 },
    });
    assert.equal(res.statusCode, 400);
  } finally {
    await cleanup();
  }
});

// ── Event log ────────────────────────────────────────────────────────────────

test("event log is append-only and ordered chronologically", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const c = await makeCampaign(app);
    await makeFighter(app, c.id);
    await app.inject({
      method: "POST", url: `/magister/dm/campaigns/${c.id}/turn`,
      payload: { intent: "damage", args: { amount: 1 } },
    });
    await app.inject({
      method: "POST", url: `/magister/dm/campaigns/${c.id}/turn`,
      payload: { intent: "heal", args: { amount: 1 } },
    });
    const log = await app.inject({ method: "GET", url: `/magister/dm/campaigns/${c.id}/log` });
    const kinds = (log.json().events as Array<{ kind: string }>).map(e => e.kind);
    assert.deepEqual(kinds, ["campaign_created", "character_created", "damage", "heal"]);
  } finally {
    await cleanup();
  }
});

test("cascade delete: deleting a campaign drops its characters and events", async () => {
  const { app, db, cleanup } = await bootApp();
  try {
    const c = await makeCampaign(app);
    await makeFighter(app, c.id);
    // Drop via raw DB (no public delete route in Slice 4B; this just verifies the FK cascade works).
    (db as unknown as { db: { prepare: (sql: string) => { run: (...a: unknown[]) => unknown } } }).db
      .prepare("DELETE FROM magister_dm_campaigns WHERE id = ?").run(c.id);
    const character = db.getDmCharacter(c.id);
    assert.equal(character, null, "character cascaded");
    const events = db.listDmEvents(c.id);
    assert.deepEqual(events, [], "events cascaded");
  } finally {
    await cleanup();
  }
});
