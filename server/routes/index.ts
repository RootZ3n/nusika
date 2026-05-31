import type { FastifyInstance } from "fastify";
import type { NusikaDB } from "../db.js";

import { registerHealthRoutes } from "./health.js";
import { registerModuleRoutes } from "./modules.js";
import { registerSessionRoutes } from "./sessions.js";
import { registerProgressRoutes } from "./progress.js";
import { registerMemoryRoutes } from "./memory.js";
import { registerCreativeRoutes } from "./creative.js";
import { registerConfigRoutes } from "./config.js";
import { registerChatRoutes } from "./chat.js";
import { registerVoiceRoutes } from "./voice.js";
import { registerShukhaAnumpaRoutes } from "./inkwell.js";
import { registerRecapRoutes } from "./recap.js";
import { registerLessonRoutes } from "./lessons.js";
import { registerDmRoutes } from "./dm.js";
import { registerDmNarrationRoutes } from "./dm-narration.js";
import { registerVoicesRoute } from "./voices.js";
import { registerChahtaAnumpaRoutes } from "./chahta-anumpa.js";

/**
 * Single source of truth for HTTP route registration.
 * Mirrors the peh-v2 routes/index.ts pattern: every mount happens here,
 * nowhere else. Add a new route file? Add an import + a call below.
 */
export async function registerAllRoutes(app: FastifyInstance, db: NusikaDB): Promise<void> {
  await registerHealthRoutes(app, db);
  await registerModuleRoutes(app, db);
  await registerSessionRoutes(app, db);
  await registerProgressRoutes(app, db);
  await registerMemoryRoutes(app, db);
  await registerCreativeRoutes(app, db);
  await registerConfigRoutes(app);
  await registerChatRoutes(app, db);
  await registerVoiceRoutes(app, db);
  await registerShukhaAnumpaRoutes(app, db);
  await registerRecapRoutes(app, db);
  await registerLessonRoutes(app, db);
  await registerDmRoutes(app, db);
  await registerDmNarrationRoutes(app, db);
  await registerVoicesRoute(app, db);
  await registerChahtaAnumpaRoutes(app);
}
