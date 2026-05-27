import type { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import type { MagisterDB, MagisterModuleRecord } from "../db.js";
import { TEACHING_MODES, SESSION_DURATIONS, AGE_TRACKS } from "../db.js";

/**
 * Companion record as seen in the curriculum config.json files: an `id`,
 * a display `name`, optionally an accent color, and any other fields the
 * curriculum author wanted to ship. The route preserves the extra fields
 * verbatim for the UI to consume.
 */
interface CompanionRich {
  id: string;
  name: string;
  accent_color?: string;
  [key: string]: unknown;
}

/**
 * The shape `/magister/modules` returns to the UI: every public field of
 * MagisterModuleRecord, but with the bare `companions: string[]` replaced
 * by the enriched objects loaded from the on-disk config.
 */
interface EnrichedModule extends Omit<MagisterModuleRecord, "companions"> {
  companions: CompanionRich[];
}

function isCompanionRich(value: unknown): value is CompanionRich {
  if (typeof value !== "object" || value === null) return false;
  const id = (value as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0;
}

async function loadConfigCompanions(configPath: string | null): Promise<CompanionRich[]> {
  if (!configPath) return [];
  try {
    const raw = await readFile(configPath, "utf-8");
    const config = JSON.parse(raw) as { companions?: unknown };
    if (!Array.isArray(config.companions)) return [];
    // Drop string entries (legacy id-only shape) — the route only uses
    // the rich form for name/accent lookup; string ids resolve through
    // the fallback at the call site.
    return config.companions.filter(isCompanionRich);
  } catch (e) {
    console.error(`[modules] failed to read ${configPath}: ${e}`);
    return [];
  }
}

/**
 * Enrich a session row with module + companion display data and
 * a derived progress percentage. The web UI reads these fields directly.
 */
export function enrichSession(db: MagisterDB, s: Record<string, unknown>): Record<string, unknown> {
  const mod = db.getModule(s.module_id as string);
  let companion: CompanionRich | null = null;
  let companionsRich: CompanionRich[] = [];

  if (mod) {
    // For display, fall back to using the id as the name if the rich
    // curriculum config isn't loaded here. The /magister/modules route
    // does the full rich enrichment; this helper stays cheap.
    companionsRich = mod.companions.map(id => ({ id, name: id }));
  }

  if (s.companion_id) {
    companion = companionsRich.find(c => c.id === s.companion_id) ?? null;
  }

  const elapsed = (s.elapsed_seconds as number) ?? 0;
  const target = ((s.duration_target as number) ?? 600);
  return {
    ...s,
    module_name: mod?.name ?? (s.module_id as string),
    companion_name: companion?.name ?? (s.companion_id as string) ?? "Companion",
    companion_color: companion?.accent_color ?? null,
    progress: target > 0 ? Math.min(100, Math.round((elapsed / target) * 100)) : 0,
    last_summary: (s.session_summary as string) ?? null,
  };
}

export async function registerModuleRoutes(app: FastifyInstance, db: MagisterDB): Promise<void> {
  // GET /magister/modules — list all known subject modules + UI constants
  app.get("/magister/modules", async (_req, reply) => {
    const modules = db.listModules();
    // Enrich each module's bare companion-id list with the rich objects
    // sitting in its on-disk curriculum config. Unknown ids fall back to
    // `{ id, name: id }` so the UI always has something to render.
    const enriched: EnrichedModule[] = await Promise.all(
      modules.map(async (mod) => {
        const configCompanions = await loadConfigCompanions(mod.config_path);
        const companions: CompanionRich[] = mod.companions.map(id => {
          const found = configCompanions.find(c => c.id === id);
          return found ?? { id, name: id };
        });
        return { ...mod, companions };
      }),
    );
    return reply.send({
      ok: true,
      modules: enriched,
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
