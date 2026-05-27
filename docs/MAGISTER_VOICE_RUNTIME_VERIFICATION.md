# Magister — Voice runtime verification (contract level)

> **Date:** 2026-05-27
> **Scope:** the Hall path's `useVoicePlayback` → `POST /magister/tts`
> wire contract. **No live synthesis or browser playback was run** as
> part of this task — what is verified here is that the request shape
> the Hall sends matches the shape the server reads, and that the
> server resolves companion ids the way the contract documents.
> **Companion documents:** `docs/MAGISTER_TRUTH_AUDIT.md`,
> `docs/MAGISTER_PHASE1_VERIFICATION.md`,
> `docs/MAGISTER_OPENCODE_SIDECAR_PARKING.md`.

## Symptom

`docs/MAGISTER_TRUTH_AUDIT.md` §4 finding #5:

> Main `/` page sends the wrong field. `web/app/hooks/useVoicePlayback.ts`
> posts `{ text, role: companionRole }`. The server's `/magister/tts`
> body schema is `{ text, voice?, scope? }`. The `role` field is
> silently dropped, the dispatch sees no voice query, and falls through
> to the default Piper voice `en_GB-alba-medium`. Every companion on
> the Hall path speaks in the same British female voice.

`docs/MAGISTER_PHASE1_VERIFICATION.md` flagged this as Phase 2 priority
#2: "useVoicePlayback.ts must send `scope: companionId` so each
companion plays its own voice."

## Server contract (unchanged)

`server/routes/voice.ts` documents:

```ts
// Accepts: { text, voice?, scope? }
// Where `voice`/`scope` may be:
//   - a VoiceProfile id (e.g. "varros-default")
//   - a companion id    (e.g. "varros", "cronk", "vermilion")
//   - a Piper voice basename (legacy callers; e.g. "en_US-lessac-medium")
//   - omitted          (uses ttsDefaultVoice() Piper voice)
```

The route reads:

```ts
const query = (req.body?.voice ?? req.body?.scope ?? "").trim();
const profile = query ? await resolveVoiceProfile(db, query) : null;
```

So `voice` and `scope` are **equivalent at the wire level**; `voice`
wins if both are sent. A field with any other name (notably `role`)
is dropped by Fastify's body validator before the handler sees it.

The `/teach` and `/dm` hooks already use this contract correctly: they
pass `voice: <profile-id>` because they have a picker UI that yields
profile ids. The Hall has no picker — it knows the companion id of the
current session, which is also a valid registry query.

## Fix

`web/app/hooks/useVoicePlayback.ts` — the `playTTS` body changes from

```ts
body: JSON.stringify({ text: clean, ...(companionRole ? { role: companionRole } : {}) }),
```

to

```ts
body: JSON.stringify({
  text: clean,
  ...(trimmedId ? { scope: trimmedId } : {}),
}),
```

The public signature changes from `(text, companionRole?: string)` to
`(text, companionId?: string | null)` — what the call sites have always
been passing was `session.companion_id` / `companion?.id`, not a role
label, so the rename is a truthful naming fix rather than a behavior
change at the call sites.

A short trim guards against empty strings (e.g. an early render where
`session.companion_id` is `""`). The field is omitted entirely in that
case, which is the right thing on the wire — the server falls back to
its default voice rather than receiving a falsy lookup query.

`web/app/components/SessionView.tsx` — the matching prop type updates
from `companionRole?: string` to `companionId?: string | null`. The
three call sites (`page.tsx:169`, `SessionView.tsx:290`,
`SessionView.tsx:523`) already passed the companion id; no behavior
change there.

`server/routes/voice.ts` and `server/lib/voice-registry.ts` are
unchanged. The bug was always client-side.

## Regression coverage

Three new tests in `test/voices-tts-dispatch.test.ts` lock the wire
contract in:

1. **`scope: "<companion_id>"` routes to the same Kokoro profile as
   `voice: "<companion_id>"`.** Both forms dispatch through the
   registry; both yield `X-TTS-Voice: bm_lewis` for a companion
   configured with that voice_ref. Counts Kokoro client calls = 2 to
   prove both forms reach the engine (and that the audio cache isn't
   masking a silent default fallback).
2. **Empty-string `scope` falls through to the default-voice path.**
   The route does not 4xx on `scope: ""` and does not silently swap
   in a different voice — it reaches the Piper preflight and 503s
   honestly because PIPER_BIN is missing in the test harness.
3. **Unknown `scope` reaches the legacy Piper preflight, not a silent
   default-voice swap.** Treats unknown ids as Piper basenames per the
   documented contract.

The existing `voice: "<companion>"` tests still pass unchanged, so
the contract equivalence holds in both directions.

## What this verification does **not** prove

Read this section carefully — it is here to keep the change honest.

- **End-to-end voice synthesis was not exercised.** No browser playback
  was tested. No live Kokoro `/generate` was called. The Kokoro client
  is exercised at the harness level via `__setKokoroFetchForTesting`,
  not against the real Python sub-service. The Phase 1 opencode-sidecar
  parking work proved the health probe rejects squatters honestly; that
  did not prove Kokoro itself is running locally.
- **No claim is being made that the Hall now plays distinct per-
  companion voices.** What this change proves is that the Hall will
  *attempt* the right registry lookup. Whether that lookup ends in
  audible audio depends on (a) Kokoro being up and (b) the companion
  having a Kokoro voice_ref the server can synthesize. Both gates are
  open today: most companions are configured, Kokoro is not currently
  running on the audit machine.
- **No new voice provider, engine, or routing path was introduced.**
  The change is renamed-field-on-the-wire + parameter-rename + three
  contract tests. The server route was already correct.
- **The Hall still has no voice picker.** That is Phase 2 priority #3
  in `docs/MAGISTER_PHASE1_VERIFICATION.md` and is **not** done here.
  Without a picker, the Hall always dispatches by `session.companion_id`
  — which is the right default, but a learner can't override it the
  way they can on `/teach` or `/dm`.

## Validation

```
$ npm run typecheck
> magister@0.1.0 typecheck
> tsc -p tsconfig.json --noEmit
(clean — no output)

$ npm run build
> magister@0.1.0 build
> rm -rf dist && tsc -p tsconfig.build.json
(clean — no output)

$ npm test
# tests 255
# pass 255
# fail 0
# skipped 0
# duration_ms 839.802907
```

Was 252/252 going into this change; the three new dispatch tests
bring it to 255/255.

## Files changed

- `web/app/hooks/useVoicePlayback.ts` — wire field rename, parameter
  rename, doc comment explaining the contract and the historical bug.
- `web/app/components/SessionView.tsx` — matching prop type rename.
- `test/voices-tts-dispatch.test.ts` — three Hall-contract regressions.
- `docs/MAGISTER_VOICE_RUNTIME_VERIFICATION.md` — this document.
