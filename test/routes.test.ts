import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { NusikaDB } from "../server/db.js";
import { registerAllRoutes } from "../server/routes/index.js";

async function bootApp() {
  const dir = mkdtempSync(join(tmpdir(), "magister-route-"));
  const db = new NusikaDB(join(dir, "test.db"));
  db.registerModule({ id: "linux", name: "Linux Fundamentals" });

  const app = Fastify({ logger: false });
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

test("GET /health returns ok=true", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const res = await app.inject({ method: "GET", url: "/health" });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.ok, true);
    assert.equal(body.status, "healthy");
  } finally {
    await cleanup();
  }
});

test("GET /nusika/modules lists registered modules", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const res = await app.inject({ method: "GET", url: "/nusika/modules" });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.ok, true);
    assert.ok(Array.isArray(body.modules));
    assert.ok(body.modules.find((m: { id: string }) => m.id === "linux"));
  } finally {
    await cleanup();
  }
});

test("session create → get → hint → tick → end", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const create = await app.inject({
      method: "POST", url: "/nusika/sessions",
      payload: {
        module_id: "linux",
        teaching_mode: "narrative",
        concept_id: "filesystem-basics",
        objective: "Navigate the filesystem",
        mastery_signal: "Can move between directories",
      },
    });
    assert.equal(create.statusCode, 201);
    const sessionId = create.json().session.id as string;
    assert.ok(sessionId);

    const got = await app.inject({ method: "GET", url: `/nusika/sessions/${sessionId}` });
    assert.equal(got.statusCode, 200);
    assert.equal(got.json().session.id, sessionId);

    const hint = await app.inject({
      method: "POST", url: `/nusika/sessions/${sessionId}/hint`,
      payload: { level: 1 },
    });
    assert.equal(hint.statusCode, 200);
    assert.equal(hint.json().session.hint_count_l1, 1);

    const tick = await app.inject({
      method: "POST", url: `/nusika/sessions/${sessionId}/tick`,
      payload: { seconds: 45 },
    });
    assert.equal(tick.statusCode, 200);
    assert.equal(tick.json().elapsed, 45);

    const end = await app.inject({
      method: "POST", url: `/nusika/sessions/${sessionId}/end`,
      payload: { summary: "wrap" },
    });
    assert.equal(end.statusCode, 200);
    assert.equal(end.json().ok, true);
  } finally {
    await cleanup();
  }
});

test("GET /nusika/sessions/:id returns 404 for unknown id", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const res = await app.inject({ method: "GET", url: "/nusika/sessions/does-not-exist" });
    assert.equal(res.statusCode, 404);
    assert.equal(res.json().ok, false);
  } finally {
    await cleanup();
  }
});
