import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import Fastify from "fastify";
import { NusikaDB } from "../server/db.js";
import { registerAllRoutes } from "../server/routes/index.js";
import { __setCompleteForTesting, __resetCompleteForTesting } from "../server/lib/llm.js";

async function bootApp() {
  const dir = mkdtempSync(join(tmpdir(), "magister-lessons-"));
  const db = new NusikaDB(join(dir, "test.db"));
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

// ── Lesson lifecycle ────────────────────────────────────────────────────────

test("POST /nusika/lessons creates a lesson with normalized topic", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const res = await app.inject({
      method: "POST", url: "/nusika/lessons",
      payload: { title: "How does compound interest work" },
    });
    assert.equal(res.statusCode, 201);
    const lesson = res.json().lesson;
    assert.equal(lesson.title, "How does compound interest work");
    assert.equal(lesson.topic, "how does compound interest work");
    assert.equal(lesson.depth, "intro");
    assert.equal(lesson.status, "active");
    assert.equal(lesson.turn_count, 0);
    assert.equal(typeof lesson.id, "string");
  } finally {
    await cleanup();
  }
});

test("POST /nusika/lessons rejects empty title with 400", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const res = await app.inject({
      method: "POST", url: "/nusika/lessons",
      payload: { title: "   " },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().ok, false);
  } finally {
    await cleanup();
  }
});

test("POST /nusika/lessons rejects invalid depth with 400", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const res = await app.inject({
      method: "POST", url: "/nusika/lessons",
      payload: { title: "x", depth: "wizard" },
    });
    assert.equal(res.statusCode, 400);
    assert.match(res.json().error, /depth/);
  } finally {
    await cleanup();
  }
});

test("GET /nusika/lessons lists in updated_at desc", async () => {
  const { app, cleanup } = await bootApp();
  try {
    await app.inject({ method: "POST", url: "/nusika/lessons", payload: { title: "first" } });
    // updated_at has millisecond resolution; insert a small gap so ordering is deterministic
    await delay(5);
    await app.inject({ method: "POST", url: "/nusika/lessons", payload: { title: "second" } });
    const res = await app.inject({ method: "GET", url: "/nusika/lessons" });
    assert.equal(res.statusCode, 200);
    const lessons = res.json().lessons as Array<{ title: string }>;
    assert.equal(lessons.length, 2);
    // most recent first; "second" was inserted after "first"
    assert.equal(lessons[0]!.title, "second");
  } finally {
    await cleanup();
  }
});

test("GET /nusika/lessons/:id returns lesson + turns; 404 for unknown id", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const create = await app.inject({ method: "POST", url: "/nusika/lessons", payload: { title: "x" } });
    const id = create.json().lesson.id as string;

    const got = await app.inject({ method: "GET", url: `/nusika/lessons/${id}` });
    assert.equal(got.statusCode, 200);
    assert.equal(got.json().lesson.id, id);
    assert.deepEqual(got.json().turns, []);

    const missing = await app.inject({ method: "GET", url: "/nusika/lessons/does-not-exist" });
    assert.equal(missing.statusCode, 404);
  } finally {
    await cleanup();
  }
});

test("PATCH /nusika/lessons/:id updates depth/status; sets completed_at on complete", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const create = await app.inject({ method: "POST", url: "/nusika/lessons", payload: { title: "x" } });
    const id = create.json().lesson.id as string;

    const patch = await app.inject({
      method: "PATCH", url: `/nusika/lessons/${id}`,
      payload: { depth: "deeper", status: "complete" },
    });
    assert.equal(patch.statusCode, 200);
    const updated = patch.json().lesson;
    assert.equal(updated.depth, "deeper");
    assert.equal(updated.status, "complete");
    assert.ok(typeof updated.completed_at === "string" && updated.completed_at.length > 0);
  } finally {
    await cleanup();
  }
});

test("PATCH /nusika/lessons/:id rejects invalid depth and invalid status with 400", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const create = await app.inject({ method: "POST", url: "/nusika/lessons", payload: { title: "x" } });
    const id = create.json().lesson.id as string;

    const badDepth = await app.inject({
      method: "PATCH", url: `/nusika/lessons/${id}`, payload: { depth: "expert" },
    });
    assert.equal(badDepth.statusCode, 400);

    const badStatus = await app.inject({
      method: "PATCH", url: `/nusika/lessons/${id}`, payload: { status: "abandoned" },
    });
    assert.equal(badStatus.statusCode, 400);
  } finally {
    await cleanup();
  }
});

// ── Chat ────────────────────────────────────────────────────────────────────

test("chat persists user + assistant turns and returns model/provider", async () => {
  const harness = await bootApp();
  __setCompleteForTesting(async () => ({
    text: "A short explanation of the concept.",
    model: "test-model", provider: "openrouter",
    tokensIn: 12, tokensOut: 34, estimatedCostUsd: 0, durationMs: 7,
  }));
  try {
    const create = await harness.app.inject({
      method: "POST", url: "/nusika/lessons", payload: { title: "What is gravity?" },
    });
    const id = create.json().lesson.id as string;

    const chat = await harness.app.inject({
      method: "POST", url: `/nusika/lessons/${id}/chat`,
      payload: { message: "Start with the basics please" },
    });
    assert.equal(chat.statusCode, 200);
    const body = chat.json();
    assert.equal(body.ok, true);
    assert.equal(body.text, "A short explanation of the concept.");
    assert.equal(body.model, "test-model");
    assert.equal(body.provider, "openrouter");

    const detail = await harness.app.inject({ method: "GET", url: `/nusika/lessons/${id}` });
    const turns = detail.json().turns as Array<{ role: string; content: string; model: string | null }>;
    assert.equal(turns.length, 2, "user + assistant should be persisted");
    assert.equal(turns[0]!.role, "user");
    assert.equal(turns[0]!.content, "Start with the basics please");
    assert.equal(turns[1]!.role, "assistant");
    assert.equal(turns[1]!.model, "test-model");

    assert.equal(detail.json().lesson.turn_count, 2);
  } finally {
    __resetCompleteForTesting();
    await harness.cleanup();
  }
});

test("chat depth override is persisted on the lesson and on the user turn", async () => {
  const harness = await bootApp();
  __setCompleteForTesting(async () => ({
    text: "ok", model: "m", provider: "openrouter",
    tokensIn: 1, tokensOut: 1, estimatedCostUsd: 0, durationMs: 1,
  }));
  try {
    const create = await harness.app.inject({
      method: "POST", url: "/nusika/lessons", payload: { title: "x" },
    });
    const id = create.json().lesson.id as string;

    await harness.app.inject({
      method: "POST", url: `/nusika/lessons/${id}/chat`,
      payload: { message: "give me an example", depth: "example" },
    });

    const detail = await harness.app.inject({ method: "GET", url: `/nusika/lessons/${id}` });
    assert.equal(detail.json().lesson.depth, "example");
    const userTurn = detail.json().turns.find((t: { role: string }) => t.role === "user");
    assert.equal(userTurn.depth_at, "example");
  } finally {
    __resetCompleteForTesting();
    await harness.cleanup();
  }
});

test("chat returns 502 when LLM unavailable; user turn persisted, NO assistant turn", async () => {
  const harness = await bootApp();
  __setCompleteForTesting(async () => { throw new Error("simulated upstream failure"); });
  try {
    const create = await harness.app.inject({
      method: "POST", url: "/nusika/lessons", payload: { title: "x" },
    });
    const id = create.json().lesson.id as string;

    const chat = await harness.app.inject({
      method: "POST", url: `/nusika/lessons/${id}/chat`,
      payload: { message: "hello" },
    });
    assert.equal(chat.statusCode, 502);
    assert.equal(chat.json().ok, false);
    assert.match(chat.json().error, /unavailable/i);

    const detail = await harness.app.inject({ method: "GET", url: `/nusika/lessons/${id}` });
    const turns = detail.json().turns as Array<{ role: string }>;
    // The user turn is intentionally persisted so the question stays visible;
    // no fake assistant turn should exist.
    assert.equal(turns.length, 1);
    assert.equal(turns[0]!.role, "user");
  } finally {
    __resetCompleteForTesting();
    await harness.cleanup();
  }
});

test("chat rejects empty message with 400 and unknown lesson with 404", async () => {
  const harness = await bootApp();
  try {
    const create = await harness.app.inject({
      method: "POST", url: "/nusika/lessons", payload: { title: "x" },
    });
    const id = create.json().lesson.id as string;

    const empty = await harness.app.inject({
      method: "POST", url: `/nusika/lessons/${id}/chat`, payload: { message: "" },
    });
    assert.equal(empty.statusCode, 400);

    const missing = await harness.app.inject({
      method: "POST", url: "/nusika/lessons/no-such-id/chat", payload: { message: "hi" },
    });
    assert.equal(missing.statusCode, 404);
  } finally {
    await harness.cleanup();
  }
});

// ── Recap ───────────────────────────────────────────────────────────────────

test("recap success path updates summary + knowledge", async () => {
  const harness = await bootApp();
  // First, mock the chat completer so we can record one turn.
  __setCompleteForTesting(async () => ({
    text: "Gravity bends spacetime.", model: "m", provider: "openrouter",
    tokensIn: 1, tokensOut: 1, estimatedCostUsd: 0, durationMs: 1,
  }));
  try {
    const create = await harness.app.inject({
      method: "POST", url: "/nusika/lessons", payload: { title: "Gravity" },
    });
    const id = create.json().lesson.id as string;
    await harness.app.inject({
      method: "POST", url: `/nusika/lessons/${id}/chat`, payload: { message: "explain it" },
    });

    // Now switch to a recap-fixture completer.
    __setCompleteForTesting(async () => ({
      text: JSON.stringify({
        summary: "We covered an introduction to gravity as spacetime curvature.",
        knowledge: { covered: ["gravity-basics"], practiced: [], stuck: [] },
      }),
      model: "recap-model", provider: "openrouter",
      tokensIn: 5, tokensOut: 20, estimatedCostUsd: 0, durationMs: 2,
    }));

    const recap = await harness.app.inject({
      method: "POST", url: `/nusika/lessons/${id}/recap`, payload: {},
    });
    assert.equal(recap.statusCode, 200);
    const body = recap.json();
    assert.equal(body.ok, true);
    assert.match(body.summary, /spacetime curvature/);
    assert.deepEqual(body.knowledge.covered, ["gravity-basics"]);

    // Persistence
    const detail = await harness.app.inject({ method: "GET", url: `/nusika/lessons/${id}` });
    assert.match(detail.json().lesson.summary, /spacetime curvature/);
    const stored = JSON.parse(detail.json().lesson.knowledge);
    assert.deepEqual(stored.covered, ["gravity-basics"]);
  } finally {
    __resetCompleteForTesting();
    await harness.cleanup();
  }
});

test("recap returns 502 when LLM returns invalid JSON; lesson summary unchanged", async () => {
  const harness = await bootApp();
  __setCompleteForTesting(async () => ({
    text: "ok", model: "m", provider: "openrouter",
    tokensIn: 1, tokensOut: 1, estimatedCostUsd: 0, durationMs: 1,
  }));
  try {
    const create = await harness.app.inject({
      method: "POST", url: "/nusika/lessons", payload: { title: "x" },
    });
    const id = create.json().lesson.id as string;
    await harness.app.inject({
      method: "POST", url: `/nusika/lessons/${id}/chat`, payload: { message: "hi" },
    });

    __setCompleteForTesting(async () => ({
      text: "I cannot help with that. Sorry!",
      model: "m", provider: "openrouter",
      tokensIn: 1, tokensOut: 1, estimatedCostUsd: 0, durationMs: 1,
    }));

    const recap = await harness.app.inject({
      method: "POST", url: `/nusika/lessons/${id}/recap`, payload: {},
    });
    assert.equal(recap.statusCode, 502);
    assert.match(recap.json().error, /valid JSON/i);

    const detail = await harness.app.inject({ method: "GET", url: `/nusika/lessons/${id}` });
    assert.equal(detail.json().lesson.summary, null, "summary must remain unset");
  } finally {
    __resetCompleteForTesting();
    await harness.cleanup();
  }
});

test("recap returns 422 when JSON parses but fails schema; nothing persisted", async () => {
  const harness = await bootApp();
  __setCompleteForTesting(async () => ({
    text: "ok", model: "m", provider: "openrouter",
    tokensIn: 1, tokensOut: 1, estimatedCostUsd: 0, durationMs: 1,
  }));
  try {
    const create = await harness.app.inject({
      method: "POST", url: "/nusika/lessons", payload: { title: "x" },
    });
    const id = create.json().lesson.id as string;
    await harness.app.inject({
      method: "POST", url: `/nusika/lessons/${id}/chat`, payload: { message: "hi" },
    });

    // Missing knowledge.stuck array → schema must reject.
    __setCompleteForTesting(async () => ({
      text: JSON.stringify({ summary: "ok", knowledge: { covered: [], practiced: [] } }),
      model: "m", provider: "openrouter",
      tokensIn: 1, tokensOut: 1, estimatedCostUsd: 0, durationMs: 1,
    }));

    const recap = await harness.app.inject({
      method: "POST", url: `/nusika/lessons/${id}/recap`, payload: {},
    });
    assert.equal(recap.statusCode, 422);
    assert.match(recap.json().error, /schema/i);

    const detail = await harness.app.inject({ method: "GET", url: `/nusika/lessons/${id}` });
    assert.equal(detail.json().lesson.summary, null);
  } finally {
    __resetCompleteForTesting();
    await harness.cleanup();
  }
});

test("recap with no turns yet returns 400", async () => {
  const harness = await bootApp();
  try {
    const create = await harness.app.inject({
      method: "POST", url: "/nusika/lessons", payload: { title: "x" },
    });
    const id = create.json().lesson.id as string;
    const recap = await harness.app.inject({
      method: "POST", url: `/nusika/lessons/${id}/recap`, payload: {},
    });
    assert.equal(recap.statusCode, 400);
  } finally {
    await harness.cleanup();
  }
});

// ── Lookup placeholder ───────────────────────────────────────────────────────

test("POST /nusika/lookup returns supported:false placeholder", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const res = await app.inject({
      method: "POST", url: "/nusika/lookup",
      payload: { query: "What is the price of tea today?" },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.ok, true);
    assert.equal(body.supported, false);
    assert.match(body.reason, /not wired/i);
    assert.equal(body.echo.query, "What is the price of tea today?");
  } finally {
    await cleanup();
  }
});
