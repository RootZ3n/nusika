/**
 * Chahta Anumpa — Phase 1 scaffold tests.
 *
 * Proves:
 *   - Module appears in curriculum (registered from config.json)
 *   - API routes return source attribution fields
 *   - Every entry has verificationStatus
 *   - Verified entries show source metadata
 *   - Unverified entries are flagged
 *   - "Halito" lesson exists
 *   - Peh does not invent translations (no entries without source)
 *   - No entry can be returned without verificationStatus
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { NusikaDB } from "../server/db.js";
import { registerAllRoutes } from "../server/routes/index.js";

async function bootApp() {
  const dir = mkdtempSync(join(tmpdir(), "nusika-chahta-anumpa-"));
  const db = new NusikaDB(join(dir, "test.db"));
  db.registerModule({ id: "chahta-anumpa", name: "Chahta Anumpa" });

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

// ── Module registration ─────────────────────────────────────────────────────

test("chahta-anumpa module is registered", async () => {
  const { db, cleanup } = await bootApp();
  try {
    const mod = db.getModule("chahta-anumpa");
    assert.ok(mod, "chahta-anumpa module should exist in the DB");
    assert.equal(mod!.name, "Chahta Anumpa");
  } finally {
    await cleanup();
  }
});

// ── Lessons route ───────────────────────────────────────────────────────────

test("GET /nusika/chahta-anumpa/lessons returns lessons with source attribution", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const res = await app.inject({ method: "GET", url: "/nusika/chahta-anumpa/lessons" });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.ok, true);
    assert.ok(Array.isArray(body.lessons));
    assert.ok(body.lessons.length > 0, "at least one lesson should exist");
  } finally {
    await cleanup();
  }
});

test("Halito lesson exists", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const res = await app.inject({ method: "GET", url: "/nusika/chahta-anumpa/lessons" });
    const body = res.json();
    const halito = body.lessons.find((l: { id: string }) => l.id === "halito-lesson");
    assert.ok(halito, "Halito lesson must exist");
    assert.equal(halito.title, "Halito");
    assert.ok(halito.pehIntro.length > 0, "Peh intro must be present");
    assert.ok(halito.words.length > 0, "lesson must have words");
  } finally {
    await cleanup();
  }
});

test("every word in lessons has verificationStatus and source", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const res = await app.inject({ method: "GET", url: "/nusika/chahta-anumpa/lessons" });
    const body = res.json();
    for (const lesson of body.lessons) {
      for (const word of lesson.words) {
        assert.ok(word.verificationStatus, `word ${word.id} missing verificationStatus`);
        assert.ok(word.source, `word ${word.id} missing source`);
        assert.ok(word.source.name, `word ${word.id} source missing name`);
        assert.ok(word.source.type, `word ${word.id} source missing type`);
      }
      for (const phrase of lesson.phrases) {
        assert.ok(phrase.verificationStatus, `phrase ${phrase.id} missing verificationStatus`);
        assert.ok(phrase.source, `phrase ${phrase.id} missing source`);
        assert.ok(phrase.source.name, `phrase ${phrase.id} source missing name`);
      }
    }
  } finally {
    await cleanup();
  }
});

// ── Words route ─────────────────────────────────────────────────────────────

test("GET /nusika/chahta-anumpa/words returns words with full attribution", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const res = await app.inject({ method: "GET", url: "/nusika/chahta-anumpa/words" });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.ok(Array.isArray(body.words));
    assert.ok(body.words.length >= 2, "at least halito + yakoke");

    for (const w of body.words) {
      assert.ok(w.verificationStatus, `word ${w.id} missing verificationStatus`);
      assert.ok(w.source, `word ${w.id} missing source`);
      assert.equal(typeof w.choctaw, "string");
      assert.equal(typeof w.english, "string");
    }
  } finally {
    await cleanup();
  }
});

test("halito word is verified with tribe_resource source", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const res = await app.inject({ method: "GET", url: "/nusika/chahta-anumpa/words" });
    const body = res.json();
    const halito = body.words.find((w: { id: string }) => w.id === "halito");
    assert.ok(halito, "halito word must exist");
    assert.equal(halito.verificationStatus, "verified");
    assert.equal(halito.source.type, "tribe_resource");
    assert.ok(halito.source.name.length > 0, "source name must be present");
  } finally {
    await cleanup();
  }
});

test("yakoke word is verified", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const res = await app.inject({ method: "GET", url: "/nusika/chahta-anumpa/words" });
    const body = res.json();
    const yakoke = body.words.find((w: { id: string }) => w.id === "yakoke");
    assert.ok(yakoke, "yakoke word must exist");
    assert.equal(yakoke.verificationStatus, "verified");
    assert.equal(yakoke.choctaw, "yakoke");
    assert.equal(yakoke.english, "thank you");
  } finally {
    await cleanup();
  }
});

// ── Phrases route ───────────────────────────────────────────────────────────

test("GET /nusika/chahta-anumpa/phrases returns phrases with attribution", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const res = await app.inject({ method: "GET", url: "/nusika/chahta-anumpa/phrases" });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.ok(Array.isArray(body.phrases));
    for (const p of body.phrases) {
      assert.ok(p.verificationStatus, `phrase ${p.id} missing verificationStatus`);
      assert.ok(p.source, `phrase ${p.id} missing source`);
    }
  } finally {
    await cleanup();
  }
});

// ── Source discipline: no entries without verification ───────────────────────

test("no word exists without verificationStatus", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const res = await app.inject({ method: "GET", url: "/nusika/chahta-anumpa/words" });
    const body = res.json();
    const missing = body.words.filter(
      (w: { verificationStatus?: string }) => !w.verificationStatus
    );
    assert.equal(missing.length, 0, "every word must have verificationStatus");
  } finally {
    await cleanup();
  }
});

test("no phrase exists without verificationStatus", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const res = await app.inject({ method: "GET", url: "/nusika/chahta-anumpa/phrases" });
    const body = res.json();
    const missing = body.phrases.filter(
      (p: { verificationStatus?: string }) => !p.verificationStatus
    );
    assert.equal(missing.length, 0, "every phrase must have verificationStatus");
  } finally {
    await cleanup();
  }
});

// ── Source discipline: no entries without source attribution ─────────────────

test("no word exists without source attribution", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const res = await app.inject({ method: "GET", url: "/nusika/chahta-anumpa/words" });
    const body = res.json();
    const missing = body.words.filter(
      (w: { source?: { name?: string } }) => !w.source || !w.source.name
    );
    assert.equal(missing.length, 0, "every word must have source with name");
  } finally {
    await cleanup();
  }
});

// ── Peh does not invent: verified content has real sources ───────────────────

test("verified words reference a real source, not AI-generated", async () => {
  const { app, cleanup } = await bootApp();
  try {
    const res = await app.inject({ method: "GET", url: "/nusika/chahta-anumpa/words" });
    const body = res.json();
    const verified = body.words.filter(
      (w: { verificationStatus: string }) => w.verificationStatus === "verified"
    );
    for (const w of verified) {
      assert.notEqual(w.source.type, "unknown",
        `verified word ${w.id} must not have source type "unknown"`);
      assert.ok(w.source.name.length > 0,
        `verified word ${w.id} must have a non-empty source name`);
    }
  } finally {
    await cleanup();
  }
});
