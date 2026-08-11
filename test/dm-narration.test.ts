import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import Fastify from "fastify";
import { NusikaDB } from "../server/db.js";
import { registerAllRoutes } from "../server/routes/index.js";
import {
  __setCompleteForTesting,
  __resetCompleteForTesting,
} from "../server/lib/llm.js";
import {
  buildDmNarrationPrompt,
  formatEvent,
  type NarrationStyle,
} from "../server/lib/dm-narration-prompt.js";
import type { DmCampaign, DmCharacter, DmEvent } from "../server/db.js";

async function bootApp() {
  const dir = mkdtempSync(join(tmpdir(), "magister-narrate-"));
  const db = new NusikaDB(join(dir, "test.db"));
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

async function campaignWithFighter(harness: Awaited<ReturnType<typeof bootApp>>) {
  const c = await harness.app.inject({
    method: "POST", url: "/nusika/dm/campaigns",
    payload: { title: "The Old Stones", setting_blurb: "A windswept moor." },
  });
  const campaignId = c.json().campaign.id as string;
  await harness.app.inject({
    method: "POST", url: `/nusika/dm/campaigns/${campaignId}/character`,
    payload: { name: "Korr", ancestry: "human", class_name: "fighter" },
  });
  return campaignId;
}

// ── Pure prompt builder + formatEvent ───────────────────────────────────────

test("buildDmNarrationPrompt includes the absolute-rules guardrails verbatim", () => {
  const campaign: DmCampaign = {
    id: "c1", user_id: "default", title: "T", setting_blurb: null, status: "active",
    current_scene: null, quest_state: {}, world_memory: [], encounter_state: null,
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", completed_at: null,
  };
  const prompt = buildDmNarrationPrompt({
    campaign, character: null, events: [], style: "cinematic",
  });
  // Each phrase below is asserted by tests; the prompt builder must keep them verbatim.
  assert.match(prompt, /Do not roll dice/);
  assert.match(prompt, /Do not change HP/);
  assert.match(prompt, /Do not add inventory/);
  assert.match(prompt, /Do not advance initiative/);
  assert.match(prompt, /Do not add enemies, NPCs, loot, XP, or hidden state/);
  assert.match(prompt, /Describe only confirmed events/);
  assert.match(prompt, /ENGINE-IS-AUTHORITATIVE CONTRACT/);
  assert.match(prompt, /You narrate the events. You do not invent outcomes/);
});

test("buildDmNarrationPrompt includes campaign + character + events sections", () => {
  const campaign: DmCampaign = {
    id: "c1", user_id: "default", title: "The Brink", setting_blurb: "A grey shore.",
    status: "active", current_scene: "Ruined watchtower",
    quest_state: {}, world_memory: ["the gate cracked", "rain returned"], encounter_state: null,
    created_at: "x", updated_at: "x", completed_at: null,
  };
  const character: DmCharacter = {
    id: "ch1", campaign_id: "c1", name: "Korr", ancestry: "human", class_name: "fighter",
    background: null, level: 1, xp: 0,
    abilities: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
    proficiency_bonus: 2, proficiencies: { saves: ["str", "con"] },
    hp_max: 11, hp_current: 7, hp_temp: 0,
    hit_dice: { die: "d10", total: 1, remaining: 1 },
    ac: 12, speed: 30, inventory: [], spells: {}, conditions: ["prone"],
    death_saves: { successes: 0, failures: 0 }, notes: null,
    created_at: "x", updated_at: "x",
  };
  const events: DmEvent[] = [
    {
      id: "e1", campaign_id: "c1", kind: "check",
      payload: { ability: "str", dc: 12, total: 13, natural: 11, success: true },
      created_at: "y",
    },
  ];
  const prompt = buildDmNarrationPrompt({
    campaign, character, events, style: "cinematic",
  });
  assert.match(prompt, /Title: The Brink/);
  assert.match(prompt, /Setting: A grey shore\./);
  assert.match(prompt, /Current scene: Ruined watchtower/);
  assert.match(prompt, /CHARACTER:[\s\S]*Korr — human fighter/);
  assert.match(prompt, /HP 7\/11/);
  assert.match(prompt, /Conditions: prone/);
  assert.match(prompt, /RECENT WORLD BEATS:/);
  assert.match(prompt, /the gate cracked/);
  assert.match(prompt, /Ability check: str.*DC 12.*total 13.*success/);
});

test("formatEvent renders the common kinds compactly", () => {
  const make = (kind: DmEvent["kind"], payload: Record<string, unknown>): DmEvent => ({
    id: "x", campaign_id: "c1", kind, payload, created_at: "x",
  });
  assert.match(
    formatEvent(make("character_created", { name: "Korr", class_name: "fighter", ancestry: "human", hp_max: 11, ac: 12 })),
    /Character created: Korr, level 1 fighter \(human\), HP 11\/11, AC 12/,
  );
  assert.match(
    formatEvent(make("roll", { formula: "1d20+5", total: 19, breakdown: "[14] + 5 = 19", label: "perception" })),
    /Roll "perception": 1d20\+5 = 19/,
  );
  assert.match(
    formatEvent(make("damage", { target_id: "g1", amount: 4, hp_current: 3 })),
    /Damage to g1: 4; HP now 3/,
  );
  assert.match(
    formatEvent(make("rest", { kind: "long", hp_restored_to: 11, hit_dice_restored_to: 1 })),
    /Long rest: HP restored to 11, hit dice to 1/,
  );
  assert.match(
    formatEvent(make("end_turn", { round: 2, next_turn_index: 0, wrapped: true })),
    /Turn ended\. Round 2, slot 0 \(round bumped\)/,
  );
});

// ── Route tests ─────────────────────────────────────────────────────────────

test("POST .../narrate 404 for unknown campaign", async () => {
  const harness = await bootApp();
  try {
    const res = await harness.app.inject({
      method: "POST", url: "/nusika/dm/campaigns/no-such/narrate",
      payload: {},
    });
    assert.equal(res.statusCode, 404);
  } finally {
    await harness.cleanup();
  }
});

test("POST .../narrate 400 when no events available (since=latest)", async () => {
  const harness = await bootApp();
  try {
    const campaignId = await campaignWithFighter(harness);
    // Get latest event id (character_created), then ask for narration of "events after it".
    const log = await harness.app.inject({ method: "GET", url: `/nusika/dm/campaigns/${campaignId}/log` });
    const latest = (log.json().events as DmEvent[]).at(-1)!;
    const res = await harness.app.inject({
      method: "POST", url: `/nusika/dm/campaigns/${campaignId}/narrate`,
      payload: { since_event_id: latest.id },
    });
    assert.equal(res.statusCode, 400);
    assert.match(res.json().error, /No events available/i);
  } finally {
    await harness.cleanup();
  }
});

test("POST .../narrate 400 when since_event_id is from a different campaign", async () => {
  const harness = await bootApp();
  try {
    const a = await campaignWithFighter(harness);
    const b = await campaignWithFighter(harness);
    const aLog = await harness.app.inject({ method: "GET", url: `/nusika/dm/campaigns/${a}/log` });
    const fromA = (aLog.json().events as DmEvent[])[0]!.id;
    const res = await harness.app.inject({
      method: "POST", url: `/nusika/dm/campaigns/${b}/narrate`,
      payload: { since_event_id: fromA },
    });
    assert.equal(res.statusCode, 400);
  } finally {
    await harness.cleanup();
  }
});

test("POST .../narrate success: returns prose, events_used, persists narration event", async () => {
  const harness = await bootApp();
  __setCompleteForTesting(async () => ({
    text: "The wind cuts across the moor as you steady your stance. ",
    model: "test-model", provider: "openrouter",
    tokensIn: 30, tokensOut: 40, estimatedCostUsd: 0, durationMs: 5,
  }));
  try {
    const campaignId = await campaignWithFighter(harness);
    const res = await harness.app.inject({
      method: "POST", url: `/nusika/dm/campaigns/${campaignId}/narrate`,
      payload: { style: "brief" },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.ok, true);
    assert.match(body.narration, /wind cuts across the moor/);
    assert.equal(typeof body.narration_event_id, "string");
    assert.equal(body.model, "test-model");
    assert.ok(Array.isArray(body.events_used));
    assert.ok(body.events_used.length >= 2, "campaign_created + character_created at minimum");

    // Persistence: the new narration event shows up in the log.
    const log = await harness.app.inject({ method: "GET", url: `/nusika/dm/campaigns/${campaignId}/log` });
    const kinds = (log.json().events as DmEvent[]).map(e => e.kind);
    assert.ok(kinds.includes("narration"), "narration event must be appended");
  } finally {
    __resetCompleteForTesting();
    await harness.cleanup();
  }
});

test("POST .../narrate 502 when LLM unavailable; engine state untouched", async () => {
  const harness = await bootApp();
  __setCompleteForTesting(async () => { throw new Error("simulated upstream failure"); });
  try {
    const campaignId = await campaignWithFighter(harness);

    // Snapshot character state.
    const before = await harness.app.inject({
      method: "GET", url: `/nusika/dm/campaigns/${campaignId}/character`,
    });
    const ch0 = before.json().character as DmCharacter;

    const res = await harness.app.inject({
      method: "POST", url: `/nusika/dm/campaigns/${campaignId}/narrate`,
      payload: {},
    });
    assert.equal(res.statusCode, 502);
    assert.match(res.json().error, /unavailable/i);

    // Character state must not have changed.
    const after = await harness.app.inject({
      method: "GET", url: `/nusika/dm/campaigns/${campaignId}/character`,
    });
    const ch1 = after.json().character as DmCharacter;
    assert.equal(ch1.hp_current, ch0.hp_current);
    assert.equal(ch1.hp_max, ch0.hp_max);
    assert.deepEqual(ch1.conditions, ch0.conditions);
    assert.deepEqual(ch1.hit_dice, ch0.hit_dice);

    // No narration event got appended.
    const log = await harness.app.inject({ method: "GET", url: `/nusika/dm/campaigns/${campaignId}/log` });
    const kinds = (log.json().events as DmEvent[]).map(e => e.kind);
    assert.ok(!kinds.includes("narration"));
  } finally {
    __resetCompleteForTesting();
    await harness.cleanup();
  }
});

test("POST .../narrate 422 on empty model output; nothing persisted", async () => {
  const harness = await bootApp();
  __setCompleteForTesting(async () => ({
    text: "   \n\t  ",
    model: "test-model", provider: "openrouter",
    tokensIn: 1, tokensOut: 0, estimatedCostUsd: 0, durationMs: 1,
  }));
  try {
    const campaignId = await campaignWithFighter(harness);
    const res = await harness.app.inject({
      method: "POST", url: `/nusika/dm/campaigns/${campaignId}/narrate`,
      payload: {},
    });
    assert.equal(res.statusCode, 422);
    assert.match(res.json().error, /empty/i);

    const log = await harness.app.inject({ method: "GET", url: `/nusika/dm/campaigns/${campaignId}/log` });
    const kinds = (log.json().events as DmEvent[]).map(e => e.kind);
    assert.ok(!kinds.includes("narration"));
  } finally {
    __resetCompleteForTesting();
    await harness.cleanup();
  }
});

test("POST .../narrate captures the prompt actually sent for assertion", async () => {
  const harness = await bootApp();
  let capturedPrompt = "";
  let capturedEventCount = 0;
  __setCompleteForTesting(async (req) => {
    const sys = req.messages.find(m => m.role === "system");
    if (sys) capturedPrompt = sys.content;
    // Count "CONFIRMED EVENTS" lines in the prompt for a soft check.
    const m = capturedPrompt.match(/CONFIRMED EVENTS \(chronological\):\n([\s\S]*?)(?:\n\n|$)/);
    if (m) capturedEventCount = m[1]!.split("\n").filter(l => /^\d+\.\s/.test(l)).length;
    return {
      text: "Narration text.", model: "test-model", provider: "openrouter",
      tokensIn: 1, tokensOut: 1, estimatedCostUsd: 0, durationMs: 1,
    };
  });
  try {
    const campaignId = await campaignWithFighter(harness);
    // Add a deterministic roll so we can confirm it shows up in the prompt.
    await harness.app.inject({
      method: "POST", url: `/nusika/dm/campaigns/${campaignId}/roll`,
      payload: { formula: "1d20", label: "perception" },
    });

    const res = await harness.app.inject({
      method: "POST", url: `/nusika/dm/campaigns/${campaignId}/narrate`,
      payload: { style: "tactical", limit: 5 },
    });
    assert.equal(res.statusCode, 200);

    // Guardrails are present.
    assert.match(capturedPrompt, /Do not roll dice/);
    assert.match(capturedPrompt, /Do not change HP/);
    assert.match(capturedPrompt, /Do not add inventory/);
    assert.match(capturedPrompt, /Describe only confirmed events/);

    // Style.
    assert.match(capturedPrompt, /STYLE: Concise tactical readout/);

    // Selected events are in the prompt.
    assert.match(capturedPrompt, /Campaign created: The Old Stones/);
    assert.match(capturedPrompt, /Character created: Korr/);
    assert.match(capturedPrompt, /Roll "perception": 1d20/);
    assert.equal(capturedEventCount, 3, "campaign_created + character_created + roll");
  } finally {
    __resetCompleteForTesting();
    await harness.cleanup();
  }
});

test("POST .../narrate event_ids selects only the requested events", async () => {
  const harness = await bootApp();
  let capturedPrompt = "";
  __setCompleteForTesting(async (req) => {
    capturedPrompt = req.messages.find(m => m.role === "system")?.content ?? "";
    return {
      text: "ok.", model: "m", provider: "openrouter",
      tokensIn: 1, tokensOut: 1, estimatedCostUsd: 0, durationMs: 1,
    };
  });
  try {
    const campaignId = await campaignWithFighter(harness);
    await harness.app.inject({
      method: "POST", url: `/nusika/dm/campaigns/${campaignId}/roll`,
      payload: { formula: "1d20", label: "alpha" },
    });
    await harness.app.inject({
      method: "POST", url: `/nusika/dm/campaigns/${campaignId}/roll`,
      payload: { formula: "1d20", label: "beta" },
    });
    const log = await harness.app.inject({ method: "GET", url: `/nusika/dm/campaigns/${campaignId}/log` });
    const events = log.json().events as DmEvent[];
    const alphaId = events.find(e => e.kind === "roll" && (e.payload as { label?: string }).label === "alpha")!.id;

    const res = await harness.app.inject({
      method: "POST", url: `/nusika/dm/campaigns/${campaignId}/narrate`,
      payload: { event_ids: [alphaId] },
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json().events_used, [alphaId]);
    // The captured prompt should NOT mention "beta".
    assert.match(capturedPrompt, /alpha/);
    assert.equal(/beta/.test(capturedPrompt), false, "non-selected events must not appear in prompt");
  } finally {
    __resetCompleteForTesting();
    await harness.cleanup();
  }
});

test("POST .../narrate since_event_id includes only events strictly after", async () => {
  const harness = await bootApp();
  __setCompleteForTesting(async () => ({
    text: "ok.", model: "m", provider: "openrouter",
    tokensIn: 1, tokensOut: 1, estimatedCostUsd: 0, durationMs: 1,
  }));
  try {
    const campaignId = await campaignWithFighter(harness);
    const log0 = await harness.app.inject({ method: "GET", url: `/nusika/dm/campaigns/${campaignId}/log` });
    const characterEvent = (log0.json().events as DmEvent[]).find(e => e.kind === "character_created")!;
    // Tiny gap to keep created_at strictly newer than the boundary.
    await delay(5);
    await harness.app.inject({
      method: "POST", url: `/nusika/dm/campaigns/${campaignId}/roll`,
      payload: { formula: "1d20" },
    });
    const res = await harness.app.inject({
      method: "POST", url: `/nusika/dm/campaigns/${campaignId}/narrate`,
      payload: { since_event_id: characterEvent.id },
    });
    assert.equal(res.statusCode, 200);
    const used = res.json().events_used as string[];
    assert.ok(!used.includes(characterEvent.id), "boundary event itself excluded");
    assert.equal(used.length, 1, "only the roll is after the boundary");
  } finally {
    __resetCompleteForTesting();
    await harness.cleanup();
  }
});

test("POST .../narrate caps limit at 30 even when a larger number is supplied", async () => {
  const harness = await bootApp();
  let capturedEventCount = 0;
  __setCompleteForTesting(async (req) => {
    const sys = req.messages.find(m => m.role === "system")?.content ?? "";
    const m = sys.match(/CONFIRMED EVENTS \(chronological\):\n([\s\S]*?)(?:\n\n|$)/);
    if (m) capturedEventCount = m[1]!.split("\n").filter(l => /^\d+\.\s/.test(l)).length;
    return {
      text: "ok.", model: "m", provider: "openrouter",
      tokensIn: 1, tokensOut: 1, estimatedCostUsd: 0, durationMs: 1,
    };
  });
  try {
    const campaignId = await campaignWithFighter(harness);
    // Fire 35 rolls; default + cap should keep narration to <= 30 events.
    for (let i = 0; i < 35; i++) {
      await harness.app.inject({
        method: "POST", url: `/nusika/dm/campaigns/${campaignId}/roll`,
        payload: { formula: "1d6", label: `r${i}` },
      });
    }
    const res = await harness.app.inject({
      method: "POST", url: `/nusika/dm/campaigns/${campaignId}/narrate`,
      payload: { limit: 100 },
    });
    assert.equal(res.statusCode, 200);
    assert.equal((res.json().events_used as string[]).length, 30);
    assert.equal(capturedEventCount, 30);
  } finally {
    __resetCompleteForTesting();
    await harness.cleanup();
  }
});

test("POST .../narrate rejects unknown style with 400", async () => {
  const harness = await bootApp();
  try {
    const campaignId = await campaignWithFighter(harness);
    const res = await harness.app.inject({
      method: "POST", url: `/nusika/dm/campaigns/${campaignId}/narrate`,
      payload: { style: "epic" },
    });
    assert.equal(res.statusCode, 400);
    assert.match(res.json().error, /style must be one of/);
    void ([] as NarrationStyle[]); // ensure the type import is used
  } finally {
    await harness.cleanup();
  }
});

test("POST .../narrate does not mutate engine state on success", async () => {
  const harness = await bootApp();
  __setCompleteForTesting(async () => ({
    text: "you stand alone on the moor.", model: "m", provider: "openrouter",
    tokensIn: 1, tokensOut: 1, estimatedCostUsd: 0, durationMs: 1,
  }));
  try {
    const campaignId = await campaignWithFighter(harness);
    const before = (await harness.app.inject({
      method: "GET", url: `/nusika/dm/campaigns/${campaignId}/character`,
    })).json().character as DmCharacter;

    await harness.app.inject({
      method: "POST", url: `/nusika/dm/campaigns/${campaignId}/narrate`,
      payload: {},
    });
    const after = (await harness.app.inject({
      method: "GET", url: `/nusika/dm/campaigns/${campaignId}/character`,
    })).json().character as DmCharacter;

    assert.equal(after.hp_current, before.hp_current);
    assert.equal(after.hp_max, before.hp_max);
    assert.equal(after.ac, before.ac);
    assert.equal(after.xp, before.xp);
    assert.equal(after.level, before.level);
    assert.deepEqual(after.conditions, before.conditions);
    assert.deepEqual(after.hit_dice, before.hit_dice);
    assert.deepEqual(after.death_saves, before.death_saves);
    assert.deepEqual(after.inventory, before.inventory);
  } finally {
    __resetCompleteForTesting();
    await harness.cleanup();
  }
});
