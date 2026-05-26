# Magister — Phase 1: db.ts migration fix

> **Date:** 2026-05-26
> **Scope:** `server/db.ts` only — plus `test/db-migration.test.ts`.
> **Companion document:** `docs/MAGISTER_TRUTH_AUDIT.md` (Phase 1 of the
> staged repair plan).

## Symptom

`npm test` reported `183 / 241` passing. Every one of the 58 failures
surfaced the same SQLite error somewhere downstream of a fresh DB:

```
error: table magister_modules has no column named tier
code:  SQLITE_ERROR
```

`registerModule()` was the proximate caller in every case: its `INSERT`
references `tier` and `lab_only`, so any DB that lacked those columns
poisoned the entire test suite.

## Root cause

`server/db.ts` widens the `age_track` CHECK constraint by rebuilding the
`magister_modules` table — SQLite has no `ALTER COLUMN`. The pre-fix
rebuild looked like this:

```sql
ALTER TABLE magister_modules RENAME TO magister_modules_old;
CREATE TABLE magister_modules (
  id, name, campaign_world, subject, description,
  age_track       TEXT NOT NULL DEFAULT 'adult'
                    CHECK (age_track IN ('young_writer','adult','kids','all','any')),
  companions, installed, config_path,
  mastery_spine,
  created_at
);
INSERT INTO magister_modules
SELECT id, name, campaign_world, subject, description, age_track,
       companions, installed, config_path, mastery_spine,
       COALESCE(created_at, '2000-01-01T00:00:00.000Z')
FROM magister_modules_old;
DROP TABLE magister_modules_old;
```

Both the new `CREATE TABLE` and the `INSERT … SELECT` **omitted `tier`
and `lab_only`** even though the additive ALTER TABLE block above the
rebuild had just added them. On a fresh test DB the recreate ran every
time the constructor opened it, dropping the columns silently and
breaking every subsequent test that inserted a module.

Production DBs escaped the bug because the columns were added
historically *after* their CHECK widening had already happened — so the
rebuild path never ran a second time and never had a chance to drop the
columns.

## The fix

Three changes in the rebuild block:

1. `CREATE TABLE magister_modules` now includes `tier TEXT` and
   `lab_only INTEGER NOT NULL DEFAULT 0`. (Also keeps `mastery_spine`.)
2. The `INSERT` lists every target column explicitly. The `SELECT` list
   is built programmatically from `pragma_table_info('magister_modules_old')`:
   columns present on `_old` are referenced by name; columns missing
   from `_old` fall through as `NULL AS <col>` so a future column that
   the additive block adds but `_old` didn't have can still land in the
   new table without breaking the migration.
3. A clarifying comment marks the rebuild as the load-bearing place
   where new columns must be reflected — future schema changes that
   skip this block will repeat the original bug.

The fix is intentionally narrow:

- It does **not** rewrite the DB layer.
- It does **not** change `registerModule`, `getModule`, or any caller.
- It does **not** touch the additive ALTER TABLE block above it.
- It does **not** reset, rebuild, or drop user data on existing DBs:
  the legacy `INSERT … SELECT` is replaced by a `pragma_table_info`-
  driven copy that preserves whatever existed.

## Regression coverage

`test/db-migration.test.ts` adds three regression tests:

1. **Fresh DB lands with `tier` + `lab_only` present.** Boots a fresh
   `MagisterDB`, registers a module with both fields set, verifies
   round-trip and the live column set via
   `pragma_table_info('magister_modules')`.
2. **Legacy schema migrates without losing data.** Seeds a DB by hand
   with the pre-additive schema (narrow CHECK, no `tier` / `lab_only` /
   `mastery_spine`), inserts a legacy row, then opens it with
   `MagisterDB`. Verifies (a) all columns now exist, (b) legacy row
   still readable, (c) the new wider CHECK accepts `age_track='kids'`,
   (d) the older `age_track='adult'` is still valid.
3. **Idempotency.** Opens the same DB twice and verifies the second open
   neither rebuilds nor drifts the column set.

## Validation

```
$ npm test
# tests 244
# pass 243
# fail 1
# skipped 0
# duration_ms 816.547899
```

Compared with the audit baseline (183 / 241):

- **+57 tests pass** that previously failed on the `tier` SQLite error.
- **+3 new regression tests** all pass.
- **1 unrelated failure remains** — `voice-assignments.test.ts`'s
  "buildVoiceRegistry surfaces 31 profiles" spot-checks for
  `maren-default` in the registry, but the inkwell config now binds
  Varros as its companion (working-tree change, separate scope). This
  is a stale curriculum assertion, not a migration regression, and it
  is outside the scope of this phase. To be addressed alongside the
  Phase 2 voice work.

## Files changed

- `server/db.ts` — narrow edit inside the `if (needsMigration)` block.
- `test/db-migration.test.ts` — new file.
- `docs/MAGISTER_PHASE1_DB_FIX.md` — this document.
