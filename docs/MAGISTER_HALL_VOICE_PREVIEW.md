# Magister — Hall voice picker + Preview

> **Date:** 2026-05-27
> **Scope:** small, narrow Phase 2 follow-up — adds a voice picker
> dropdown, a Preview button, an engine-status badge, and a preview
> result banner to the Hall's in-session header. Does **not** add
> autoplay, does **not** change the existing 🔊 Repeat button, and
> does **not** redesign the Hall.
> **Companion documents:** `docs/MAGISTER_TTS_HUMAN_VERIFICATION.md`,
> `docs/MAGISTER_KOKORO_RUNTIME.md`,
> `docs/MAGISTER_VOICE_RUNTIME_VERIFICATION.md`,
> `docs/MAGISTER_TTS_LIVE_SMOKE.md`.

## What this gives you

A compact one-row control strip inside the Hall's Session view,
sitting in the existing teaching-mode header. When a session is
active and the voice registry has voices, the strip shows:

| Element                | What it does                                                                 |
|------------------------|-------------------------------------------------------------------------------|
| `VOICE` dropdown       | Lists every profile from `/magister/voices`, Varros first, then alphabetic. |
| **Preview** button     | Posts `{ text, voice: <profile-id> }` to `/magister/tts` and plays the WAV. |
| Kokoro status badge    | Honest live state pulled from `engines.kokoro` — see "Status states" below. |
| Result banner (below)  | Renders only when the preview is running, succeeded, or failed.              |

The dropdown selection is persisted in `localStorage` under
`magister.hall.voiceProfileId` — independent of `/teach`'s
`magister.teach.voiceProfileId` and `/dm`'s `magister.dm.voiceProfileId`
keys, so each surface keeps its own preference.

## How to use it

Open the Hall (`/`), start a session with any companion, and look
at the top header bar above the chat area. If the registry returned
at least one voice, you'll see the picker on the right side, next to
the World Map button.

1. **Open the dropdown.** It defaults to Varros; pick any companion
   whose voice you want to hear.
2. **Click Preview.** The button transitions to `Playing…`, the
   backend synthesises the preview phrase (`"Hello. I am <name>."`)
   via the configured Kokoro engine, and the WAV plays back through
   your browser.
3. **Check the badge.** The Kokoro status badge to the right of the
   button reflects the live engine state — green for ready, amber
   for cold, red for error/wrong-service, grey for not-running or
   unknown. Hover over the badge for the full detail string.
4. **Read the result banner.** Below the header you'll see one of:
   - `Preview playing…` — the request is in flight.
   - `Preview played. If you didn't hear it, check your output device.` — the audio play call resolved without throwing.
   - `Preview failed: <reason>` — the server returned an error, the browser refused playback, or the network failed. The reason is taken verbatim from the upstream response when present.

## What this verifies

When a click on **Preview** results in audible audio:

- The Magister API resolved the selected voice profile through the
  registry (server-side proof: `x-tts-voice` header in the response
  matches the profile's `voice_ref`).
- The Kokoro engine actually produced bytes for that voice profile.
- The browser audio path (`fetch` → `Blob` → `URL.createObjectURL`
  → `new Audio(url).play()`) works on this machine, in this browser,
  with the current autoplay policy state.
- The wire shape Phase 2 verified at the bytes level is now also
  verified at the ears level for the Hall — at least for the voices
  the operator clicks through.

## What this does **not** verify

Be careful with the failure modes — this control adds one new UX
surface, not a system-wide guarantee.

- **The 🔊 Repeat button is a different code path.** Repeat calls
  `useVoicePlayback.playTTS(text, companionId)`, which posts
  `{ text, scope: companionId }` (no picker involvement). Preview
  proves the registry resolves a profile id correctly; it does not
  prove the same registry resolves an unqualified companion id
  through the same engine. The wire-level equivalence is locked by
  `test/voices-tts-dispatch.test.ts` ("scope === voice"), but if you
  want full audible confidence, click Repeat too after Preview.
- **In-session reply autoplay still routes through `playTTS`**, not
  through this picker. There is no Hall autoplay toggle; Comfort
  drawer's "Narration on/off" still owns that.
- **A successful Preview is not a system PASS.** The
  `docs/MAGISTER_TTS_HUMAN_VERIFICATION.md` checklist defines the
  steps that escalate a verification to full PASS. A heard Preview
  here checks one box in that checklist (the Hall path's
  registry-resolution leg), not all of them.
- **`Preview played` does not equal `audio was heard`.** The banner
  reflects the result of `<audio>.play()` resolving, which the
  browser will do even if your output device is muted, the tab is
  muted, or your default output is something silent. The banner
  copy explicitly tells the operator to confirm with their ears.
- **The picker only mounts when the registry returns voices.** If
  `/magister/voices` is empty (e.g., no curriculum, or a broken
  registry), the picker hides entirely so the rest of the Hall
  keeps working. No banner is rendered in that case — the absence
  of the picker is the signal.

## Status states (badge legend)

The Kokoro engine badge surfaces the same five-state distinction
documented in `docs/MAGISTER_KOKORO_RUNTIME.md`. It's parsed from
`/magister/voices`'s `engines.kokoro` shape via
`parseKokoroEngine()` in `web/app/lib/voice-picker.ts`.

| Badge                              | Source condition                                                | What to do                                                                 |
|------------------------------------|------------------------------------------------------------------|----------------------------------------------------------------------------|
| **Kokoro: ready** (green)          | `configured:true`, detail matches `status: ready`               | Click Preview. Expect a sub-second response.                               |
| **Kokoro: cold** (amber)           | `configured:true`, detail matches `status: cold`                | Preview works, but the first call pays the ~10 s lazy-load cost.           |
| **Kokoro: error** (red)            | `configured:false`, detail matches `loaded with errors`         | Service is up but broken — see logs and the runtime doc.                   |
| **Kokoro: wrong service on port** (red) | `configured:false`, detail matches `not Kokoro`            | Park the squatter or change `MAGISTER_KOKORO_URL`. See parking doc.        |
| **Kokoro: not running** (grey)     | `configured:false`, none of the above                           | Start Kokoro via `voices/kokoro/start.sh`.                                 |
| **Kokoro: status unknown** (grey)  | First render before the registry call resolves                  | Wait a moment; the badge updates on first successful fetch.                |

The exact detail substrings (`status: ready`, `status: cold`,
`loaded with errors`, `not Kokoro`) are pinned by the server-side
test `engine.detail contract: substrings the Hall picker parser
depends on stay stable` in `test/voice-assignments.test.ts` — if a
future change renames any of them, that test fails first.

## Preview result banner — semantics

| Banner text                                                                                | Maps to               | What it means                                                                   |
|--------------------------------------------------------------------------------------------|-----------------------|---------------------------------------------------------------------------------|
| (not rendered)                                                                              | idle                  | No preview attempted in this session yet.                                       |
| `Preview playing…`                                                                          | running               | Request in flight or `<audio>` still playing.                                   |
| `Preview played. If you didn't hear it, check your output device.`                          | ok                    | `<audio>.play()` resolved. **Does not guarantee audible output.** Confirm by ear.|
| `Preview failed: <reason>`                                                                  | error                 | HTTP failure, autoplay refusal, or network error. `<reason>` is verbatim.       |

The picker also re-fetches the registry on a failed preview so the
badge updates if the failure shifted the engine state (e.g., a
service that just died will flip from `ready` to `not-running`
without a manual refresh).

## How this relates to `/teach` verification

The `/teach` autoplay path remains the canonical first-leg check
(`docs/MAGISTER_TTS_HUMAN_VERIFICATION.md` step 6). This Hall
picker is the **second leg** — it audibly verifies the Hall's
in-session voice resolution without requiring a full session
exchange and without a second person to play the assistant role.

Wire shape parity (server-side test `scope === voice` in
`test/voices-tts-dispatch.test.ts`):

| Path                          | Body field         | Resolves to    |
|-------------------------------|--------------------|-----------------|
| `/teach` reply autoplay       | `voice: <profile-id>` | registry profile |
| `/dm` Preview                 | preview route via `voice_ref` | direct engine call |
| **Hall Preview (this hook)**  | `voice: <profile-id>` | registry profile |
| Hall `🔊 Repeat` button       | `scope: <companion-id>` | registry profile (by companion_id) |

The route treats `voice` and `scope` equivalently for registry
lookup, so this Preview audibly proves the registry resolution
path that the Hall's Repeat button also uses.

## Known limitations

- **No "Play latest" on the Hall.** The Hall doesn't track a "latest
  reply" the same way `/teach` does, and the existing 🔊 Repeat
  buttons already serve that need per-message. Adding a second
  affordance for it here would be redundant.
- **No autoplay toggle on the Hall.** Reply autoplay on `/` is
  governed by the Comfort drawer's `narration_enabled` flag (which
  routes through `useVoicePlayback`); this picker only affects
  Preview. A future change can unify those if needed.
- **Browser autoplay policy.** A click on **Preview** is a user
  gesture, so the first audio play usually goes through. If the
  page has been left untouched and the very first audio interaction
  is the auto-fired session-open `playTTS`, the browser may refuse
  it — that's a `useVoicePlayback` concern, not a picker concern,
  and the picker's failure banner does surface it when the picker
  itself runs into the policy.
- **Cache visibility.** The Hall picker does not expose the voice
  cache size or a Clear button (the `/teach` UI does). If you want
  to clear cached WAVs from the Hall, use `/teach`'s control or
  hit `DELETE /magister/voices/cache` directly.
- **Mobile layout.** The control row uses `flex-wrap` so on narrow
  screens the picker drops below the teaching-mode badge instead
  of overflowing. The dropdown caps at `max-width: 240px` to keep
  long companion names from blowing out the row.

## How this converts the Hall voice status from PARTIAL to PASS

The Phase 1 verification doc
(`docs/MAGISTER_PHASE1_VERIFICATION.md`) listed "Hall voice picker"
as Phase 2 priority #3. The Live TTS smoke
(`docs/MAGISTER_TTS_LIVE_SMOKE.md`) classified the Hall path as
PARTIAL because nothing audible had been verified end-to-end. This
picker is the smallest UI surface that lets an operator escalate
that status honestly:

1. Bring Kokoro up per `docs/MAGISTER_TTS_HUMAN_VERIFICATION.md`
   steps 1–5.
2. Open the Hall (`/`) and start any session — the picker appears
   in the header.
3. Confirm the **Kokoro: ready** (or **cold**) badge.
4. Click **Preview** with Varros selected. Confirm by ear that you
   hear a male American voice say "Hello. I am Varros Default."
5. Change the dropdown to a non-Varros companion (e.g., Nova,
   Tessera, Marcus). Click **Preview** again. Confirm by ear that
   you hear a *different* voice say "Hello. I am <name>."
6. Append a verification log entry per
   `docs/MAGISTER_TTS_HUMAN_VERIFICATION.md` "Recording the
   verification" template, naming the Hall picker as the surface
   tested.

Two voices clearly heard from this picker, plus one Repeat-button
press inside the same session, is enough audible evidence to
classify the Hall voice path as PASS. The earlier PARTIAL stays in
the live-smoke report unchanged — the verification log is the new
record, not a rewrite of history.

## Files changed in this slice

- `web/app/lib/voice-picker.ts` — added `HALL_VOICE_KEY`, the
  `KokoroEngineState` type, and the `parseKokoroEngine()` helper.
- `web/app/hooks/useHallVoice.ts` — new hook modeled on
  `useDmVoice`; Preview uses `/magister/tts` with `voice: <id>`.
- `web/app/page.tsx` — instantiate the hook and pass it down.
- `web/app/components/SessionView.tsx` — render the picker bar in
  the existing teaching-mode header row, plus the result banner.
- `test/voice-assignments.test.ts` — new test pinning the four
  detail substrings the parser keys off (`status: ready`,
  `status: cold`, `loaded with errors`).
- `docs/MAGISTER_HALL_VOICE_PREVIEW.md` — this document.

No server route changed. No public API changed. No
voice-architecture refactor. Tests: 258 → 259.
