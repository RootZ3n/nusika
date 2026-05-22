/**
 * Magister voice cache (Slice 6D).
 *
 * Content-addressed WAV cache for synthesised audio. Same engine + voice
 * + text → same key → same file. The dispatch path checks the cache
 * before calling Kokoro (and could later check before Piper / cloud);
 * a hit avoids the upstream call entirely.
 *
 *   <stateDir>/voices/cache/<sha256(engine|voiceId|text)>.wav
 *
 * Failure mode: cache operations never break TTS. Read errors return
 * null (treated as miss); write/evict errors log and continue. The cap
 * is best-effort LRU eviction by mtime.
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import { mkdir, readFile, readdir, stat, unlink, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stateDir } from "./paths.js";
import { consoleLogger } from "./log.js";

export interface VoiceCacheKeyInput {
  engine: string;
  voiceId: string;
  text: string;
}

export interface CachedVoiceMeta {
  key: string;
  path: string;
  size: number;
}

const CACHE_DIRNAME = "voices/cache";

/** Where cached WAVs live. */
export function voiceCacheDir(): string {
  return join(stateDir(), CACHE_DIRNAME);
}

/** Default cap, configurable via env in MB. */
export function voiceCacheMaxBytes(): number {
  const raw = process.env["MAGISTER_VOICE_CACHE_MAX_MB"];
  const parsed = raw ? Number.parseFloat(raw) : NaN;
  const mb = Number.isFinite(parsed) && parsed > 0 ? parsed : 500;
  return Math.floor(mb * 1024 * 1024);
}

/**
 * Stable cache key. Same input always yields the same hex string.
 * The pipe separator is a defensive choice; collisions would require
 * the same canonical pre-image, which sha256 already guards against.
 */
export function voiceCacheKey(input: VoiceCacheKeyInput): string {
  const canonical = `${input.engine}|${input.voiceId}|${input.text}`;
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function cachePath(key: string): string {
  return join(voiceCacheDir(), `${key}.wav`);
}

async function ensureCacheDir(): Promise<void> {
  await mkdir(voiceCacheDir(), { recursive: true });
}

/**
 * Look up a cached WAV. Returns null on any failure (treated as miss).
 * Touches mtime on hit so LRU eviction respects access order.
 */
export async function getCachedVoice(key: string): Promise<Buffer | null> {
  const path = cachePath(key);
  if (!existsSync(path)) return null;
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (err) {
    consoleLogger.warn(`voice cache read failed for ${key}: ${String(err)}`);
    return null;
  }
  // Touch mtime for LRU. Best-effort; ignore failures.
  const now = new Date();
  utimes(path, now, now).catch(() => {});
  return bytes;
}

/**
 * Write a WAV to the cache. Returns metadata so the route layer can log.
 * Triggers an async eviction sweep after a successful write.
 */
export async function putCachedVoice(key: string, bytes: Buffer | Uint8Array): Promise<CachedVoiceMeta | null> {
  const path = cachePath(key);
  try {
    await ensureCacheDir();
    const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    await writeFile(path, buf);
    // Fire-and-forget eviction. We log inside if it fails.
    void evictVoiceCacheTo(voiceCacheMaxBytes()).catch((err) => {
      consoleLogger.warn(`voice cache eviction failed: ${String(err)}`);
    });
    return { key, path, size: buf.length };
  } catch (err) {
    consoleLogger.warn(`voice cache write failed for ${key}: ${String(err)}`);
    return null;
  }
}

/**
 * Evict oldest files (by mtime) until total size ≤ maxBytes.
 * Best-effort — partial failures don't throw, they just log.
 */
export async function evictVoiceCacheTo(maxBytes: number): Promise<void> {
  const dir = voiceCacheDir();
  if (!existsSync(dir)) return;
  if (maxBytes < 0) maxBytes = 0;

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    consoleLogger.warn(`voice cache listdir failed: ${String(err)}`);
    return;
  }

  interface E { path: string; mtime: number; size: number }
  const wavs: E[] = [];
  for (const name of entries) {
    if (!name.endsWith(".wav")) continue;
    const p = join(dir, name);
    try {
      const s = await stat(p);
      if (!s.isFile()) continue;
      wavs.push({ path: p, mtime: s.mtimeMs, size: s.size });
    } catch {
      // entry vanished mid-scan; ignore
    }
  }
  wavs.sort((a, b) => a.mtime - b.mtime); // oldest first
  let total = wavs.reduce((acc, e) => acc + e.size, 0);

  for (const e of wavs) {
    if (total <= maxBytes) break;
    try {
      await unlink(e.path);
      total -= e.size;
    } catch (err) {
      consoleLogger.warn(`voice cache evict unlink failed for ${e.path}: ${String(err)}`);
    }
  }
}

/** Synchronous size probe — used by tests to assert eviction worked. */
export function voiceCacheSizeBytes(): number {
  const dir = voiceCacheDir();
  if (!existsSync(dir)) return 0;
  let total = 0;
  try {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".wav")) continue;
      try {
        const s = statSync(join(dir, name));
        if (s.isFile()) total += s.size;
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  return total;
}
