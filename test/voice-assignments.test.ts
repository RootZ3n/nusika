/**
 * Slice 6E — voice assignment guarantees.
 *
 * Locks in the content invariants for the Kokoro voice rollout:
 *   - Every shipped curriculum companion carries a voice block.
 *   - Every voice block uses engine:"kokoro" with a known voice_ref.
 *   - No companion uses engine:"elevenlabs" any longer (Maren migrated).
 *   - Voice ids reference the canonical KOKORO_VOICE_IDS set.
 *   - Varros has a Kokoro voice override.
 *   - When the Kokoro service is reachable, Kokoro-bound voices flip
 *     available:true through the registry.
 *   - GET /magister/voices yields one profile per companion plus Varros.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { MagisterDB } from "../server/db.js";
import { registerAllRoutes } from "../server/routes/index.js";
import { buildVoiceRegistry, type VoiceRegistry } from "../server/lib/voice-registry.js";
import { VARROS } from "../server/lib/narrator.js";
import {
  KOKORO_VOICE_IDS,
  __setKokoroFetchForTesting,
  __resetKokoroFetchForTesting,
} from "../server/lib/voices/kokoro.js";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const CURRICULUM_DIR = resolve(REPO_ROOT, "curriculum");

interface CompanionEntry {
  id?: string;
  name?: string;
  voice?: { engine?: string; voice_ref?: string; language?: string; style?: string };
  voice_id?: string; // legacy
  [k: string]: unknown;
}

function readModuleConfigs(): Array<{ moduleId: string; companions: CompanionEntry[] }> {
  const out: Array<{ moduleId: string; companions: CompanionEntry[] }> = [];
  for (const subdir of readdirSync(CURRICULUM_DIR, { withFileTypes: true })) {
    if (!subdir.isDirectory()) continue;
    const path = join(CURRICULUM_DIR, subdir.name, "config.json");
    const cfg = JSON.parse(readFileSync(path, "utf-8")) as {
      id?: string;
      companions?: Array<CompanionEntry | string>;
    };
    const comps: CompanionEntry[] = [];
    for (const c of cfg.companions ?? []) {
      if (typeof c === "object" && c !== null) comps.push(c as CompanionEntry);
    }
    out.push({ moduleId: cfg.id ?? subdir.name, companions: comps });
  }
  return out;
}

// ── Static curriculum invariants ────────────────────────────────────────────

test("every curriculum companion has a voice block", () => {
  const offenders: string[] = [];
  for (const { moduleId, companions } of readModuleConfigs()) {
    for (const c of companions) {
      if (!c.voice) offenders.push(`${moduleId}:${c.id ?? "?"} missing voice`);
    }
  }
  assert.deepEqual(offenders, [], `companions without a voice block: ${offenders.join(", ")}`);
});

test("every companion voice uses engine:'kokoro' with a non-empty voice_ref", () => {
  const offenders: string[] = [];
  for (const { moduleId, companions } of readModuleConfigs()) {
    for (const c of companions) {
      const v = c.voice;
      if (!v) continue;
      if (v.engine !== "kokoro") offenders.push(`${moduleId}:${c.id} engine=${v.engine}`);
      if (typeof v.voice_ref !== "string" || v.voice_ref.trim() === "") {
        offenders.push(`${moduleId}:${c.id} voice_ref empty`);
      }
    }
  }
  assert.deepEqual(offenders, [], offenders.join(", "));
});

test("every voice_ref is in the canonical KOKORO_VOICE_IDS set", () => {
  const unknown: string[] = [];
  for (const { moduleId, companions } of readModuleConfigs()) {
    for (const c of companions) {
      const ref = c.voice?.voice_ref;
      if (!ref) continue;
      if (!KOKORO_VOICE_IDS.has(ref)) unknown.push(`${moduleId}:${c.id} → ${ref}`);
    }
  }
  assert.deepEqual(unknown, [], `unknown voice ids: ${unknown.join(", ")}`);
});

test("no companion still carries the legacy ElevenLabs voice_id field", () => {
  const offenders: string[] = [];
  for (const { moduleId, companions } of readModuleConfigs()) {
    for (const c of companions) {
      if ("voice_id" in c) offenders.push(`${moduleId}:${c.id}`);
    }
  }
  assert.deepEqual(offenders, [], `legacy voice_id remains on: ${offenders.join(", ")}`);
});

test("VARROS has a Kokoro voice override with a known voice_ref", () => {
  assert.ok(VARROS.voice, "Varros must have a voice block");
  assert.equal(VARROS.voice!.engine, "kokoro");
  assert.ok(KOKORO_VOICE_IDS.has(VARROS.voice!.voice_ref), `${VARROS.voice!.voice_ref} not in KOKORO_VOICE_IDS`);
});

// ── Registry round-trip ────────────────────────────────────────────────────

async function bootRegistryHarness(): Promise<{ db: MagisterDB; cleanup: () => Promise<void> }> {
  const dir = mkdtempSync(join(tmpdir(), "magister-6e-"));
  const db = new MagisterDB(join(dir, "test.db"));
  const app = Fastify({ logger: false });
  // Boot the routes so the curriculum scanner registers everything.
  // We use the real curriculum directory (not a fixture) so this test
  // also covers the on-disk config_path → registry pipeline.
  // Use scanCurriculum with the real path.
  const { scanCurriculum } = await import("../server/curriculum.js");
  await scanCurriculum(db, CURRICULUM_DIR, {
    info: () => {}, warn: () => {}, error: () => {}, debug: () => {},
  });
  await registerAllRoutes(app, db);
  return {
    db,
    cleanup: async () => {
      await app.close();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("buildVoiceRegistry surfaces 31 profiles (Varros + 30 companions) when probing live disk", async () => {
  // Count expectation tracks the curriculum on disk. Adding/removing a
  // companion in any module/*/config.json should bump this number — the
  // test exists to catch silent loss of a voice, not to enforce a
  // constant. Last bumped 2026-05-22 when ai-literacy + ai-systems
  // added iris, field, atlas, pico.
  __setKokoroFetchForTesting(async () => { throw new Error("stub: not reachable"); });
  const { db, cleanup } = await bootRegistryHarness();
  try {
    const reg = await buildVoiceRegistry(db, { probeKokoro: true });
    assert.equal(reg.voices.length, 31, `expected 31 voices, got ${reg.voices.length}`);
    const ids = new Set(reg.voices.map(v => v.id));
    assert.ok(ids.has("varros-default"));
    // Spot-check a few companions across different modules. Maren used to
    // sit on this list as the Inkwell companion; the Inkwell rebind to
    // Varros (2026-05) removed her from the curriculum entirely. We add
    // Vermilion (history) so coverage still spans an extra module —
    // dropping Maren without a replacement would weaken the spread.
    for (const cid of ["vermilion", "cronk", "marcus", "tessera", "sol", "iris", "atlas"]) {
      assert.ok(ids.has(`${cid}-default`), `expected ${cid}-default in registry`);
    }
  } finally {
    __resetKokoroFetchForTesting();
    await cleanup();
  }
});

test("with Kokoro stubbed reachable, every Kokoro-bound voice flips available:true", async () => {
  // Stub /health to look healthy; the registry should mark profiles available.
  __setKokoroFetchForTesting(async () => new Response(
    JSON.stringify({ ok: true, engine: "kokoro", status: "ready", model_loaded: true }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  ));
  const { db, cleanup } = await bootRegistryHarness();
  try {
    const reg = await buildVoiceRegistry(db, { probeKokoro: true });
    assert.equal(reg.engines.kokoro.configured, true);
    const kokoroVoices = reg.voices.filter(v => v.engine === "kokoro");
    assert.ok(kokoroVoices.length >= 27, `expected ≥27 kokoro voices, got ${kokoroVoices.length}`);
    const unavailable = kokoroVoices.filter(v => !v.available);
    assert.deepEqual(unavailable, [], `all Kokoro voices should be available; not: ${unavailable.map(v => v.id).join(", ")}`);
  } finally {
    __resetKokoroFetchForTesting();
    await cleanup();
  }
});

test("with Kokoro stubbed unreachable, Kokoro-bound voices are unavailable with a reason", async () => {
  __setKokoroFetchForTesting(async () => { throw new Error("stub: ECONNREFUSED"); });
  const { db, cleanup } = await bootRegistryHarness();
  try {
    const reg = await buildVoiceRegistry(db, { probeKokoro: true });
    assert.equal(reg.engines.kokoro.configured, false);
    const kokoroVoices = reg.voices.filter(v => v.engine === "kokoro");
    for (const v of kokoroVoices) {
      assert.equal(v.available, false, `${v.id} should be unavailable when Kokoro is down`);
      assert.ok(v.reason && v.reason.length > 0, `${v.id} should have a reason`);
    }
  } finally {
    __resetKokoroFetchForTesting();
    await cleanup();
  }
});

// ── Kokoro sub-state surfacing on engines.kokoro.detail ─────────────────────
//
// The runtime-posture doc (docs/MAGISTER_KOKORO_RUNTIME.md) names five
// observable states; these three are the ones the registry can report
// directly via /magister/voices. "Wrong service on port" is covered by
// the opencode-sidecar test in voices-kokoro-client.test.ts.

test("Kokoro detail surfaces status:'ready' when the service is fully loaded", async () => {
  __setKokoroFetchForTesting(async () => new Response(
    JSON.stringify({ ok: true, engine: "kokoro", status: "ready", model_loaded: true }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  ));
  const { db, cleanup } = await bootRegistryHarness();
  try {
    const reg = await buildVoiceRegistry(db, { probeKokoro: true });
    assert.equal(reg.engines.kokoro.configured, true);
    assert.match(reg.engines.kokoro.detail ?? "", /status: ready/i);
    assert.match(reg.engines.kokoro.detail ?? "", /model loaded/i);
  } finally {
    __resetKokoroFetchForTesting();
    await cleanup();
  }
});

test("Kokoro detail surfaces status:'cold' (reachable, model not yet loaded)", async () => {
  __setKokoroFetchForTesting(async () => new Response(
    JSON.stringify({ ok: true, engine: "kokoro", status: "cold", model_loaded: false }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  ));
  const { db, cleanup } = await bootRegistryHarness();
  try {
    const reg = await buildVoiceRegistry(db, { probeKokoro: true });
    assert.equal(reg.engines.kokoro.configured, true,
      "cold service is still configured — model loads lazily on first /generate");
    assert.match(reg.engines.kokoro.detail ?? "", /status: cold/i);
    assert.match(reg.engines.kokoro.detail ?? "", /lazy/i);
  } finally {
    __resetKokoroFetchForTesting();
    await cleanup();
  }
});

test("Kokoro detail flips configured:false when status:'error' (model load failed)", async () => {
  __setKokoroFetchForTesting(async () => new Response(
    JSON.stringify({
      ok: true, engine: "kokoro", status: "error", model_loaded: false,
      detail: "espeak-ng missing on host",
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  ));
  const { db, cleanup } = await bootRegistryHarness();
  try {
    const reg = await buildVoiceRegistry(db, { probeKokoro: true });
    assert.equal(reg.engines.kokoro.configured, false,
      "error-state Kokoro must NOT report configured:true — /generate will 503");
    assert.match(reg.engines.kokoro.detail ?? "", /loaded with errors/i);
    assert.match(reg.engines.kokoro.detail ?? "", /espeak-ng/);
    // Per-voice availability follows the engine status: every Kokoro
    // voice must be marked unavailable so the UI doesn't promise audio
    // it can't deliver.
    const kokoroVoices = reg.voices.filter(v => v.engine === "kokoro");
    for (const v of kokoroVoices) {
      assert.equal(v.available, false, `${v.id} must be unavailable when Kokoro is in error state`);
    }
  } finally {
    __resetKokoroFetchForTesting();
    await cleanup();
  }
});

test("no profile in the live registry uses engine:'elevenlabs' (Maren migrated)", async () => {
  __setKokoroFetchForTesting(async () => { throw new Error("stub"); });
  const { db, cleanup } = await bootRegistryHarness();
  try {
    const reg = await buildVoiceRegistry(db, { probeKokoro: false });
    const elevenlabs = reg.voices.filter(v => v.engine === "elevenlabs");
    assert.deepEqual(elevenlabs, [], `expected no elevenlabs voices; got: ${elevenlabs.map(v => v.id).join(", ")}`);
  } finally {
    __resetKokoroFetchForTesting();
    await cleanup();
  }
});

test("GET /magister/voices returns exactly 31 entries when run against the real curriculum", async () => {
  // Mirror of the buildVoiceRegistry count above. Bump together.
  __setKokoroFetchForTesting(async () => { throw new Error("stub"); });
  const dir = mkdtempSync(join(tmpdir(), "magister-6e-route-"));
  const db = new MagisterDB(join(dir, "test.db"));
  const { scanCurriculum } = await import("../server/curriculum.js");
  await scanCurriculum(db, CURRICULUM_DIR, {
    info: () => {}, warn: () => {}, error: () => {}, debug: () => {},
  });
  const app = Fastify({ logger: false });
  await registerAllRoutes(app, db);
  try {
    const res = await app.inject({ method: "GET", url: "/magister/voices" });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { ok: boolean } & VoiceRegistry;
    assert.equal(body.ok, true);
    assert.equal(body.voices.length, 31);
    // Anti-faking guard: when Kokoro is unreachable, no Kokoro voice may
    // simultaneously claim available:true.
    const fake = body.voices.find(v => v.engine === "kokoro" && v.available === true);
    assert.equal(fake, undefined);
  } finally {
    __resetKokoroFetchForTesting();
    await app.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
