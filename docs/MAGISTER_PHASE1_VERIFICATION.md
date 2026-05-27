# Magister — Phase 1 mechanical verification

> **Verification date:** 2026-05-27
> **Repo:** `/mnt/ai/magister`, branch `main`
> **Author intent:** mechanical baseline only — green tests, green
> build, honest health detection, no identity drift. **No claim is
> being made here that the product is complete, that voice playback
> works end to end, or that real story campaigns exist.**

## Executive summary

The truth audit at `docs/MAGISTER_TRUTH_AUDIT.md` (2026-05-26) called
out two hard mechanical blockers and several truth-level
inconsistencies (stale identities, a service-port collision, prose
that contradicted on-disk reality). Across five commits between
2026-05-26 and 2026-05-27 those blockers were closed and the related
truth gaps were narrowed to the smallest possible patch each.

At the close of Phase 1:

- `npm run typecheck` is **clean**.
- `npm run build` is **clean** (was red on TS2352).
- `npm test` reports **252 / 252 passing** (was 183 / 241 at audit
  baseline; the +69 net comes from 58 cascade failures resolving plus
  11 new regression tests across the four sub-fixes).
- `/magister/voices` no longer falsely reports Kokoro as configured
  when an unrelated uvicorn sidecar happens to share port 18794.
- No companion identity references a character that does not exist in
  the curriculum.

This is a mechanical stability gate, not a product-quality gate. Voice
synthesis was not exercised against a running Kokoro process during
this verification; campaign infrastructure remains the deterministic
SRD engine with no curriculum tie-in; structured lesson content still
only exists for `ai-literacy` and `ai-systems`. Phase 2 (voice truth)
and beyond are described at the end of this document.

## Commits included in Phase 1

| Commit    | Title                                                       | Phase-1 role |
|-----------|-------------------------------------------------------------|--------------|
| `6665bd8` | magister: add full truth audit                              | Audit baseline + repair plan |
| `c964233` | magister: preserve module columns during age track migration | **Blocker #1 closed** — db migration drop of `tier` / `lab_only` |
| `ef84fa3` | magister: align voice tests with varros identity            | Maren → Varros identity drift removed |
| `b6bb029` | magister: park opencode sidecar assumptions                 | Kokoro health probe identity-checked; opencode-sidecar parked as external runtime collision |
| `d06ceda` | magister: fix modules route type conversion                 | **Blocker #2 closed** — TS2352 build error |

Each commit's full message is on `git log`; each has a companion design
document in `docs/MAGISTER_PHASE1_*` or `docs/MAGISTER_OPENCODE_*`.

## Validation commands and results

```
$ npm run typecheck
> magister@0.1.0 typecheck
> tsc -p tsconfig.json --noEmit
(no output — clean)

$ npm run build
> magister@0.1.0 build
> rm -rf dist && tsc -p tsconfig.build.json
(no output — clean; dist/ populated)

$ npm test
# tests 252
# pass 252
# fail 0
# skipped 0
# duration_ms ~750–1010
```

`npm run smoke` (a separate, lighter-weight script that spawns the
server and probes `/health` + `/magister/modules`) was already passing
before Phase 1 and continues to pass. It does not exercise the
migration path because it boots against an already-migrated `state/`
directory; the new `test/db-migration.test.ts` covers that gap.

## Blockers closed in Phase 1

### #1 — DB migration drop of `tier` / `lab_only` (truth audit §10)

**Symptom:** every fresh DB construction tripped the `age_track` CHECK
widening recreate, which omitted `tier` and `lab_only` from both the
new `CREATE TABLE` and the `INSERT … SELECT`. Subsequent
`registerModule()` calls raised
`SQLITE_ERROR: table magister_modules has no column named tier`,
cascading into 58 of 241 unit-test failures.

**Fix:** `server/db.ts` rebuild now includes all current columns and
introspects `pragma_table_info('magister_modules_old')` so the `SELECT`
references only columns the old table actually had — robust against
future additive migrations as well.

**Coverage:** `test/db-migration.test.ts` — three regression tests
(fresh DB, legacy schema migration, reopen idempotency).

**Design doc:** `docs/MAGISTER_PHASE1_DB_FIX.md`.

### #2 — TS2352 production-build error (truth audit §10)

**Symptom:** `npm run build` aborted with TS2352 on
`server/routes/modules.ts:51` (`mod as Record<string, unknown>`).
`MagisterModuleRecord` had no index signature, but more importantly
the cast existed because the public type was lying:
`companions` was typed `string` (the JSON column) while
`parseModuleRow` mutated it in place to `string[]` via `(row as any)`.

**Fix:** `server/db.ts` now splits the SQL row type from the public
record type: internal `MagisterModuleRow` (`companions: string`),
public `MagisterModuleRecord` (`companions: string[]`).
`parseModuleRow` is pure (`Array.isArray` + `(x): x is string`
narrowing). `routes/modules.ts` gains an `EnrichedModule` response
type, an `isCompanionRich` predicate, and a `loadConfigCompanions`
helper; three downstream casts (route widening, `(mod as any)` in
`enrichSession`, and the double-cast in `voice-registry.ts`) all go
away. No `any` added; no tsconfig weakening; no public API change.

**Coverage:** `test/modules-route.test.ts` — five regression tests
(post-parse shape, empty-companions round-trip, rich config join,
missing-config_path fallback, mixed-shape filtering).

**Design doc:** `docs/MAGISTER_PHASE1_BUILD_FIX.md`.

### Related truth fixes landed in the same window

These were not in the truth audit's hard-blocker list but closed
specific §3 / §4 / §6 findings while the Phase 1 batch was open.

#### Maren → Varros identity cleanup

The Inkwell companion was rebound from Maren to Varros in Slice 6E,
but several places still claimed the old identity:

- `server/routes/inkwell.ts` system prompt still began `"You are
  Maren, senior editor"` — every `/magister/inkwell/feedback` call
  contradicted the on-disk curriculum.
- Four module descriptions (`history`, `history-through-story`,
  `science`, `mathematics`) named Maren as the in-world guide even
  though each module shipped a different real companion.
- README, JSDoc, and code comments still used Maren as a live
  example.
- `test/voice-assignments.test.ts` spot-checked for `maren-default`
  (the single test that remained red after the db migration fix).

All renamed; synthetic Maren fixtures in `test/voice-registry.test.ts`
and `test/voices-tts-dispatch.test.ts` are deliberately preserved
because they exercise the registry's legacy ElevenLabs `voice_id`
backcompat branch (the code path is generic, not Maren-specific).

**Design doc:** `docs/MAGISTER_PHASE2_VOICE_IDENTITY_CLEANUP.md`
(the "Phase 2" in that filename is its position in the Phase 1
baseline batch, not the audit's Phase 2 voice-truth slice).

#### opencode-sidecar parked + Kokoro identity check

The audit's §4 finding: `kokoroHealth()` accepted any `{ ok: true }`
body, so an unrelated `opencode-sidecar` uvicorn squatting port 18794
satisfied the probe and Kokoro voices were reported as available
even though `/generate` would 503 at runtime.

A full repo sweep confirmed Magister has no code-level dependency on
opencode-sidecar — only the runtime port collision. The probe now
requires `engine: "kokoro"` in the `/health` body (Kokoro's
`server.py` always emits this); a foreign service is rejected with an
actionable detail naming the squatter and pointing at
`MAGISTER_KOKORO_URL`. Three new regression tests lock the behavior
in. `.env.example` and README updated to explain the identity check.

No service was started or stopped from the repo. Operator notes for
parking opencode-sidecar locally live in the design doc; Aedis is
named as the intended future orchestration host so opencode-sidecar
does not creep back in as an assumed dependency.

**Design doc:** `docs/MAGISTER_OPENCODE_SIDECAR_PARKING.md`.

## Remaining known issues (carried forward)

These were either explicitly out of scope for Phase 1 or surfaced by
the audit but not yet addressed. They are documented honestly to
avoid implying the system is finished.

### Voice (still not runtime-verified)

- `web/app/hooks/useVoicePlayback.ts` sends `{ text, role }` to
  `/magister/tts`; the server schema reads `{ text, voice, scope }`.
  Every TTS call from the Hall path therefore falls through to the
  default Piper voice regardless of companion. **Audit §4 finding 5;
  still open.**
- Piper has exactly one voice file installed (`en_GB-alba-medium`).
  Any per-companion Piper request still 503s.
- `magister-kokoro.service` is registered under `systemctl --user`
  but inactive. Whether Kokoro should auto-start, or whether Magister
  should set `MAGISTER_VOICE_FALLBACK=piper` and drop the README
  claim, is undecided.
- No end-to-end TTS round-trip (synthesis + browser playback) was
  exercised in this verification. The Kokoro identity check landed
  here proves the registry will fail honestly when Kokoro is down;
  it does not prove that Kokoro is up.

### Campaigns (still not real story campaigns)

- The `/dm` surface is a deterministic SRD-style engine. There is no
  campaign generator, no chapter system, no narrative arc, no
  curriculum tie-in.
- `magister_dm_campaigns.world_memory` and `quest_state` columns
  remain JSON blobs that no code writes.
- "New campaign" in the Hall UI still creates a single-concept
  session, not a multi-arc campaign. (Audit §5.)

### Curriculum depth

- Only `ai-literacy` and `ai-systems` ship structured `lessons[]`,
  `practice_activities[]`, and `review_questions[]`. The remaining
  17 modules carry companion personality + a domain concept list.
- No structured-lesson rendering UI exists even for the two modules
  that ship the data; the field is served at `GET /magister/modules/:id`
  and consumed by nothing.

### Other audit items still open

- Auth, rate-limit on LLM-backed routes, CORS hardening
  (truth audit §10 soft blockers).
- README pluralization fixes (`17 modules` → `19`), test-count
  rewording where it implies green.
- The two new `contrib/systemd/*.system.service` files remain
  uncommitted in the working tree (audit §10 blocker #5).

## Recommended Phase 2 priorities

Following the truth audit's own staged repair plan
(`docs/MAGISTER_TRUTH_AUDIT.md` §11), Phase 2 is **voice truth**.
Concretely:

1. **Decide Kokoro's runtime story** — auto-start under systemd, or
   document Piper as the supported default and set
   `MAGISTER_VOICE_FALLBACK=piper`. The identity check landed in
   Phase 1 makes either path safe.
2. **Fix the Hall path voice routing** — `useVoicePlayback.ts` must
   send `scope: companionId` so each companion plays its own voice.
   Add a test (probably the existing `voices-tts-dispatch.test.ts`
   shape) for the round-trip.
3. **Add a voice picker + Preview button to the Hall's Session view**
   so it matches `/teach` and `/dm`. Today the Hall has none.
4. **Run one end-to-end TTS smoke** against a live Kokoro and document
   the result honestly (works / doesn't / partial). This is the
   piece Phase 1 explicitly did not do.

Items beyond Phase 2 (coherent UI, content depth, real campaigns,
public-release security posture) follow the audit's §11 phase
breakdown unchanged.

## Files touched by this verification pass

- `docs/MAGISTER_TRUTH_AUDIT.md` — added a Phase-1-status section
  near the top so future readers see the closed blockers without
  reading 600 lines first.
- `docs/MAGISTER_PHASE2_VOICE_IDENTITY_CLEANUP.md` — added a naming
  note clarifying that "Phase 2" in the filename is the second
  baseline-cleanup task inside the audit's Phase 1 batch, not the
  audit's Phase 2 voice-truth slice.
- `docs/MAGISTER_PHASE1_VERIFICATION.md` — this document.

No code, no schema, no tests touched in this verification. The
re-run of `npm run typecheck`, `npm run build`, and `npm test` was
the verification.
