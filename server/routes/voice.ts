import type { FastifyInstance } from "fastify";
import type { MagisterDB } from "../db.js";

/**
 * Voice routes (TTS + STT).
 *
 * STATUS: stub — direct port of the squidley-v2 chat.ts implementation
 * pending. The original code shells out to local binaries:
 *   - Piper (TTS) — /home/zen/.local/bin/piper
 *   - whisper.cpp (STT) — /mnt/ai/whisper.cpp/build/bin/whisper-cli
 *   - ElevenLabs HTTPS API (premium TTS, optional)
 *
 * These call out to the host filesystem and don't depend on squidley
 * internals, so the port should be straightforward — copy the route
 * bodies over and replace receipt writes with our own JSONL writer.
 *
 * Routes ported in a follow-up session:
 *   POST /magister/tts             local Piper
 *   POST /magister/tts/elevenlabs  cloud, with Piper fallback
 *   POST /magister/stt             multipart upload, whisper.cpp
 *   GET  /magister/audio/:filename ambient audio file serving
 */
export async function registerVoiceRoutes(app: FastifyInstance, _db: MagisterDB): Promise<void> {
  const stub = (name: string) => async (_req: unknown, reply: any) => reply.status(501).send({
    ok: false,
    error: "not_implemented",
    message: `${name} is pending the standalone voice port. See server/routes/voice.ts.`,
  });

  app.post("/magister/tts", stub("POST /magister/tts (Piper)"));
  app.post("/magister/tts/elevenlabs", stub("POST /magister/tts/elevenlabs"));
  app.post("/magister/stt", stub("POST /magister/stt (whisper.cpp)"));
  app.get("/magister/audio/:filename", stub("GET /magister/audio/:filename"));
}
