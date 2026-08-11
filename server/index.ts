/**
 * Nusika Server — Fastify on NUSIKA_PORT (default 18793).
 *
 * Boots the SQLite layer, scans the curriculum directory to register every
 * subject module config, mounts all routes, and listens.
 *
 * Originally lived inside peh-v2 as an experience module; extracted
 * to standalone in May 2026. Peh calls this server over HTTP via
 * NUSIKA_URL (default http://127.0.0.1:18793).
 */

import Fastify from "fastify";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { velumFastify } from "velum-ai/adapters/fastify";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { NusikaDB } from "./db.js";
import { scanCurriculum } from "./curriculum.js";
import { registerAllRoutes } from "./routes/index.js";
import { dbPath, curriculumDir, projectRoot } from "./lib/paths.js";
import { consoleLogger } from "./lib/log.js";
import { nenv } from "./lib/env.js";

const PORT = Number.parseInt(nenv("PORT", "18793")!, 10);
const HOST = nenv("HOST", "127.0.0.1")!;
const ALLOW_PUBLIC_BIND = (process.env["NUSIKA_ALLOW_PUBLIC_BIND"] ?? process.env["MAGISTER_ALLOW_PUBLIC_BIND"]) === "true";

if (!HOST.startsWith("127.") && HOST !== "localhost" && !ALLOW_PUBLIC_BIND) {
  consoleLogger.error(
    `refusing to bind to ${HOST}: set NUSIKA_ALLOW_PUBLIC_BIND=true to expose nusika on a non-loopback interface`,
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const isProd = process.env["NODE_ENV"] === "production";
  const loggerOpts: Record<string, unknown> = {
    level: nenv("LOG_LEVEL", "info"),
  };
  if (!isProd) {
    loggerOpts.transport = { target: "pino-pretty", options: { colorize: true } };
  }
  const app = Fastify({
    logger: loggerOpts,
    bodyLimit: 10 * 1024 * 1024, // 10 MB — generous enough for resume/audio uploads
    rewriteUrl: (req) => {
      const url = req.url ?? "";
      if (url.startsWith("/magister/")) {
        return "/nusika/" + url.slice("/magister/".length);
      }
      return url;
    },
  });

  // Velum: AI privacy/injection defense middleware
  velumFastify(app, { defaultPiiLevel: 2 });

  // Permissive CORS for now — locked down later when we know the production caller set.
  app.addHook("onRequest", async (req, reply) => {
    reply.header("Access-Control-Allow-Origin", req.headers.origin ?? "*");
    reply.header("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
    reply.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      return reply.status(204).send();
    }
  });

  // Multipart support for STT audio uploads. 25 MB ceiling — whisper-cli
  // chokes on much larger inputs anyway and we don't want to buffer arbitrary
  // payloads in memory.
  await app.register(multipart, {
    limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 5 },
  });

  const db = new NusikaDB(dbPath());
  consoleLogger.info(`db opened at ${dbPath()}`);

  const scanned = await scanCurriculum(db, curriculumDir(), consoleLogger);
  consoleLogger.info(`curriculum scan complete — ${scanned} modules registered`);

  await registerAllRoutes(app, db);

  // Serve the world-engine UI from the repo's ui/ directory.
  const uiDir = join(projectRoot(), "ui");
  if (existsSync(join(uiDir, "index.html"))) {
    await app.register(fastifyStatic, {
      root: uiDir,
      prefix: "/",
      decorateReply: false,
    });
    consoleLogger.info(`UI served from ${uiDir}`);
  }

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
