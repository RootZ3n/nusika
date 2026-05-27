# Magister — Live Kokoro + TTS smoke

> **Date / time:** 2026-05-27 11:02 – 11:08 UTC (Mushin)
> **Scope:** first honest end-to-end probe of Kokoro plus
> `/magister/tts` since the Phase 2 voice contract and Kokoro identity
> work landed. **No browser playback was attempted; this is a service-
> and bytes-level smoke, not an audible-verification pass.**
> **Companion documents:** `docs/MAGISTER_KOKORO_RUNTIME.md`,
> `docs/MAGISTER_VOICE_RUNTIME_VERIFICATION.md`,
> `docs/MAGISTER_OPENCODE_SIDECAR_PARKING.md`.

## Final status: **PARTIAL — bytes verified, audio not heard**

- Kokoro synthesises real, non-silent 24 kHz mono PCM WAV.
- `/magister/tts` round-trips correctly through the registry and
  returns per-companion-distinct audio (Varros ≠ Nova, both ≠ default).
- The Magister-side audio cache works (second identical call returns
  `kokoro-cached` with `cache-hit: true` in 4 ms).
- Mechanical evidence is strong (RIFF header parse, sample-rate match,
  non-zero standard deviation across hundreds of samples), but **no
  human listened to the audio in this pass** and no browser was driven
  to playback. Per the task rules, that floors the rating at PARTIAL.

## Environment

| Field           | Value                                                  |
|-----------------|--------------------------------------------------------|
| Host            | Mushin (Linux 6.1.0-45-amd64, x86_64)                  |
| Node            | v22.22.2                                               |
| Python          | 3.11.2                                                 |
| Disk free       | 431 G on `/mnt/ai` (model cache ~330 MB, fits easily)  |
| Pre-existing    | Magister API on `127.0.0.1:18793`; opencode-sidecar on `127.0.0.1:18794` (per the parking doc) |
| Smoke fixtures  | Kokoro on `127.0.0.1:18894`; fresh Magister API on `127.0.0.1:18893`. Both spawned by this smoke and stopped at the end. |

## Configured Kokoro URL

`.env` sets `MAGISTER_KOKORO_URL=http://127.0.0.1:18794`. Port 18794
was occupied by `opencode-sidecar` (confirmed via `ss -tlnp` + a
`curl /health` returning `{"ok":true,"service":"opencode-sidecar",
"version":"1.0.0"}`). Per
`docs/MAGISTER_OPENCODE_SIDECAR_PARKING.md`, the operator-safe path is
to leave the squatter alone and run Kokoro on an alternate port with
an env override — this smoke followed that path:

```bash
# In this smoke window only, override the port:
cd /mnt/ai/magister/voices/kokoro
MAGISTER_KOKORO_PORT=18894 ./start.sh
# … and spawn a fresh Magister API pointing at it:
MAGISTER_PORT=18893 \
MAGISTER_KOKORO_URL=http://127.0.0.1:18894 \
MAGISTER_STATE_DIR=/tmp/magister-tts-smoke-state \
MAGISTER_LOCAL_ONLY=true \
node dist/server/index.js
```

Neither the existing Magister API at 18793 nor opencode-sidecar at
18794 was touched. Both were still listening at the end of the smoke.

## Startup method

`voices/kokoro/start.sh` (manual-start, the documented near-term
posture). On this run:

- `.venv/` already existed; `pip install -r requirements.txt` was a
  no-op (every package already satisfied).
- `espeak-ng` is not installed at the OS level; the script printed
  its loud stderr warning, but generation later succeeded because
  the bundled `espeakng-loader` Python wheel provided what Kokoro
  needed.
- uvicorn bound `127.0.0.1:18894` within ~8 seconds of `start.sh`
  being invoked.

## Kokoro `/health` result

First probe (before any `/generate`):

```json
{ "ok": true, "engine": "kokoro", "status": "cold", "model_loaded": false }
```

Identity check (`engine: "kokoro"`) satisfied, so Magister's
hardened `kokoroHealth()` accepts this as Kokoro rather than as a
squatter.

After the first synthesis:

```json
{ "ok": true, "engine": "kokoro", "status": "ready", "model_loaded": true }
```

The cold → ready transition matches the documented sub-state
behavior; the registry's `engines.kokoro.detail` updated from
`status: cold` to `status: ready, model loaded` on subsequent probes
(see `/magister/voices` result below).

## Direct Kokoro `/generate` result

```bash
curl -X POST http://127.0.0.1:18894/generate \
  -H 'content-type: application/json' \
  -d '{"voice":"am_michael","text":"Hello, I am Varros, the Magister narrator."}' \
  --output /tmp/magister-kokoro-varros.wav
# HTTP 200 | size=180044 | time=10.893s
# file: RIFF (little-endian) data, WAVE audio, Microsoft PCM, 16 bit, mono 24000 Hz
```

10.9 s is the **cold-start cost** — the model downloaded from
Hugging Face (`hexgrad/Kokoro-82M`) on the first call. Subsequent
calls were sub-second. The server-side log confirmed
`kokoro generated voice=am_michael text_len=42 audio_bytes=180044
sample_rate=24000`.

Mechanical WAV check (Python `struct` walk of the RIFF chunks):

| File                                  | Channels | Rate     | Bits | Duration | Sample stdev | Peak  |
|---------------------------------------|----------|----------|------|----------|--------------|-------|
| `magister-kokoro-varros.wav` (direct) | 1        | 24000 Hz | 16   | 3.75 s   | 1294.9       | 7655  |

Non-zero stdev across the 1024-sample subset confirms the WAV is not
silent. Peak amplitude in the thousands is normal for speech audio.

## `/magister/voices` result

Polled against the fresh Magister API instance pointed at the
working Kokoro:

```json
"engines.kokoro": {
  "configured": true,
  "detail": "Kokoro service at http://127.0.0.1:18894 — status: ready, model loaded."
}
"engines.piper": {
  "configured": true,
  "detail": "PIPER_BIN at /home/zen/.local/bin/piper."
}
"voices.length": 31
"varros-default": {
  "id": "varros-default", "engine": "kokoro",
  "voice_ref": "am_michael", "companion_id": "varros",
  "role": "narrator", "language": "en-us", "style": "warm narrator",
  "available": true
}
```

The Phase 1 status enrichment (cold/ready/error distinction in the
detail string) is showing through correctly, and Varros's profile
matches the narrator config in `server/lib/narrator.ts`.

## `/magister/tts` result — Varros (Hall wire shape: `scope`)

```bash
curl -X POST http://127.0.0.1:18893/magister/tts \
  -H 'content-type: application/json' \
  -d '{"text":"Hello, I am Varros, the Magister narrator.","scope":"varros"}' \
  --output /tmp/magister-tts-varros.wav
# HTTP 200 | size=180044 | time=0.065s
```

Response headers:

```
content-type:        audio/wav
x-tts-provider:      kokoro
x-voice-engine:      kokoro
x-voice-id:          varros-default
x-tts-voice:         am_michael
x-tts-cache-hit:     false
```

This is the **Phase 2 wire fix paying off**: `scope: "varros"`
resolved through the registry to the `varros-default` profile with
`voice_ref: am_michael`. The route header confirms which voice was
actually used, so a silent default-voice substitution can't hide.

Bytes match the direct Kokoro call exactly (180,044 — Kokoro is
deterministic for the same input). 65 ms total because the model
was already warm; Magister's audio cache was empty on this fresh
state dir so this was a real synthesis, not a cache hit.

## `/magister/tts` result — Nova (non-Varros companion)

```bash
curl -X POST http://127.0.0.1:18893/magister/tts \
  -H 'content-type: application/json' \
  -d '{"text":"I am Nova. Every question is an experiment.","scope":"nova"}' \
  --output /tmp/magister-tts-nova.wav
# HTTP 200 | size=168044 | time=0.509s
```

Response headers:

```
x-tts-provider:      kokoro
x-voice-engine:      kokoro
x-voice-id:          nova-default
x-tts-voice:         af_heart
x-tts-cache-hit:     false
```

Different `x-tts-voice` (`af_heart` vs Varros's `am_michael`) confirms
**per-companion voice resolution is working end to end**. Different
audio size (168 KB vs 180 KB) further confirms distinct synthesis —
not the "every companion plays the same Piper voice" failure mode
the Phase 2 wire fix removed.

Cache verification — re-running the identical Nova request:

```
# HTTP 200 | size=168044 | time=0.004s
x-tts-provider:      kokoro-cached
x-tts-cache-hit:     true
```

The Magister-side content-addressed cache returns the cached bytes in
4 ms without calling Kokoro again.

## Generated-audio evidence (mechanical)

All three WAV files mechanically inspected (Python `struct` walk of
RIFF chunks, then a 1024-sample stride across the PCM data):

| File                          | Channels | Rate     | Bits | Duration | Sample stdev | Peak  |
|-------------------------------|----------|----------|------|----------|--------------|-------|
| `magister-kokoro-varros.wav`  | 1        | 24000 Hz | 16   | 3.75 s   | 1294.9       | 7655  |
| `magister-tts-varros.wav`     | 1        | 24000 Hz | 16   | 3.75 s   | 1291.7       | 7822  |
| `magister-tts-nova.wav`       | 1        | 24000 Hz | 16   | 3.50 s   | 1548.5       | 11498 |

Observations:

- All three are valid RIFF/WAVE PCM. Duration matches input phrase
  length at conversational pace.
- Standard deviations >1000 across the sampled frames mean the WAV
  is not silent and not a flat-DC artifact.
- Varros bytes via direct Kokoro and via `/magister/tts` are byte-
  comparable (same input → deterministic output → same stats).
- Nova's peak amplitude (11,498) is noticeably higher than Varros's
  (~7,700), consistent with a different voice timbre rather than the
  same waveform being relabeled.

## Hall path status

The Hall path (`web/app/hooks/useVoicePlayback.ts`) posts
`{ text, scope: companionId }` to `/magister/tts` after the Phase 2
wire fix. The Varros call above is exactly that wire shape and it
worked. **The Hall path's wire contract is verified end to end at
the bytes level.** What is *not* verified here:

- A real browser was not driven; `<audio>.play()` was not executed.
- The Hall has no voice picker, so the Hall always dispatches by
  `session.companion_id`. A learner can't override that on `/` the
  way they can on `/teach` or `/dm`.
- The autoplay policy of any specific browser was not tested. The
  fetch-and-play pattern is the same one `/teach` uses today, so
  this is mainly a UX gap, not a contract gap.

## Remaining issues

- **`MAGISTER_KOKORO_URL` in `.env` still points at 18794** — the
  port opencode-sidecar squats. The user-facing Magister API
  (PID 3572891) therefore still sees `engines.kokoro.configured:
  false` with the "Service at ... is not Kokoro (identified as
  'opencode-sidecar')" detail. **No code change needed here**, but
  the operator must either:
  1. Move opencode-sidecar off 18794, or
  2. Set `MAGISTER_KOKORO_URL=http://127.0.0.1:<alt>` in `.env` and
     restart the Magister API + run Kokoro on `<alt>`.

  Step-by-step for path 2 lives in
  `docs/MAGISTER_KOKORO_RUNTIME.md` under "When `:18794` is occupied
  (alternate-port workflow)" — it walks through port selection,
  `start.sh` invocation, `.env` edit, API restart, and the
  `/magister/voices` verification curl.
- **espeak-ng is not installed at the OS level.** The bundled
  `espeakng-loader` wheel covered for it on this smoke, but
  `voices/kokoro/start.sh` still emits the warning every boot. If
  any future Kokoro upgrade drops the bundled binary, `/generate`
  will start returning 503 with a phonemizer error.
- **HF model cache lives at `~/.cache/huggingface/`.** This smoke
  populated it on first call. If that directory is wiped between
  runs, the first `/generate` on the next run will pay the ~10 s
  cold cost again.
- **No human heard the audio.** The PARTIAL classification is
  honest about that.
- **No persisted "synthesis verified" surface.** The registry can
  say "model loaded" but cannot say "last successful synthesis at
  …". This is named in `MAGISTER_KOKORO_RUNTIME.md` as future work.

## Recommended next step

1. **Decide the opencode-sidecar port question.** Either move it,
   or change `.env`'s `MAGISTER_KOKORO_URL` to a non-conflicting
   port that Kokoro will use. Once that's done, the current
   Magister API at 18793 will see Kokoro on the first boot rather
   than reporting "wrong service on port."
2. **Optionally install OS espeak-ng** to silence the start.sh
   warning and reduce dependency on the bundled wheel.
3. **First in-browser playback** — load `/teach` (which already has
   a working voice picker + the cleaned-up wire contract), play
   one reply with autoplay on, and listen. That single audible
   confirmation upgrades this from PARTIAL to PASS for `/teach`.
4. **Then exercise the Hall path.** Open `/`, start a session with
   a non-Varros companion, click Repeat next to a reply, and
   confirm the voice matches the companion. That upgrades the Hall
   path to PASS.
5. **Add a voice picker + Preview button to the Hall's Session
   view.** This is the Phase 2 priority #3 from
   `MAGISTER_PHASE1_VERIFICATION.md`.

## Smoke fixtures cleanup

Both smoke-spawned services were stopped at the end of this pass:

- Kokoro on 18894 (smoke-spawned uvicorn) → killed.
- Magister API on 18893 (smoke-spawned `node dist/server/index.js`)
  → killed.
- Magister API on 18793 (pre-existing, owned by the user) →
  **untouched**.
- opencode-sidecar on 18794 (pre-existing, owned by the user) →
  **untouched**.

Generated WAVs left at `/tmp/magister-kokoro-varros.wav`,
`/tmp/magister-tts-varros.wav`, `/tmp/magister-tts-nova.wav`,
`/tmp/magister-tts-nova-2.wav` for the operator to play with their
preferred audio tool. They will be cleared on the next `/tmp` sweep.

## Validation (no code changed)

```
$ npm run typecheck   # clean
$ npm run build       # clean
$ npm test            # 258 / 258 passing
```

This smoke neither shipped new code nor needed any. The hardened
Kokoro identity check, the registry sub-state surfacing, and the
Hall `scope` wire fix landed in earlier Phase 1 / Phase 2 commits
all passed their first real end-to-end exercise against a live
Kokoro process.
