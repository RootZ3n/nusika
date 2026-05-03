import type { FastifyInstance } from "fastify";
import type { MagisterDB, CompanionMemoryWriteback } from "../db.js";

export async function registerMemoryRoutes(app: FastifyInstance, db: MagisterDB): Promise<void> {
  // GET /magister/memory/:companionId — list a companion's memories of a learner
  app.get<{ Params: { companionId: string } }>(
    "/magister/memory/:companionId",
    async (req, reply) => {
      return reply.send({ ok: true, memories: db.getCompanionMemories(req.params.companionId) });
    },
  );

  // POST /magister/memory/:companionId — schema-validated companion writeback
  app.post<{ Params: { companionId: string }; Body: CompanionMemoryWriteback }>(
    "/magister/memory/:companionId",
    async (req, reply) => {
      try {
        const memories = db.saveCompanionMemory(req.params.companionId, req.body);
        return reply.send({ ok: true, memories });
      } catch (err) {
        return reply.status(400).send({ ok: false, error: String(err) });
      }
    },
  );
}
