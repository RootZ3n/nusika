/**
 * Slice 6F — voice preview, cache status, and cache clear route tests.
 *
 * Each test isolates `MAGISTER_STATE_DIR` so the production cache is
 * never touched. Kokoro's fetch is stubbed via the test seam so no
 * Python service is required.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { MagisterDB } from "../server/db.js";
import { registerAllRoutes } from "../server/routes/index.js";
import {
  __setKokoroFetchForTesting,
  __resetKokoroFetchForTesting,
} from "../server/lib/voices/kokoro.js";
import { voiceCacheDir } from "../server/lib/voice-cache.js";

const FAKE_WAV = Buffer.from("RIFF\x00\x00\x00\x00WAVE-fake-bytes-stable-for-test");

interface Harness {
  app: Awaited<ReturnType<typeof Fastify>>;
  db: MagisterDB;
  cleanup: () => Promise<void>;
}

async function bootApp(): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), "magister-6f-"));
  process.env["MAGISTER_STATE_DIR"] = join(dir, "state");
  const db = new MagisterDB(join(dir, "test.db"));
  const app = Fastify({ logger: false });
  await registerAllRoutes(app, db);
  return {
    app, db,
    cleanup: async () => {
      await app.close();
      db.close();
      delete process.env["MAGISTER_STATE_DIR"];
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

// ── Preview: validation ─────────────────────────────────────────────────────

test("preview rejects invalid engine with 400", async () => {
  const h = await bootApp();
  try {
    const res = await h.app.inject({ method: "GET", url: "/magister/voices/preview/eleven/some_voice" });
    assert.equal(res.statusCode, 400);
    const body = res.json();
    assert.equal(body.ok, false);
    assert.match(body.error, /engine/i);
  } finally {
    await h.cleanup();
  }
});

test("preview rejects unknown Kokoro voice with 400", async () => {
  const h = await bootApp();
  try {
    const res = await h.app.inject({ method: "GET", url: "/magister/voices/preview/kokoro/not_a_real_voice" });
    assert.equal(res.statusCode, 400);
    const body = res.json();
    assert.equal(body.ok, false);
    assert.match(body.error, /unknown kokoro voice/i);
    assert.match(body.detail, /voices/i);
  } finally {
    await h.cleanup();
  }
});

// ── Preview: Kokoro happy path + cache ──────────────────────────────────────

test("preview Kokoro returns WAV with X-TTS-Provider:kokoro on cache miss", async () => {
  let calls = 0;
  __setKokoroFetchForTesting(async (url, init) => {
    calls += 1;
    const body = JSON.parse(String((init as RequestInit).body));
    // Sanity: the preview route should ship our shaped phrase to Kokoro.
    assert.match(body.text, /^Hello, I am /);
    return new Response(FAKE_WAV, { status: 200, headers: { "Content-Type": "audio/wav" } });
  });
  const h = await bootApp();
  try {
    const res = await h.app.inject({
      method: "GET",
      url: "/magister/voices/preview/kokoro/am_michael?name=Varros",
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["content-type"], "audio/wav");
    assert.equal(res.headers["x-tts-provider"], "kokoro");
    assert.equal(res.headers["x-tts-voice"], "am_michael");
    assert.equal(res.headers["x-tts-cache-hit"], "false");
    assert.equal(res.rawPayload.length, FAKE_WAV.length);
    assert.equal(calls, 1);
  } finally {
    __resetKokoroFetchForTesting();
    await h.cleanup();
  }
});

test("preview second identical request hits cache; Kokoro client not called twice", async () => {
  let calls = 0;
  __setKokoroFetchForTesting(async () => {
    calls += 1;
    return new Response(FAKE_WAV, { status: 200, headers: { "Content-Type": "audio/wav" } });
  });
  const h = await bootApp();
  try {
    const a = await h.app.inject({
      method: "GET", url: "/magister/voices/preview/kokoro/am_michael?name=Varros",
    });
    assert.equal(a.statusCode, 200);
    assert.equal(a.headers["x-tts-cache-hit"], "false");
    assert.equal(calls, 1);

    const b = await h.app.inject({
      method: "GET", url: "/magister/voices/preview/kokoro/am_michael?name=Varros",
    });
    assert.equal(b.statusCode, 200);
    assert.equal(b.headers["x-tts-provider"], "kokoro-cached");
    assert.equal(b.headers["x-tts-cache-hit"], "true");
    assert.equal(calls, 1, "second call should be served from cache");
    assert.equal(b.rawPayload.length, FAKE_WAV.length);
  } finally {
    __resetKokoroFetchForTesting();
    await h.cleanup();
  }
});

test("preview Kokoro unavailable returns 503 friendly error; no cache write", async () => {
  __setKokoroFetchForTesting(async () => { throw new Error("ECONNREFUSED 127.0.0.1:18794"); });
  const h = await bootApp();
  try {
    const res = await h.app.inject({
      method: "GET", url: "/magister/voices/preview/kokoro/am_michael?name=Varros",
    });
    assert.equal(res.statusCode, 503);
    const body = res.json();
    assert.equal(body.ok, false);
    assert.match(body.error, /preview unavailable/i);
    assert.equal(typeof body.detail, "string");
    // Sanity: detail is short, no traceback leak.
    assert.equal(/Traceback/.test(body.detail), false);
    assert.ok(body.detail.length <= 240);

    // Confirm nothing made it into the cache.
    const cacheRes = await h.app.inject({ method: "GET", url: "/magister/voices/cache" });
    assert.equal(cacheRes.json().bytes, 0);
  } finally {
    __resetKokoroFetchForTesting();
    await h.cleanup();
  }
});

// ── Preview: Piper missing-binary 503 ──────────────────────────────────────

test("preview Piper returns 503 when PIPER_BIN is missing", async () => {
  const prev = process.env["PIPER_BIN"];
  process.env["PIPER_BIN"] = "/tmp/no-such-piper-magister-test";
  const h = await bootApp();
  try {
    const res = await h.app.inject({
      method: "GET", url: "/magister/voices/preview/piper/some_voice",
    });
    assert.equal(res.statusCode, 503);
    const body = res.json();
    assert.match(body.error, /Piper preview/i);
    assert.match(body.detail, /PIPER_BIN/);
  } finally {
    if (prev === undefined) delete process.env["PIPER_BIN"];
    else process.env["PIPER_BIN"] = prev;
    await h.cleanup();
  }
});

// ── Cache status ────────────────────────────────────────────────────────────

test("GET /magister/voices/cache returns expected shape with empty cache", async () => {
  const h = await bootApp();
  try {
    const res = await h.app.inject({ method: "GET", url: "/magister/voices/cache" });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.ok, true);
    assert.equal(body.bytes, 0);
    assert.equal(body.mb, 0);
    assert.equal(typeof body.maxBytes, "number");
    assert.equal(typeof body.maxMb, "number");
    assert.ok(body.maxBytes > 0);
  } finally {
    await h.cleanup();
  }
});

test("GET /magister/voices/cache reports bytes after a preview is cached", async () => {
  __setKokoroFetchForTesting(async () =>
    new Response(FAKE_WAV, { status: 200, headers: { "Content-Type": "audio/wav" } }),
  );
  const h = await bootApp();
  try {
    await h.app.inject({
      method: "GET", url: "/magister/voices/preview/kokoro/am_michael?name=Varros",
    });
    const res = await h.app.inject({ method: "GET", url: "/magister/voices/cache" });
    const body = res.json();
    assert.ok(body.bytes >= FAKE_WAV.length, `expected cache bytes >= ${FAKE_WAV.length}, got ${body.bytes}`);
  } finally {
    __resetKokoroFetchForTesting();
    await h.cleanup();
  }
});

// ── Cache clear ─────────────────────────────────────────────────────────────

test("DELETE /magister/voices/cache is safe on an empty cache", async () => {
  const h = await bootApp();
  try {
    const res = await h.app.inject({ method: "DELETE", url: "/magister/voices/cache" });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.ok, true);
    assert.equal(body.deletedFiles, 0);
    assert.equal(body.deletedBytes, 0);
  } finally {
    await h.cleanup();
  }
});

test("DELETE /magister/voices/cache removes cached preview WAVs", async () => {
  __setKokoroFetchForTesting(async () =>
    new Response(FAKE_WAV, { status: 200, headers: { "Content-Type": "audio/wav" } }),
  );
  const h = await bootApp();
  try {
    // Generate two distinct previews so we have two cache entries.
    await h.app.inject({ method: "GET", url: "/magister/voices/preview/kokoro/am_michael?name=Varros" });
    await h.app.inject({ method: "GET", url: "/magister/voices/preview/kokoro/af_heart?name=Nova" });
    const before = (await h.app.inject({ method: "GET", url: "/magister/voices/cache" })).json();
    assert.ok(before.bytes > 0);

    const del = await h.app.inject({ method: "DELETE", url: "/magister/voices/cache" });
    const body = del.json();
    assert.equal(body.ok, true);
    assert.equal(body.deletedFiles, 2);
    assert.equal(body.deletedBytes, before.bytes);

    const after = (await h.app.inject({ method: "GET", url: "/magister/voices/cache" })).json();
    assert.equal(after.bytes, 0);
  } finally {
    __resetKokoroFetchForTesting();
    await h.cleanup();
  }
});

test("DELETE /magister/voices/cache only removes .wav files; leaves other files alone", async () => {
  const h = await bootApp();
  try {
    // Seed the cache directory with a wav AND a non-wav file.
    const dir = voiceCacheDir();
    await writeFile(join(dir, "abc.wav"), Buffer.from("RIFFfake")).catch(async () => {
      // mkdir if missing
      const fs = await import("node:fs/promises");
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(join(dir, "abc.wav"), Buffer.from("RIFFfake"));
    });
    writeFileSync(join(dir, "do-not-touch.txt"), "this is not a wav");

    const del = await h.app.inject({ method: "DELETE", url: "/magister/voices/cache" });
    assert.equal(del.statusCode, 200);
    assert.equal(del.json().deletedFiles, 1);
    // The non-wav file must still be there.
    const stat = statSync(join(dir, "do-not-touch.txt"));
    assert.ok(stat.isFile());
    assert.equal(stat.size, "this is not a wav".length);
  } finally {
    await h.cleanup();
  }
});
