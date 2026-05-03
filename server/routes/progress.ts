import type { FastifyInstance } from "fastify";
import type { MagisterDB } from "../db.js";

const DEFAULT_USER = "jeff";

export async function registerProgressRoutes(app: FastifyInstance, db: MagisterDB): Promise<void> {
  // GET /magister/progress/:moduleId — concept-level mastery + exam readiness
  app.get<{ Params: { moduleId: string }; Querystring: { user_id?: string } }>(
    "/magister/progress/:moduleId",
    async (req, reply) => {
      const userId = req.query?.user_id ?? DEFAULT_USER;
      return reply.send({
        ok: true,
        progress: db.getModuleProgress(userId, req.params.moduleId),
        readiness: db.computeExamReadiness(userId, req.params.moduleId),
      });
    },
  );

  // GET /magister/reaffirmations — concepts past their next_reaffirm date
  app.get<{ Querystring: { user_id?: string } }>(
    "/magister/reaffirmations",
    async (req, reply) => {
      const userId = req.query?.user_id ?? DEFAULT_USER;
      return reply.send({ ok: true, due: db.getDueReaffirmations(userId) });
    },
  );
}
