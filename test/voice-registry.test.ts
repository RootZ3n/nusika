/**
 * Slice 6B — voice registry tests.
 *
 * Asserts the GET /nusika/voices contract:
 *   - Always returns ok:true (no crash even when binaries are missing).
 *   - Includes Peh narrator + every companion id from registered modules.
 *   - Voice ids are globally unique.
 *   - Kokoro reported as configured:false (probe-skipped or not-reachable).
 *   - ElevenLabs reported as deprecated.
 *   - Missing PIPER_BIN marks Piper voices unavailable with a reason but
 *     does NOT throw or 500.
 *
 * Tests use an in-memory loader to avoid depending on the on-disk
 * curriculum tree.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { NusikaDB } from "../server/db.js";
import { registerAllRoutes } from "../server/routes/index.js";
import { buildVoiceRegistry, type VoiceRegistry } from "../server/lib/voice-registry.js";
import { __setKokoroFetchForTesting, __resetKokoroFetchForTesting } from "../server/lib/voices/kokoro.js";

/**
 * Stub the Kokoro client fetch to fail-closed. Without this, an unrelated
 * service listening on 127.0.0.1:18794 (e.g. another tool's sidecar)
 * could make the registry's Kokoro probe return reachable:true and break
 * the "configured:false when nothing is wired" assertions. Tests that
 * want to simulate Kokoro reachable can override this in their own scope.
 */
function stubKokoroUnreachable(): void {
  __setKokoroFetchForTesting(async () => {
    throw new Error("stub: Kokoro unreachable");
  });
}

async function bootApp() {
  const dir = mkdtempSync(join(tmpdir(), "magister-6b-"));
  const db = new NusikaDB(join(dir, "test.db"));
  // Register a representative slice of modules with companions.
  db.registerModule({ id: "linux", name: "Linux Fundamentals", companions: ["cronk", "wrrrakk"] });
  db.registerModule({ id: "latin", name: "Latin", companions: ["marcus"] });
  db.registerModule({ id: "inkwell", name: "Shukha Anumpa", companions: ["maren"] });

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

// ── Unit-level: buildVoiceRegistry directly ────────────────────────────────

test("buildVoiceRegistry returns Peh + every companion when configs are absent", async () => {
  const { db, cleanup } = await bootApp();
  try {
    const reg = await buildVoiceRegistry(db, {
      // No on-disk reads — force the fallback DB-id-only path.
      loader: async () => null,
    });
    const ids = new Set(reg.voices.map(v => v.id));
    assert.ok(ids.has("peh-default"), "Peh narrator profile must be present");
    for (const cid of ["cronk", "wrrrakk", "marcus", "maren"]) {
      assert.ok(ids.has(`${cid}-default`), `expected ${cid}-default in registry`);
    }
  } finally {
    await cleanup();
  }
});

test("buildVoiceRegistry voice ids are globally unique", async () => {
  const { db, cleanup } = await bootApp();
  try {
    const reg = await buildVoiceRegistry(db, { loader: async () => null });
    const ids = reg.voices.map(v => v.id);
    assert.equal(new Set(ids).size, ids.length, `ids: ${ids.join(", ")}`);
  } finally {
    await cleanup();
  }
});

test("buildVoiceRegistry reports Kokoro as configured:false when probe is skipped", async () => {
  const { db, cleanup } = await bootApp();
  try {
    const reg = await buildVoiceRegistry(db, { loader: async () => null });
    assert.equal(reg.engines.kokoro.configured, false);
    // probeKokoro defaults to false → detail should say "probe skipped".
    assert.match(reg.engines.kokoro.detail ?? "", /probe skipped/i);
    // Critical anti-faking guarantee: NO voice may claim engine:"kokoro" with available:true.
    const fakeKokoro = reg.voices.find(v => v.engine === "kokoro" && v.available === true);
    assert.equal(fakeKokoro, undefined, "no voice may report engine=kokoro + available=true");
  } finally {
    await cleanup();
  }
});

test("buildVoiceRegistry marks ElevenLabs deprecated", async () => {
  const { db, cleanup } = await bootApp();
  try {
    const reg = await buildVoiceRegistry(db, { loader: async () => null });
    assert.equal(reg.engines.elevenlabs.deprecated, true);
  } finally {
    await cleanup();
  }
});

test("buildVoiceRegistry honors per-companion legacy ElevenLabs voice_id", async () => {
  const { db, cleanup } = await bootApp();
  try {
    const reg = await buildVoiceRegistry(db, {
      loader: async (configPath) => {
        if (configPath?.endsWith("inkwell-config")) {
          return {
            id: "inkwell",
            companions: [
              { id: "maren", name: "Maren", voice_id: "fTtv3eikoepIosk8dTZ5" },
            ],
          };
        }
        return null;
      },
    });
    // Force the loader to fire by giving inkwell a config_path. Re-register
    // inkwell with that path so listModules() surfaces it.
    db.registerModule({ id: "inkwell", name: "Shukha Anumpa", companions: ["maren"], configPath: "inkwell-config" });
    const reg2 = await buildVoiceRegistry(db, {
      loader: async (configPath) => {
        if (configPath === "inkwell-config") {
          return {
            id: "inkwell",
            companions: [
              { id: "maren", name: "Maren", voice_id: "fTtv3eikoepIosk8dTZ5" },
            ],
          };
        }
        return null;
      },
    });
    const maren = reg2.voices.find(v => v.companion_id === "maren");
    assert.ok(maren, "Maren profile must exist");
    assert.equal(maren!.engine, "elevenlabs");
    assert.equal(maren!.voice_ref, "fTtv3eikoepIosk8dTZ5");
    void reg;
  } finally {
    await cleanup();
  }
});

test("buildVoiceRegistry honors voice override with engine: kokoro (marked unavailable)", async () => {
  const { db, cleanup } = await bootApp();
  try {
    db.registerModule({ id: "linux", name: "Linux", companions: ["cronk"], configPath: "linux-config" });
    const reg = await buildVoiceRegistry(db, {
      loader: async (configPath) => {
        if (configPath === "linux-config") {
          return {
            id: "linux",
            companions: [
              { id: "cronk", name: "C-RONK", voice: { engine: "kokoro", voice_ref: "am_michael" } },
            ],
          };
        }
        return null;
      },
    });
    const cronk = reg.voices.find(v => v.companion_id === "cronk");
    assert.ok(cronk);
    assert.equal(cronk!.engine, "kokoro");
    assert.equal(cronk!.voice_ref, "am_michael");
    assert.equal(cronk!.available, false);
    assert.match(cronk!.reason ?? "", /Kokoro/i);
  } finally {
    await cleanup();
  }
});

test("buildVoiceRegistry handles missing PIPER_BIN without crashing", async () => {
  const prev = process.env["PIPER_BIN"];
  process.env["PIPER_BIN"] = "/tmp/no-such-piper-magister-test";
  const { db, cleanup } = await bootApp();
  try {
    const reg = await buildVoiceRegistry(db, { loader: async () => null });
    assert.equal(reg.engines.piper.configured, false);
    assert.match(reg.engines.piper.detail ?? "", /not found/i);
    // Voices that were going to be Piper are now unavailable with a reason.
    const piperVoices = reg.voices.filter(v => v.engine === "piper");
    assert.ok(piperVoices.length > 0);
    for (const v of piperVoices) {
      assert.equal(v.available, false, `${v.id} should be unavailable when PIPER_BIN is missing`);
      assert.ok(v.reason && v.reason.length > 0, `${v.id} should have a reason`);
    }
  } finally {
    if (prev === undefined) delete process.env["PIPER_BIN"];
    else process.env["PIPER_BIN"] = prev;
    await cleanup();
  }
});

// ── Route-level ────────────────────────────────────────────────────────────

test("GET /nusika/voices returns ok:true with Peh, companions, engine status", async () => {
  stubKokoroUnreachable();
  const { app, cleanup } = await bootApp();
  try {
    const res = await app.inject({ method: "GET", url: "/nusika/voices" });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { ok: boolean } & VoiceRegistry;
    assert.equal(body.ok, true);

    const ids = body.voices.map(v => v.id);
    assert.ok(ids.includes("peh-default"));
    for (const cid of ["cronk", "marcus", "maren"]) {
      assert.ok(ids.includes(`${cid}-default`), `expected ${cid}-default`);
    }

    // /nusika/voices probes Kokoro on every call; with no service running
    // in tests, the result must be configured:false with a "not reachable" detail.
    assert.equal(body.engines.kokoro.configured, false);
    assert.match(body.engines.kokoro.detail ?? "", /not reachable/i);
    assert.equal(body.engines.elevenlabs.deprecated, true);
  } finally {
    __resetKokoroFetchForTesting();
    await cleanup();
  }
});

test("GET /nusika/voices stays 200 even with no curriculum modules registered", async () => {
  stubKokoroUnreachable();
  const dir = mkdtempSync(join(tmpdir(), "magister-6b-empty-"));
  const db = new NusikaDB(join(dir, "test.db"));
  const app = Fastify({ logger: false });
  await registerAllRoutes(app, db);
  try {
    const res = await app.inject({ method: "GET", url: "/nusika/voices" });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { ok: boolean } & VoiceRegistry;
    assert.equal(body.ok, true);
    // With no modules, the registry has only Peh.
    assert.equal(body.voices.length, 1);
    assert.equal(body.voices[0]!.id, "peh-default");
  } finally {
    __resetKokoroFetchForTesting();
    await app.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("GET /nusika/voices stays 200 when PIPER_BIN points at a non-existent path", async () => {
  stubKokoroUnreachable();
  const prev = process.env["PIPER_BIN"];
  process.env["PIPER_BIN"] = "/tmp/no-such-piper-magister-test";
  const { app, cleanup } = await bootApp();
  try {
    const res = await app.inject({ method: "GET", url: "/nusika/voices" });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { ok: boolean } & VoiceRegistry;
    assert.equal(body.ok, true);
    assert.equal(body.engines.piper.configured, false);
    assert.match(body.engines.piper.detail ?? "", /not found/i);
  } finally {
    if (prev === undefined) delete process.env["PIPER_BIN"];
    else process.env["PIPER_BIN"] = prev;
    __resetKokoroFetchForTesting();
    await cleanup();
  }
});
