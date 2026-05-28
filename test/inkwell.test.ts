import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { NusikaDB } from "../server/db.js";
import { registerAllRoutes } from "../server/routes/index.js";

async function bootApp() {
  const dir = mkdtempSync(join(tmpdir(), "nusika-shukha-anumpa-"));
  const db = new NusikaDB(join(dir, "test.db"));
  db.registerModule({ id: "inkwell", name: "Shukha Anumpa" });

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

// ── New canonical routes: /nusika/shukha-anumpa/* ───────────────────────────

test("GET /nusika/shukha-anumpa/drafts returns empty list when none saved", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const res = await app.inject({ method: "GET", url: "/nusika/shukha-anumpa/drafts" });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.ok, true);
    assert.deepEqual(body.drafts, []);
  } finally {
    await cleanup();
  }
});

test("POST /nusika/shukha-anumpa/drafts creates a draft and lists it", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const create = await app.inject({
      method: "POST", url: "/nusika/shukha-anumpa/drafts",
      payload: { title: "Morning Pages", content: "The window was open." },
    });
    assert.equal(create.statusCode, 201);
    const created = create.json();
    assert.equal(created.ok, true);
    assert.equal(created.draft.title, "Morning Pages");
    assert.equal(created.draft.content, "The window was open.");
    assert.equal(typeof created.draft.id, "string");

    const list = await app.inject({ method: "GET", url: "/nusika/shukha-anumpa/drafts" });
    assert.equal(list.statusCode, 200);
    const drafts = list.json().drafts;
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0].id, created.draft.id);
    assert.equal(drafts[0].title, "Morning Pages");
  } finally {
    await cleanup();
  }
});

test("POST /nusika/shukha-anumpa/drafts auto-titles from first line when missing", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const res = await app.inject({
      method: "POST", url: "/nusika/shukha-anumpa/drafts",
      payload: { content: "First line of the draft.\nMore lines below." },
    });
    assert.equal(res.statusCode, 201);
    assert.equal(res.json().draft.title, "First line of the draft.");
  } finally {
    await cleanup();
  }
});

test("POST /nusika/shukha-anumpa/drafts rejects empty content", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const res = await app.inject({
      method: "POST", url: "/nusika/shukha-anumpa/drafts",
      payload: { title: "Blank", content: "   " },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().ok, false);
  } finally {
    await cleanup();
  }
});

test("POST /nusika/shukha-anumpa/drafts updates an existing draft when id is provided", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const create = await app.inject({
      method: "POST", url: "/nusika/shukha-anumpa/drafts",
      payload: { title: "v1", content: "draft v1" },
    });
    const id = create.json().draft.id as string;

    const update = await app.inject({
      method: "POST", url: "/nusika/shukha-anumpa/drafts",
      payload: { id, title: "v2", content: "draft v2", feedback: "stronger now" },
    });
    assert.equal(update.statusCode, 200);
    const updated = update.json().draft;
    assert.equal(updated.id, id);
    assert.equal(updated.title, "v2");
    assert.equal(updated.feedback, "stronger now");

    const list = await app.inject({ method: "GET", url: "/nusika/shukha-anumpa/drafts" });
    assert.equal(list.json().drafts.length, 1, "update must not create a new row");
  } finally {
    await cleanup();
  }
});

test("GET /nusika/shukha-anumpa/drafts/:id returns 404 for unknown id", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const res = await app.inject({ method: "GET", url: "/nusika/shukha-anumpa/drafts/does-not-exist" });
    assert.equal(res.statusCode, 404);
    assert.equal(res.json().ok, false);
  } finally {
    await cleanup();
  }
});

test("POST /nusika/shukha-anumpa/drafts with id from another module returns 404", async () => {
  const { app, db, cleanup } = await bootApp();
  try {
    db.registerModule({ id: "linux", name: "Linux Fundamentals" });
    const otherWork = db.saveCreativeWork("linux", { title: "shell notes", content: "ls -la" });
    const res = await app.inject({
      method: "POST", url: "/nusika/shukha-anumpa/drafts",
      payload: { id: otherWork.id, title: "hijack", content: "should fail" },
    });
    assert.equal(res.statusCode, 404);
  } finally {
    await cleanup();
  }
});

test("POST /nusika/shukha-anumpa/feedback rejects empty content with 400", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const res = await app.inject({
      method: "POST", url: "/nusika/shukha-anumpa/feedback",
      payload: { content: "" },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().ok, false);
  } finally {
    await cleanup();
  }
});

test("POST /nusika/shukha-anumpa/feedback returns 502 with clear error when LLM unavailable", async () => {
  const prevKey = process.env["OPENROUTER_API_KEY"];
  const prevOllama = process.env["NUSIKA_LOCAL_OLLAMA_URL"];
  const prevLocalOnly = process.env["NUSIKA_LOCAL_ONLY"];
  delete process.env["OPENROUTER_API_KEY"];
  process.env["NUSIKA_LOCAL_OLLAMA_URL"] = "http://127.0.0.1:1";
  delete process.env["NUSIKA_LOCAL_ONLY"];

  const { app, cleanup } = await bootApp();
  try {
    const res = await app.inject({
      method: "POST", url: "/nusika/shukha-anumpa/feedback",
      payload: { content: "A short paragraph for feedback." },
    });
    assert.equal(res.statusCode, 502);
    const body = res.json();
    assert.equal(body.ok, false);
    assert.match(body.error, /unavailable/i);
    assert.equal(typeof body.detail, "string");
  } finally {
    await cleanup();
    if (prevKey === undefined) delete process.env["OPENROUTER_API_KEY"];
    else process.env["OPENROUTER_API_KEY"] = prevKey;
    if (prevOllama === undefined) delete process.env["NUSIKA_LOCAL_OLLAMA_URL"];
    else process.env["NUSIKA_LOCAL_OLLAMA_URL"] = prevOllama;
    if (prevLocalOnly === undefined) delete process.env["NUSIKA_LOCAL_ONLY"];
    else process.env["NUSIKA_LOCAL_ONLY"] = prevLocalOnly;
  }
});

// ── Backward-compat: old /nusika/inkwell/* routes still work ────────────────

test("old /nusika/inkwell/drafts alias still works", async () => {
  const { app, cleanup } = await bootApp();
  try {
    // Create via new path
    const create = await app.inject({
      method: "POST", url: "/nusika/shukha-anumpa/drafts",
      payload: { title: "Via new path", content: "Test content." },
    });
    assert.equal(create.statusCode, 201);

    // List via old alias
    const list = await app.inject({ method: "GET", url: "/nusika/inkwell/drafts" });
    assert.equal(list.statusCode, 200);
    assert.equal(list.json().drafts.length, 1);
    assert.equal(list.json().drafts[0].title, "Via new path");
  } finally {
    await cleanup();
  }
});

test("old /nusika/inkwell/drafts POST alias still creates drafts", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const create = await app.inject({
      method: "POST", url: "/nusika/inkwell/drafts",
      payload: { title: "Via old path", content: "Old client content." },
    });
    assert.equal(create.statusCode, 201);

    // Visible via new path
    const list = await app.inject({ method: "GET", url: "/nusika/shukha-anumpa/drafts" });
    assert.equal(list.statusCode, 200);
    assert.equal(list.json().drafts.length, 1);
    assert.equal(list.json().drafts[0].title, "Via old path");
  } finally {
    await cleanup();
  }
});
