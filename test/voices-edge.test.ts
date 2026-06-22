/**
 * Edge TTS engine — client unit tests, registry wiring, and dispatch.
 *
 * Edge TTS is the free, zero-GPU, no-API-key engine. The `edge-tts` CLI
 * is stubbed via the synth/health test seams so these tests never touch
 * the network or require the binary to be installed.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { NusikaDB } from "../server/db.js";
import { registerAllRoutes } from "../server/routes/index.js";
import { buildVoiceRegistry } from "../server/lib/voice-registry.js";
import {
  edgeBin,
  mapKokoroToEdge,
  edgeTtsHealth,
  edgeGenerate,
  EDGE_VOICE_IDS,
  __setEdgeSynthForTesting,
  __resetEdgeSynthForTesting,
  __setEdgeHealthForTesting,
  __resetEdgeHealthForTesting,
  type EdgeGenerateError,
} from "../server/lib/voices/edge.js";

const FAKE_MP3 = Buffer.from("ID3\x04\x00\x00\x00fake-mp3-bytes-stable-for-test");

// ── edgeBin ──────────────────────────────────────────────────────────────────

test("edgeBin reads NUSIKA_EDGE_TTS_BIN with default fallback", () => {
  const prev = process.env["NUSIKA_EDGE_TTS_BIN"];
  try {
    delete process.env["NUSIKA_EDGE_TTS_BIN"];
    assert.equal(edgeBin(), "edge-tts");
    process.env["NUSIKA_EDGE_TTS_BIN"] = "/opt/edge-tts/bin/edge-tts";
    assert.equal(edgeBin(), "/opt/edge-tts/bin/edge-tts");
  } finally {
    if (prev === undefined) delete process.env["NUSIKA_EDGE_TTS_BIN"];
    else process.env["NUSIKA_EDGE_TTS_BIN"] = prev;
  }
});

// ── mapKokoroToEdge ──────────────────────────────────────────────────────────

test("mapKokoroToEdge maps every Kokoro voice to a known Edge voice", () => {
  // The 28 ids in KOKORO_VOICE_IDS must all resolve to a curated Edge id.
  const kokoroIds = [
    "af_heart", "af_alloy", "af_aoede", "af_bella", "af_jessica", "af_kore",
    "af_nicole", "af_nova", "af_river", "af_sarah", "af_sky",
    "am_adam", "am_echo", "am_eric", "am_fenrir", "am_liam", "am_michael",
    "am_onyx", "am_puck", "am_santa",
    "bf_alice", "bf_emma", "bf_isabella", "bf_lily",
    "bm_daniel", "bm_fable", "bm_george", "bm_lewis",
  ];
  const mapped = kokoroIds.map(mapKokoroToEdge);
  for (const m of mapped) {
    assert.ok(EDGE_VOICE_IDS.has(m), `${m} should be a known Edge voice id`);
  }
  // One-to-one: distinct companions keep distinct voices.
  assert.equal(new Set(mapped).size, kokoroIds.length, "mapping must be one-to-one");
});

test("mapKokoroToEdge preserves accent and gender", () => {
  assert.match(mapKokoroToEdge("af_heart"), /^en-US-.*Neural$/); // American female
  assert.match(mapKokoroToEdge("am_adam"), /^en-US-.*Neural$/);  // American male
  assert.match(mapKokoroToEdge("bf_alice"), /^en-GB-.*Neural$/); // British female
  assert.match(mapKokoroToEdge("bm_lewis"), /^en-GB-.*Neural$/); // British male
});

test("mapKokoroToEdge passes an Edge voice id through unchanged", () => {
  assert.equal(mapKokoroToEdge("en-US-AriaNeural"), "en-US-AriaNeural");
  // An Edge-shaped id not in the curated set still passes (locale + Neural).
  assert.equal(mapKokoroToEdge("fr-FR-DeniseNeural"), "fr-FR-DeniseNeural");
});

test("mapKokoroToEdge falls back by prefix for unknown Kokoro-shaped ids", () => {
  assert.equal(mapKokoroToEdge("af_unknown"), "en-US-AriaNeural");
  assert.equal(mapKokoroToEdge("bm_unknown"), "en-GB-RyanNeural");
});

test("mapKokoroToEdge returns a default for empty/garbage input", () => {
  assert.equal(mapKokoroToEdge(""), "en-US-AriaNeural");
  assert.equal(mapKokoroToEdge(undefined), "en-US-AriaNeural");
});

// ── health (stubbed) ─────────────────────────────────────────────────────────

test("edgeTtsHealth returns configured:true via the health seam", async () => {
  __setEdgeHealthForTesting(async () => ({ configured: true, detail: "stub: available" }));
  try {
    const h = await edgeTtsHealth();
    assert.equal(h.configured, true);
  } finally {
    __resetEdgeHealthForTesting();
  }
});

test("edgeTtsHealth returns configured:false with a detail when the CLI is missing", async () => {
  __setEdgeHealthForTesting(async () => ({ configured: false, detail: "edge-tts CLI not runnable (edge-tts): ENOENT" }));
  try {
    const h = await edgeTtsHealth();
    assert.equal(h.configured, false);
    assert.match(h.detail, /not runnable|ENOENT/i);
  } finally {
    __resetEdgeHealthForTesting();
  }
});

// ── generate (stubbed) ───────────────────────────────────────────────────────

test("edgeGenerate returns audio bytes via the synth seam", async () => {
  __setEdgeSynthForTesting(async (input) => {
    assert.equal(input.voice, "am_michael");
    assert.equal(input.text, "Hello.");
    return FAKE_MP3;
  });
  try {
    const out = await edgeGenerate({ voice: "am_michael", text: "Hello." });
    assert.ok(Buffer.isBuffer(out));
    assert.equal(out.equals(FAKE_MP3), true);
  } finally {
    __resetEdgeSynthForTesting();
  }
});

test("edgeGenerate surfaces a structured error", async () => {
  __setEdgeSynthForTesting(async () => {
    const err = new Error("Edge TTS generation failed.") as EdgeGenerateError;
    err.detail = "edge-tts exited 1: network unreachable";
    err.reachable = true;
    throw err;
  });
  try {
    await assert.rejects(
      () => edgeGenerate({ voice: "af_heart", text: "x" }),
      (err: unknown) => {
        const e = err as EdgeGenerateError;
        assert.equal(e.message, "Edge TTS generation failed.");
        assert.match(e.detail ?? "", /network unreachable/);
        return true;
      },
    );
  } finally {
    __resetEdgeSynthForTesting();
  }
});

// ── registry wiring ──────────────────────────────────────────────────────────

function bootDb(): { db: NusikaDB; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "nusika-edge-reg-"));
  const db = new NusikaDB(join(dir, "test.db"));
  return { db, cleanup: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test("buildVoiceRegistry honors a per-companion engine:edge override", async () => {
  const { db, cleanup } = bootDb();
  __setEdgeHealthForTesting(async () => ({ configured: true, detail: "stub: available" }));
  try {
    db.registerModule({ id: "linux", name: "Linux", companions: ["cronk"], configPath: "linux-config" });
    const reg = await buildVoiceRegistry(db, {
      probeEdge: true,
      loader: async (p) => p === "linux-config"
        ? { id: "linux", companions: [{ id: "cronk", name: "C-RONK", voice: { engine: "edge", voice_ref: "en-US-GuyNeural" } }] }
        : null,
    });
    const cronk = reg.voices.find(v => v.companion_id === "cronk");
    assert.ok(cronk, "cronk profile must exist");
    assert.equal(cronk!.engine, "edge");
    assert.equal(cronk!.voice_ref, "en-US-GuyNeural");
    assert.equal(cronk!.available, true, "edge probe reported configured");
    assert.equal(reg.engines.edge.configured, true);
  } finally {
    __resetEdgeHealthForTesting();
    cleanup();
  }
});

test("NUSIKA_TTS_ENGINE=edge redirects a Kokoro-configured companion to Edge with a mapped voice", async () => {
  const { db, cleanup } = bootDb();
  process.env["NUSIKA_TTS_ENGINE"] = "edge";
  __setEdgeHealthForTesting(async () => ({ configured: true, detail: "stub: available" }));
  try {
    db.registerModule({ id: "latin", name: "Latin", companions: ["marcus"], configPath: "latin-config" });
    const reg = await buildVoiceRegistry(db, {
      probeEdge: true,
      loader: async (p) => p === "latin-config"
        ? { id: "latin", companions: [{ id: "marcus", name: "Marcus", voice: { engine: "kokoro", voice_ref: "bm_lewis" } }] }
        : null,
    });
    const marcus = reg.voices.find(v => v.companion_id === "marcus");
    assert.ok(marcus, "marcus profile must exist");
    assert.equal(marcus!.engine, "edge", "kokoro companion must be redirected to edge");
    assert.equal(marcus!.voice_ref, mapKokoroToEdge("bm_lewis"), "voice must be mapped to the Edge equivalent");
    // Peh (narrator, kokoro:am_michael) must also redirect under the global switch.
    const peh = reg.voices.find(v => v.companion_id === "peh");
    assert.equal(peh!.engine, "edge");
  } finally {
    delete process.env["NUSIKA_TTS_ENGINE"];
    __resetEdgeHealthForTesting();
    cleanup();
  }
});

test("buildVoiceRegistry reports edge configured:false when probe skipped", async () => {
  const { db, cleanup } = bootDb();
  try {
    const reg = await buildVoiceRegistry(db, { loader: async () => null });
    assert.equal(reg.engines.edge.configured, false);
    assert.match(reg.engines.edge.detail ?? "", /probe skipped/i);
  } finally {
    cleanup();
  }
});

// ── dispatch (POST /nusika/tts) ──────────────────────────────────────────────

interface Harness {
  app: Awaited<ReturnType<typeof Fastify>>;
  db: NusikaDB;
  cleanup: () => Promise<void>;
}

async function bootApp(companions: Record<string, unknown[]>): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), "nusika-edge-dispatch-"));
  process.env["NUSIKA_STATE_DIR"] = join(dir, "state");
  process.env["PIPER_BIN"] = "/tmp/no-such-piper-edge-test";

  const db = new NusikaDB(join(dir, "test.db"));
  for (const [moduleId, comps] of Object.entries(companions)) {
    const cfgPath = join(dir, `${moduleId}-config.json`);
    const ids = comps.map((c) => (typeof c === "string" ? c : (c as { id?: string }).id ?? "")).filter(Boolean);
    db.registerModule({ id: moduleId, name: moduleId, companions: ids, configPath: cfgPath });
    const fs = await import("node:fs/promises");
    await fs.writeFile(cfgPath, JSON.stringify({ id: moduleId, companions: comps }), "utf-8");
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
      delete process.env["NUSIKA_TTS_ENGINE"];
      delete process.env["NUSIKA_VOICE_FALLBACK"];
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("engine:edge profile returns MP3 with X-Voice-Engine: edge, then serves from cache", async () => {
  let calls = 0;
  __setEdgeSynthForTesting(async () => { calls += 1; return FAKE_MP3; });
  const h = await bootApp({
    linux: [{ id: "cronk", name: "C-RONK", voice: { engine: "edge", voice_ref: "en-US-GuyNeural" } }],
  });
  try {
    const a = await h.app.inject({ method: "POST", url: "/nusika/tts", payload: { text: "Hello there.", voice: "cronk" } });
    assert.equal(a.statusCode, 200);
    assert.equal(a.headers["content-type"], "audio/mpeg");
    assert.equal(a.headers["x-tts-provider"], "edge");
    assert.equal(a.headers["x-voice-engine"], "edge");
    assert.equal(a.headers["x-tts-voice"], "en-US-GuyNeural");
    assert.equal(a.headers["x-tts-cache-hit"], "false");
    assert.equal(a.rawPayload.length, FAKE_MP3.length);
    assert.equal(calls, 1);

    const b = await h.app.inject({ method: "POST", url: "/nusika/tts", payload: { text: "Hello there.", voice: "cronk" } });
    assert.equal(b.statusCode, 200);
    assert.equal(b.headers["x-tts-provider"], "edge-cached");
    assert.equal(b.headers["x-tts-cache-hit"], "true");
    assert.equal(calls, 1, "second request must be served from cache");
  } finally {
    __resetEdgeSynthForTesting();
    await h.cleanup();
  }
});

test("NUSIKA_TTS_ENGINE=edge routes a Kokoro-configured companion through Edge", async () => {
  process.env["NUSIKA_TTS_ENGINE"] = "edge";
  let calls = 0;
  __setEdgeSynthForTesting(async (input) => {
    calls += 1;
    // The route maps the kokoro ref to an Edge voice before synthesis.
    assert.equal(input.voice, mapKokoroToEdge("bm_lewis"));
    return FAKE_MP3;
  });
  const h = await bootApp({
    latin: [{ id: "marcus", name: "Marcus", voice: { engine: "kokoro", voice_ref: "bm_lewis" } }],
  });
  try {
    const res = await h.app.inject({ method: "POST", url: "/nusika/tts", payload: { text: "Salve.", voice: "marcus" } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["x-voice-engine"], "edge");
    assert.equal(res.headers["x-tts-voice"], mapKokoroToEdge("bm_lewis"));
    assert.equal(calls, 1);
  } finally {
    __resetEdgeSynthForTesting();
    await h.cleanup();
  }
});

test("Edge failure returns 503 by default (no fallback configured)", async () => {
  __setEdgeSynthForTesting(async () => {
    const err = new Error("Edge TTS CLI not runnable.") as EdgeGenerateError;
    err.detail = "spawn edge-tts ENOENT";
    err.reachable = false;
    throw err;
  });
  const h = await bootApp({
    linux: [{ id: "cronk", name: "C-RONK", voice: { engine: "edge", voice_ref: "en-US-GuyNeural" } }],
  });
  try {
    const res = await h.app.inject({ method: "POST", url: "/nusika/tts", payload: { text: "Hi.", voice: "cronk" } });
    assert.equal(res.statusCode, 503);
    const body = res.json();
    assert.equal(body.ok, false);
    assert.match(body.error, /Edge TTS unavailable/i);
    assert.match(body.detail, /ENOENT/);
  } finally {
    __resetEdgeSynthForTesting();
    await h.cleanup();
  }
});
