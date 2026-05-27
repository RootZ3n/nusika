# Magister — Phase 1: TS build fix (modules.ts TS2352)

> **Date:** 2026-05-27
> **Scope:** smallest correct fix to `npm run build` so it stops failing
> on the modules-route conversion error, plus the underlying type/runtime
> mismatch that caused it.
> **Companion documents:** `docs/MAGISTER_TRUTH_AUDIT.md`,
> `docs/MAGISTER_PHASE1_DB_FIX.md`,
> `docs/MAGISTER_PHASE2_VOICE_IDENTITY_CLEANUP.md`,
> `docs/MAGISTER_OPENCODE_SIDECAR_PARKING.md`.

## Symptom

```
$ npm run build
server/routes/modules.ts(51,17): error TS2352:
  Conversion of type 'MagisterModuleRecord' to type 'Record<string, unknown>'
  may be a mistake because neither type sufficiently overlaps with the other.
  If this was intentional, convert the expression to 'unknown' first.
  Index signature for type 'string' is missing in type 'MagisterModuleRecord'.
```

The truth audit listed this as Phase 1 blocker #2; Phases 1–3 of repair
left it untouched. With this change it is closed.

## Root cause

A static-type / runtime-shape disagreement that the type system was
correctly objecting to:

- **`MagisterModuleRecord.companions`** was declared as `string`
  (the raw JSON blob written into the SQLite column).
- **`db.parseModuleRow()`** mutated the field in place via
  `(row as any).companions = JSON.parse(row.companions)`, leaving the
  runtime shape as `string[]` while the static type still claimed
  `string`.
- Every reader needed to compensate. The `/magister/modules` route did
  it by widening to `mod as Record<string, unknown>` and then accessing
  `m.companions` as an array. Under `strict` + `noUncheckedIndexedAccess`
  + `exactOptionalPropertyTypes` the conversion is a real lie:
  `MagisterModuleRecord` has no index signature, so TS2352 fires.
- The voice registry made the same compensation more defensively
  (`as unknown as { companions: unknown }` then a second cast to
  `string[]`). The pattern of escape-hatching the static type was
  spreading every time a new reader landed.

Suppressing the cast site would have papered the symptom; the underlying
issue was that the public record type was lying about what callers
receive.

## Fix

Three narrow, type-safe changes:

### 1. Split the row type from the public record type — `server/db.ts`

A new internal `MagisterModuleRow` mirrors the SQL columns 1-to-1 with
`companions: string` (the stored JSON blob). The public
`MagisterModuleRecord` now declares `companions: string[]`, matching the
post-parse runtime shape every caller already expects.

```ts
export interface MagisterModuleRecord {
  // ...
  companions: string[];
  // ...
}

interface MagisterModuleRow extends Omit<MagisterModuleRecord, "companions"> {
  companions: string;
}
```

### 2. Make `parseModuleRow` pure — `server/db.ts`

`parseModuleRow(row: MagisterModuleRow): MagisterModuleRecord` returns a
fresh record built from the row plus a typed JSON parse:

```ts
private parseModuleRow(row: MagisterModuleRow): MagisterModuleRecord {
  let companions: string[] = [];
  try {
    const parsed = JSON.parse(row.companions) as unknown;
    if (Array.isArray(parsed)) {
      companions = parsed.filter((x): x is string => typeof x === "string");
    }
  } catch { /* malformed JSON → empty list, matches legacy behavior */ }
  return { ...row, companions };
}
```

The `as any` mutation is gone. The malformed-JSON branch behaves as
before (empty list, no throw) so an in-place corrupt row doesn't crash
the whole module list.

`listModules` and `getModule` now type the SQL result as
`MagisterModuleRow` and hand each row to `parseModuleRow`.

`registerModule` builds a row for the SQL bind (string companions) and
returns `parseModuleRow(row)`, so callers always receive the parsed
public shape.

### 3. Drop the lying casts in route + registry

- **`server/routes/modules.ts`**: the `Record<string, unknown>` widening
  is gone. A new `EnrichedModule` type captures what the route actually
  returns (`MagisterModuleRecord` with `companions: CompanionRich[]`
  instead of `string[]`). A helper `loadConfigCompanions(configPath)`
  reads the on-disk config and filters to entries that pass an
  `isCompanionRich` predicate, so the route never trusts an unvalidated
  shape. Unknown ids still fall back to `{ id, name: id }`.

- **`enrichSession`** in the same file lost its `(mod as any).companions`
  cast. It can now read `mod.companions` directly as `string[]`.

- **`server/lib/voice-registry.ts`**: the
  `as unknown as { companions: unknown }` + second cast pair collapses
  to a direct `mod.companions` iteration.

No `any` was introduced. No `unknown` cast was used to escape runtime
checks — the only `as unknown` is inside `JSON.parse(...) as unknown`,
which is then narrowed with `Array.isArray` + an inline type guard.

## Regression tests

`test/modules-route.test.ts` (new) locks in five behaviors:

1. `MagisterModuleRecord.companions` round-trips as `string[]` (not the
   stored JSON blob).
2. A `registerModule` call with no companions returns an empty array,
   not a stringified `"[]"`.
3. `GET /magister/modules` joins rich companion config (name,
   accent_color) into the response when `config_path` resolves.
4. Missing or unreadable `config_path` falls back gracefully to
   `{ id, name: id }` per companion and never throws.
5. A config with mixed-shape companion entries (rich, bare string,
   id-less) ignores the non-rich entries instead of mis-typing them.

The existing `test/db-migration.test.ts` regression tests still pass
unchanged.

## What this is **not**

- **Not** a public API change. `GET /magister/modules` returns the same
  body it did before (rich companion objects with id + name + accent).
  The new `EnrichedModule` type just names the shape callers were
  already receiving.
- **Not** a tsconfig weakening. `strict`, `noImplicitAny`,
  `strictNullChecks`, `noUncheckedIndexedAccess`, and
  `exactOptionalPropertyTypes` are all unchanged and still passing.
- **Not** an `any` insertion. No new `any` was added. One pre-existing
  `(row as any)` was removed.
- **Not** a broader refactor. Three files in `server/`, one new test
  file, this doc.

## Validation

```
$ npm run typecheck
> magister@0.1.0 typecheck
> tsc -p tsconfig.json --noEmit
(clean — no output)

$ npm run build
> magister@0.1.0 build
> rm -rf dist && tsc -p tsconfig.build.json
(clean — no output, dist/ populated)

$ npm test
# tests 252
# pass 252
# fail 0
# skipped 0
# duration_ms 1013.300925
```

Was 247/247 going into this change; the five new `modules-route` tests
bring it to 252/252.

This closes Phase 1 blocker #2. With #1 (the `tier` migration) and #2
both fixed, the project now has a green test suite **and** a green
production build for the first time since the truth audit was written.

## Files changed

- `server/db.ts` — split row vs record types, pure `parseModuleRow`,
  typed `registerModule` flow.
- `server/routes/modules.ts` — `EnrichedModule` response type,
  `loadConfigCompanions` helper, dropped two casts in the route + one
  in `enrichSession`.
- `server/lib/voice-registry.ts` — dropped the double-cast on the
  fallback companion-id branch.
- `test/modules-route.test.ts` — new regression suite.
- `docs/MAGISTER_PHASE1_BUILD_FIX.md` — this document.
