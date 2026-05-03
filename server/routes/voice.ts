/**
 * Voice routes — TTS (Piper, ElevenLabs) and STT (whisper.cpp).
 *
 * Direct port of the squidley-v2 implementation in apps/api/src/routes/chat.ts
 * (~lines 4683-4995). The original code shells out to local binaries with
 * no squidley-specific deps beyond paths + receipts, so the port is largely
 * a copy with paths and receipts swapped for the magister equivalents.
 */

import type { FastifyInstance } from "fastify";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { stateDir } from "../lib/paths.js";
import { writeReceipt } from "../lib/receipts.js";
import { safeServeFile } from "../lib/safe-serve-file.js";

const PIPER_BIN = process.env["PIPER_BIN"] ?? "/home/zen/.local/bin/piper";
const PIPER_VOICES_DIR = process.env["PIPER_VOICES_DIR"] ?? "/home/zen/.local/share/piper-voices";
const WHISPER_BIN = process.env["WHISPER_BIN"] ?? "/mnt/ai/whisper.cpp/build/bin/whisper-cli";
const WHISPER_MODEL = process.env["WHISPER_MODEL"] ?? "/mnt/ai/whisper.cpp/models/ggml-base.en.bin";
const WHISPER_MODEL_MULTILINGUAL = process.env["WHISPER_MODEL_MULTILINGUAL"] ?? "/mnt/ai/whisper.cpp/models/ggml-base.bin";
const TTS_DEFAULT_VOICE = process.env["MAGISTER_TTS_DEFAULT_VOICE"] ?? "en_GB-alba-medium";

async function tmpDir(): Promise<string> {
  const dir = join(stateDir(), "tmp");
  await mkdir(dir, { recursive: true });
  return dir;
}

async function piperSynth(text: string, voice: string): Promise<{ audio: Buffer; outFile: string }> {
  const modelPath = `${PIPER_VOICES_DIR}/${voice}.onnx`;
  const outFile = join(await tmpDir(), `tts-${randomUUID()}.wav`);

  await new Promise<void>((resolvePiper, rejectPiper) => {
    const proc = spawn(PIPER_BIN, ["-m", modelPath, "-f", outFile], {
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

export async function registerVoiceRoutes(app: FastifyInstance): Promise<void> {
  // ── POST /magister/tts — Piper local TTS ───────────────────────────────────

  app.post<{ Body: { text: string; voice?: string } }>(
    "/magister/tts",
    async (req, reply) => {
      const { text, voice = TTS_DEFAULT_VOICE } = req.body ?? {};
      if (!text) return reply.status(400).send({ ok: false, error: "text required" });

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
          meta: { voice, characters: text.length, audioBytes: audio.length },
        });

        return reply
          .header("Content-Type", "audio/wav")
          .header("X-TTS-Provider", "piper")
          .header("X-TTS-Voice", voice)
          .header("X-TTS-Duration-Ms", String(durationMs))
          .header("X-TTS-Characters", String(text.length))
          .send(audio);
      } catch (err) {
        app.log.error(`magister:tts: Piper failed: ${err}`);
        return reply.status(500).send({ ok: false, error: `TTS failed: ${String(err).slice(0, 300)}` });
      } finally {
        if (outFile) unlink(outFile).catch(() => {});
      }
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

      // Piper fallback
      let outFile = "";
      try {
        const { audio, outFile: f } = await piperSynth(text, TTS_DEFAULT_VOICE);
        outFile = f;
        void writeReceipt({
          componentType: "module-event",
          componentName: "magister-tts",
          reason: "magister:tts:piper-fallback",
          durationMs: Date.now() - start,
          meta: { voice: TTS_DEFAULT_VOICE, characters: text.length, fallbackFrom: "elevenlabs" },
        });
        return reply
          .header("Content-Type", "audio/wav")
          .header("X-TTS-Provider", "piper-fallback")
          .send(audio);
      } catch (err) {
        return reply.status(500).send({ ok: false, error: `All TTS providers failed: ${String(err).slice(0, 300)}` });
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
      const whisperModel = useMultilingual ? WHISPER_MODEL_MULTILINGUAL : WHISPER_MODEL;

      audioPath = join(await tmpDir(), `stt-${randomUUID()}.wav`);
      txtPath = `${audioPath}.txt`;

      const chunks: Buffer[] = [];
      for await (const chunk of data.file) chunks.push(chunk as Buffer);
      const totalBytes = chunks.reduce((acc, c) => acc + c.length, 0);
      await writeFile(audioPath, Buffer.concat(chunks));

      const transcript = await new Promise<string>((resolveStt, rejectStt) => {
        const proc = spawn(WHISPER_BIN, [
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
      app.log.error(`magister:stt: Whisper failed: ${err}`);
      return reply.status(500).send({ ok: false, error: `STT failed: ${String(err).slice(0, 300)}` });
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
