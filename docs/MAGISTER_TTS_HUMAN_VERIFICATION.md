# Magister — TTS human-ear verification checklist

> **Purpose:** convert the live TTS smoke status from **PARTIAL** to
> **PASS** by having a human actually hear Kokoro audio through the
> Magister web UI. The mechanical bytes-and-headers proof is already
> in `docs/MAGISTER_TTS_LIVE_SMOKE.md`; this document is the last mile.
> **Companion documents:** `docs/MAGISTER_TTS_LIVE_SMOKE.md`,
> `docs/MAGISTER_KOKORO_RUNTIME.md`,
> `docs/MAGISTER_VOICE_RUNTIME_VERIFICATION.md`.
> **Out of scope:** no UI changes, no architecture changes, no service
> start/stop from this checklist (the operator runs commands, the
> checklist just lists them).

## The fastest path: `/teach` Preview button

`/teach` already ships a working voice picker, a Preview button, an
opt-in autoplay toggle, and a "Play latest" button — the full UX is
in place. The Hall (`/`) does not yet have a picker (Phase 2 priority
#3 from `MAGISTER_PHASE1_VERIFICATION.md`), so prefer `/teach` first
and use Hall only as the second-leg confirmation that the
`scope:companionId` wire shape produces audio in a real browser.

If you only have time for one step, **do step 6 (Preview Varros on
/teach)**. A single audible click is the difference between PARTIAL
and PASS for the narrator voice.

---

## Preconditions

Have these confirmed before opening a browser. Each is a one-line
shell command.

```bash
# A. Kokoro identity probe at the configured URL succeeds.
#    Replace 18794 with your alt port if you're using one.
curl -s http://127.0.0.1:18794/health | jq '{ok, engine, status, model_loaded}'
# Want:  { "ok": true, "engine": "kokoro", "status": "cold" | "ready", ... }
# Wrong: anything where "engine" != "kokoro" or the curl fails.

# B. Magister API sees Kokoro through its registry.
curl -s http://127.0.0.1:18793/magister/voices | jq '.engines.kokoro'
# Want:  { "configured": true, "detail": "... status: cold|ready ..." }
# If configured:false, jump to the alt-port runbook in
#   docs/MAGISTER_KOKORO_RUNTIME.md → "When :18794 is occupied"
# before continuing.

# C. The Magister web app is up.
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3003/teach
# Want: 200
```

If any of A, B, or C is wrong, fix it first — the browser steps
below assume all three are green.

---

## Step-by-step

### 1. Pick the Kokoro port

Default is `:18794`. If `opencode-sidecar` (or anything else not
identifying as `engine:"kokoro"`) is squatting that port, follow
`docs/MAGISTER_KOKORO_RUNTIME.md` → **"When `:18794` is occupied
(alternate-port workflow)"**. The live smoke used `:18894` as the
example port; pick whatever is free on your box.

Whichever port you choose, the rest of this checklist uses the same
URL pair end to end:

- `MAGISTER_KOKORO_PORT=<port>` (passed to `voices/kokoro/start.sh`)
- `MAGISTER_KOKORO_URL=http://127.0.0.1:<port>` (in project `.env`)

### 2. Start Kokoro

In its own terminal:

```bash
cd voices/kokoro
MAGISTER_KOKORO_PORT=18794 ./start.sh    # or :<alt> per step 1
```

Wait for the log line `Uvicorn running on http://127.0.0.1:<port>`.
Leave this terminal running until you finish the checklist.

### 3. Point Magister at Kokoro (only if you changed the port)

If you used the default `18794` and `.env` already has
`MAGISTER_KOKORO_URL` either unset or set to `18794`, **skip this
step**.

Otherwise, edit `.env`:

```
MAGISTER_KOKORO_URL=http://127.0.0.1:<port>
```

`.env.example` carries a commented example for `:18894` you can
uncomment as a template.

### 4. Restart the Magister API

The API reads `MAGISTER_KOKORO_URL` from `process.env` at boot, so an
edit to `.env` does nothing until the API restarts.

```bash
# dev:      Ctrl-C the `npm run dev` / `tsx watch` process, start it again
# systemd:  systemctl --user restart magister-api.service
# manual:   kill the `node dist/server/index.js` PID; relaunch it
```

Confirm the PID actually changed if you used `kill` — sometimes a
process refuses SIGTERM and you'll be talking to the old instance
with the old env.

### 5. Verify the registry sees Kokoro

```bash
curl -s http://127.0.0.1:18793/magister/voices | jq '.engines.kokoro'
```

You want:

```json
{
  "configured": true,
  "detail": "Kokoro service at http://127.0.0.1:<port> — status: cold|ready, ..."
}
```

If `configured` is still `false`, do not proceed — see "Failure
troubleshooting" below.

### 6. Preview Varros on `/teach`

Open `http://127.0.0.1:3003/teach` in a desktop browser with audio
output working.

1. **Confirm system audio.** Play any short YouTube clip or a system
   sound first. If you can't hear that, the rest of this checklist
   will mislead you — fix the audio device before continuing.
2. **Open `/teach`.** The voice picker dropdown lives in the header.
   The default selection is "Varros Default — am_michael".
3. **Click "Preview" next to the picker.** The page will fetch
   `/magister/voices/preview/kokoro/am_michael?name=Varros%20Default`
   and play the returned WAV.

Expected (open DevTools → Network if you want the receipts):

| Field                | Value                          |
|----------------------|--------------------------------|
| URL                  | `/magister/voices/preview/kokoro/am_michael?name=...` (first call) or the same with cache header on repeat |
| HTTP status          | `200`                          |
| `content-type`       | `audio/wav`                    |
| `x-tts-provider`     | `kokoro` (first) or `kokoro-cached` (repeat) |
| `x-tts-voice`        | `am_michael`                   |
| `x-tts-cache-hit`    | `false` (first) or `true` (repeat) |
| **Your ears**        | A short American-male voice saying `"Hello, I am Varros Default."` |

**If you hear the voice, Varros preview is PASS.** Note the playback in
the verification log at the bottom of this doc.

If you see the network success but hear nothing, jump to "Failure
troubleshooting → silent success".

### 7. Preview one non-Varros companion on `/teach`

Same page, same Preview button — change the dropdown first.

1. Open the dropdown. Pick **Nova (af_heart)** if you can find it, or
   **Tessera (af_aoede)**, or any companion whose `voice_ref` differs
   from `am_michael`. The point is to prove the registry routes
   different companion ids to different voices.
2. Click **Preview**.

Expected:

| Field                | Value                                              |
|----------------------|----------------------------------------------------|
| `x-tts-voice`        | `af_heart` (or whichever ref the picker showed)    |
| **Your ears**        | A noticeably different voice from Varros's        |

**If the second voice sounds clearly different from the first, the
per-companion-voice-resolution path is PASS audibly.**

### 8. Autoplay round-trip on `/teach`

This step also exercises the actual chat → reply → TTS pipeline,
which is the path users will use day-to-day.

1. With Varros selected in the picker, toggle **Auto voice** on
   (the checkbox in the header).
2. Send any short message — `"hello, can you hear me?"` works.
3. Wait for the assistant reply to land in the chat.

Expected:

- The reply text appears in the chat as usual.
- Within ~1 s of the text landing, audio plays automatically.
- Network: `POST /magister/tts` with body `{ text, voice: "varros-default" }`,
  `200`, `x-tts-provider: kokoro`, `x-tts-voice: am_michael`,
  `x-tts-cache-hit: false`. (The text differs across runs, so this is
  always a cache miss.)
- **Your ears:** the reply read aloud in Varros's voice.

**If you hear the autoplay, `/teach` autoplay is PASS.** This proves
the full pipeline: chat → reply → wire contract → registry resolve →
Kokoro `/generate` → audio cache → `<audio>.play()`.

### 9. (Optional) "Play latest"

The "Play latest" button replays the most recent reply on demand
(useful if autoplay was blocked by the browser policy). One click
should re-play the reply you just heard, served entirely from the
audio cache:

- `x-tts-provider: kokoro-cached`
- `x-tts-cache-hit: true`
- Response in single-digit milliseconds.

Hearing it the second time costs nothing and confirms the cache.

### 10. Hall path confirmation (second leg)

The Hall (`/`) does not have a voice picker yet, but it does have a
`🔊 Repeat` button next to each assistant message in a session. After
the Phase 2 wire fix this button posts `{ text, scope: <companion_id> }`
to `/magister/tts`, which is what the Hall's reply autoplay also
does (`useVoicePlayback.playTTS`).

1. Open `http://127.0.0.1:3003/`.
2. Start a new session with a **non-Varros** companion (e.g. Marcus,
   Cronk, Nova — pick from "Start Adventure" → choose module → pick
   companion). The companion id (not Varros) is what makes this leg
   informative.
3. Wait for the opening message. The Hall fires off a `playTTS` call
   for the opener automatically — if narration is enabled in the
   Comfort drawer, you should hear it.
4. If autoplay didn't fire (browser autoplay policies often block the
   first audio play before the user has clicked anything), click the
   **🔊 Repeat** icon next to an assistant bubble.

Expected (Network):

| Field             | Value                       |
|-------------------|-----------------------------|
| `POST /magister/tts` body | `{ text, scope: "<companion_id>" }` |
| `x-tts-voice`     | the configured `voice_ref` for that companion (not `am_michael` unless you actually picked Varros — for Marcus it should be `bm_lewis`, etc.) |
| **Your ears**     | the companion's voice, distinct from Varros's |

**If you hear the companion's own voice, the Hall path is PASS.**

---

## Final status mapping

After running through the steps, write the result down somewhere
durable. Suggested classification:

| Steps that produced audio | Status            |
|---------------------------|-------------------|
| 6 only                    | PARTIAL→PASS for Varros narrator only; Hall + multi-companion still unverified |
| 6 + 7                     | PASS for the multi-voice registry path; `/teach` UI verified |
| 6 + 7 + 8                 | PASS for the full `/teach` chat → reply → autoplay pipeline |
| 6 + 7 + 8 + 10            | PASS overall; both the `/teach` and Hall wire shapes are audibly correct |
| Any step produced 200 + WAV but no audible sound | Still PARTIAL — see "silent success" troubleshooting |

---

## Failure troubleshooting

### Wrong service on port

Symptom: `engines.kokoro.configured: false` with
`detail: "Service at <url> is not Kokoro (identified as ...)"`.

That's the Phase 1 identity check rejecting a squatter (e.g.
`opencode-sidecar`). Either move the squatter or run Kokoro on an
alternate port per
`docs/MAGISTER_KOKORO_RUNTIME.md` → "When :18794 is occupied".

### `.env` points at old port

Symptom: you updated `.env`, restarted nothing, and
`engines.kokoro.detail` still names the old URL. The API reads env
at boot. Restart the API process (step 4 above) and confirm its PID
changed.

### Kokoro cold first-call delay

Symptom: the very first `/generate` after starting Kokoro takes 8–15
seconds. Subsequent calls are sub-second.

That's the model download from Hugging Face into
`~/.cache/huggingface/`. Expected on a fresh box (~330 MB). If
the call eventually completes and audio plays, you're fine.

If the call hangs >30 s with no `HEAD https://huggingface.co/...` in
the Kokoro server log, check network connectivity to `huggingface.co`.

### Browser autoplay blocked

Symptom: Network shows `POST /magister/tts` returning `200` + WAV
bytes, but no sound and no `<audio>` error in the console — or a
console message like `play() failed because the user didn't interact
with the document first`.

Most desktop browsers gate `<audio>.play()` until the user has
clicked or typed inside the page. Workaround:

- Click anywhere on the page (a button, a tab, an input field).
- Then click **Play latest** on `/teach`, or **🔊 Repeat** on `/`.
  These are direct user gestures, so the policy lets them through.

### Audio output device muted / missing

Symptom: silent success — `200` + WAV bytes in Network, no sound,
no autoplay warning in the console.

Before assuming Magister is at fault: play any unrelated audio (a
YouTube video, a system sound). If that's silent too, fix the OS
audio first. If unrelated audio works but Magister doesn't, save
the response body to a file:

```bash
curl -sS -X POST http://127.0.0.1:18793/magister/tts \
  -H 'content-type: application/json' \
  -d '{"text":"Manual playback test.","scope":"varros"}' \
  --output /tmp/magister-manual.wav
file /tmp/magister-manual.wav
# RIFF (little-endian) data, WAVE audio, ...
aplay /tmp/magister-manual.wav   # or `afplay`, `paplay`, `vlc --play-and-exit`
```

If `aplay` is audible but the browser is silent, the regression is
browser-side (autoplay policy, audio API permission, page tab muted
in the OS volume mixer). If `aplay` is also silent, the regression
is system audio.

### Piper fallback masking the failure

Symptom: `x-tts-provider: piper-fallback` or `piper` with
`x-tts-voice` other than the expected Kokoro voice_ref.

This means `MAGISTER_VOICE_FALLBACK=piper` is set in `.env` and the
Kokoro call failed. Honest behavior is to **leave the fallback
unset** until Kokoro is working, so 503s surface plainly. See
`docs/MAGISTER_KOKORO_RUNTIME.md` → "When Piper fallback is
appropriate (Option C, opt-in)" before turning it on.

### "Silent success" (200 + bytes, no sound)

If you've ruled out browser autoplay, output device, and Piper
fallback — and `aplay /tmp/magister-manual.wav` is also silent —
treat the audio as suspect and **do not classify PASS**. Save the
WAV with a stable filename and run a mechanical check:

```bash
python3 - <<'PY'
import struct, statistics, sys
with open('/tmp/magister-manual.wav', 'rb') as f:
    d = f.read()
# Find the data chunk and read it as int16 LE.
i = d.find(b'data') + 4
n_bytes = struct.unpack('<I', d[i:i+4])[0]
i += 4
samples = struct.unpack(f'<{n_bytes//2}h', d[i:i+n_bytes])
sub = samples[::max(1, len(samples)//1024)][:1024]
print('stdev', round(statistics.pstdev(sub),1), 'peak', max(map(abs, sub)))
PY
```

`stdev > 1000` and `peak > 5000` mean the WAV is real speech audio
(see the live-smoke doc for the reference values). If you get those
numbers but still hear nothing, the regression is between the
`<audio>` element and your speakers — not Magister.

---

## Recording the verification

When you do hear it, leave a small record so future readers know
what was verified. Append to this file under a new heading, or to
`docs/MAGISTER_TTS_LIVE_SMOKE.md` under a new section, in this
shape:

```
### Human verification — YYYY-MM-DD
- Operator: <name or initials>
- Steps run: 6, 7, 8, 10
- Browser: <name + version>
- Heard: Varros (am_michael), Marcus (bm_lewis)
- Result: PASS (Hall + /teach autoplay)
```

That converts the historical PARTIAL into an auditable PASS without
needing this checklist again.
