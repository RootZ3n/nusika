import type { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import type { MagisterDB } from "../db.js";
import { TEACHING_MODES, SESSION_DURATIONS, AGE_TRACKS } from "../db.js";

interface CompanionRich {
  id: string;
  name: string;
  accent_color?: string;
  [key: string]: unknown;
}

/**
 * Enrich a session row with module + companion display data and
 * a derived progress percentage. The web UI reads these fields directly.
 */
export function enrichSession(db: MagisterDB, s: Record<string, unknown>): Record<string, unknown> {
  const mod = db.getModule(s.module_id as string);
  let companion: CompanionRich | null = null;
  let companionsRich: CompanionRich[] = [];

  if (mod && typeof (mod as any).companions !== "string") {
    // db.getModule already JSON-parses companions to an array of strings (ids)
    // For display, fall back to using the id as the name if the rich data isn't loaded.
    const ids = (mod as any).companions as string[];
    companionsRich = ids.map(id => ({ id, name: id }));
  }

  if (s.companion_id) {
    companion = companionsRich.find(c => c.id === s.companion_id) ?? null;
  }

  const elapsed = (s.elapsed_seconds as number) ?? 0;
  const target = ((s.duration_target as number) ?? 600);
  return {
    ...s,
    module_name: (mod?.name as string) ?? (s.module_id as string),
    companion_name: companion?.name ?? (s.companion_id as string) ?? "Companion",
    companion_color: companion?.accent_color ?? null,
    progress: target > 0 ? Math.min(100, Math.round((elapsed / target) * 100)) : 0,
    last_summary: (s.session_summary as string) ?? null,
  };
}

export async function registerModuleRoutes(app: FastifyInstance, db: MagisterDB): Promise<void> {
  // GET /magister/modules — list all known subject modules + UI constants
  app.get("/magister/modules", async (_req, reply) => {
    return reply.send({
      ok: true,
      modules: db.listModules(),
      constants: {
        TEACHING_MODES,
        SESSION_DURATIONS,
        AGE_TRACKS,
      },
    });
  });

  // GET /magister/modules/:id — full module record incl. mastery spine
  app.get<{ Params: { id: string } }>("/magister/modules/:id", async (req, reply) => {
    const mod = db.getModule(req.params.id);
    if (!mod) return reply.status(404).send({ ok: false, error: "Module not found" });

    // If the config_path is on disk, attach the full curriculum config so the
    // UI can render companions, domains, and concepts without a second request.
    let config: Record<string, unknown> | null = null;
    if (mod.config_path) {
      try {
        const raw = await readFile(mod.config_path, "utf-8");
        config = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        /* config missing/unreadable — caller still gets the DB record */
      }
    }

    return reply.send({ ok: true, module: mod, config });
  });

  // POST /magister/modules/:id/install — flip the installed flag
  app.post<{ Params: { id: string } }>("/magister/modules/:id/install", async (req, reply) => {
    const ok = db.installModule(req.params.id);
    if (!ok) return reply.status(404).send({ ok: false, error: "Module not found" });
    return reply.send({ ok: true, module: db.getModule(req.params.id) });
  });
}
