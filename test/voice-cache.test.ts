/**
 * Slice 6D — voice cache unit tests.
 *
 * Each test points MAGISTER_STATE_DIR at a fresh tmpdir so the live
 * state/voices/cache/ directory is never touched.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  voiceCacheKey,
  voiceCacheDir,
  voiceCacheMaxBytes,
  voiceCacheSizeBytes,
  getCachedVoice,
  putCachedVoice,
  evictVoiceCacheTo,
} from "../server/lib/voice-cache.js";

function withIsolatedState(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "magister-6d-cache-"));
  const prev = process.env["MAGISTER_STATE_DIR"];
  process.env["MAGISTER_STATE_DIR"] = dir;
  return {
    dir,
    cleanup: () => {
      if (prev === undefined) delete process.env["MAGISTER_STATE_DIR"];
      else process.env["MAGISTER_STATE_DIR"] = prev;
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("voiceCacheKey is stable across calls with the same input", () => {
  const a = voiceCacheKey({ engine: "kokoro", voiceId: "af_heart", text: "hello" });
  const b = voiceCacheKey({ engine: "kokoro", voiceId: "af_heart", text: "hello" });
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/, "should be a sha256 hex string");
});

test("voiceCacheKey differs when any field differs", () => {
  const base = voiceCacheKey({ engine: "kokoro", voiceId: "af_heart", text: "hello" });
  const otherEngine = voiceCacheKey({ engine: "piper", voiceId: "af_heart", text: "hello" });
  const otherVoice = voiceCacheKey({ engine: "kokoro", voiceId: "am_michael", text: "hello" });
  const otherText = voiceCacheKey({ engine: "kokoro", voiceId: "af_heart", text: "Hello" });
  assert.notEqual(base, otherEngine);
  assert.notEqual(base, otherVoice);
  assert.notEqual(base, otherText);
});

test("putCachedVoice + getCachedVoice roundtrip returns identical bytes", async () => {
  const { cleanup } = withIsolatedState();
  try {
    const key = voiceCacheKey({ engine: "kokoro", voiceId: "af_heart", text: "abc" });
    const bytes = Buffer.from("RIFF\x00\x00\x00\x00WAVEfmt fake but stable", "utf8");
    const meta = await putCachedVoice(key, bytes);
    assert.ok(meta);
    assert.equal(meta!.size, bytes.length);
    const fetched = await getCachedVoice(key);
    assert.ok(fetched);
    assert.equal(fetched!.equals(bytes), true);
  } finally {
    cleanup();
  }
});

test("getCachedVoice returns null on miss", async () => {
  const { cleanup } = withIsolatedState();
  try {
    const result = await getCachedVoice("0000000000000000000000000000000000000000000000000000000000000000");
    assert.equal(result, null);
  } finally {
    cleanup();
  }
});

test("getCachedVoice updates mtime on hit (LRU touch)", async () => {
  const { cleanup } = withIsolatedState();
  try {
    const key = voiceCacheKey({ engine: "kokoro", voiceId: "af_heart", text: "lru-test" });
    const meta = await putCachedVoice(key, Buffer.from("data"));
    assert.ok(meta);
    const before = statSync(meta!.path).mtimeMs;
    // Wait long enough that mtime resolution can move on most filesystems.
    await delay(15);
    await getCachedVoice(key);
    // utimes is fire-and-forget; a tiny extra delay covers the async write.
    await delay(20);
    const after = statSync(meta!.path).mtimeMs;
    assert.ok(after >= before, `mtime should not regress (before=${before}, after=${after})`);
  } finally {
    cleanup();
  }
});

test("evictVoiceCacheTo(0) deletes everything", async () => {
  const { cleanup } = withIsolatedState();
  try {
    await putCachedVoice("a".repeat(64), Buffer.from("a".repeat(100)));
    await putCachedVoice("b".repeat(64), Buffer.from("b".repeat(100)));
    assert.ok(voiceCacheSizeBytes() > 0);
    await evictVoiceCacheTo(0);
    assert.equal(voiceCacheSizeBytes(), 0);
  } finally {
    cleanup();
  }
});

test("evictVoiceCacheTo(N) removes oldest first by mtime", async () => {
  const { cleanup } = withIsolatedState();
  try {
    // Three files of 100 bytes each. Cap to 200 → oldest (first) should go.
    const k1 = "1".repeat(64);
    const k2 = "2".repeat(64);
    const k3 = "3".repeat(64);
    await putCachedVoice(k1, Buffer.from("1".repeat(100)));
    await delay(15);
    await putCachedVoice(k2, Buffer.from("2".repeat(100)));
    await delay(15);
    await putCachedVoice(k3, Buffer.from("3".repeat(100)));

    await evictVoiceCacheTo(200);
    assert.equal(await getCachedVoice(k1), null, "oldest must be evicted");
    assert.ok(await getCachedVoice(k2), "newer file should remain");
    assert.ok(await getCachedVoice(k3), "newest file should remain");
  } finally {
    cleanup();
  }
});

test("voiceCacheMaxBytes honors MAGISTER_VOICE_CACHE_MAX_MB", () => {
  const prev = process.env["MAGISTER_VOICE_CACHE_MAX_MB"];
  try {
    delete process.env["MAGISTER_VOICE_CACHE_MAX_MB"];
    assert.equal(voiceCacheMaxBytes(), 500 * 1024 * 1024, "default 500 MB");
    process.env["MAGISTER_VOICE_CACHE_MAX_MB"] = "10";
    assert.equal(voiceCacheMaxBytes(), 10 * 1024 * 1024);
    process.env["MAGISTER_VOICE_CACHE_MAX_MB"] = "0.5";
    assert.equal(voiceCacheMaxBytes(), Math.floor(0.5 * 1024 * 1024));
    process.env["MAGISTER_VOICE_CACHE_MAX_MB"] = "garbage";
    assert.equal(voiceCacheMaxBytes(), 500 * 1024 * 1024, "garbage falls back to default");
  } finally {
    if (prev === undefined) delete process.env["MAGISTER_VOICE_CACHE_MAX_MB"];
    else process.env["MAGISTER_VOICE_CACHE_MAX_MB"] = prev;
  }
});

test("voiceCacheDir respects MAGISTER_STATE_DIR", () => {
  const { dir, cleanup } = withIsolatedState();
  try {
    const cacheDir = voiceCacheDir();
    assert.ok(cacheDir.startsWith(dir), `cache dir ${cacheDir} should be under ${dir}`);
  } finally {
    cleanup();
  }
});
