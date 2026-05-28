/**
 * Shukha Anumpa — story/tale drafts persistence + writing-guide feedback.
 *
 * Formerly "Inkwell". Renamed to Shukha Anumpa (a fable, story, tale) as
 * part of the Nusika mythology rename. The DB module_id stays "inkwell"
 * for backward compatibility with existing saved data.
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
 * Feedback calls go through lib/llm.ts complete() with a Peh-shaped
 * editor prompt. If no LLM backend is configured/reachable, the route
 * returns 502 with a clear error — never a fake "feedback received".
 *
 * Identity note: the Shukha Anumpa companion used to be Maren, with an
 * ElevenLabs voice. The 2026-05 rebind switched the config to Peh (the
 * same persona that narrates Ittunaha, /teach, and /dm) on a local
 * Kokoro voice. The system prompt below was rewritten to match.
 * Old companion-memory rows keyed by "maren" are left in place — the
 * registry no longer surfaces Maren as a companion so they are simply
 * unreferenced, not migrated.
 */

import type { FastifyInstance } from "fastify";
import type { NusikaDB, NusikaCreative } from "../db.js";
import { complete } from "../lib/llm.js";
import { writeReceipt } from "../lib/receipts.js";

/** DB module_id — kept as "inkwell" for backward compat with saved data. */
const INKWELL_MODULE = "inkwell";

const EDITOR_SYSTEM_PROMPT =
  "You are Peh, the Nusika narrator acting as story guide and writing companion. " +
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

function toDraftDTO(row: NusikaCreative): DraftDTO {
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

export async function registerShukhaAnumpaRoutes(app: FastifyInstance, db: NusikaDB): Promise<void> {
  // ── Handlers ────────────────────────────────────────────────────────────
  // Defined once, registered under both /nusika/shukha-anumpa/* (canonical)
  // and /nusika/inkwell/* (backward compat alias).

  const listDrafts = async (_req: unknown, reply: import("fastify").FastifyReply) => {
    const works = db.getCreativeWorks(INKWELL_MODULE);
    return reply.send({ ok: true, drafts: works.map(toDraftDTO) });
  };

  const getDraft = async (req: import("fastify").FastifyRequest<{ Params: { id: string } }>, reply: import("fastify").FastifyReply) => {
    const work = db.getCreativeWork(req.params.id);
    if (!work || work.module_id !== INKWELL_MODULE) {
      return reply.status(404).send({ ok: false, error: "Draft not found" });
    }
    return reply.send({ ok: true, draft: toDraftDTO(work) });
  };

  const deleteDraft = async (req: import("fastify").FastifyRequest<{ Params: { id: string } }>, reply: import("fastify").FastifyReply) => {
    const work = db.getCreativeWork(req.params.id);
    if (!work || work.module_id !== INKWELL_MODULE) {
      return reply.status(404).send({ ok: false, error: "Draft not found" });
    }
    const removed = db.deleteCreativeWork(req.params.id);
    if (!removed) return reply.status(404).send({ ok: false, error: "Draft not found" });
    return reply.send({ ok: true, deleted: true, id: req.params.id });
  };

  const upsertDraft = async (req: import("fastify").FastifyRequest<{ Body: UpsertBody }>, reply: import("fastify").FastifyReply) => {
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
  };

  const postFeedback = async (req: import("fastify").FastifyRequest<{ Body: FeedbackBody }>, reply: import("fastify").FastifyReply) => {
    const body = req.body ?? ({} as FeedbackBody);
    if (typeof body.content !== "string" || body.content.trim() === "") {
      return reply.status(400).send({ ok: false, error: "content required" });
    }

    const userTurn = [
      body.title ? `Title: ${body.title}` : null,
      body.context ? `Context: ${body.context}` : null,
      "Draft:",
      body.content.slice(0, 8000),
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
        reason: "nusika:shukha-anumpa:feedback",
      });

      void writeReceipt({
        componentType: "model-call",
        componentName: "nusika-shukha-anumpa-feedback",
        reason: "nusika:shukha-anumpa:feedback",
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
        componentName: "nusika-shukha-anumpa-feedback",
        reason: "nusika:shukha-anumpa:feedback",
        status: "failure",
        meta: { error: detail, inputLength: body.content.length },
      });
      return reply.status(502).send({
        ok: false,
        error: "Shukha Anumpa feedback is unavailable: no LLM backend reachable.",
        detail,
      });
    }
  };

  // ── Route registration ──────────────────────────────────────────────────
  // Canonical paths: /nusika/shukha-anumpa/*
  app.get("/nusika/shukha-anumpa/drafts", listDrafts);
  app.get<{ Params: { id: string } }>("/nusika/shukha-anumpa/drafts/:id", getDraft);
  app.delete<{ Params: { id: string } }>("/nusika/shukha-anumpa/drafts/:id", deleteDraft);
  app.post<{ Body: UpsertBody }>("/nusika/shukha-anumpa/drafts", upsertDraft);
  app.post<{ Body: FeedbackBody }>("/nusika/shukha-anumpa/feedback", postFeedback);

  // Backward-compat aliases: /nusika/inkwell/* (old clients, old bookmarks)
  app.get("/nusika/inkwell/drafts", listDrafts);
  app.get<{ Params: { id: string } }>("/nusika/inkwell/drafts/:id", getDraft);
  app.delete<{ Params: { id: string } }>("/nusika/inkwell/drafts/:id", deleteDraft);
  app.post<{ Body: UpsertBody }>("/nusika/inkwell/drafts", upsertDraft);
  app.post<{ Body: FeedbackBody }>("/nusika/inkwell/feedback", postFeedback);
}
