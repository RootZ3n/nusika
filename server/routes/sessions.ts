import type { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import type { NusikaDB, TeachingMode, HintLevel } from "../db.js";
import { enrichSession } from "./modules.js";

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
