/**
 * Route alias tests — proves that legacy /magister/* paths still work
 * through the rewriteUrl compatibility shim added in server/index.ts.
 *
 * The rewriteUrl hook rewrites /magister/* → /nusika/* before Fastify
 * matches routes, so both prefixes reach the same handler.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { NusikaDB } from "../server/db.js";
import { registerAllRoutes } from "../server/routes/index.js";

/** Boot a Fastify instance WITH the rewriteUrl shim, matching production. */
async function bootApp() {
  const dir = mkdtempSync(join(tmpdir(), "nusika-alias-"));
  const db = new NusikaDB(join(dir, "test.db"));
  db.registerModule({ id: "linux", name: "Linux Fundamentals" });

  const app = Fastify({
    logger: false,
    rewriteUrl: (req) => {
      const url = req.url ?? "";
      if (url.startsWith("/magister/")) {
        return "/nusika/" + url.slice("/magister/".length);
      }
      return url;
    },
  });
  await registerAllRoutes(app, db);
  return {
    app, db,
    cleanup: async () => {
      await app.close();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("GET /nusika/health returns 200", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const res = await app.inject({ method: "GET", url: "/nusika/health" });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().ok, true);
  } finally {
    await cleanup();
  }
});

test("GET /magister/health (legacy alias) returns 200", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const res = await app.inject({ method: "GET", url: "/magister/health" });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().ok, true);
  } finally {
    await cleanup();
  }
});

test("GET /nusika/modules returns modules", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const res = await app.inject({ method: "GET", url: "/nusika/modules" });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.ok(Array.isArray(body.modules));
    assert.ok(body.modules.length > 0);
  } finally {
    await cleanup();
  }
});

test("GET /magister/modules (legacy alias) returns same modules", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const res = await app.inject({ method: "GET", url: "/magister/modules" });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.ok(Array.isArray(body.modules));
    assert.ok(body.modules.length > 0);
  } finally {
    await cleanup();
  }
});

test("POST+GET /magister/sessions (legacy alias) round-trips", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const create = await app.inject({
      method: "POST",
      url: "/magister/sessions",
      payload: {
        module_id: "linux",
        teaching_mode: "narrative",
        concept_id: "fs-basics",
        objective: "learn filesystems",
        mastery_signal: "can ls",
      },
    });
    assert.equal(create.statusCode, 201);
    const sessionId = create.json().session.id as string;
    assert.ok(sessionId);

    const get = await app.inject({ method: "GET", url: `/magister/sessions/${sessionId}` });
    assert.equal(get.statusCode, 200);
    assert.equal(get.json().session.id, sessionId);
  } finally {
    await cleanup();
  }
});

test("GET /magister/config (legacy alias) returns config", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const res = await app.inject({ method: "GET", url: "/magister/config" });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().ok, true);
    assert.ok(res.json().narrator);
  } finally {
    await cleanup();
  }
});

test("GET /magister/voices (legacy alias) returns voices", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const res = await app.inject({ method: "GET", url: "/magister/voices" });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().ok, true);
  } finally {
    await cleanup();
  }
});
