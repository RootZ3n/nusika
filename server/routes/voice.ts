/**
 * Voice routes — TTS (Piper, ElevenLabs) and STT (whisper.cpp).
 *
 * Direct port of the squidley-v2 implementation in apps/api/src/routes/chat.ts
 * (~lines 4683-4995). The original code shells out to local binaries with
 * no squidley-specific deps beyond paths + receipts, so the port is largely
 * a copy with paths and receipts swapped for the magister equivalents.
 */

import type { FastifyInstance, FastifyReply } from "fastify";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import type { MagisterDB } from "../db.js";
import { stateDir } from "../lib/paths.js";
import { writeReceipt } from "../lib/receipts.js";
import { safeServeFile } from "../lib/safe-serve-file.js";
import { resolveVoiceProfile, type VoiceProfile } from "../lib/voice-registry.js";
import { kokoroGenerate, type KokoroGenerateError } from "../lib/voices/kokoro.js";
import {
  voiceCacheKey,
  getCachedVoice,
  putCachedVoice,
} from "../lib/voice-cache.js";

// Read env at call time (not module load) so tests + ops can flip paths
// before issuing a request. Defaults match Jeff's local layout; anywhere
// else, set the env vars in `.env`.
//
// Some accessors are exported because the voice registry (server/lib/voice-registry.ts)
// reuses them to compute engine availability without duplicating preflight logic.
export const piperBin = () => process.env["PIPER_BIN"] ?? "/home/zen/.local/bin/piper";
export const piperVoicesDir = () => process.env["PIPER_VOICES_DIR"] ?? "/home/zen/.local/share/piper-voices";
const whisperBin = () => process.env["WHISPER_BIN"] ?? "/mnt/ai/whisper.cpp/build/bin/whisper-cli";
const whisperModelEn = () => process.env["WHISPER_MODEL"] ?? "/mnt/ai/whisper.cpp/models/ggml-base.en.bin";
const whisperModelMulti = () => process.env["WHISPER_MODEL_MULTILINGUAL"] ?? "/mnt/ai/whisper.cpp/models/ggml-base.bin";
export const ttsDefaultVoice = () => process.env["MAGISTER_TTS_DEFAULT_VOICE"] ?? "en_GB-alba-medium";

/** Where Piper expects to find a voice's .onnx file. */
export function voiceModelPath(voice: string): string {
  return `${piperVoicesDir()}/${voice}.onnx`;
}

async function tmpDir(): Promise<string> {
  const dir = join(stateDir(), "tmp");
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function piperSynth(text: string, voice: string): Promise<{ audio: Buffer; outFile: string }> {
  const modelPath = voiceModelPath(voice);
  const outFile = join(await tmpDir(), `tts-${randomUUID()}.wav`);

  await new Promise<void>((resolvePiper, rejectPiper) => {
    const proc = spawn(piperBin(), ["-m", modelPath, "-f", outFile], {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 30_000,
    });
    proc.stdin.write(text);
    proc.stdin.end();
    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    proc.on("close", (code) => {
      if (code === 0) resolvePiper();
      else rejectPiper(new Error(`Piper exited ${code}: ${stderr.slice(0, 300)}`));
    });
    proc.on("error", rejectPiper);
  });

  const audio = await readFile(outFile);
  return { audio, outFile };
}

function addPausesForTTS(t: string): string {
  return t
    .replace(/\. ([A-Z])/g, "... $1")
    .replace(/\? /g, "?... ")
    .replace(/! /g, "!... ")
    .replace(/\n/g, " ... ");
}

/**
 * Run Piper synthesis. Extracted so dispatch can call it as either the
 * primary path or a Kokoro fallback. `isFallback` adds the
 * X-TTS-Fallback header so callers can distinguish the cases.
 */
async function runPiperSynthesis(
  app: FastifyInstance,
  reply: FastifyReply,
  text: string,
  voice: string,
  isFallback = false,
): Promise<FastifyReply> {
  const bin = piperBin();
  if (!existsSync(bin)) {
    void writeReceipt({
      componentType: "module-event", componentName: "magister-tts",
      reason: "magister:tts:piper", status: "failure",
      meta: { stage: "preflight", missing: "binary", path: bin, fallback: isFallback },
    });
    return reply.status(503).send({
      ok: false,
      error: "TTS not configured.",
      detail: `PIPER_BIN not found at ${bin}.`,
    });
  }
  const modelPath = voiceModelPath(voice);
  if (!existsSync(modelPath)) {
    void writeReceipt({
      componentType: "module-event", componentName: "magister-tts",
      reason: "magister:tts:piper", status: "failure",
      meta: { stage: "preflight", missing: "voice", path: modelPath, voice, fallback: isFallback },
    });
    return reply.status(503).send({
      ok: false,
      error: "TTS voice not configured.",
      detail: `Voice model not found at ${modelPath}.`,
    });
  }

  const start = Date.now();
  let outFile = "";
  try {
    const { audio, outFile: f } = await piperSynth(text, voice);
    outFile = f;
    const durationMs = Date.now() - start;

    void writeReceipt({
      componentType: "module-event",
      componentName: "magister-tts",
      reason: "magister:tts:piper",
      durationMs,
      meta: { voice, characters: text.length, audioBytes: audio.length, fallback: isFallback },
    });

    let r = reply
      .header("Content-Type", "audio/wav")
      .header("X-TTS-Provider", "piper")
      .header("X-TTS-Voice", voice)
      .header("X-TTS-Duration-Ms", String(durationMs))
      .header("X-TTS-Characters", String(text.length));
    if (isFallback) r = r.header("X-TTS-Fallback", "piper");
    return r.send(audio);
  } catch (err) {
    const fullDetail = err instanceof Error ? err.message : String(err);
    app.log.error(`magister:tts: Piper failed: ${fullDetail}`);
    void writeReceipt({
      componentType: "module-event", componentName: "magister-tts",
      reason: "magister:tts:piper", status: "failure",
      meta: { stage: "spawn", error: fullDetail.slice(0, 400), fallback: isFallback },
    });
    return reply.status(500).send({
      ok: false,
      error: "TTS execution failed.",
      detail: "Piper exited with an error. See server logs for details.",
    });
  } finally {
    if (outFile) unlink(outFile).catch(() => {});
  }
}

/**
 * Run Kokoro synthesis through the local Python sub-service. Cache hits
 * skip the upstream call. On failure, optionally fall back to Piper if
 * `MAGISTER_VOICE_FALLBACK=piper`.
 */
async function runKokoroSynthesis(
  app: FastifyInstance,
  reply: FastifyReply,
  profile: VoiceProfile,
  text: string,
): Promise<FastifyReply> {
  const cacheKey = voiceCacheKey({ engine: "kokoro", voiceId: profile.voice_ref, text });
  const cached = await getCachedVoice(cacheKey);
  if (cached) {
    void writeReceipt({
      componentType: "module-event", componentName: "magister-tts",
      reason: "magister:tts:kokoro:cached",
      meta: { voice: profile.voice_ref, profile_id: profile.id, characters: text.length, audioBytes: cached.length, cache_hit: true },
    });
    return reply
      .header("Content-Type", "audio/wav")
      .header("X-TTS-Provider", "kokoro-cached")
      .header("X-Voice-Engine", "kokoro")
      .header("X-Voice-Id", profile.id)
      .header("X-TTS-Voice", profile.voice_ref)
      .header("X-TTS-Cache-Hit", "true")
      .send(cached);
  }

  const start = Date.now();
  try {
    const audio = await kokoroGenerate({ voice: profile.voice_ref, text });
    const durationMs = Date.now() - start;
    // Best-effort cache write; failure here is logged inside putCachedVoice
    // and never surfaces to the client.
    await putCachedVoice(cacheKey, audio);

    void writeReceipt({
      componentType: "module-event", componentName: "magister-tts",
      reason: "magister:tts:kokoro",
      durationMs,
      meta: { voice: profile.voice_ref, profile_id: profile.id, characters: text.length, audioBytes: audio.length, cache_hit: false },
    });
    return reply
      .header("Content-Type", "audio/wav")
      .header("X-TTS-Provider", "kokoro")
      .header("X-Voice-Engine", "kokoro")
      .header("X-Voice-Id", profile.id)
      .header("X-TTS-Voice", profile.voice_ref)
      .header("X-TTS-Duration-Ms", String(durationMs))
      .header("X-TTS-Cache-Hit", "false")
      .send(audio);
  } catch (err) {
    const e = err as KokoroGenerateError;
    const detail = e.detail ?? (err instanceof Error ? err.message : String(err));
    app.log.warn(`magister:tts: Kokoro failed: ${detail}`);
    void writeReceipt({
      componentType: "module-event", componentName: "magister-tts",
      reason: "magister:tts:kokoro", status: "failure",
      meta: { voice: profile.voice_ref, profile_id: profile.id, error: detail, status: e.status, reachable: e.reachable },
    });

    if (process.env["MAGISTER_VOICE_FALLBACK"] === "piper") {
      app.log.info("magister:tts: falling back to Piper after Kokoro failure");
      return runPiperSynthesis(app, reply, text, ttsDefaultVoice(), /*isFallback=*/ true);
    }
    return reply.status(503).send({
      ok: false,
      error: "Kokoro TTS unavailable.",
      detail,
    });
  }
}

export async function registerVoiceRoutes(app: FastifyInstance, db: MagisterDB): Promise<void> {
  // ── POST /magister/tts — voice-profile dispatch + Piper backward-compat ──
  //
  // Accepts:
  //   { text, voice?, scope? }
  //
  // Where `voice`/`scope` may be:
  //   - a VoiceProfile id (e.g. "varros-default")
  //   - a companion id    (e.g. "varros", "cronk", "maren")
  //   - a Piper voice basename (legacy callers; e.g. "en_US-lessac-medium")
  //   - omitted          (uses ttsDefaultVoice() Piper voice)
  //
  // The first two routes through the registry → engine dispatch (Kokoro
  // or Piper). The third and fourth keep the pre-Slice-6D behavior so
  // existing callers don't break.

  app.post<{ Body: { text?: string; voice?: string; scope?: string } }>(
    "/magister/tts",
    async (req, reply) => {
      const text = req.body?.text;
      if (!text) return reply.status(400).send({ ok: false, error: "text required" });

      const query = (req.body?.voice ?? req.body?.scope ?? "").trim();
      const profile = query ? await resolveVoiceProfile(db, query) : null;

      if (profile) {
        switch (profile.engine) {
          case "kokoro":
            return runKokoroSynthesis(app, reply, profile, text);
          case "piper":
            return runPiperSynthesis(app, reply, text, profile.voice_ref);
          case "elevenlabs":
            // ElevenLabs is deprecated. Avoid silently routing to it.
            return reply.status(409).send({
              ok: false,
              error: "ElevenLabs voice profile is deprecated.",
              detail: "Use POST /magister/tts/elevenlabs explicitly, or rebind this companion to a local engine.",
            });
          case "none":
            if (process.env["MAGISTER_VOICE_FALLBACK"] === "piper") {
              return runPiperSynthesis(app, reply, text, ttsDefaultVoice(), /*isFallback=*/ true);
            }
            return reply.status(503).send({
              ok: false,
              error: "Voice not configured for this profile.",
              detail: profile.reason ?? "Profile engine is 'none'.",
            });
        }
      }

      // No registry match → legacy path: treat `query` as a Piper voice
      // basename, or fall through to the default voice.
      const voice = query || ttsDefaultVoice();
      return runPiperSynthesis(app, reply, text, voice);
    },
  );

  // ── POST /magister/tts/elevenlabs — ElevenLabs cloud, Piper fallback ──────

  app.post<{ Body: { text: string; voice_id?: string; companion_voice?: boolean } }>(
    "/magister/tts/elevenlabs",
    async (req, reply) => {
      const { text, voice_id: explicitVoiceId, companion_voice } = req.body ?? {};
      if (!text) return reply.status(400).send({ ok: false, error: "text required" });

      const voice_id = explicitVoiceId || "21m00Tcm4TlvDq8ikWAM"; // Rachel default
      const isCompanionVoice = Boolean(companion_voice);
      const finalText = isCompanionVoice ? addPausesForTTS(text) : text;

      const elevenLabsKey = process.env["ELEVENLABS_API_KEY"] ?? "";
      const start = Date.now();

      if (elevenLabsKey) {
        try {
          const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice_id}`, {
            method: "POST",
            headers: {
              "xi-api-key": elevenLabsKey,
              "Content-Type": "application/json",
              "Accept": "audio/mpeg",
            },
            body: JSON.stringify({
              text: finalText,
              model_id: "eleven_monolingual_v1",
              voice_settings: isCompanionVoice
                ? { stability: 0.80, similarity_boost: 0.85, speed: 0.78, style: 0.25 }
                : { stability: 0.5, similarity_boost: 0.75 },
            }),
            signal: AbortSignal.timeout(60_000),
          });

          if (res.ok && res.body) {
            const audioBuffer = Buffer.from(await res.arrayBuffer());
            const durationMs = Date.now() - start;
            const estimatedCredits = Math.ceil(text.length / 30);

            void writeReceipt({
              componentType: "module-event",
              componentName: "magister-tts",
              reason: "magister:tts:elevenlabs",
              durationMs,
              meta: { voice_id, characters: text.length, estimatedCredits, audioBytes: audioBuffer.length },
            });

            return reply
              .header("Content-Type", "audio/mpeg")
              .header("X-TTS-Provider", "elevenlabs")
              .header("X-TTS-Voice-Id", voice_id)
              .header("X-TTS-Duration-Ms", String(durationMs))
              .send(audioBuffer);
          }

          app.log.warn(`magister:tts: ElevenLabs HTTP ${res.status}, falling back to Piper`);
        } catch (err) {
          app.log.warn(`magister:tts: ElevenLabs error, falling back to Piper: ${err}`);
        }
      }

      // Piper fallback. Pre-flight here too — without it, a missing PIPER_BIN
      // would crash the spawn after ElevenLabs already failed.
      const fallbackVoice = ttsDefaultVoice();
      const bin = piperBin();
      if (!existsSync(bin)) {
        return reply.status(503).send({
          ok: false,
          error: "TTS not configured.",
          detail: `ElevenLabs failed and PIPER_BIN fallback not found at ${bin}.`,
        });
      }
      const fallbackModelPath = voiceModelPath(fallbackVoice);
      if (!existsSync(fallbackModelPath)) {
        return reply.status(503).send({
          ok: false,
          error: "TTS voice not configured.",
          detail: `ElevenLabs failed and Piper fallback voice not found at ${fallbackModelPath}.`,
        });
      }

      let outFile = "";
      try {
        const { audio, outFile: f } = await piperSynth(text, fallbackVoice);
        outFile = f;
        void writeReceipt({
          componentType: "module-event",
          componentName: "magister-tts",
          reason: "magister:tts:piper-fallback",
          durationMs: Date.now() - start,
          meta: { voice: fallbackVoice, characters: text.length, fallbackFrom: "elevenlabs" },
        });
        return reply
          .header("Content-Type", "audio/wav")
          .header("X-TTS-Provider", "piper-fallback")
          .send(audio);
      } catch (err) {
        const fullDetail = err instanceof Error ? err.message : String(err);
        app.log.error(`magister:tts: All providers failed: ${fullDetail}`);
        return reply.status(500).send({
          ok: false,
          error: "TTS execution failed.",
          detail: "All TTS providers failed. See server logs for details.",
        });
      } finally {
        if (outFile) unlink(outFile).catch(() => {});
      }
    },
  );

  // ── POST /magister/stt — whisper.cpp local STT ────────────────────────────

  app.post("/magister/stt", async (req, reply) => {
    const start = Date.now();
    let audioPath = "";
    let txtPath = "";
    try {
      // @fastify/multipart adds .file()
      const multipartReq = req as typeof req & {
        file: () => Promise<{
          file: AsyncIterable<Uint8Array>;
          fields?: Record<string, unknown>;
        } | undefined>;
      };
      const data = await multipartReq.file();
      if (!data) return reply.status(400).send({ ok: false, error: "Audio file required (multipart upload)" });

      const langField = data.fields?.["language"];
      const language = (langField && typeof langField === "object" && "value" in langField
        ? String((langField as { value: unknown }).value ?? "")
        : "") || "en";
      const useMultilingual = language !== "en";
      const whisperModel = useMultilingual ? whisperModelMulti() : whisperModelEn();

      // Pre-flight: missing binary or missing model → 503 with friendly
      // text. Without this, spawn ENOENT or whisper.cpp's "couldn't load
      // model" stderr would surface as raw 500s.
      const bin = whisperBin();
      if (!existsSync(bin)) {
        void writeReceipt({
          componentType: "module-event", componentName: "magister-stt",
          reason: "magister:stt:whisper", status: "failure",
          meta: { stage: "preflight", missing: "binary", path: bin },
        });
        return reply.status(503).send({
          ok: false,
          error: "STT not configured.",
          detail: `WHISPER_BIN not found at ${bin}.`,
        });
      }
      if (!existsSync(whisperModel)) {
        void writeReceipt({
          componentType: "module-event", componentName: "magister-stt",
          reason: "magister:stt:whisper", status: "failure",
          meta: { stage: "preflight", missing: "model", path: whisperModel },
        });
        return reply.status(503).send({
          ok: false,
          error: "STT model not configured.",
          detail: `Whisper model not found at ${whisperModel}.`,
        });
      }

      audioPath = join(await tmpDir(), `stt-${randomUUID()}.wav`);
      txtPath = `${audioPath}.txt`;

      const chunks: Buffer[] = [];
      for await (const chunk of data.file) chunks.push(chunk as Buffer);
      const totalBytes = chunks.reduce((acc, c) => acc + c.length, 0);
      await writeFile(audioPath, Buffer.concat(chunks));

      const transcript = await new Promise<string>((resolveStt, rejectStt) => {
        const proc = spawn(bin, [
          "-m", whisperModel,
          "-f", audioPath,
          "--no-timestamps",
          "--language", language,
          "-otxt",
        ], { stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 });

        let stdout = "", stderr = "";
        proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
        proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
        proc.on("close", (code) => {
          if (code === 0) {
            readFile(txtPath, "utf-8")
              .then(t => resolveStt(t.trim()))
              .catch(() => resolveStt(stdout.trim()));
          } else {
            rejectStt(new Error(`Whisper exited ${code}: ${stderr.slice(0, 300)}`));
          }
        });
        proc.on("error", rejectStt);
      });

      const durationMs = Date.now() - start;
      void writeReceipt({
        componentType: "module-event",
        componentName: "magister-stt",
        reason: "magister:stt:whisper",
        durationMs,
        meta: {
          model: useMultilingual ? "base-multilingual" : "base.en",
          language,
          transcriptLength: transcript.length,
          audioBytes: totalBytes,
        },
      });

      return reply.send({
        ok: true,
        transcript,
        durationMs,
        model: useMultilingual ? "whisper-base" : "whisper-base.en",
        language,
      });
    } catch (err) {
      // Log full detail server-side; sanitized message to client (no stderr leak).
      const fullDetail = err instanceof Error ? err.message : String(err);
      app.log.error(`magister:stt: Whisper failed: ${fullDetail}`);
      void writeReceipt({
        componentType: "module-event", componentName: "magister-stt",
        reason: "magister:stt:whisper", status: "failure",
        meta: { stage: "spawn", error: fullDetail.slice(0, 400) },
      });
      return reply.status(500).send({
        ok: false,
        error: "STT execution failed.",
        detail: "Whisper exited with an error. See server logs for details.",
      });
    } finally {
      if (audioPath) unlink(audioPath).catch(() => {});
      if (txtPath) unlink(txtPath).catch(() => {});
    }
  });

  // ── GET /magister/audio/:filename — ambient audio file serving ────────────

  app.get<{ Params: { filename: string } }>(
    "/magister/audio/:filename",
    async (req, reply) => {
      const audioDir = resolve(stateDir(), "uploads", "magister", "audio");
      try {
        const filePath = safeServeFile(audioDir, req.params.filename);
        const ext = req.params.filename.split(".").pop()?.toLowerCase();
        reply.header("Content-Type", ext === "ogg" ? "audio/ogg" : ext === "wav" ? "audio/wav" : "audio/mpeg");
        return reply.send(createReadStream(filePath));
      } catch (err) {
        return reply.status(403).send({ ok: false, error: (err as Error).message });
      }
    },
  );
}
