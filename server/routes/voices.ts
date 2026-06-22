/**
 * Voice registry + management routes.
 *
 *   GET    /nusika/voices                              — registry (Slice 6B)
 *   GET    /nusika/voices/preview/:engine/:voice_id    — preview clip (6F)
 *   GET    /nusika/voices/cache                        — cache size + cap (6F)
 *   DELETE /nusika/voices/cache                        — clear cached WAVs (6F)
 *
 * The preview route shares the audio cache with the dispatch path: same
 * `(engine, voice_id, text)` → same key → same WAV. Clicking "Preview"
 * with the same voice id and the same `name` query reuses cached bytes.
 *
 * The cache routes never reach outside `state/voices/cache/`. Clear
 * scans only `*.wav` files in that directory.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { NusikaDB } from "../db.js";
import { buildVoiceRegistry } from "../lib/voice-registry.js";
import {
  voiceCacheDir,
  voiceCacheKey,
  voiceCacheMaxBytes,
  voiceCacheSizeBytes,
  getCachedVoice,
  putCachedVoice,
} from "../lib/voice-cache.js";
import {
  KOKORO_VOICE_IDS,
  kokoroGenerate,
  type KokoroGenerateError,
} from "../lib/voices/kokoro.js";
import {
  EDGE_VOICE_IDS,
  edgeGenerate,
  mapKokoroToEdge,
  type EdgeGenerateError,
} from "../lib/voices/edge.js";
import {
  piperBin,
  piperSynth,
  voiceModelPath,
} from "./voice.js";
import { writeReceipt } from "../lib/receipts.js";

const PREVIEW_ENGINES = new Set(["kokoro", "edge", "piper"]);

/**
 * Build the short sample phrase used for previews. Same input always
 * yields the same text (and therefore the same cache key).
 */
function previewText(name: string | undefined): string {
  const safe = (name ?? "").trim().slice(0, 60);
  return safe ? `Hello, I am ${safe}.` : "Hello, I am a Nusika voice.";
}

async function previewKokoro(
  app: FastifyInstance,
  reply: FastifyReply,
  voiceId: string,
  text: string,
): Promise<FastifyReply> {
  const cacheKey = voiceCacheKey({ engine: "kokoro", voiceId, text });
  const cached = await getCachedVoice(cacheKey);
  if (cached) {
    return reply
      .header("Content-Type", "audio/wav")
      .header("X-TTS-Provider", "kokoro-cached")
      .header("X-TTS-Voice", voiceId)
      .header("X-TTS-Cache-Hit", "true")
      .send(cached);
  }
  try {
    const audio = await kokoroGenerate({ voice: voiceId, text });
    await putCachedVoice(cacheKey, audio);
    return reply
      .header("Content-Type", "audio/wav")
      .header("X-TTS-Provider", "kokoro")
      .header("X-TTS-Voice", voiceId)
      .header("X-TTS-Cache-Hit", "false")
      .send(audio);
  } catch (err) {
    const e = err as KokoroGenerateError;
    const detail = e.detail ?? (err instanceof Error ? err.message : String(err));
    app.log.warn(`nusika:voices:preview: Kokoro failed: ${detail}`);
    void writeReceipt({
      componentType: "module-event", componentName: "magister-voice-preview",
      reason: "magister:voices:preview:kokoro", status: "failure",
      meta: { voice: voiceId, error: detail, status: e.status, reachable: e.reachable },
    });
    return reply.status(503).send({
      ok: false,
      error: "Voice preview unavailable.",
      detail,
    });
  }
}

async function previewEdge(
  app: FastifyInstance,
  reply: FastifyReply,
  voiceId: string,
  text: string,
): Promise<FastifyReply> {
  const voiceRef = mapKokoroToEdge(voiceId);
  const cacheKey = voiceCacheKey({ engine: "edge", voiceId: voiceRef, text });
  const cached = await getCachedVoice(cacheKey);
  if (cached) {
    return reply
      .header("Content-Type", "audio/mpeg")
      .header("X-TTS-Provider", "edge-cached")
      .header("X-TTS-Voice", voiceRef)
      .header("X-TTS-Cache-Hit", "true")
      .send(cached);
  }
  try {
    const audio = await edgeGenerate({ voice: voiceRef, text });
    await putCachedVoice(cacheKey, audio);
    return reply
      .header("Content-Type", "audio/mpeg")
      .header("X-TTS-Provider", "edge")
      .header("X-TTS-Voice", voiceRef)
      .header("X-TTS-Cache-Hit", "false")
      .send(audio);
  } catch (err) {
    const e = err as EdgeGenerateError;
    const detail = e.detail ?? (err instanceof Error ? err.message : String(err));
    app.log.warn(`nusika:voices:preview: Edge failed: ${detail}`);
    void writeReceipt({
      componentType: "module-event", componentName: "magister-voice-preview",
      reason: "magister:voices:preview:edge", status: "failure",
      meta: { voice: voiceRef, error: detail, reachable: e.reachable },
    });
    return reply.status(503).send({
      ok: false,
      error: "Voice preview unavailable.",
      detail,
    });
  }
}

async function previewPiper(
  app: FastifyInstance,
  reply: FastifyReply,
  voiceId: string,
  text: string,
): Promise<FastifyReply> {
  const cacheKey = voiceCacheKey({ engine: "piper", voiceId, text });
  const cached = await getCachedVoice(cacheKey);
  if (cached) {
    return reply
      .header("Content-Type", "audio/wav")
      .header("X-TTS-Provider", "piper-cached")
      .header("X-TTS-Voice", voiceId)
      .header("X-TTS-Cache-Hit", "true")
      .send(cached);
  }

  // Pre-flight: missing binary or voice file → 503.
  const bin = piperBin();
  if (!existsSync(bin)) {
    return reply.status(503).send({
      ok: false,
      error: "Piper preview not available.",
      detail: `PIPER_BIN not found at ${bin}.`,
    });
  }
  const modelPath = voiceModelPath(voiceId);
  if (!existsSync(modelPath)) {
    return reply.status(503).send({
      ok: false,
      error: "Piper preview voice not available.",
      detail: `Voice model not found at ${modelPath}.`,
    });
  }

  let outFile = "";
  try {
    const result = await piperSynth(text, voiceId);
    outFile = result.outFile;
    await putCachedVoice(cacheKey, result.audio);
    return reply
      .header("Content-Type", "audio/wav")
      .header("X-TTS-Provider", "piper")
      .header("X-TTS-Voice", voiceId)
      .header("X-TTS-Cache-Hit", "false")
      .send(result.audio);
  } catch (err) {
    const fullDetail = err instanceof Error ? err.message : String(err);
    app.log.warn(`nusika:voices:preview: Piper failed: ${fullDetail}`);
    return reply.status(503).send({
      ok: false,
      error: "Piper preview failed.",
      detail: "Piper exited with an error. See server logs for details.",
    });
  } finally {
    if (outFile) unlink(outFile).catch(() => {});
  }
}

export async function registerVoicesRoute(app: FastifyInstance, db: NusikaDB): Promise<void> {
  // ── GET /nusika/voices ──────────────────────────────────────────────────
  app.get("/nusika/voices", async (_req, reply) => {
    try {
      const registry = await buildVoiceRegistry(db, { probeKokoro: true, probeEdge: true });
      return reply.send({ ok: true, ...registry });
    } catch (err) {
      app.log.error(`nusika:voices: registry failed: ${err}`);
      return reply.status(200).send({
        ok: true,
        voices: [],
        engines: {
          piper: { configured: false, detail: "registry unavailable" },
          kokoro: { configured: false, detail: "Kokoro service not wired yet." },
          edge: { configured: false, detail: "Edge TTS not probed." },
          elevenlabs: { configured: false, deprecated: true },
        },
        warning: "Voice registry could not be built; see server logs.",
      });
    }
  });

  // ── GET /nusika/voices/preview/:engine/:voice_id ────────────────────────
  // Generates a short sample phrase using the requested voice. Shares the
  // audio cache with /nusika/tts: identical (engine, voice_id, text)
  // returns the same bytes without an upstream call.
  app.get<{
    Params: { engine: string; voice_id: string };
    Querystring: { name?: string };
  }>("/nusika/voices/preview/:engine/:voice_id", async (req, reply) => {
    const engine = (req.params.engine ?? "").toLowerCase();
    const voiceId = (req.params.voice_id ?? "").trim();

    if (!PREVIEW_ENGINES.has(engine)) {
      return reply.status(400).send({
        ok: false,
        error: `Engine not supported for previews.`,
        detail: `engine must be one of: ${[...PREVIEW_ENGINES].join(", ")}`,
      });
    }
    if (!voiceId) {
      return reply.status(400).send({ ok: false, error: "voice_id required" });
    }
    if (engine === "kokoro" && !KOKORO_VOICE_IDS.has(voiceId)) {
      return reply.status(400).send({
        ok: false,
        error: `Unknown Kokoro voice id '${voiceId}'.`,
        detail: "GET /nusika/voices for the supported list.",
      });
    }
    // Edge accepts either an Edge voice id or a Kokoro id (mapped). Reject
    // only a string that resolves to neither a known Kokoro nor Edge voice.
    if (engine === "edge" && !EDGE_VOICE_IDS.has(voiceId) && !KOKORO_VOICE_IDS.has(voiceId)) {
      return reply.status(400).send({
        ok: false,
        error: `Unknown Edge voice id '${voiceId}'.`,
        detail: "GET /nusika/voices for the supported list (Edge or Kokoro ids accepted).",
      });
    }

    const text = previewText(req.query?.name);
    if (engine === "kokoro") return previewKokoro(app, reply, voiceId, text);
    if (engine === "edge") return previewEdge(app, reply, voiceId, text);
    return previewPiper(app, reply, voiceId, text);
  });

  // ── GET /nusika/voices/cache — current size + cap ──────────────────────
  app.get("/nusika/voices/cache", async (_req, reply) => {
    const bytes = voiceCacheSizeBytes();
    const maxBytes = voiceCacheMaxBytes();
    const round1 = (n: number): number => Math.round(n * 10) / 10;
    return reply.send({
      ok: true,
      bytes,
      maxBytes,
      mb: round1(bytes / (1024 * 1024)),
      maxMb: round1(maxBytes / (1024 * 1024)),
    });
  });

  // ── DELETE /nusika/voices/cache — remove cached *.wav files ────────────
  // Only touches files in `state/voices/cache/` matching `*.wav`. Errors
  // on individual files are logged but don't abort the operation.
  app.delete("/nusika/voices/cache", async (_req, reply) => {
    const dir = voiceCacheDir();
    let deletedFiles = 0;
    let deletedBytes = 0;
    if (!existsSync(dir)) {
      return reply.send({ ok: true, deletedFiles: 0, deletedBytes: 0 });
    }

    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch (err) {
      app.log.error(`nusika:voices:cache:clear: readdir failed: ${err}`);
      return reply.status(500).send({
        ok: false,
        error: "Could not read voice cache directory.",
      });
    }

    for (const name of entries) {
      // Defensive: only `.wav` files, no traversal.
      if (!name.endsWith(".wav")) continue;
      if (name.includes("/") || name.includes("\\") || name.startsWith("..")) continue;
      const path = join(dir, name);
      let size = 0;
      try {
        const s = statSync(path);
        if (!s.isFile()) continue;
        size = s.size;
      } catch {
        continue;
      }
      try {
        await unlink(path);
        deletedFiles += 1;
        deletedBytes += size;
      } catch (err) {
        app.log.warn(`nusika:voices:cache:clear: failed to unlink ${path}: ${err}`);
      }
    }

    void writeReceipt({
      componentType: "module-event", componentName: "magister-voice-cache",
      reason: "magister:voices:cache:clear",
      meta: { deletedFiles, deletedBytes },
    });

    return reply.send({ ok: true, deletedFiles, deletedBytes });
  });
}
