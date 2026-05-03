/**
 * Magister Server — Fastify on MAGISTER_PORT (default 18793).
 *
 * Boots the SQLite layer, scans the curriculum directory to register every
 * subject module config, mounts all routes, and listens.
 *
 * Originally lived inside squidley-v2 as an experience module; extracted
 * to standalone in May 2026. Squidley calls this server over HTTP via
 * MAGISTER_URL (default http://127.0.0.1:18793).
 */

import Fastify from "fastify";
import { MagisterDB } from "./db.js";
import { scanCurriculum } from "./curriculum.js";
import { registerAllRoutes } from "./routes/index.js";
import { dbPath, curriculumDir } from "./lib/paths.js";
import { consoleLogger } from "./lib/log.js";

const PORT = Number.parseInt(process.env["MAGISTER_PORT"] ?? "18793", 10);
const HOST = process.env["MAGISTER_HOST"] ?? "127.0.0.1";
const ALLOW_PUBLIC_BIND = process.env["MAGISTER_ALLOW_PUBLIC_BIND"] === "true";

if (!HOST.startsWith("127.") && HOST !== "localhost" && !ALLOW_PUBLIC_BIND) {
  consoleLogger.error(
    `refusing to bind to ${HOST}: set MAGISTER_ALLOW_PUBLIC_BIND=true to expose magister on a non-loopback interface`,
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const isProd = process.env["NODE_ENV"] === "production";
  const loggerOpts: Record<string, unknown> = {
    level: process.env["MAGISTER_LOG_LEVEL"] ?? "info",
  };
  if (!isProd) {
    loggerOpts.transport = { target: "pino-pretty", options: { colorize: true } };
  }
  const app = Fastify({
    logger: loggerOpts,
    bodyLimit: 10 * 1024 * 1024, // 10 MB — generous enough for resume/audio uploads
  });

  // Permissive CORS for now — locked down later when we know the production caller set.
  app.addHook("onRequest", async (req, reply) => {
    reply.header("Access-Control-Allow-Origin", req.headers.origin ?? "*");
    reply.header("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
    reply.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      return reply.status(204).send();
    }
  });

  const db = new MagisterDB(dbPath());
  consoleLogger.info(`db opened at ${dbPath()}`);

  const scanned = await scanCurriculum(db, curriculumDir(), consoleLogger);
  consoleLogger.info(`curriculum scan complete — ${scanned} modules registered`);

  await registerAllRoutes(app, db);

  const shutdown = async (signal: string): Promise<void> => {
    consoleLogger.info(`received ${signal}, shutting down`);
    try {
      await app.close();
      db.close();
    } catch (err) {
      consoleLogger.error(`shutdown error: ${String(err)}`);
    } finally {
      process.exit(0);
    }
  };

  process.on("SIGINT", () => { void shutdown("SIGINT"); });
  process.on("SIGTERM", () => { void shutdown("SIGTERM"); });

  try {
    await app.listen({ port: PORT, host: HOST });
    consoleLogger.info(`listening on http://${HOST}:${PORT}`);
  } catch (err) {
    consoleLogger.error(`failed to bind ${HOST}:${PORT}: ${String(err)}`);
    db.close();
    process.exit(1);
  }
}

main().catch((err) => {
  consoleLogger.error(`fatal: ${String(err)}`);
  process.exit(1);
});
