import type { FastifyInstance } from "fastify";
import type { NusikaDB } from "../db.js";

const DEFAULT_USER = "default";

export async function registerProgressRoutes(app: FastifyInstance, db: NusikaDB): Promise<void> {
  // GET /nusika/progress/:moduleId — concept-level mastery + exam readiness
  app.get<{ Params: { moduleId: string }; Querystring: { user_id?: string } }>(
    "/nusika/progress/:moduleId",
    async (req, reply) => {
      const userId = req.query?.user_id ?? DEFAULT_USER;
      return reply.send({
        ok: true,
        progress: db.getModuleProgress(userId, req.params.moduleId),
        readiness: db.computeExamReadiness(userId, req.params.moduleId),
      });
    },
  );

  // GET /nusika/reaffirmations — concepts past their next_reaffirm date
  app.get<{ Querystring: { user_id?: string } }>(
    "/nusika/reaffirmations",
    async (req, reply) => {
      const userId = req.query?.user_id ?? DEFAULT_USER;
      return reply.send({ ok: true, due: db.getDueReaffirmations(userId) });
    },
  );
}
