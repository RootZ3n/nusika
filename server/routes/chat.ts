import type { FastifyInstance } from "fastify";
import type { MagisterDB } from "../db.js";

/**
 * Companion chat endpoint.
 *
 * STATUS: stub — pending standalone LLM client.
 *
 * In squidley-v2, this route lived in apps/api/src/routes/chat.ts (around
 * line 4413) and consumed:
 *   - provider-manager (squidley.system.provider-manager) for completions
 *   - model-roles for resolving the "roleplay" model
 *   - the central receipts JSONL stream
 *   - the magister DB for session + memory + module config
 *
 * The standalone needs its own LLM client. The plan:
 *   1. lib/llm.ts — thin OpenRouter HTTP wrapper (primary cloud path)
 *   2. lib/llm-ollama.ts — local fallback against MAGISTER_LOCAL_OLLAMA_URL
 *   3. lib/receipts.ts — append-only JSONL writer to MAGISTER_RECEIPTS_DIR
 *   4. Re-implement the system-prompt builder + companion memory writeback
 *
 * Until then, this returns 501 with a clear message so the UI can render
 * a "feature pending" state instead of a silent failure.
 */
export async function registerChatRoutes(app: FastifyInstance, _db: MagisterDB): Promise<void> {
  app.post<{ Params: { id: string }; Body: { message: string; history?: Array<{ role: string; content: string }> } }>(
    "/magister/sessions/:id/chat",
    async (_req, reply) => {
      return reply.status(501).send({
        ok: false,
        error: "not_implemented",
        message: "Companion chat is pending the standalone LLM client. See server/routes/chat.ts.",
      });
    },
  );
}
