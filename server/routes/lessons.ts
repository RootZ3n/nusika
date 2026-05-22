/**
 * Lessons — Teach Me Anything mode (Varros).
 *
 * Lessons are open-ended Varros conversations that don't bind to any
 * curriculum module, concept, or companion. The route layer owns
 * validation; db.ts owns persistence.
 *
 * Endpoints under /magister/lessons:
 *   POST   /magister/lessons              create
 *   GET    /magister/lessons              list (most recent first)
 *   GET    /magister/lessons/:id          detail with recent turns
 *   PATCH  /magister/lessons/:id          update depth/status/title
 *   POST   /magister/lessons/:id/chat     Varros turn — persists user + assistant
 *   POST   /magister/lessons/:id/recap    rolling summary update (strict JSON)
 *
 * Plus the lookup placeholder:
 *   POST   /magister/lookup               returns { supported: false } today
 *
 * The lookup placeholder is intentional: Varros may surface "I'd want to
 * look this up" in chat, and a real lookup backend can be plugged into this
 * single route later. We do NOT fake browsing today.
 */

import type { FastifyInstance } from "fastify";
import {
  type MagisterDB,
  type LessonDepth,
  type LessonStatus,
  type MagisterLessonTurn,
  LESSON_DEPTHS,
  LESSON_STATUSES,
} from "../db.js";
import { complete, type CompletionMessage } from "../lib/llm.js";
import { writeReceipt } from "../lib/receipts.js";
import { buildVarrosTeachPrompt, turnsToMessages } from "../lib/varros-prompt.js";

const DEPTH_SET = new Set<LessonDepth>(LESSON_DEPTHS);
const STATUS_SET = new Set<LessonStatus>(LESSON_STATUSES);

interface CreateLessonBody { title?: string; topic?: string; depth?: string }
interface PatchLessonBody { title?: string; depth?: string; status?: string }
interface ChatBody { message?: string; depth?: string }
interface RecapBody { model?: string }
interface LookupBody { query?: string; mode?: string }

const RECAP_SYSTEM_PROMPT = [
  "You produce a JSON-only rolling summary of a Magister Teach Me Anything lesson.",
  "Output exactly one JSON object with this shape and nothing else:",
  "{",
  '  "summary": string,           // 2-4 sentence rolling synopsis of what has been taught',
  '  "knowledge": {',
  '    "covered":   string[],     // topics that have been explained',
  '    "practiced": string[],     // topics the learner has actively worked on',
  '    "stuck":     string[]      // topics the learner showed confusion on',
  "  }",
  "}",
  "",
  "Rules:",
  "- Output ONLY the JSON object — no prose, no code fences, no commentary.",
  "- Use only what the provided turns clearly support; do not invent learner traits.",
  "- Do not include personal/sensitive speculation about the learner.",
  "- Empty arrays are fine; an empty summary is not — write at least one sentence.",
].join("\n");

interface RecapShape {
  summary: string;
  knowledge: { covered: string[]; practiced: string[]; stuck: string[] };
}

function validateRecapShape(x: unknown): x is RecapShape {
  if (!x || typeof x !== "object") return false;
  const obj = x as Record<string, unknown>;
  if (typeof obj.summary !== "string" || obj.summary.trim() === "") return false;
  if (!obj.knowledge || typeof obj.knowledge !== "object") return false;
  const k = obj.knowledge as Record<string, unknown>;
  for (const key of ["covered", "practiced", "stuck"] as const) {
    if (!Array.isArray(k[key])) return false;
    if (!(k[key] as unknown[]).every(v => typeof v === "string")) return false;
  }
  return true;
}

function unfence(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? fenced[1]!.trim() : trimmed;
}

function turnToMsg(t: MagisterLessonTurn): CompletionMessage | null {
  if (t.role === "tool") return null; // tool turns aren't replayed back to the model today
  return { role: t.role, content: t.content };
}

export async function registerLessonRoutes(app: FastifyInstance, db: MagisterDB): Promise<void> {
  // ── POST /magister/lessons — create ───────────────────────────────────────
  app.post<{ Body: CreateLessonBody }>("/magister/lessons", async (req, reply) => {
    const body = req.body ?? {};
    const title = (body.title ?? "").trim();
    if (!title) return reply.status(400).send({ ok: false, error: "title required" });

    if (body.depth !== undefined && !DEPTH_SET.has(body.depth as LessonDepth)) {
      return reply.status(400).send({ ok: false, error: `depth must be one of: ${LESSON_DEPTHS.join(", ")}` });
    }

    const lesson = db.createLesson({
      title,
      ...(body.topic ? { topic: body.topic } : {}),
      ...(body.depth ? { depth: body.depth as LessonDepth } : {}),
    });
    return reply.status(201).send({ ok: true, lesson });
  });

  // ── GET /magister/lessons — list ──────────────────────────────────────────
  app.get<{ Querystring: { limit?: string } }>("/magister/lessons", async (req, reply) => {
    const limitRaw = req.query?.limit ? Number.parseInt(req.query.limit, 10) : NaN;
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 50;
    const lessons = db.listLessons({ limit });
    return reply.send({ ok: true, lessons });
  });

  // ── GET /magister/lessons/:id — detail with recent turns ─────────────────
  app.get<{ Params: { id: string } }>("/magister/lessons/:id", async (req, reply) => {
    const lesson = db.getLesson(req.params.id);
    if (!lesson) return reply.status(404).send({ ok: false, error: "Lesson not found" });
    const turns = db.getLessonTurns(req.params.id);
    return reply.send({ ok: true, lesson, turns });
  });

  // ── DELETE /magister/lessons/:id — hard delete (turns cascade) ───────────
  app.delete<{ Params: { id: string } }>("/magister/lessons/:id", async (req, reply) => {
    if (!db.getLesson(req.params.id)) {
      return reply.status(404).send({ ok: false, error: "Lesson not found" });
    }
    const removed = db.deleteLesson(req.params.id);
    if (!removed) return reply.status(404).send({ ok: false, error: "Lesson not found" });
    return reply.send({ ok: true, deleted: true, id: req.params.id });
  });

  // ── PATCH /magister/lessons/:id — depth/status/title ─────────────────────
  app.patch<{ Params: { id: string }; Body: PatchLessonBody }>(
    "/magister/lessons/:id",
    async (req, reply) => {
      const existing = db.getLesson(req.params.id);
      if (!existing) return reply.status(404).send({ ok: false, error: "Lesson not found" });

      const body = req.body ?? {};
      if (body.depth !== undefined && !DEPTH_SET.has(body.depth as LessonDepth)) {
        return reply.status(400).send({ ok: false, error: `depth must be one of: ${LESSON_DEPTHS.join(", ")}` });
      }
      if (body.status !== undefined && !STATUS_SET.has(body.status as LessonStatus)) {
        return reply.status(400).send({ ok: false, error: `status must be one of: ${LESSON_STATUSES.join(", ")}` });
      }
      if (body.title !== undefined && body.title.trim() === "") {
        return reply.status(400).send({ ok: false, error: "title cannot be empty" });
      }

      const lesson = db.patchLesson(req.params.id, {
        ...(body.title !== undefined ? { title: body.title.trim() } : {}),
        ...(body.depth !== undefined ? { depth: body.depth as LessonDepth } : {}),
        ...(body.status !== undefined ? { status: body.status as LessonStatus } : {}),
      });
      return reply.send({ ok: true, lesson });
    },
  );

  // ── POST /magister/lessons/:id/chat — Varros turn ────────────────────────
  app.post<{ Params: { id: string }; Body: ChatBody }>(
    "/magister/lessons/:id/chat",
    async (req, reply) => {
      const lesson = db.getLesson(req.params.id);
      if (!lesson) return reply.status(404).send({ ok: false, error: "Lesson not found" });

      const body = req.body ?? {};
      const message = (body.message ?? "").trim();
      if (!message) return reply.status(400).send({ ok: false, error: "message required" });

      let depth: LessonDepth = lesson.depth;
      if (body.depth !== undefined) {
        if (!DEPTH_SET.has(body.depth as LessonDepth)) {
          return reply.status(400).send({ ok: false, error: `depth must be one of: ${LESSON_DEPTHS.join(", ")}` });
        }
        depth = body.depth as LessonDepth;
        // Persist the depth change so subsequent turns inherit it.
        if (depth !== lesson.depth) db.patchLesson(lesson.id, { depth });
      }

      // 1. Persist the user turn FIRST so a downstream LLM failure leaves a
      //    visible question in the transcript rather than a silent gap.
      db.addLessonTurn({
        lessonId: lesson.id,
        role: "user",
        content: message,
        depthAt: depth,
      });

      // 2. Build the prompt from prior turns (we just appended the user's
      //    message, so include it in the history).
      const prior = db.getLessonTurns(lesson.id, { limit: 30 })
        .map(turnToMsg)
        .filter((m): m is CompletionMessage => m !== null);
      const systemPrompt = buildVarrosTeachPrompt({
        title: lesson.title,
        topic: lesson.topic,
        depth,
        summary: lesson.summary,
        recentTurns: turnsToMessages(prior.map(m => ({ role: m.role as "user" | "assistant", content: m.content }))),
      });
      const messages: CompletionMessage[] = [
        { role: "system", content: systemPrompt },
        ...prior.slice(-12),
      ];

      // 3. Call the LLM. On failure, do NOT persist a fake assistant turn.
      try {
        const result = await complete({
          messages,
          maxTokens: 800,
          temperature: 0.6,
          reason: `magister:lesson:chat:${lesson.id}`,
        });

        const turn = db.addLessonTurn({
          lessonId: lesson.id,
          role: "assistant",
          content: result.text,
          depthAt: depth,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
          model: result.model,
          provider: result.provider,
        });

        void writeReceipt({
          componentType: "model-call",
          componentName: "magister-lesson-chat",
          reason: "magister:lesson:chat",
          status: "success",
          model: result.model,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
          estimatedCostUsd: result.estimatedCostUsd,
          durationMs: result.durationMs,
          meta: { lessonId: lesson.id, depth, provider: result.provider, turnId: turn.id },
        });

        return reply.send({
          ok: true,
          turn,
          text: result.text,
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
          componentName: "magister-lesson-chat",
          reason: "magister:lesson:chat",
          status: "failure",
          meta: { lessonId: lesson.id, depth, error: detail },
        });
        return reply.status(502).send({
          ok: false,
          error: "Lesson chat is unavailable: no LLM backend reachable.",
          detail,
        });
      }
    },
  );

  // ── POST /magister/lessons/:id/recap — rolling summary update ─────────────
  app.post<{ Params: { id: string }; Body: RecapBody }>(
    "/magister/lessons/:id/recap",
    async (req, reply) => {
      const lesson = db.getLesson(req.params.id);
      if (!lesson) return reply.status(404).send({ ok: false, error: "Lesson not found" });

      const turns = db.getLessonTurns(lesson.id, { limit: 60 });
      if (turns.length === 0) {
        return reply.status(400).send({ ok: false, error: "Cannot recap a lesson with no turns yet." });
      }

      const conversation = turns
        .filter(t => t.role !== "tool")
        .map(t => `[${t.role}${t.depth_at ? `:${t.depth_at}` : ""}] ${t.content}`)
        .join("\n\n");
      const userTurn =
        `Lesson title: ${lesson.title}\nTopic: ${lesson.topic}\n` +
        (lesson.summary ? `Prior summary: ${lesson.summary}\n` : "") +
        `\nConversation:\n${conversation}`;

      let raw = "";
      let result;
      try {
        result = await complete({
          messages: [
            { role: "system", content: RECAP_SYSTEM_PROMPT },
            { role: "user", content: userTurn },
          ],
          ...(req.body?.model ? { model: req.body.model } : {}),
          maxTokens: 600,
          temperature: 0.2,
          reason: `magister:lesson:recap:${lesson.id}`,
        });
        raw = result.text;
      } catch (err) {
        const detail = (err instanceof Error ? err.message : String(err)).slice(0, 300);
        void writeReceipt({
          componentType: "model-call",
          componentName: "magister-lesson-recap",
          reason: "magister:lesson:recap",
          status: "failure",
          meta: { lessonId: lesson.id, error: detail, stage: "llm" },
        });
        return reply.status(502).send({
          ok: false,
          error: "Lesson recap is unavailable: no LLM backend reachable.",
          detail,
        });
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(unfence(raw));
      } catch (err) {
        void writeReceipt({
          componentType: "model-call",
          componentName: "magister-lesson-recap",
          reason: "magister:lesson:recap",
          status: "failure",
          model: result.model,
          meta: { lessonId: lesson.id, stage: "json-parse", error: String(err).slice(0, 200) },
        });
        return reply.status(502).send({
          ok: false,
          error: "Recap LLM did not return valid JSON.",
          detail: (err instanceof Error ? err.message : String(err)).slice(0, 200),
          raw: raw.slice(0, 400),
        });
      }

      if (!validateRecapShape(parsed)) {
        void writeReceipt({
          componentType: "model-call",
          componentName: "magister-lesson-recap",
          reason: "magister:lesson:recap",
          status: "failure",
          model: result.model,
          meta: { lessonId: lesson.id, stage: "schema-validate" },
        });
        return reply.status(422).send({
          ok: false,
          error: "Recap JSON failed schema validation; nothing was persisted.",
          raw: raw.slice(0, 400),
        });
      }

      db.updateLessonSummary(lesson.id, parsed.summary, parsed.knowledge);
      void writeReceipt({
        componentType: "model-call",
        componentName: "magister-lesson-recap",
        reason: "magister:lesson:recap",
        status: "success",
        model: result.model,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        estimatedCostUsd: result.estimatedCostUsd,
        durationMs: result.durationMs,
        meta: { lessonId: lesson.id, provider: result.provider },
      });
      return reply.send({
        ok: true,
        summary: parsed.summary,
        knowledge: parsed.knowledge,
        model: result.model,
        provider: result.provider,
        durationMs: result.durationMs,
      });
    },
  );

  // ── POST /magister/lookup — placeholder (intentional) ─────────────────────
  // Varros may say "a lookup would help here" in chat. This route gives the
  // architecture a single hook to plug a real research backend into later.
  // It does NOT browse, search, or fetch external content today.
  app.post<{ Body: LookupBody }>("/magister/lookup", async (req, reply) => {
    const query = (req.body?.query ?? "").toString().slice(0, 500);
    return reply.send({
      ok: true,
      supported: false,
      reason: "Lookup is not wired yet. Magister does not browse, search, or fetch external content. " +
              "Plug a real backend into POST /magister/lookup to enable this.",
      echo: { query, mode: req.body?.mode ?? null },
    });
  });
}
