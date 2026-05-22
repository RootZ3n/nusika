import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { MagisterDB } from "../server/db.js";
import { registerAllRoutes } from "../server/routes/index.js";

async function bootApp() {
  const dir = mkdtempSync(join(tmpdir(), "magister-inkwell-"));
  const db = new MagisterDB(join(dir, "test.db"));
  db.registerModule({ id: "inkwell", name: "The Inkwell" });

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

test("GET /magister/inkwell/drafts returns empty list when none saved", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const res = await app.inject({ method: "GET", url: "/magister/inkwell/drafts" });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.ok, true);
    assert.deepEqual(body.drafts, []);
  } finally {
    await cleanup();
  }
});

test("POST /magister/inkwell/drafts creates a draft and lists it", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const create = await app.inject({
      method: "POST", url: "/magister/inkwell/drafts",
      payload: { title: "Morning Pages", content: "The window was open." },
    });
    assert.equal(create.statusCode, 201);
    const created = create.json();
    assert.equal(created.ok, true);
    assert.equal(created.draft.title, "Morning Pages");
    assert.equal(created.draft.content, "The window was open.");
    assert.equal(typeof created.draft.id, "string");

    const list = await app.inject({ method: "GET", url: "/magister/inkwell/drafts" });
    assert.equal(list.statusCode, 200);
    const drafts = list.json().drafts;
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0].id, created.draft.id);
    assert.equal(drafts[0].title, "Morning Pages");
  } finally {
    await cleanup();
  }
});

test("POST /magister/inkwell/drafts auto-titles from first line when missing", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const res = await app.inject({
      method: "POST", url: "/magister/inkwell/drafts",
      payload: { content: "First line of the draft.\nMore lines below." },
    });
    assert.equal(res.statusCode, 201);
    assert.equal(res.json().draft.title, "First line of the draft.");
  } finally {
    await cleanup();
  }
});

test("POST /magister/inkwell/drafts rejects empty content", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const res = await app.inject({
      method: "POST", url: "/magister/inkwell/drafts",
      payload: { title: "Blank", content: "   " },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().ok, false);
  } finally {
    await cleanup();
  }
});

test("POST /magister/inkwell/drafts updates an existing draft when id is provided", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const create = await app.inject({
      method: "POST", url: "/magister/inkwell/drafts",
      payload: { title: "v1", content: "draft v1" },
    });
    const id = create.json().draft.id as string;

    const update = await app.inject({
      method: "POST", url: "/magister/inkwell/drafts",
      payload: { id, title: "v2", content: "draft v2", feedback: "stronger now" },
    });
    assert.equal(update.statusCode, 200);
    const updated = update.json().draft;
    assert.equal(updated.id, id);
    assert.equal(updated.title, "v2");
    assert.equal(updated.feedback, "stronger now");

    const list = await app.inject({ method: "GET", url: "/magister/inkwell/drafts" });
    assert.equal(list.json().drafts.length, 1, "update must not create a new row");
  } finally {
    await cleanup();
  }
});

test("GET /magister/inkwell/drafts/:id returns 404 for unknown id", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const res = await app.inject({ method: "GET", url: "/magister/inkwell/drafts/does-not-exist" });
    assert.equal(res.statusCode, 404);
    assert.equal(res.json().ok, false);
  } finally {
    await cleanup();
  }
});

test("POST /magister/inkwell/drafts with id from another module returns 404", async () => {
  const { app, db, cleanup } = await bootApp();
  try {
    db.registerModule({ id: "linux", name: "Linux Fundamentals" });
    const otherWork = db.saveCreativeWork("linux", { title: "shell notes", content: "ls -la" });
    const res = await app.inject({
      method: "POST", url: "/magister/inkwell/drafts",
      payload: { id: otherWork.id, title: "hijack", content: "should fail" },
    });
    assert.equal(res.statusCode, 404);
  } finally {
    await cleanup();
  }
});

test("POST /magister/inkwell/feedback rejects empty content with 400", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const res = await app.inject({
      method: "POST", url: "/magister/inkwell/feedback",
      payload: { content: "" },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().ok, false);
  } finally {
    await cleanup();
  }
});

test("POST /magister/inkwell/feedback returns 502 with clear error when LLM unavailable", async () => {
  // Force a configuration where every backend will fail:
  //   - no OpenRouter key
  //   - Ollama URL pointed at a closed port (127.0.0.1:1)
  //   - LOCAL_ONLY off so the route falls through to Ollama and fails
  const prevKey = process.env["OPENROUTER_API_KEY"];
  const prevOllama = process.env["MAGISTER_LOCAL_OLLAMA_URL"];
  const prevLocalOnly = process.env["MAGISTER_LOCAL_ONLY"];
  delete process.env["OPENROUTER_API_KEY"];
  process.env["MAGISTER_LOCAL_OLLAMA_URL"] = "http://127.0.0.1:1";
  delete process.env["MAGISTER_LOCAL_ONLY"];

  const { app, cleanup } = await bootApp();
  try {
    const res = await app.inject({
      method: "POST", url: "/magister/inkwell/feedback",
      payload: { content: "A short paragraph for feedback." },
    });
    assert.equal(res.statusCode, 502);
    const body = res.json();
    assert.equal(body.ok, false);
    assert.match(body.error, /unavailable/i);
    // Detail must be a string, not undefined — proves the route surfaced the
    // upstream failure rather than pretending feedback happened.
    assert.equal(typeof body.detail, "string");
  } finally {
    await cleanup();
    if (prevKey === undefined) delete process.env["OPENROUTER_API_KEY"];
    else process.env["OPENROUTER_API_KEY"] = prevKey;
    if (prevOllama === undefined) delete process.env["MAGISTER_LOCAL_OLLAMA_URL"];
    else process.env["MAGISTER_LOCAL_OLLAMA_URL"] = prevOllama;
    if (prevLocalOnly === undefined) delete process.env["MAGISTER_LOCAL_ONLY"];
    else process.env["MAGISTER_LOCAL_ONLY"] = prevLocalOnly;
  }
});
