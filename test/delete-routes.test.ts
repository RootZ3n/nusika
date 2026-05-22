/**
 * Slice 5B — DELETE routes for Inkwell drafts, lessons, and DM campaigns.
 *
 * Coverage:
 *   - happy paths
 *   - 404 on unknown id
 *   - cross-module rejection for the Inkwell route
 *   - FK cascade (lesson turns / DM characters + events) verified through DB
 *   - listing endpoints reflect the deletion
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { MagisterDB, type DmEvent } from "../server/db.js";
import { registerAllRoutes } from "../server/routes/index.js";
import { __setCompleteForTesting, __resetCompleteForTesting } from "../server/lib/llm.js";

async function bootApp() {
  const dir = mkdtempSync(join(tmpdir(), "magister-5b-"));
  const db = new MagisterDB(join(dir, "test.db"));
  db.registerModule({ id: "inkwell", name: "The Inkwell" });
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

// ── Inkwell delete ──────────────────────────────────────────────────────────

test("DELETE /magister/inkwell/drafts/:id removes the draft and the list reflects it", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const create = await app.inject({
      method: "POST", url: "/magister/inkwell/drafts",
      payload: { title: "Soon to be erased", content: "A first sentence." },
    });
    const id = create.json().draft.id as string;

    const beforeList = await app.inject({ method: "GET", url: "/magister/inkwell/drafts" });
    assert.equal(beforeList.json().drafts.length, 1);

    const del = await app.inject({ method: "DELETE", url: `/magister/inkwell/drafts/${id}` });
    assert.equal(del.statusCode, 200);
    const body = del.json();
    assert.equal(body.ok, true);
    assert.equal(body.deleted, true);
    assert.equal(body.id, id);

    const afterList = await app.inject({ method: "GET", url: "/magister/inkwell/drafts" });
    assert.deepEqual(afterList.json().drafts, []);

    const single = await app.inject({ method: "GET", url: `/magister/inkwell/drafts/${id}` });
    assert.equal(single.statusCode, 404);
  } finally {
    await cleanup();
  }
});

test("DELETE /magister/inkwell/drafts/:id returns 404 for unknown id", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const res = await app.inject({ method: "DELETE", url: "/magister/inkwell/drafts/no-such-id" });
    assert.equal(res.statusCode, 404);
  } finally {
    await cleanup();
  }
});

test("DELETE /magister/inkwell/drafts/:id refuses to delete a creative row from another module", async () => {
  const { app, db, cleanup } = await bootApp();
  try {
    // Create a creative work owned by a different module via the DB.
    const otherWork = db.saveCreativeWork("linux", { title: "shell notes", content: "ls -la" });

    // Delete attempt via the Inkwell route must fail with 404 — the row
    // is real but doesn't belong to the inkwell module.
    const del = await app.inject({
      method: "DELETE", url: `/magister/inkwell/drafts/${otherWork.id}`,
    });
    assert.equal(del.statusCode, 404);

    // The non-inkwell row must still exist.
    const stillThere = db.getCreativeWork(otherWork.id);
    assert.ok(stillThere, "cross-module creative row must not be deleted");
    assert.equal(stillThere!.module_id, "linux");
  } finally {
    await cleanup();
  }
});

// ── Lesson delete ───────────────────────────────────────────────────────────

test("DELETE /magister/lessons/:id removes the lesson and cascades turns", async () => {
  const { app, db, cleanup } = await bootApp();
  __setCompleteForTesting(async () => ({
    text: "ok.", model: "m", provider: "openrouter",
    tokensIn: 1, tokensOut: 1, estimatedCostUsd: 0, durationMs: 1,
  }));
  try {
    const create = await app.inject({
      method: "POST", url: "/magister/lessons",
      payload: { title: "What is gravity?" },
    });
    const id = create.json().lesson.id as string;

    // Add a turn so we can verify the cascade fires.
    await app.inject({
      method: "POST", url: `/magister/lessons/${id}/chat`,
      payload: { message: "explain it" },
    });
    const beforeTurns = db.getLessonTurns(id);
    assert.ok(beforeTurns.length >= 2, "expected user + assistant turn");

    const del = await app.inject({ method: "DELETE", url: `/magister/lessons/${id}` });
    assert.equal(del.statusCode, 200);
    assert.equal(del.json().deleted, true);
    assert.equal(del.json().id, id);

    const afterList = await app.inject({ method: "GET", url: "/magister/lessons" });
    assert.deepEqual(afterList.json().lessons, []);
    assert.deepEqual(db.getLessonTurns(id), [], "turns must cascade with the lesson");
    assert.equal(db.getLesson(id), null);
  } finally {
    __resetCompleteForTesting();
    await cleanup();
  }
});

test("DELETE /magister/lessons/:id returns 404 for unknown id", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const res = await app.inject({ method: "DELETE", url: "/magister/lessons/no-such-lesson" });
    assert.equal(res.statusCode, 404);
  } finally {
    await cleanup();
  }
});

// ── DM campaign delete ─────────────────────────────────────────────────────

test("DELETE /magister/dm/campaigns/:id removes the campaign and cascades character + events", async () => {
  const { app, db, cleanup } = await bootApp();
  try {
    const create = await app.inject({
      method: "POST", url: "/magister/dm/campaigns",
      payload: { title: "to be deleted" },
    });
    const cid = create.json().campaign.id as string;

    // Add a character (1 event) and a roll (1 more event) so we can test cascade.
    await app.inject({
      method: "POST", url: `/magister/dm/campaigns/${cid}/character`,
      payload: { name: "Korr", ancestry: "human", class_name: "fighter" },
    });
    await app.inject({
      method: "POST", url: `/magister/dm/campaigns/${cid}/roll`,
      payload: { formula: "1d20", label: "perception" },
    });

    const beforeLog = await app.inject({ method: "GET", url: `/magister/dm/campaigns/${cid}/log` });
    assert.ok((beforeLog.json().events as DmEvent[]).length >= 3);
    assert.ok(db.getDmCharacter(cid), "character should exist before delete");

    const del = await app.inject({ method: "DELETE", url: `/magister/dm/campaigns/${cid}` });
    assert.equal(del.statusCode, 200);
    assert.equal(del.json().deleted, true);

    assert.equal(db.getDmCampaign(cid), null);
    assert.equal(db.getDmCharacter(cid), null, "character must cascade");
    assert.deepEqual(db.listDmEvents(cid), [], "events must cascade");

    const list = await app.inject({ method: "GET", url: "/magister/dm/campaigns" });
    assert.deepEqual(list.json().campaigns, []);
  } finally {
    await cleanup();
  }
});

test("DELETE /magister/dm/campaigns/:id returns 404 for unknown id", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const res = await app.inject({ method: "DELETE", url: "/magister/dm/campaigns/no-such-campaign" });
    assert.equal(res.statusCode, 404);
  } finally {
    await cleanup();
  }
});

test("PATCH /magister/dm/campaigns/:id with status='complete' is the lossless archive path", async () => {
  // This locks in the archive contract used by the /dm UI's Archive button:
  // status flips, completed_at lands, but events + character remain.
  const { app, db, cleanup } = await bootApp();
  try {
    const create = await app.inject({
      method: "POST", url: "/magister/dm/campaigns",
      payload: { title: "to be archived" },
    });
    const cid = create.json().campaign.id as string;
    await app.inject({
      method: "POST", url: `/magister/dm/campaigns/${cid}/character`,
      payload: { name: "Mira", ancestry: "human", class_name: "wizard" },
    });

    const patch = await app.inject({
      method: "PATCH", url: `/magister/dm/campaigns/${cid}`,
      payload: { status: "complete" },
    });
    assert.equal(patch.statusCode, 200);
    assert.equal(patch.json().campaign.status, "complete");
    assert.ok(typeof patch.json().campaign.completed_at === "string");

    // Lossless: character + events still readable.
    assert.ok(db.getDmCharacter(cid), "character preserved through archive");
    assert.ok(db.listDmEvents(cid).length >= 2, "events preserved through archive");
  } finally {
    await cleanup();
  }
});
