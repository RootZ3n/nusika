# Magister — Phase 2: voice identity cleanup (Maren → Varros)

> **Date:** 2026-05-26
> **Scope:** narrow Maren → Varros rename across stale references.
> **Companion documents:** `docs/MAGISTER_TRUTH_AUDIT.md`,
> `docs/MAGISTER_PHASE1_DB_FIX.md`,
> `docs/MAGISTER_PHASE1_VERIFICATION.md`.
>
> **Naming note:** the "Phase 2" in this filename refers to the
> *second baseline-cleanup task landed after the db migration fix*,
> not to the truth audit's Phase 2 (voice truth) slice. Both this doc
> and the db-fix doc belong to the audit's **Phase 1**
> (mechanical truth + baseline stability) batch — see
> `docs/MAGISTER_PHASE1_VERIFICATION.md` for the mapping.

## Symptom

After the Phase 1 db migration fix, the test suite went from 183/241 to
243/244. The remaining red was one assertion in
`test/voice-assignments.test.ts`:

```
not ok 193 - buildVoiceRegistry surfaces 31 profiles ...
  error: 'expected maren-default in registry'
```

The test spot-checked the live voice registry for `maren-default`. Maren
had been the Inkwell companion (on an ElevenLabs voice). The 2026-05
rebind switched the Inkwell config to **Varros** on a local Kokoro voice
— the same persona that narrates the Hall, `/teach`, and `/dm`. The
registry no longer surfaces a Maren profile because no shipped companion
carries that id.

## What was checked

A full repo grep for `Maren` / `maren` (case-insensitive) found
references in four shapes:

1. **Active code that still claimed Maren's identity.** Most
   user-facing: `server/routes/inkwell.ts` carried a system prompt that
   began `"You are Maren, senior editor and writing guide…"`. The LLM
   was instructed to be Maren on every Inkwell feedback request, even
   though the on-disk inkwell config binds Varros. This was a real
   identity drift bug — the model and the curriculum disagreed.
2. **The failing test assertion.** The spot-check list in
   `test/voice-assignments.test.ts` still expected `maren-default`.
3. **Stale flavor prose in curriculum descriptions.** Four module
   descriptions (`history`, `history-through-story`, `science`,
   `mathematics`) opened by naming Maren as the in-world companion,
   even though each module ships a different actual companion
   (Vermilion, Codex, Nova, Tessera respectively). The library card a
   learner sees was naming a character who never appears in the chat.
4. **Stale documentation prose and code comments.** README, JSDoc
   examples in `voice-picker.ts`, an "e.g. maren" in
   `server/routes/voice.ts`, and a Maren-specific framing of the
   ElevenLabs branch in `server/lib/voice-registry.ts`.
5. **Synthetic test fixtures.** `test/voice-registry.test.ts` and
   `test/voices-tts-dispatch.test.ts` use `"maren"` as a fixture id to
   exercise the legacy ElevenLabs `voice_id` code path that the
   registry still honors.

## Classification and decisions

| Reference | Classification | Action |
|---|---|---|
| `server/routes/inkwell.ts` system prompt (`"You are Maren…"`) | Stale active code | **Renamed to Varros** with a paragraph explaining the rebind |
| `server/routes/inkwell.ts` route + file-level comments | Stale active code | Renamed to Varros |
| `test/voice-assignments.test.ts:155` spot-check | Stale assertion | Replaced `maren` with `vermilion` (history) so module coverage stays as broad |
| `curriculum/history/config.json` description | Stale flavor prose | Renamed to Vermilion + corrected pronouns (`bm_george`) |
| `curriculum/history-through-story/config.json` description | Stale flavor prose | Renamed to Codex + corrected pronouns (`bm_fable`) |
| `curriculum/science/config.json` description | Stale flavor prose | Renamed to Nova (kept `she` — `af_heart`) |
| `curriculum/mathematics/config.json` description | Stale flavor prose | Renamed to Tessera (kept `she` — `af_aoede`) |
| `README.md` `/magister/inkwell/feedback` row | Stale doc prose | Maren → Varros |
| `README.md` "Maren has been migrated…" paragraph | Stale doc prose | Rewritten to "Inkwell companion (formerly Maren on an ElevenLabs voice) was rebound to Varros…" |
| `README.md` Slice-6E status bullet | Stale doc prose | Maren → Varros |
| `server/lib/voice-registry.ts` two ElevenLabs branch comments | Stale code comments | Reworded so the historical context is preserved without implying Maren still exists as an active companion |
| `server/routes/voice.ts:246` "e.g. maren" example | Stale code comment | Replaced with `vermilion` |
| `web/app/lib/voice-picker.ts:28` JSDoc example | Stale doc comment | Replaced with `Vermilion — bm_george` |
| `test/voice-registry.test.ts` synthetic Maren fixture | Intentional fixture | **Kept** — exercises the legacy ElevenLabs `voice_id` branch in `voice-registry.ts` |
| `test/voices-tts-dispatch.test.ts` synthetic Maren fixture | Intentional fixture | **Kept** — exercises the deprecated ElevenLabs dispatch path |
| `test/voice-assignments.test.ts:7,205` "(Maren migrated)" comments | Historical | **Kept** — accurate historical tag for the elevenlabs invariant |
| `docs/VOICEBOX-AUDIT.md` | Frozen historical audit | **Kept** — snapshot from 2026-05-10 |
| `server/routes/inkwell.ts` identity-note comment | New | Added as part of this change, documents the rebind for the next reader |

The "fixture vs character" split matters: the registry has a generic
backcompat code path for any companion shipped with a top-level
ElevenLabs `voice_id`. That branch is still real; its unit tests need a
fixture name; using `maren` as the historical example is the most
literate choice. Replacing it would erase the trail of where the branch
came from.

## Backward compatibility for saved data

The DB exposes one place where Maren's identity could be persisted:
`magister_memory` rows are keyed by `companion_id`. Pre-rebind rows where
`companion_id = "maren"` may still exist in some instances (the
production DB at audit time had only 4 memory rows total; whether any
are Maren's is environment-specific).

**Decision:** no migration code. Rationale:

- The registry no longer surfaces a Maren profile, so old memory rows
  for that id are simply unreferenced — not deleted, not corrupted, not
  exposed.
- Migrating them to `companion_id="varros"` would risk merging two
  distinct conversational histories: Varros also accrues memory through
  the Hall narrator path, the `/teach` lessons, and now the Inkwell
  feedback flow. Concatenating Maren's old draft-editor memories into
  Varros's general narrator memory would distort future system prompts
  in subtle ways.
- The right move if a user wants to clean those up is a one-line
  `DELETE FROM magister_memory WHERE companion_id='maren'` — documented
  here, not silently performed.

If that becomes a recurring concern, a follow-up phase can add an
explicit `magister memory prune --companion maren` admin path.

## Validation

```
$ npm test
# tests 244
# pass 244
# fail 0
# skipped 0
# duration_ms 812.948542

$ npm run build
server/routes/modules.ts(51,17): error TS2352:
  Conversion of type 'MagisterModuleRecord' to type 'Record<string, unknown>'
  may be a mistake because neither type sufficiently overlaps with the other.
  Index signature for type 'string' is missing in type 'MagisterModuleRecord'.
```

**Tests: 244/244 green** (was 243/244 after Phase 1; the Maren spot-check
is the +1).

**Build: still red** on a **pre-existing, unrelated** TypeScript error
in `server/routes/modules.ts:51`. This is the same TS2352 the truth
audit listed as Phase 1 blocker #2, present in the working tree before
either Phase 1 or Phase 2 began, and outside the scope of this Maren
cleanup. It is left to its own follow-up.

## Files changed in Phase 2

- `server/routes/inkwell.ts` — system prompt rebind + identity note.
- `test/voice-assignments.test.ts` — spot-check assertion.
- `server/lib/voice-registry.ts` — ElevenLabs branch comments.
- `server/routes/voice.ts` — companion-id example.
- `web/app/lib/voice-picker.ts` — JSDoc example.
- `README.md` — three Maren → Varros prose updates.
- `curriculum/history/config.json` — description prose.
- `curriculum/history-through-story/config.json` — description prose.
- `curriculum/science/config.json` — description prose.
- `curriculum/mathematics/config.json` — description prose.
- `docs/MAGISTER_PHASE2_VOICE_IDENTITY_CLEANUP.md` — this document.
