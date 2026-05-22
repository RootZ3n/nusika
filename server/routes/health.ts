import type { FastifyInstance } from "fastify";
import type { MagisterDB } from "../db.js";
import { kokoroHealth, kokoroBaseUrl } from "../lib/voices/kokoro.js";
import { loadLlmConfig } from "../lib/llm.js";

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

  // GET /magister/health/services — composite probe used by the web banner.
  //
  // Reports every sub-service the API depends on. Reaching this endpoint at
  // all is proof the API itself is up; the body breaks down DB, Kokoro and
  // LLM availability so the UI can render a "degraded" rather than "dead"
  // state. Probes are short-timeout and never throw — `ok` reflects whether
  // the API is in a USABLE state (DB reachable). Kokoro/LLM degrade silently
  // because the product is still partially usable without them.
  app.get("/magister/health/services", async (_req, reply) => {
    const timestamp = new Date().toISOString();

    // DB probe — cheap, in-process.
    let dbReachable = false;
    let dbDetail = "";
    let installedCount: number | undefined;
    let moduleCount: number | undefined;
    try {
      installedCount = db.installedCount();
      moduleCount = db.listModules().length;
      dbReachable = true;
    } catch (err) {
      dbDetail = `DB probe threw: ${String(err).slice(0, 200)}`;
    }

    // Kokoro probe — already short-timeout (750ms by default) and non-throwing.
    const kokoro = await kokoroHealth({ timeoutMs: 600 });

    // LLM probe — mode tells the UI what to expect; we ping Ollama when
    // local-only because that's the load-bearing path in that mode.
    const llmCfg = loadLlmConfig();
    const mode: "local-only" | "cloud" | "cloud-with-local-fallback" | "unconfigured" =
      llmCfg.localOnly
        ? "local-only"
        : llmCfg.openrouterApiKey && llmCfg.ollamaUrl
          ? "cloud-with-local-fallback"
          : llmCfg.openrouterApiKey
            ? "cloud"
            : "unconfigured";

    let ollamaReachable = false;
    let ollamaDetail = "";
    const ollamaUrl = llmCfg.ollamaUrl ?? "http://127.0.0.1:11434";
    if (mode === "local-only" || mode === "cloud-with-local-fallback") {
      try {
        const res = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(600) });
        ollamaReachable = res.ok;
        if (!res.ok) ollamaDetail = `Ollama returned HTTP ${res.status} at ${ollamaUrl}`;
      } catch (err) {
        ollamaDetail = `Ollama not reachable at ${ollamaUrl}: ${String(err).slice(0, 120)}`;
      }
    }

    const llmOk =
      mode === "cloud"
        ? Boolean(llmCfg.openrouterApiKey)
        : mode === "local-only"
          ? ollamaReachable
          : mode === "cloud-with-local-fallback"
            ? Boolean(llmCfg.openrouterApiKey) || ollamaReachable
            : false;

    return reply.send({
      ok: dbReachable, // API is "usable" iff DB is reachable.
      api: { ok: true, host: process.env["MAGISTER_HOST"] ?? "127.0.0.1", port: Number(process.env["MAGISTER_PORT"] ?? 18793) },
      db: {
        ok: dbReachable,
        ...(dbDetail ? { detail: dbDetail } : {}),
        ...(installedCount !== undefined ? { installedCount } : {}),
        ...(moduleCount !== undefined ? { moduleCount } : {}),
      },
      kokoro: {
        ok: kokoro.reachable && kokoro.ok === true,
        url: kokoroBaseUrl(),
        ...(kokoro.detail ? { detail: kokoro.detail } : {}),
        ...(kokoro.status ? { status: kokoro.status } : {}),
        ...(kokoro.model_loaded !== undefined ? { modelLoaded: kokoro.model_loaded } : {}),
      },
      llm: {
        ok: llmOk,
        mode,
        ollama: {
          ok: ollamaReachable,
          url: ollamaUrl,
          probed: mode === "local-only" || mode === "cloud-with-local-fallback",
          ...(ollamaDetail ? { detail: ollamaDetail } : {}),
        },
        openrouter: {
          configured: Boolean(llmCfg.openrouterApiKey),
          model: llmCfg.openrouterDefaultModel ?? null,
        },
      },
      publicBindAllowed: process.env["MAGISTER_ALLOW_PUBLIC_BIND"] === "true",
      timestamp,
    });
  });
}
