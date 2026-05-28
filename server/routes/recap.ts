/**
 * Session recap — end-of-session companion memory writeback.
 *
 * The chat path intentionally does NOT do per-turn memory writeback (the
 * strict CompanionMemoryWriteback schema would reject most lightweight
 * per-turn signals). Recap is the canonical entry: take the session's
 * accumulated metadata, ask the configured LLM to produce a
 * schema-shaped JSON object, validate it, and persist via the existing
 * db.saveCompanionMemory().
 *
 * Honesty notes that show up in the prompt:
 *  - There is currently no transcript table. The model only sees session
 *    metadata (atom, hint counts, elapsed/target seconds, teaching mode,
 *    status). The prompt forbids inventing learner-specific details.
 *  - Sessions without a companion_id can't have memory written; we
 *    return 200 with skipped=true rather than 4xx, since "ended a
 *    companion-less session" is a legitimate state.
 */

import type { FastifyInstance } from "fastify";
import type { NusikaDB, CompanionMemoryWriteback } from "../db.js";
import { complete } from "../lib/llm.js";
import { writeReceipt } from "../lib/receipts.js";

const SYSTEM_PROMPT = [
  "You produce a JSON-only memory record for a Nusika teaching session.",
  "You will receive ONLY session metadata — there is NO transcript. Do not invent",
  "learner-specific details, do not speculate about personality, do not record",
  "personal or sensitive information.",
  "",
  "Output exactly one JSON object with this shape and nothing else:",
  "{",
  '  "mastered_concepts": string[],',
  '  "struggled_concepts": string[],',
  '  "hint_patterns": { [conceptId: string]: number },',
  '  "preferences": {',
  '    "session_length": "short" | "standard" | "long",',
  '    "pace": "slow" | "standard" | "fast",',
  '    "teaching_mode": "narrative" | "direct" | "socratic"',
  "  },",
  '  "relationship_beat": string  (OPTIONAL — omit the key entirely if you have nothing)',
  "}",
  "",
  "Inference rules:",
  "- mastered_concepts: include the session's atom concept ID only if the session",
  "  reached status=complete with low total hints (≤1) and a non-trivial duration.",
  "  Otherwise leave it out.",
  "- struggled_concepts: include the atom concept ID only if total hints ≥ 2",
  "  or if level-3 hints were used.",
  "- hint_patterns: a single map entry { atom_concept_id: total_hints } when",
  "  total_hints > 0; otherwise an empty object.",
  "- preferences.session_length: derive from duration_target_seconds:",
  "  ≤ 300 → 'short', ≤ 900 → 'standard', otherwise 'long'.",
  "- preferences.pace: 'slow' if elapsed > duration_target * 1.25 OR",
  "  any level-3 hints; 'fast' if status=complete and total hints == 0 and",
  "  elapsed < duration_target * 0.7; otherwise 'standard'.",
  "- preferences.teaching_mode: copy the provided teaching_mode verbatim.",
  "- relationship_beat: only include if you have a single concrete observation",
  "  about the session shape (e.g. 'finished early without hints'). Otherwise omit.",
  "",
  "Output ONLY the JSON object. No prose, no code fences, no commentary.",
].join("\n");

interface RecapResponse {
  ok: true;
  saved: boolean;
  skipped?: boolean;
  reason?: string;
  writeback?: CompanionMemoryWriteback;
  memory_count?: number;
  model?: string;
  provider?: string;
  durationMs?: number;
}

interface RecapErrorResponse {
  ok: false;
  error: string;
  detail?: string;
  raw?: string;
}

/**
 * Strip ```json fences and surrounding whitespace if the model wraps its JSON.
 * The prompt forbids fences but real models occasionally add them anyway —
 * accommodate without weakening the JSON-only contract.
 */
function unfence(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? fenced[1]!.trim() : trimmed;
}

export async function registerRecapRoutes(app: FastifyInstance, db: NusikaDB): Promise<void> {
  app.post<{ Params: { id: string }; Body: { model?: string } }>(
    "/nusika/sessions/:id/recap",
    async (req, reply) => {
      const session = db.getSession(req.params.id);
      if (!session) return reply.status(404).send({ ok: false, error: "Session not found" } satisfies RecapErrorResponse);

      const totalHints = session.hint_count_l1 + session.hint_count_l2 + session.hint_count_l3;
      const meta = {
        module_id: session.module_id,
        companion_id: session.companion_id,
        atom_concept_id: session.atom_concept_id,
        atom_objective: session.atom_objective,
        atom_mastery_signal: session.atom_mastery_signal,
        teaching_mode: session.teaching_mode,
        duration_target_seconds: session.duration_target,
        elapsed_seconds: session.elapsed_seconds,
        hint_counts: {
          l1: session.hint_count_l1,
          l2: session.hint_count_l2,
          l3: session.hint_count_l3,
          total: totalHints,
        },
        status: session.status,
      };

      // Sessions with no companion can't have memory keyed against one.
      // Tell the caller honestly rather than fabricating a companion id.
      if (!session.companion_id) {
        return reply.send({
          ok: true,
          saved: false,
          skipped: true,
          reason: "Session has no companion_id; companion memory requires one.",
        } satisfies RecapResponse);
      }

      const userTurn =
        "Session metadata (no transcript exists):\n" + JSON.stringify(meta, null, 2);

      let raw = "";
      let result;
      try {
        result = await complete({
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userTurn },
          ],
          ...(req.body?.model ? { model: req.body.model } : {}),
          maxTokens: 600,
          temperature: 0.2,
          reason: `magister:recap:${req.params.id}`,
        });
        raw = result.text;
      } catch (err) {
        const detail = (err instanceof Error ? err.message : String(err)).slice(0, 300);
        void writeReceipt({
          componentType: "model-call",
          componentName: "magister-recap",
          reason: "magister:recap",
          status: "failure",
          meta: { sessionId: req.params.id, error: detail, stage: "llm" },
        });
        return reply.status(502).send({
          ok: false,
          error: "Recap is unavailable: no LLM backend reachable.",
          detail,
        } satisfies RecapErrorResponse);
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(unfence(raw));
      } catch (err) {
        void writeReceipt({
          componentType: "model-call",
          componentName: "magister-recap",
          reason: "magister:recap",
          status: "failure",
          model: result.model,
          meta: { sessionId: req.params.id, stage: "json-parse", error: String(err).slice(0, 200) },
        });
        return reply.status(502).send({
          ok: false,
          error: "Recap LLM did not return valid JSON.",
          detail: (err instanceof Error ? err.message : String(err)).slice(0, 200),
          raw: raw.slice(0, 400),
        } satisfies RecapErrorResponse);
      }

      // saveCompanionMemory throws on schema violation. Treat the throw as
      // a 422 (unprocessable entity) rather than 500: it's a content issue,
      // not a server fault, and we explicitly do not persist invalid memory.
      let memories;
      try {
        memories = db.saveCompanionMemory(session.companion_id, parsed as CompanionMemoryWriteback, {
          sessionId: session.id,
          ...(session.user_id ? { userId: session.user_id } : {}),
        });
      } catch (err) {
        const detail = (err instanceof Error ? err.message : String(err)).slice(0, 400);
        void writeReceipt({
          componentType: "model-call",
          componentName: "magister-recap",
          reason: "magister:recap",
          status: "failure",
          model: result.model,
          meta: { sessionId: req.params.id, stage: "schema-validate", error: detail },
        });
        return reply.status(422).send({
          ok: false,
          error: "Recap JSON failed schema validation; nothing was persisted.",
          detail,
          raw: raw.slice(0, 400),
        } satisfies RecapErrorResponse);
      }

      void writeReceipt({
        componentType: "model-call",
        componentName: "magister-recap",
        reason: "magister:recap",
        status: "success",
        model: result.model,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        estimatedCostUsd: result.estimatedCostUsd,
        durationMs: result.durationMs,
        meta: {
          sessionId: req.params.id,
          companionId: session.companion_id,
          moduleId: session.module_id,
          provider: result.provider,
          memoryCount: memories.length,
        },
      });

      return reply.send({
        ok: true,
        saved: true,
        writeback: parsed as CompanionMemoryWriteback,
        memory_count: memories.length,
        model: result.model,
        provider: result.provider,
        durationMs: result.durationMs,
      } satisfies RecapResponse);
    },
  );
}
