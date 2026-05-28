/**
 * Slice 6D — POST /nusika/tts dispatch tests.
 *
 * Verifies:
 *   - Profile with engine:"kokoro" routes to the Kokoro client.
 *   - Repeat request hits the cache and never calls the client.
 *   - Kokoro down → 503 by default; falls back to Piper when configured.
 *   - Profile with engine:"elevenlabs" returns 409 (route to /tts/elevenlabs).
 *   - Legacy `{ text }` callers still get the existing Piper behavior.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { NusikaDB } from "../server/db.js";
import { registerAllRoutes } from "../server/routes/index.js";
import {
  __setKokoroFetchForTesting,
  __resetKokoroFetchForTesting,
} from "../server/lib/voices/kokoro.js";

interface Harness {
  app: Awaited<ReturnType<typeof Fastify>>;
  db: NusikaDB;
  cleanup: () => Promise<void>;
}

async function bootApp(opts: {
  /** Override per-companion config injected as the registry's curriculum config. */
  companions?: Record<string, unknown[]>;
} = {}): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), "magister-6d-dispatch-"));
  // Isolate the voice cache to a tmp dir so tests don't collide.
  process.env["NUSIKA_STATE_DIR"] = join(dir, "state");
  // Force every Piper preflight to fail so legacy/fallback paths get a deterministic 503.
  process.env["PIPER_BIN"] = "/tmp/no-such-piper-magister-test";

  const db = new NusikaDB(join(dir, "test.db"));
  // Each module's companions array is registered as a list of ids; the
  // registry then reads rich config via a loader. We don't have a loader
  // injection point on the live route, so we register modules with the
  // companion ids and use the fact that tests can swap the curriculum
  // config via a tiny patch: attach a fake config_path to the module row,
  // and use a side-channel monkey-patch via the loader override. To keep
  // the surface narrow, this test instead points the route's resolver
  // at our fake config_path through a real on-disk file.
  for (const [moduleId, companions] of Object.entries(opts.companions ?? {})) {
    const cfgPath = join(dir, `${moduleId}-config.json`);
    const ids = companions
      .map((c) => (typeof c === "string" ? c : (c as { id?: string }).id ?? ""))
      .filter(Boolean);
    db.registerModule({ id: moduleId, name: moduleId, companions: ids, configPath: cfgPath });
    const fs = await import("node:fs/promises");
    await fs.writeFile(cfgPath, JSON.stringify({ id: moduleId, companions }), "utf-8");
  }

  const app = Fastify({ logger: false });
  await registerAllRoutes(app, db);
  return {
    app, db,
    cleanup: async () => {
      await app.close();
      db.close();
      delete process.env["NUSIKA_STATE_DIR"];
      delete process.env["PIPER_BIN"];
      delete process.env["NUSIKA_VOICE_FALLBACK"];
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function jsonRes(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function bytesRes(status: number, bytes: Uint8Array, ct = "audio/wav"): Response {
  return new Response(bytes, { status, headers: { "Content-Type": ct } });
}

const FAKE_WAV = Buffer.from("RIFF\x00\x00\x00\x00WAVE-fake-bytes-stable-for-test");

// ── Kokoro happy + cache ────────────────────────────────────────────────────

test("Kokoro voice profile returns WAV with X-TTS-Provider: kokoro on cache miss", async () => {
  let kokoroCalls = 0;
  __setKokoroFetchForTesting(async (url) => {
    kokoroCalls += 1;
    return bytesRes(200, FAKE_WAV);
  });
  const h = await bootApp({
    companions: {
      linux: [
        { id: "cronk", name: "C-RONK", voice: { engine: "kokoro", voice_ref: "am_michael" } },
      ],
    },
  });
  try {
    const res = await h.app.inject({
      method: "POST", url: "/nusika/tts",
      payload: { text: "Hello there.", voice: "cronk" },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["x-tts-provider"], "kokoro");
    assert.equal(res.headers["x-voice-engine"], "kokoro");
    assert.equal(res.headers["x-tts-voice"], "am_michael");
    assert.equal(res.headers["x-tts-cache-hit"], "false");
    assert.equal(res.headers["content-type"], "audio/wav");
    assert.equal(res.rawPayload.length, FAKE_WAV.length);
    assert.equal(kokoroCalls, 1);
  } finally {
    __resetKokoroFetchForTesting();
    await h.cleanup();
  }
});

test("identical Kokoro request hits cache; client is not called twice", async () => {
  let kokoroCalls = 0;
  __setKokoroFetchForTesting(async () => {
    kokoroCalls += 1;
    return bytesRes(200, FAKE_WAV);
  });
  const h = await bootApp({
    companions: {
      linux: [
        { id: "cronk", name: "C-RONK", voice: { engine: "kokoro", voice_ref: "am_michael" } },
      ],
    },
  });
  try {
    const a = await h.app.inject({
      method: "POST", url: "/nusika/tts",
      payload: { text: "Hello there.", voice: "cronk" },
    });
    assert.equal(a.statusCode, 200);
    assert.equal(a.headers["x-tts-provider"], "kokoro");
    assert.equal(kokoroCalls, 1);

    const b = await h.app.inject({
      method: "POST", url: "/nusika/tts",
      payload: { text: "Hello there.", voice: "cronk" },
    });
    assert.equal(b.statusCode, 200);
    assert.equal(b.headers["x-tts-provider"], "kokoro-cached");
    assert.equal(b.headers["x-tts-cache-hit"], "true");
    assert.equal(kokoroCalls, 1, "second request should be served entirely from cache");
    assert.equal(b.rawPayload.length, FAKE_WAV.length);
  } finally {
    __resetKokoroFetchForTesting();
    await h.cleanup();
  }
});

// ── Kokoro down ──────────────────────────────────────────────────────────────

test("Kokoro down returns 503 with friendly error when fallback is disabled", async () => {
  __setKokoroFetchForTesting(async () => { throw new Error("ECONNREFUSED 127.0.0.1:18794"); });
  delete process.env["NUSIKA_VOICE_FALLBACK"];
  const h = await bootApp({
    companions: {
      linux: [{ id: "cronk", name: "C-RONK", voice: { engine: "kokoro", voice_ref: "am_michael" } }],
    },
  });
  try {
    const res = await h.app.inject({
      method: "POST", url: "/nusika/tts",
      payload: { text: "Hello.", voice: "cronk" },
    });
    assert.equal(res.statusCode, 503);
    const body = res.json();
    assert.equal(body.ok, false);
    assert.match(body.error, /Kokoro TTS unavailable/i);
    assert.equal(typeof body.detail, "string");
  } finally {
    __resetKokoroFetchForTesting();
    await h.cleanup();
  }
});

test("Kokoro down + NUSIKA_VOICE_FALLBACK=piper falls through to Piper preflight (still 503 here because Piper is missing)", async () => {
  // The harness sets PIPER_BIN to a missing path, so the Piper fallback
  // also returns 503 — but with the `X-TTS-Fallback: piper` header on the
  // failed-fallback response if the route had managed to set headers.
  // What we're really testing is: the route TRIED Piper rather than
  // returning the Kokoro 503 directly.
  __setKokoroFetchForTesting(async () => { throw new Error("ECONNREFUSED"); });
  process.env["NUSIKA_VOICE_FALLBACK"] = "piper";
  const h = await bootApp({
    companions: {
      linux: [{ id: "cronk", name: "C-RONK", voice: { engine: "kokoro", voice_ref: "am_michael" } }],
    },
  });
  try {
    const res = await h.app.inject({
      method: "POST", url: "/nusika/tts",
      payload: { text: "Hello.", voice: "cronk" },
    });
    // Piper preflight 503 fires before we can write the Fallback header,
    // so this asserts the Piper-shaped error rather than the Kokoro one.
    assert.equal(res.statusCode, 503);
    const body = res.json();
    assert.match(body.error, /TTS not configured/i, "should be the Piper preflight 503, not the Kokoro one");
    assert.match(body.detail, /PIPER_BIN/);
  } finally {
    __resetKokoroFetchForTesting();
    await h.cleanup();
  }
});

// ── ElevenLabs profile ──────────────────────────────────────────────────────

test("ElevenLabs profile (legacy voice_id) returns 409 from /nusika/tts", async () => {
  const h = await bootApp({
    companions: {
      inkwell: [{ id: "maren", name: "Maren", voice_id: "fTtv3eikoepIosk8dTZ5" }],
    },
  });
  try {
    const res = await h.app.inject({
      method: "POST", url: "/nusika/tts",
      payload: { text: "Hello.", voice: "maren" },
    });
    assert.equal(res.statusCode, 409);
    const body = res.json();
    assert.match(body.error, /ElevenLabs/i);
    assert.match(body.detail, /elevenlabs/);
  } finally {
    await h.cleanup();
  }
});

// ── Legacy callers ─────────────────────────────────────────────────────────

test("Legacy { text } caller still goes through Piper preflight", async () => {
  // Boot harness without companions; PIPER_BIN is missing in the env.
  const h = await bootApp();
  try {
    const res = await h.app.inject({
      method: "POST", url: "/nusika/tts",
      payload: { text: "Hello." },
    });
    // Same 503 contract as before Slice 6D.
    assert.equal(res.statusCode, 503);
    const body = res.json();
    assert.match(body.error, /TTS not configured/i);
  } finally {
    await h.cleanup();
  }
});

test("Legacy { text, voice: '<piper-basename>' } still hits the Piper path", async () => {
  // No registry profile matches "en_US-lessac-medium", so the route falls
  // through to the legacy Piper path with that as the voice basename.
  const h = await bootApp();
  try {
    const res = await h.app.inject({
      method: "POST", url: "/nusika/tts",
      payload: { text: "Hello.", voice: "en_US-lessac-medium" },
    });
    // PIPER_BIN missing → preflight 503. Detail mentions PIPER_BIN, not
    // Kokoro, proving we routed to Piper.
    assert.equal(res.statusCode, 503);
    assert.match(res.json().detail, /PIPER_BIN/);
  } finally {
    await h.cleanup();
  }
});

// ── Ittunaha payload contract: scope === voice ────────────────────────────
//
// Ittunaha's useVoicePlayback hook dispatches by companion id and passes
// it as `scope`. The /teach and /dm pickers pass a profile id as `voice`.
// The route contract says these two fields are equivalent — both run
// through resolveVoiceProfile. The pre-fix path used a different field
// name (`role`) which the route silently dropped, so every companion
// played the default voice. These tests pin the scope-and-voice-
// equivalence behavior so that regression can't sneak back in.

test("scope: <companion_id> routes to the same Kokoro profile as voice: <companion_id>", async () => {
  let kokoroCalls = 0;
  __setKokoroFetchForTesting(async () => {
    kokoroCalls += 1;
    return bytesRes(200, FAKE_WAV);
  });
  const h = await bootApp({
    companions: {
      latin: [
        { id: "marcus", name: "Marcus", voice: { engine: "kokoro", voice_ref: "bm_lewis" } },
      ],
    },
  });
  try {
    const viaScope = await h.app.inject({
      method: "POST", url: "/nusika/tts",
      payload: { text: "Salve.", scope: "marcus" },
    });
    assert.equal(viaScope.statusCode, 200);
    assert.equal(viaScope.headers["x-tts-provider"], "kokoro");
    assert.equal(viaScope.headers["x-voice-engine"], "kokoro");
    assert.equal(viaScope.headers["x-tts-voice"], "bm_lewis",
      "scope must resolve through the companion's configured voice_ref");

    // Different text so we don't hit the audio cache; we want to prove
    // both fields actually dispatch through the real Kokoro client.
    const viaVoice = await h.app.inject({
      method: "POST", url: "/nusika/tts",
      payload: { text: "Salve mundi.", voice: "marcus" },
    });
    assert.equal(viaVoice.statusCode, 200);
    assert.equal(viaVoice.headers["x-tts-voice"], "bm_lewis",
      "voice must resolve through the same companion profile");

    assert.equal(kokoroCalls, 2, "both requests should reach Kokoro");
  } finally {
    __resetKokoroFetchForTesting();
    await h.cleanup();
  }
});

test("scope: '' (empty) is treated like no scope and falls through to the default voice path", async () => {
  // The Ittunaha hook omits the field entirely when the companion id is
  // empty, but the route must also tolerate an explicit empty string
  // (e.g. an early-render where companion_id was a blank string).
  const h = await bootApp();
  try {
    const res = await h.app.inject({
      method: "POST", url: "/nusika/tts",
      payload: { text: "Hello.", scope: "" },
    });
    // No registry profile, no Piper installed → preflight 503 with the
    // Piper-shaped detail. Proves we did NOT 200 with a silently wrong
    // voice, and did NOT 4xx with a malformed-payload error.
    assert.equal(res.statusCode, 503);
    assert.match(res.json().detail, /PIPER_BIN/,
      "empty scope must fall through to the default-voice path, not error out");
  } finally {
    await h.cleanup();
  }
});

test("unknown scope falls through to the legacy Piper path (no companion match → treat as voice basename)", async () => {
  // If the companion id doesn't resolve to a profile (e.g. a typo, or a
  // companion that was removed), the route's documented behavior is to
  // treat the string as a Piper voice basename. That keeps the contract
  // honest — no silent default-voice substitution.
  const h = await bootApp();
  try {
    const res = await h.app.inject({
      method: "POST", url: "/nusika/tts",
      payload: { text: "Hello.", scope: "no-such-companion" },
    });
    assert.equal(res.statusCode, 503);
    const body = res.json();
    assert.match(body.detail, /PIPER_BIN|Voice model not found/i,
      "unknown scope must reach the Piper preflight, not silently swap voices");
  } finally {
    await h.cleanup();
  }
});

test("POST /nusika/tts rejects missing text with 400", async () => {
  const h = await bootApp();
  try {
    const res = await h.app.inject({
      method: "POST", url: "/nusika/tts",
      payload: {},
    });
    assert.equal(res.statusCode, 400);
  } finally {
    await h.cleanup();
  }
});
