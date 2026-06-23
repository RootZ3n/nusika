import type { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import type { NusikaDB, TeachingMode, HintLevel } from "../db.js";
import { enrichSession } from "./modules.js";
import { synthesizeSpeech, transcribeAudioBuffer } from "./voice.js";

interface CreateSessionBody {
  module_id: string;
  companion_id?: string;
  duration_target?: number;
  teaching_mode?: TeachingMode;
  concept_id?: string;
  objective?: string;
  mastery_signal?: string;
  adult_mode?: boolean;
}

interface DefaultAtom {
  concept_id: string;
  objective: string;
  mastery_signal: string;
}

interface PronounceBody {
  target_phrase?: string;
  audio_base64?: string;
  language?: string;
}

interface WordDiff {
  word: string;
  match: boolean;
  expected: string;
}

/**
 * Derive a sensible default atom for a module when the caller didn't pick a
 * concept. Reads the curriculum config's first domain.
 */
async function resolveDefaultAtom(db: NusikaDB, moduleId: string, override: Partial<DefaultAtom>): Promise<DefaultAtom> {
  let defaults: DefaultAtom = {
    concept_id: "introduction",
    objective: "Explore the fundamentals",
    mastery_signal: "Can explain core concepts in your own words",
  };

  const mod = db.getModule(moduleId);
  if (mod?.config_path) {
    try {
      const raw = await readFile(mod.config_path, "utf-8");
      const cfg = JSON.parse(raw) as {
        domains?: Array<{ id?: string; name?: string; concepts?: string[]; mastery_signal?: string }> | string[];
      };
      if (Array.isArray(cfg.domains) && cfg.domains.length > 0) {
        const first = cfg.domains[0]!;
        if (typeof first === "object") {
          defaults = {
            concept_id: first.id ?? defaults.concept_id,
            objective: (first.concepts?.[0] as string) ?? `Learn ${first.name ?? "this domain"}`,
            mastery_signal: first.mastery_signal ?? defaults.mastery_signal,
          };
        } else {
          defaults = {
            concept_id: first,
            objective: `Learn ${first}`,
            mastery_signal: defaults.mastery_signal,
          };
        }
      }
    } catch { /* fall back to defaults */ }
  }

  return {
    concept_id: override.concept_id ?? defaults.concept_id,
    objective: override.objective ?? defaults.objective,
    mastery_signal: override.mastery_signal ?? defaults.mastery_signal,
  };
}

function normalizePhrase(input: string): string[] {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}' ]/gu, " ")
    .split(/\s+/)
    .map(w => w.replace(/^'+|'+$/g, ""))
    .filter(Boolean);
}

function phonemeKey(word: string): string {
  const cleaned = word
    .replace(/[^a-z0-9]/g, "")
    .replace(/^kn/, "n")
    .replace(/^wr/, "r")
    .replace(/^wh/, "w")
    .replace(/ph/g, "f")
    .replace(/ght/g, "t")
    .replace(/qu/g, "kw")
    .replace(/x/g, "ks")
    .replace(/c(?=[eiy])/g, "s")
    .replace(/c/g, "k")
    .replace(/z/g, "s")
    .replace(/v/g, "f")
    .replace(/(.)\1+/g, "$1")
    .replace(/e$/g, "");
  if (cleaned.length <= 1) return cleaned;
  return cleaned[0] + cleaned.slice(1).replace(/[aeiouy]/g, "");
}

function wordsMatch(actual: string, expected: string): boolean {
  return actual === expected || phonemeKey(actual) === phonemeKey(expected);
}

function pronunciationDiff(transcript: string, target: string): { score: number; word_diffs: WordDiff[] } {
  const actual = normalizePhrase(transcript);
  const expected = normalizePhrase(target);
  const m = actual.length;
  const n = expected.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i += 1) dp[i]![0] = i;
  for (let j = 0; j <= n; j += 1) dp[0]![j] = j;

  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = wordsMatch(actual[i - 1]!, expected[j - 1]!) ? 0 : 1;
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + cost,
      );
    }
  }

  const diffs: WordDiff[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const match = wordsMatch(actual[i - 1]!, expected[j - 1]!);
      const cost = match ? 0 : 1;
      if (dp[i]![j] === dp[i - 1]![j - 1]! + cost) {
        diffs.push({ word: actual[i - 1]!, match, expected: expected[j - 1]! });
        i -= 1;
        j -= 1;
        continue;
      }
    }
    if (i > 0 && dp[i]![j] === dp[i - 1]![j]! + 1) {
      diffs.push({ word: actual[i - 1]!, match: false, expected: "" });
      i -= 1;
      continue;
    }
    diffs.push({ word: "", match: false, expected: expected[j - 1] ?? "" });
    j -= 1;
  }

  diffs.reverse();
  const distance = dp[m]![n]!;
  const denominator = Math.max(m, n, 1);
  const score = Math.max(0, Math.min(100, Math.round((1 - distance / denominator) * 100)));
  return { score, word_diffs: diffs };
}

function decodeBase64Audio(audioBase64: string): Buffer | null {
  const trimmed = audioBase64.trim();
  if (!trimmed) return null;
  const payload = trimmed.includes(",") ? trimmed.slice(trimmed.indexOf(",") + 1) : trimmed;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(payload) || payload.length % 4 === 1) return null;
  const audio = Buffer.from(payload, "base64");
  return audio.length > 0 ? audio : null;
}

export async function registerSessionRoutes(app: FastifyInstance, db: NusikaDB): Promise<void> {
  // GET /nusika/sessions — all sessions, enriched with module + companion display data
  app.get("/nusika/sessions", async (_req, reply) => {
    return reply.send({
      ok: true,
      sessions: db.listSessions().map(s => enrichSession(db, s as unknown as Record<string, unknown>)),
    });
  });

  // POST /nusika/sessions — start a new session; auto-derives atom if not provided
  app.post<{ Body: CreateSessionBody }>("/nusika/sessions", async (req, reply) => {
    const { module_id, companion_id, duration_target = 600, teaching_mode = "narrative", concept_id, objective, mastery_signal, adult_mode } = req.body ?? {};
    if (!module_id) return reply.status(400).send({ ok: false, error: "module_id required" });

    const atom = await resolveDefaultAtom(db, module_id, {
      ...(concept_id ? { concept_id } : {}),
      ...(objective ? { objective } : {}),
      ...(mastery_signal ? { mastery_signal } : {}),
    });

    try {
      const session = db.createSession(module_id, {
        ...(companion_id ? { companionId: companion_id } : {}),
        durationTarget: duration_target,
        teachingMode: teaching_mode,
        ...(adult_mode !== undefined ? { adultMode: adult_mode } : {}),
        atom,
      });
      return reply.status(201).send({ ok: true, session: enrichSession(db, session as unknown as Record<string, unknown>) });
    } catch (err) {
      return reply.status(400).send({ ok: false, error: String(err) });
    }
  });

  // GET /nusika/sessions/:id
  app.get<{ Params: { id: string } }>("/nusika/sessions/:id", async (req, reply) => {
    const session = db.getSession(req.params.id);
    if (!session) return reply.status(404).send({ ok: false, error: "Session not found" });
    return reply.send({ ok: true, session: enrichSession(db, session as unknown as Record<string, unknown>) });
  });

  // PATCH /nusika/sessions/:id — update mutable fields
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>("/nusika/sessions/:id", async (req, reply) => {
    const updated = db.updateSession(req.params.id, req.body ?? {});
    if (!updated) return reply.status(404).send({ ok: false, error: "Session not found" });
    return reply.send({ ok: true });
  });

  // POST /nusika/sessions/:id/end — mark session complete
  app.post<{ Params: { id: string }; Body: { summary?: string } }>("/nusika/sessions/:id/end", async (req, reply) => {
    const ok = db.endSession(req.params.id, req.body?.summary);
    if (!ok) return reply.status(404).send({ ok: false, error: "Session not found" });
    return reply.send({ ok: true });
  });

  // POST /nusika/sessions/:id/hint — record a hint at a given level
  app.post<{ Params: { id: string }; Body: { level: number } }>("/nusika/sessions/:id/hint", async (req, reply) => {
    const level = (req.body?.level ?? 1) as HintLevel;
    const session = db.recordHint(req.params.id, level);
    if (!session) return reply.status(404).send({ ok: false, error: "Session not found" });
    return reply.send({ ok: true, session });
  });

  // POST /nusika/sessions/:id/pronounce — compare learner audio to a target phrase
  app.post<{ Params: { id: string }; Body: PronounceBody }>("/nusika/sessions/:id/pronounce", async (req, reply) => {
    const session = db.getSession(req.params.id);
    if (!session) return reply.status(404).send({ ok: false, error: "Session not found" });

    const target = req.body?.target_phrase?.trim() ?? "";
    const audioBase64 = req.body?.audio_base64 ?? "";
    if (!target) return reply.status(400).send({ ok: false, error: "target_phrase required" });
    if (!audioBase64) return reply.status(400).send({ ok: false, error: "audio_base64 required" });

    const audio = decodeBase64Audio(audioBase64);
    if (!audio) return reply.status(400).send({ ok: false, error: "audio_base64 must be valid base64 audio" });

    try {
      await synthesizeSpeech(app, target, session.companion_id ?? undefined);
      const stt = await transcribeAudioBuffer(app, audio, req.body?.language || "en");
      const diff = pronunciationDiff(stt.transcript, target);
      return reply.send({
        score: diff.score,
        transcript: stt.transcript,
        target,
        word_diffs: diff.word_diffs,
      });
    } catch (err) {
      const statusCode = (err as Error & { statusCode?: number }).statusCode ?? 500;
      return reply.status(statusCode).send({
        ok: false,
        error: err instanceof Error ? err.message : "Pronunciation practice failed.",
        ...((err as Error & { detail?: string }).detail ? { detail: (err as Error & { detail: string }).detail } : {}),
      });
    }
  });

  // POST /nusika/sessions/:id/tick — advance the session timer
  app.post<{ Params: { id: string }; Body: { seconds: number } }>("/nusika/sessions/:id/tick", async (req, reply) => {
    const result = db.tickSession(req.params.id, req.body?.seconds ?? 1);
    return reply.send({ ok: true, ...(result ?? {}) });
  });

  // DELETE /nusika/sessions/:id — permanently remove a session
  app.delete<{ Params: { id: string } }>("/nusika/sessions/:id", async (req, reply) => {
    const ok = db.deleteSession(req.params.id);
    if (!ok) return reply.status(404).send({ ok: false, error: "Session not found" });
    return reply.send({ ok: true });
  });
}
