import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NusikaDB, computeNextReaffirm } from "../server/db.js";

function freshDb(): { db: NusikaDB; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "magister-test-"));
  const db = new NusikaDB(join(dir, "test.db"));
  return {
    db,
    cleanup: () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("session lifecycle: create → tick → hint → end", () => {
  const { db, cleanup } = freshDb();
  try {
    db.registerModule({ id: "linux", name: "Linux Fundamentals" });

    const session = db.createSession("linux", {
      atom: {
        concept_id: "filesystem-basics",
        objective: "Navigate the filesystem",
        mastery_signal: "Can move between directories",
      },
      teachingMode: "narrative",
      durationTarget: 600,
    });

    assert.equal(session.module_id, "linux");
    assert.equal(session.status, "active");
    assert.equal(session.atom_concept_id, "filesystem-basics");
    assert.equal(session.elapsed_seconds, 0);

    const tick = db.tickSession(session.id, 30);
    assert.ok(tick);
    assert.equal(tick!.elapsed, 30);
    assert.equal(tick!.remaining, 570);

    const afterHint = db.recordHint(session.id, 2);
    assert.ok(afterHint);
    assert.equal(afterHint!.hint_count_l2, 1);

    const ended = db.endSession(session.id, "covered ls and cd");
    assert.equal(ended, true);
    const got = db.getSession(session.id);
    assert.equal(got!.status, "complete");
    assert.equal(got!.session_summary, "covered ls and cd");
  } finally {
    cleanup();
  }
});

test("createSession rejects empty atom fields", () => {
  const { db, cleanup } = freshDb();
  try {
    db.registerModule({ id: "linux", name: "Linux Fundamentals" });
    assert.throws(
      () => db.createSession("linux", {
        atom: { concept_id: "", objective: "x", mastery_signal: "y" },
      }),
      /concept_id/,
    );
  } finally {
    cleanup();
  }
});

test("progress upsert rejects mode-prefixed concept ids", () => {
  const { db, cleanup } = freshDb();
  try {
    db.registerModule({ id: "linux", name: "Linux Fundamentals" });
    assert.throws(
      () => db.updateProgress("jeff", "linux", "campaign:filesystem", { mastery_level: "introduced" }),
      /colon/i,
    );
  } finally {
    cleanup();
  }
});

test("computeNextReaffirm returns ISO date in the future", () => {
  const before = Date.now();
  const next = new Date(computeNextReaffirm("introduced")).getTime();
  assert.ok(next > before, "next_reaffirm must be in the future");
});

test("companion memory writeback rejects unknown keys", () => {
  const { db, cleanup } = freshDb();
  try {
    assert.throws(
      // @ts-expect-error — intentionally invalid
      () => db.saveCompanionMemory("marcus", { unknown_field: "x" }),
      /writeback failed validation/,
    );
  } finally {
    cleanup();
  }
});
