import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { NusikaDB, type CompanionMemoryWriteback } from "../server/db.js";
import { registerAllRoutes } from "../server/routes/index.js";
import { __setCompleteForTesting, __resetCompleteForTesting } from "../server/lib/llm.js";

async function bootApp() {
  const dir = mkdtempSync(join(tmpdir(), "magister-recap-"));
  const db = new NusikaDB(join(dir, "test.db"));
  db.registerModule({ id: "linux", name: "Linux Fundamentals" });
  db.registerModule({ id: "modulewithoutcompanion", name: "Module Without Companion" });

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

function createSession(app: ReturnType<typeof bootApp> extends Promise<infer T> ? T : never, opts: {
  module_id?: string;
  companion_id?: string | null;
  hint_l1?: number;
  hint_l3?: number;
} = {}) {
  return app.app.inject({
    method: "POST", url: "/nusika/sessions",
    payload: {
      module_id: opts.module_id ?? "linux",
      ...(opts.companion_id !== null
        ? { companion_id: opts.companion_id ?? "cronk" }
        : {}),
      teaching_mode: "narrative",
      concept_id: "filesystem-basics",
      objective: "Navigate the filesystem",
      mastery_signal: "Can move between directories",
    },
  });
}

test("POST /nusika/sessions/:id/recap returns 404 for unknown session", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const res = await app.inject({
      method: "POST", url: "/nusika/sessions/does-not-exist/recap",
      payload: {},
    });
    assert.equal(res.statusCode, 404);
    assert.equal(res.json().ok, false);
  } finally {
    await cleanup();
  }
});

test("recap returns 502 with structured error when LLM unavailable, persists nothing", async () => {
  const prevKey = process.env["OPENROUTER_API_KEY"];
  const prevOllama = process.env["NUSIKA_LOCAL_OLLAMA_URL"];
  delete process.env["OPENROUTER_API_KEY"];
  process.env["NUSIKA_LOCAL_OLLAMA_URL"] = "http://127.0.0.1:1";

  const harness = await bootApp();
  try {
    const create = await createSession(harness);
    const sessionId = create.json().session.id as string;

    const res = await harness.app.inject({
      method: "POST", url: `/nusika/sessions/${sessionId}/recap`,
      payload: {},
    });
    assert.equal(res.statusCode, 502);
    const body = res.json();
    assert.equal(body.ok, false);
    assert.match(body.error, /unavailable/i);
    assert.equal(typeof body.detail, "string");

    // No memory should have been written.
    const memRes = await harness.app.inject({ method: "GET", url: "/nusika/memory/cronk" });
    assert.deepEqual(memRes.json().memories, []);
  } finally {
    await harness.cleanup();
    if (prevKey === undefined) delete process.env["OPENROUTER_API_KEY"];
    else process.env["OPENROUTER_API_KEY"] = prevKey;
    if (prevOllama === undefined) delete process.env["NUSIKA_LOCAL_OLLAMA_URL"];
    else process.env["NUSIKA_LOCAL_OLLAMA_URL"] = prevOllama;
  }
});

test("recap returns 502 when LLM returns invalid JSON, no memory written", async () => {
  const harness = await bootApp();
  __setCompleteForTesting(async () => ({
    text: "I cannot help with that. Sorry!",
    model: "test-model", provider: "openrouter",
    tokensIn: 10, tokensOut: 5, estimatedCostUsd: 0, durationMs: 1,
  }));
  try {
    const create = await createSession(harness);
    const sessionId = create.json().session.id as string;
    const res = await harness.app.inject({
      method: "POST", url: `/nusika/sessions/${sessionId}/recap`,
      payload: {},
    });
    assert.equal(res.statusCode, 502);
    const body = res.json();
    assert.equal(body.ok, false);
    assert.match(body.error, /valid JSON/i);
    assert.equal(typeof body.raw, "string");

    const memRes = await harness.app.inject({ method: "GET", url: "/nusika/memory/cronk" });
    assert.deepEqual(memRes.json().memories, []);
  } finally {
    __resetCompleteForTesting();
    await harness.cleanup();
  }
});

test("recap returns 422 when JSON parses but fails schema, no memory written", async () => {
  const harness = await bootApp();
  // Valid JSON, but missing required `preferences` block — schema must reject.
  __setCompleteForTesting(async () => ({
    text: '{"mastered_concepts":[],"struggled_concepts":[],"hint_patterns":{}}',
    model: "test-model", provider: "openrouter",
    tokensIn: 10, tokensOut: 5, estimatedCostUsd: 0, durationMs: 1,
  }));
  try {
    const create = await createSession(harness);
    const sessionId = create.json().session.id as string;
    const res = await harness.app.inject({
      method: "POST", url: `/nusika/sessions/${sessionId}/recap`,
      payload: {},
    });
    assert.equal(res.statusCode, 422);
    const body = res.json();
    assert.equal(body.ok, false);
    assert.match(body.error, /schema/i);

    const memRes = await harness.app.inject({ method: "GET", url: "/nusika/memory/cronk" });
    assert.deepEqual(memRes.json().memories, []);
  } finally {
    __resetCompleteForTesting();
    await harness.cleanup();
  }
});

test("recap success path writes memory and returns saved=true", async () => {
  const harness = await bootApp();
  const fixture: CompanionMemoryWriteback = {
    mastered_concepts: ["filesystem-basics"],
    struggled_concepts: [],
    hint_patterns: {},
    preferences: { session_length: "standard", pace: "standard", teaching_mode: "narrative" },
    relationship_beat: "finished without hints",
  };
  __setCompleteForTesting(async () => ({
    text: JSON.stringify(fixture),
    model: "test-model", provider: "openrouter",
    tokensIn: 50, tokensOut: 80, estimatedCostUsd: 0, durationMs: 5,
  }));
  try {
    const create = await createSession(harness);
    const sessionId = create.json().session.id as string;

    const res = await harness.app.inject({
      method: "POST", url: `/nusika/sessions/${sessionId}/recap`,
      payload: {},
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.ok, true);
    assert.equal(body.saved, true);
    assert.deepEqual(body.writeback.mastered_concepts, ["filesystem-basics"]);
    assert.equal(body.model, "test-model");

    const memRes = await harness.app.inject({ method: "GET", url: "/nusika/memory/cronk" });
    const memories = memRes.json().memories as Array<{ memory_type: string; content: string }>;
    assert.ok(memories.length > 0, "memories must be persisted");
    const types = new Set(memories.map(m => m.memory_type));
    assert.ok(types.has("achievement"), "mastered_concepts -> achievement memory");
    assert.ok(types.has("preference"), "preferences -> preference memory");
    assert.ok(types.has("relationship"), "relationship_beat -> relationship memory");
  } finally {
    __resetCompleteForTesting();
    await harness.cleanup();
  }
});

test("recap unwraps fenced ```json blocks the model wraps around its JSON", async () => {
  const harness = await bootApp();
  const fixture: CompanionMemoryWriteback = {
    mastered_concepts: [],
    struggled_concepts: [],
    hint_patterns: {},
    preferences: { session_length: "standard", pace: "standard", teaching_mode: "narrative" },
  };
  __setCompleteForTesting(async () => ({
    text: "```json\n" + JSON.stringify(fixture) + "\n```",
    model: "test-model", provider: "openrouter",
    tokensIn: 1, tokensOut: 1, estimatedCostUsd: 0, durationMs: 1,
  }));
  try {
    const create = await createSession(harness);
    const sessionId = create.json().session.id as string;
    const res = await harness.app.inject({
      method: "POST", url: `/nusika/sessions/${sessionId}/recap`,
      payload: {},
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().saved, true);
  } finally {
    __resetCompleteForTesting();
    await harness.cleanup();
  }
});

test("recap on a session without companion_id returns saved=false, skipped=true", async () => {
  const harness = await bootApp();
  // Manually create a session with no companion via the DB to bypass the
  // route's optional companion path (POST /nusika/sessions accepts no companion).
  const session = harness.db.createSession("modulewithoutcompanion", {
    atom: { concept_id: "x", objective: "y", mastery_signal: "z" },
  });
  // Even without an LLM mock — the route should short-circuit before calling
  // complete() — but we set one to be safe.
  __setCompleteForTesting(async () => {
    throw new Error("LLM should not have been called");
  });
  try {
    const res = await harness.app.inject({
      method: "POST", url: `/nusika/sessions/${session.id}/recap`,
      payload: {},
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.ok, true);
    assert.equal(body.saved, false);
    assert.equal(body.skipped, true);
    assert.match(body.reason, /companion/i);
  } finally {
    __resetCompleteForTesting();
    await harness.cleanup();
  }
});
