import type { FastifyInstance } from "fastify";
import type { MagisterDB } from "../db.js";

export async function registerHealthRoutes(app: FastifyInstance, db: MagisterDB): Promise<void> {
  // GET /health — top-level liveness for monitors
  app.get("/health", async (_req, reply) => {
    const timestamp = new Date().toISOString();
    try {
      const installed = db.installedCount();
      return reply.send({
        ok: true,
        status: "healthy",
        detail: `magister DB reachable; ${installed} module${installed === 1 ? "" : "s"} installed`,
        installedCount: installed,
        timestamp,
      });
    } catch (err) {
      return reply.status(503).send({
        ok: false,
        status: "degraded",
        detail: `DB probe threw: ${String(err).slice(0, 200)}`,
        timestamp,
      });
    }
  });

  // GET /magister/health — same payload, /magister-prefixed for proxy parity
  app.get("/magister/health", async (_req, reply) => {
    const timestamp = new Date().toISOString();
    try {
      const modules = db.listModules();
      return reply.send({
        ok: true,
        status: "healthy",
        detail: `magister service reachable; ${modules.length} module${modules.length === 1 ? "" : "s"} registered`,
        moduleCount: modules.length,
        timestamp,
      });
    } catch (err) {
      return reply.status(503).send({
        ok: false,
        status: "degraded",
        detail: `magister DB probe threw: ${String(err).slice(0, 200)}`,
        timestamp,
      });
    }
  });
}
