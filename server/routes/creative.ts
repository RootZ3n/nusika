import type { FastifyInstance } from "fastify";
import type { MagisterDB } from "../db.js";

export async function registerCreativeRoutes(app: FastifyInstance, db: MagisterDB): Promise<void> {
  // GET /magister/creative/:moduleId — saved creative works for a module
  app.get<{ Params: { moduleId: string } }>(
    "/magister/creative/:moduleId",
    async (req, reply) => {
      return reply.send({ ok: true, works: db.getCreativeWorks(req.params.moduleId) });
    },
  );

  // POST /magister/creative/:moduleId — save a new creative work
  app.post<{ Params: { moduleId: string }; Body: { title: string; content: string } }>(
    "/magister/creative/:moduleId",
    async (req, reply) => {
      const { title, content } = req.body ?? {};
      if (!title || !content) {
        return reply.status(400).send({ ok: false, error: "title and content required" });
      }
      return reply.send({ ok: true, work: db.saveCreativeWork(req.params.moduleId, { title, content }) });
    },
  );
}
