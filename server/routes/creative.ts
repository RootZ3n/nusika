import type { FastifyInstance } from "fastify";
import type { NusikaDB } from "../db.js";

export async function registerCreativeRoutes(app: FastifyInstance, db: NusikaDB): Promise<void> {
  // GET /nusika/creative/:moduleId — saved creative works for a module
  app.get<{ Params: { moduleId: string } }>(
    "/nusika/creative/:moduleId",
    async (req, reply) => {
      return reply.send({ ok: true, works: db.getCreativeWorks(req.params.moduleId) });
    },
  );

  // POST /nusika/creative/:moduleId — save a new creative work
  app.post<{ Params: { moduleId: string }; Body: { title: string; content: string } }>(
    "/nusika/creative/:moduleId",
    async (req, reply) => {
      const { title, content } = req.body ?? {};
      if (!title || !content) {
        return reply.status(400).send({ ok: false, error: "title and content required" });
      }
      return reply.send({ ok: true, work: db.saveCreativeWork(req.params.moduleId, { title, content }) });
    },
  );
}
