/**
 * Inkwell — drafts persistence + writing-guide feedback.
 *
 * Drafts piggyback on the existing magister_creative table, keyed by
 * module_id="inkwell". This avoids a new table and inherits the
 * created_at/updated_at + user_id machinery the creative routes already
 * use. Field mapping:
 *
 *   draft.id          ↔ magister_creative.id
 *   draft.title       ↔ magister_creative.title
 *   draft.content     ↔ magister_creative.content
 *   draft.feedback    ↔ magister_creative.companion_feedback
 *   draft.createdAt   ↔ magister_creative.created_at (ISO string)
 *   draft.updatedAt   ↔ magister_creative.updated_at (ISO string)
 *
 * Feedback calls go through lib/llm.ts complete() with a Varros-shaped
 * editor prompt. If no LLM backend is configured/reachable, the route
 * returns 502 with a clear error — never a fake "feedback received".
 *
 * Identity note: the Inkwell companion used to be Maren, with an
 * ElevenLabs voice. The 2026-05 rebind switched the Inkwell config to
 * Varros (the same persona that narrates the Hall, /teach, and /dm) on
 * a local Kokoro voice. The system prompt below was rewritten to match.
 * Old companion-memory rows keyed by "maren" are left in place — the
 * registry no longer surfaces Maren as a companion so they are simply
 * unreferenced, not migrated.
 */

import type { FastifyInstance } from "fastify";
import type { MagisterDB, MagisterCreative } from "../db.js";
import { complete } from "../lib/llm.js";
import { writeReceipt } from "../lib/receipts.js";

const INKWELL_MODULE = "inkwell";

const EDITOR_SYSTEM_PROMPT =
  "You are Varros, the Magister narrator acting as senior editor and writing guide. " +
  "Read carefully and respond as a thoughtful editor: what works, what doesn't, what " +
  "you want to know more about. Celebrate strong sentences specifically. Ask one " +
  "focused question. Direct, honest, no false encouragement. One piece of feedback at " +
  "a time. Keep your response to 2-4 short paragraphs.";

interface DraftDTO {
  id: string;
  title: string | null;
  content: string | null;
  feedback: string | null;
  createdAt: string;
  updatedAt: string;
}

function toDraftDTO(row: MagisterCreative): DraftDTO {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    feedback: row.companion_feedback,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface UpsertBody {
  id?: string;
  title?: string;
  content: string;
  feedback?: string;
}

interface FeedbackBody {
  content: string;
  title?: string;
  context?: string;
  model?: string;
}

export async function registerInkwellRoutes(app: FastifyInstance, db: MagisterDB): Promise<void> {
  // GET /magister/inkwell/drafts — list all drafts for the default user
  app.get("/magister/inkwell/drafts", async (_req, reply) => {
    const works = db.getCreativeWorks(INKWELL_MODULE);
    return reply.send({ ok: true, drafts: works.map(toDraftDTO) });
  });

  // GET /magister/inkwell/drafts/:id — single draft (404 if missing or wrong module)
  app.get<{ Params: { id: string } }>("/magister/inkwell/drafts/:id", async (req, reply) => {
    const work = db.getCreativeWork(req.params.id);
    if (!work || work.module_id !== INKWELL_MODULE) {
      return reply.status(404).send({ ok: false, error: "Draft not found" });
    }
    return reply.send({ ok: true, draft: toDraftDTO(work) });
  });

  // DELETE /magister/inkwell/drafts/:id — hard delete a draft.
  // Verifies the row belongs to module_id="inkwell" so this route cannot
  // be used to delete creative work owned by another module.
  app.delete<{ Params: { id: string } }>("/magister/inkwell/drafts/:id", async (req, reply) => {
    const work = db.getCreativeWork(req.params.id);
    if (!work || work.module_id !== INKWELL_MODULE) {
      return reply.status(404).send({ ok: false, error: "Draft not found" });
    }
    const removed = db.deleteCreativeWork(req.params.id);
    if (!removed) return reply.status(404).send({ ok: false, error: "Draft not found" });
    return reply.send({ ok: true, deleted: true, id: req.params.id });
  });

  // POST /magister/inkwell/drafts — create or upsert a draft.
  // Provide `id` to update an existing draft; omit it to create a new one.
  app.post<{ Body: UpsertBody }>("/magister/inkwell/drafts", async (req, reply) => {
    const body = req.body ?? ({} as UpsertBody);
    if (typeof body.content !== "string" || body.content.trim() === "") {
      return reply.status(400).send({ ok: false, error: "content required" });
    }
    const title = typeof body.title === "string" && body.title.trim() !== ""
      ? body.title.trim()
      : (body.content.split("\n")[0] ?? "Untitled Draft").slice(0, 60);

    if (body.id) {
      const existing = db.getCreativeWork(body.id);
      if (!existing || existing.module_id !== INKWELL_MODULE) {
        return reply.status(404).send({ ok: false, error: "Draft not found" });
      }
      const ok = db.updateCreativeWork(body.id, {
        title,
        content: body.content,
        ...(body.feedback !== undefined ? { companion_feedback: body.feedback } : {}),
      });
      if (!ok) return reply.status(500).send({ ok: false, error: "update failed" });
      const updated = db.getCreativeWork(body.id);
      return reply.send({ ok: true, draft: updated ? toDraftDTO(updated) : null });
    }

    const created = db.saveCreativeWork(INKWELL_MODULE, {
      title,
      content: body.content,
      ...(body.feedback !== undefined ? { companionFeedback: body.feedback } : {}),
    });
    return reply.status(201).send({ ok: true, draft: toDraftDTO(created) });
  });

  // POST /magister/inkwell/feedback — Varros editorial feedback on a piece of writing.
  // Calls the configured LLM. If no backend is configured/reachable, returns 502.
  app.post<{ Body: FeedbackBody }>("/magister/inkwell/feedback", async (req, reply) => {
    const body = req.body ?? ({} as FeedbackBody);
    if (typeof body.content !== "string" || body.content.trim() === "") {
      return reply.status(400).send({ ok: false, error: "content required" });
    }

    const userTurn = [
      body.title ? `Title: ${body.title}` : null,
      body.context ? `Context: ${body.context}` : null,
      "Draft:",
      body.content.slice(0, 8000), // cap input length for safety
    ].filter(Boolean).join("\n\n");

    try {
      const result = await complete({
        messages: [
          { role: "system", content: EDITOR_SYSTEM_PROMPT },
          { role: "user", content: userTurn },
        ],
        ...(body.model ? { model: body.model } : {}),
        maxTokens: 600,
        temperature: 0.6,
        reason: "magister:inkwell:feedback",
      });

      void writeReceipt({
        componentType: "model-call",
        componentName: "magister-inkwell-feedback",
        reason: "magister:inkwell:feedback",
        status: "success",
        model: result.model,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        estimatedCostUsd: result.estimatedCostUsd,
        durationMs: result.durationMs,
        meta: { provider: result.provider, inputLength: body.content.length },
      });

      return reply.send({
        ok: true,
        feedback: result.text.trim(),
        model: result.model,
        provider: result.provider,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        durationMs: result.durationMs,
      });
    } catch (err) {
      const detail = (err instanceof Error ? err.message : String(err)).slice(0, 300);
      void writeReceipt({
        componentType: "model-call",
        componentName: "magister-inkwell-feedback",
        reason: "magister:inkwell:feedback",
        status: "failure",
        meta: { error: detail, inputLength: body.content.length },
      });
      // 502: the route reached us, but the upstream LLM provider failed.
      return reply.status(502).send({
        ok: false,
        error: "Inkwell feedback is unavailable: no LLM backend reachable.",
        detail,
      });
    }
  });
}
