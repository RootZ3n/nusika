import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { MagisterDB } from "../server/db.js";

/**
 * Regression tests for the age_track CHECK-constraint upgrade in db.ts.
 *
 * History: before this fix, the migration that rebuilt magister_modules to
 * widen the age_track CHECK constraint left `tier` and `lab_only` out of
 * both the recreated CREATE TABLE and the INSERT … SELECT. The result was
 * that any DB constructed by `new MagisterDB(...)` against a path whose
 * initial CREATE TABLE used the old narrow CHECK would lose those columns
 * — and every later `registerModule({ tier, labOnly })` would throw
 * `SQLITE_ERROR: table magister_modules has no column named tier`,
 * cascading into 58 unrelated test failures.
 *
 * These tests prove three properties of the migration:
 *   1. A fresh DB lands with `tier` and `lab_only` columns present and
 *      `registerModule` can write them.
 *   2. A DB that started life with the old narrow schema migrates to the
 *      new wider CHECK constraint AND retains `tier` / `lab_only`,
 *      including any data the additive ALTER TABLE block populated.
 *   3. The migration is idempotent — running the constructor twice on
 *      the same on-disk file does not corrupt rows or schema.
 */

function freshDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "magister-mig-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function columnNames(dbFile: string, table: string): string[] {
  const raw = new Database(dbFile, { readonly: true });
  try {
    const rows = raw.prepare(`SELECT name FROM pragma_table_info(?)`).all(table) as Array<{ name: string }>;
    return rows.map(r => r.name);
  } finally {
    raw.close();
  }
}

test("fresh DB has tier + lab_only columns and registerModule can write them", () => {
  const { dir, cleanup } = freshDir();
  const dbFile = join(dir, "fresh.db");
  try {
    const db = new MagisterDB(dbFile);
    try {
      db.registerModule({
        id: "linux",
        name: "The Sovereign Grid",
        ageTrack: "adult",
        tier: "advanced",
        labOnly: true,
      });
      const mod = db.getModule("linux");
      assert.ok(mod, "module must round-trip");
      assert.equal(mod!.tier, "advanced");
      assert.equal(mod!.lab_only, 1);
    } finally {
      db.close();
    }
    const cols = columnNames(dbFile, "magister_modules");
    assert.ok(cols.includes("tier"), `expected tier column; got [${cols.join(", ")}]`);
    assert.ok(cols.includes("lab_only"), `expected lab_only column; got [${cols.join(", ")}]`);
  } finally {
    cleanup();
  }
});

test("age_track CHECK migration preserves tier and lab_only data", () => {
  const { dir, cleanup } = freshDir();
  const dbFile = join(dir, "legacy.db");
  try {
    // Recreate the pre-migration schema by hand: narrow CHECK, none of
    // the additive columns yet. This is the on-disk shape a database that
    // was created before any of the additive migrations would have.
    const seed = new Database(dbFile);
    seed.exec(`
      CREATE TABLE magister_modules (
        id              TEXT PRIMARY KEY,
        name            TEXT NOT NULL,
        campaign_world  TEXT,
        subject         TEXT,
        description     TEXT,
        age_track       TEXT NOT NULL DEFAULT 'adult' CHECK (age_track IN ('young_writer', 'adult')),
        companions      TEXT NOT NULL DEFAULT '[]',
        installed       INTEGER NOT NULL DEFAULT 0,
        config_path     TEXT,
        created_at      TEXT NOT NULL
      );
      INSERT INTO magister_modules
        (id, name, campaign_world, subject, description, age_track, companions, installed, config_path, created_at)
      VALUES
        ('legacy', 'Legacy module', 'Old World', 'Subject', 'desc', 'adult', '[]', 1, NULL, '2025-01-01T00:00:00.000Z');
    `);
    seed.close();

    // Boot MagisterDB on this legacy file. The constructor will:
    //   1. CREATE TABLE IF NOT EXISTS — no-op (table exists).
    //   2. ALTER TABLE ADD COLUMN mastery_spine / tier / lab_only.
    //   3. Probe with age_track='kids' — old CHECK rejects → needsMigration.
    //   4. Rebuild magister_modules with the wider CHECK and the full
    //      column set, copying every old column verbatim.
    const db = new MagisterDB(dbFile);
    try {
      const cols = columnNames(dbFile, "magister_modules");
      assert.ok(cols.includes("tier"), `tier must survive migration; got [${cols.join(", ")}]`);
      assert.ok(cols.includes("lab_only"), `lab_only must survive migration; got [${cols.join(", ")}]`);
      assert.ok(cols.includes("mastery_spine"), `mastery_spine must survive migration; got [${cols.join(", ")}]`);

      // Legacy row still readable.
      const legacy = db.getModule("legacy");
      assert.ok(legacy, "legacy row must survive recreate");
      assert.equal(legacy!.name, "Legacy module");
      assert.equal(legacy!.age_track, "adult");
      assert.equal(legacy!.tier, null);
      assert.equal(legacy!.lab_only, 0);

      // Newly-allowed age_track value now writable.
      db.registerModule({
        id: "kids-module",
        name: "Kids Module",
        ageTrack: "kids",
        tier: "premium_kids",
        labOnly: false,
      });
      const kids = db.getModule("kids-module");
      assert.ok(kids);
      assert.equal(kids!.age_track, "kids");
      assert.equal(kids!.tier, "premium_kids");
      assert.equal(kids!.lab_only, 0);

      // Old age_track values still valid.
      db.registerModule({
        id: "adult-module",
        name: "Adult Module",
        ageTrack: "adult",
        tier: "advanced",
        labOnly: true,
      });
      const adult = db.getModule("adult-module");
      assert.ok(adult);
      assert.equal(adult!.tier, "advanced");
      assert.equal(adult!.lab_only, 1);
    } finally {
      db.close();
    }
  } finally {
    cleanup();
  }
});

test("re-opening a migrated DB is a no-op (idempotency)", () => {
  const { dir, cleanup } = freshDir();
  const dbFile = join(dir, "twice.db");
  try {
    // First open: any CHECK widening happens here.
    const first = new MagisterDB(dbFile);
    try {
      first.registerModule({
        id: "twice",
        name: "Open twice",
        ageTrack: "kids",
        tier: "premium_kids",
        labOnly: true,
      });
    } finally {
      first.close();
    }
    const colsAfterFirst = columnNames(dbFile, "magister_modules");

    // Second open: probe should pass without recreating the table.
    const second = new MagisterDB(dbFile);
    try {
      const mod = second.getModule("twice");
      assert.ok(mod, "row must survive a second boot");
      assert.equal(mod!.tier, "premium_kids");
      assert.equal(mod!.lab_only, 1);
    } finally {
      second.close();
    }
    const colsAfterSecond = columnNames(dbFile, "magister_modules");
    assert.deepEqual(colsAfterSecond, colsAfterFirst, "column set must not drift across reopens");
  } finally {
    cleanup();
  }
});
