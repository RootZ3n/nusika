# Magister — Kokoro runtime posture

> **Date:** 2026-05-27
> **Scope:** the local Kokoro 82M voice sub-service that lives in
> `voices/kokoro/`. Decides and documents the safest near-term way to
> run it.
> **Companion documents:** `docs/MAGISTER_TRUTH_AUDIT.md`,
> `docs/MAGISTER_OPENCODE_SIDECAR_PARKING.md`,
> `docs/MAGISTER_VOICE_RUNTIME_VERIFICATION.md`.
> **Out of scope:** no new TTS provider; no automated launching from
> the API process; no live synthesis smoke against a running Kokoro
> in this pass.

## Chosen near-term posture

**Option A (manual start) + Option D (honest degradation when down).**

- The canonical way to bring Kokoro up is `voices/kokoro/start.sh`,
  run by the operator in a terminal or under their own process
  manager.
- When Kokoro is **not running**, the Magister API stays fully
  usable: `/magister/tts` returns a 503 with a friendly detail; the
  voice registry reports `engines.kokoro.configured: false` with an
  actionable reason; chat, lessons, Inkwell feedback, and DM all
  continue to work text-only.
- A user-level systemd unit (`contrib/systemd/magister-kokoro.service`)
  exists in the repo as **Option B** for operators who want
  long-running supervision, but it is **not auto-enabled** and not
  required.
- **Option C (`MAGISTER_VOICE_FALLBACK=piper`)** is wired and works,
  but **off by default**. Reason: only one Piper voice file
  (`en_GB-alba-medium`) is currently installed; enabling the fallback
  would make every companion speak in the same British female voice
  — the exact silent-default-voice failure mode the Phase 2 wire
  fix just cleaned up.

### Why this choice and not auto-start

- "Do not start or stop services from repo code" — the repo respects
  the operator's process boundary.
- Kokoro has a heavy first-call model load (~330 MB download, ~1 GB
  RAM during inference) that should happen on the operator's
  schedule, not on `npm run dev`.
- Auto-starting an external Python service from a Node API process
  is a footgun (zombie processes, port conflicts, restart loops on
  Python import failures).
- The Phase 1 opencode-sidecar parking work proved that pretending
  a service is "Kokoro" when something else is on the port is the
  real failure mode — explicit start + honest degradation prevents
  that. Adding magic auto-start would weaken the identity check by
  re-introducing race conditions the hardened probe was designed
  to catch.

## How to start Kokoro manually

From the project root:

```bash
cd voices/kokoro
./start.sh
```

`start.sh` is idempotent:

- Creates `.venv/` on first run, then `pip install -r requirements.txt`
  (fast no-op when nothing changed).
- Warns loudly to stderr if `espeak-ng` is missing from `$PATH`. The
  bundled `espeakng-loader` wheel usually covers this; the warning
  exists for environments where it doesn't.
- Exits into `exec uvicorn server:app …`, so the process runs in
  the foreground. `Ctrl-C` stops it cleanly.

Environment overrides (also honored by `voices/kokoro/server.py`):

| Variable                    | Default     | Purpose                                 |
|-----------------------------|-------------|-----------------------------------------|
| `MAGISTER_KOKORO_HOST`      | `127.0.0.1` | Bind host. Keep on loopback.            |
| `MAGISTER_KOKORO_PORT`      | `18794`     | Bind port.                              |
| `MAGISTER_KOKORO_LOG_LEVEL` | `INFO`      | Standard logging level string.          |

The Magister API side reads `MAGISTER_KOKORO_URL`
(`http://127.0.0.1:18794` default) to know where to find the service.
If you change the host/port, set `MAGISTER_KOKORO_URL` in your `.env`
to match — otherwise the API will keep probing the old address.

### When `:18794` is occupied (alternate-port workflow)

Some development environments have another local service squatting
`:18794` — `opencode-sidecar` is the documented case
(`docs/MAGISTER_OPENCODE_SIDECAR_PARKING.md`). The
Phase 1 identity check correctly rejects it, so Kokoro never gets
mis-routed through the wrong process, but it does mean Kokoro itself
can't bind that port. **Do not stop the squatter from the repo.** Run
Kokoro on a different loopback port instead, and keep the two env
vars (the Python server's `MAGISTER_KOKORO_PORT` and the Node API's
`MAGISTER_KOKORO_URL`) in agreement.

The port number is your choice — anything free above 1024 will work.
The live TTS smoke (`docs/MAGISTER_TTS_LIVE_SMOKE.md`) used `18894`
because it is one off from the default and easy to remember; the
project does **not** treat `18894` as a blessed default. Pick whatever
suits your local layout.

```bash
# 1. Confirm what (if anything) is holding the default port.
ss -tlnp | grep 18794
curl -s http://127.0.0.1:18794/health     # is it Kokoro, or something else?

# 2. Pick a free loopback port. 18894 is the convention used in the
#    live smoke; 18800, 28794, etc. are all fine.
export KOKORO_ALT_PORT=18894

# 3. Start Kokoro on that port. start.sh honours MAGISTER_KOKORO_PORT.
cd voices/kokoro
MAGISTER_KOKORO_PORT="${KOKORO_ALT_PORT}" ./start.sh
# leave this running in its own terminal (or under systemd — see below)

# 4. In your project root .env, point the Magister API at the same port.
#    .env.example carries a commented line you can uncomment:
#      MAGISTER_KOKORO_URL=http://127.0.0.1:18894
#    Replace 18894 with whatever port you actually chose.

# 5. Restart the Magister API so it picks up the new env. The env var
#    is read at boot from process.env, so a running API will not pick
#    up an edited .env until it restarts.
#    - dev:      stop the `npm run dev` (or `tsx watch`) process; start it again
#    - systemd:  systemctl --user restart magister-api.service
#    - manual:   kill the `node dist/server/index.js` process; relaunch it

# 6. Verify the API now sees Kokoro.
curl -s http://127.0.0.1:18793/magister/voices | jq '.engines.kokoro'
# Expect:
# { "configured": true,
#   "detail": "Kokoro service at http://127.0.0.1:18894 — status: <cold|ready>, ..." }
```

If `engines.kokoro.configured` still reads `false` after the restart,
check three things in order: (a) the `.env` `MAGISTER_KOKORO_URL` line
is not still commented out; (b) the API process actually restarted
(its PID should change); (c) `curl http://127.0.0.1:<alt>/health`
directly identifies as Kokoro. The `detail` field on
`engines.kokoro` will name the failure mode honestly — squatter,
unreachable, or upstream load error.

## Optional: systemd unit (Option B)

Use this if you want Kokoro to come up under user-session
supervision rather than babysitting `start.sh` in a terminal.
**Provision the venv first** so the unit isn't trying to `pip install`
on every boot:

```bash
cd voices/kokoro
./start.sh           # let it create .venv/ and install deps
# wait until it prints "starting on 127.0.0.1:18794" — then Ctrl-C
```

Then install the user unit (`scripts/install-systemd.mjs` already
handles this in batch, but you can do it one unit at a time):

```bash
cp contrib/systemd/magister-kokoro.service \
   ~/.config/systemd/user/magister-kokoro.service
systemctl --user daemon-reload
systemctl --user start  magister-kokoro.service
systemctl --user enable magister-kokoro.service   # autostart on login
```

The unit binds loopback only, has `Restart=on-failure`, and reads
the same env-var overrides as `start.sh`. To stop:

```bash
systemctl --user stop    magister-kokoro.service
systemctl --user disable magister-kokoro.service
```

If you don't want long-running supervision, leave this section
alone — manual `./start.sh` is the supported default.

## How to check Kokoro health

Three layers, increasing in trust:

### 1. Service-level: ask the Python directly

```bash
curl -s http://127.0.0.1:18794/health | jq .
```

Expected when fully ready:

```json
{ "ok": true, "engine": "kokoro", "status": "ready", "model_loaded": true }
```

The `engine: "kokoro"` field is the identity signal — the Magister
client requires it. The Phase 1 opencode-sidecar parking work
documents why; see `docs/MAGISTER_OPENCODE_SIDECAR_PARKING.md`.

### 2. Registry-level: ask Magister what it sees

```bash
curl -s http://127.0.0.1:18793/magister/voices | jq '.engines.kokoro'
```

This probes the service with a 750 ms timeout, rejects responses
that don't identify as Kokoro, and surfaces the five-state
distinction below in the `detail` string.

### 3. End-to-end: ask Magister to actually synthesise

```bash
curl -sS -X POST http://127.0.0.1:18793/magister/tts \
  -H 'content-type: application/json' \
  -d '{"text":"Hello, I am Varros.","scope":"varros"}' \
  --output /tmp/varros.wav
file /tmp/varros.wav
# Expect:  RIFF (little-endian) data, WAVE audio, ...
```

A 503 here with `Kokoro TTS unavailable` means the dispatch path
reached the client but generation failed; a 503 with `TTS not
configured` means the request fell through to the Piper preflight.

## How to verify the service really is Kokoro

The Magister client's `kokoroHealth()` already enforces this — it
will reject any response that lacks `engine: "kokoro"` — but if you
want to spot-check manually:

```bash
curl -s http://127.0.0.1:18794/health | jq '.engine'
```

If that prints anything other than `"kokoro"` (e.g., `"opencode-
sidecar"`, `null`, or the value is missing entirely), some other
service is bound to the port. Stop it, move it, or override
`MAGISTER_KOKORO_URL` to point at the actual Kokoro instance. The
registry's `engines.kokoro.detail` field also names the squatter when
it sees one.

## What "voice status" actually means

`engines.kokoro` collapses to one of five distinguishable runtime
states. The first four are observable directly from
`GET /magister/voices`; the fifth is a future concern not yet
implemented.

| State                           | `configured` | `detail` shape                                                                                  | What it means                                                                                                |
|---------------------------------|--------------|-------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------|
| **Not configured / not running**| `false`      | `Kokoro service not reachable at <url>: ECONNREFUSED ...`                                       | Nothing is bound to the configured port. Run `voices/kokoro/start.sh`.                                       |
| **Wrong service on port**       | `false`      | `Service at <url> is not Kokoro (identified as "<service>"). Stop or move the other service, or override MAGISTER_KOKORO_URL.` | Identity check rejected the response. Park the squatter (e.g., opencode-sidecar) or repoint Kokoro.          |
| **Reachable, model cold**       | `true`       | `Kokoro service at <url> — status: cold, model loads on first /generate call (lazy).`           | Service is up; the model hasn't been loaded yet. First `/magister/tts` will load it (slow once, then quick). |
| **Reachable, model loaded**     | `true`       | `Kokoro service at <url> — status: ready, model loaded.`                                        | Service is up and warm. Synthesis should succeed.                                                            |
| **Reachable, model load error** | `false`      | `Kokoro service at <url> loaded with errors: <upstream detail>.`                                | Service is up but the model failed to load (often missing `espeak-ng`). Restart after fixing the upstream.   |

There is **no "synthesis verified" state** today. The registry only
probes `/health`; it does not retry a real `/generate` call to confirm
audio comes back. A verified flag would require either persisting a
"last successful synthesis" timestamp or running a periodic smoke
generator — both are future work, not part of this Phase 2 task.

## What happens when Kokoro is unavailable

The Magister API stays fully functional. Concretely:

- `GET /health` keeps returning 200 — Kokoro is not a liveness
  dependency.
- `GET /magister/voices` keeps returning 200 with
  `engines.kokoro.configured: false` and a friendly detail.
- `POST /magister/tts` with a Kokoro-bound voice returns **503**:
  ```json
  { "ok": false, "error": "Kokoro TTS unavailable.", "detail": "<reason>" }
  ```
  The detail field is sanitised — no Python tracebacks ever reach
  the client.
- `POST /magister/voices/preview/...` for a Kokoro voice returns the
  same 503 contract.
- All non-voice routes (chat, lessons, Inkwell feedback, DM, recap,
  translate) are unaffected. Voice failure is isolated.
- The `/teach` and `/dm` voice pickers show a small "Voice
  unavailable" banner from their existing error-handling paths.

If `MAGISTER_VOICE_FALLBACK=piper` is set in `.env`, the dispatch
path will try Piper instead of returning 503. **Off by default** —
read the next section before turning it on.

## When Piper fallback is appropriate (Option C, opt-in)

Setting `MAGISTER_VOICE_FALLBACK=piper` makes every Kokoro 503
silently fall through to Piper with the default voice
(`ttsDefaultVoice()`, i.e. `en_GB-alba-medium` unless overridden).

This is honest only when:

1. Piper is installed (`PIPER_BIN` resolves).
2. The default Piper voice file exists at the expected path.
3. You have other Piper voices installed and intend to use them as
   per-companion fallbacks (otherwise every companion collapses to
   the one available voice — the same lie the Phase 2 wire fix
   removed).

If those don't hold, leave `MAGISTER_VOICE_FALLBACK` unset and let
Kokoro fail honestly. A 503 the operator can act on is better than
a silently uniform voice.

## Future recommendation

When Magister becomes a daily-use product surface for more than one
operator, revisit this posture in roughly this order:

1. **Health verification surface.** Add a "last successful synthesis"
   timestamp on `engines.kokoro` so the UI can distinguish "claims
   to be loaded" from "demonstrably generated audio in the last
   N minutes."
2. **Optional pooled warm-start.** A `POST /magister/voices/warmup`
   that fires one synthesis through each unique voice_ref so the
   first user-facing TTS isn't paying the cold-start cost. Operator-
   triggered, not on API boot.
3. **Aedis orchestration.** Once Aedis is the supervisor (see
   `docs/MAGISTER_OPENCODE_SIDECAR_PARKING.md`), the kokoro unit
   becomes one of its managed processes with shared health reporting.
4. **Multiple Piper voice files.** Either ship them or document the
   `piper-tts-voices` install path so Piper fallback is honest per
   companion rather than collapsing to one voice. Only then is
   `MAGISTER_VOICE_FALLBACK=piper` safe as a default.

None of these are required for the current posture to be honest.

## Files changed in this pass

- `server/lib/voice-registry.ts` — `kokoroEngineStatus()` now
  distinguishes `cold` / `ready` / `error` sub-states in the detail
  string and marks `configured: false` when the upstream reports
  `status: "error"` so per-voice availability stops claiming
  usability.
- `test/voice-assignments.test.ts` — three new regression tests
  covering the cold / ready / error state mapping.
- `docs/MAGISTER_KOKORO_RUNTIME.md` — this document.

No service was started or stopped from the repo. The `.env.example`
and README already explain the identity check and where Kokoro
listens — no further code or config changes were needed.

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
# tests 258
# pass 258
# fail 0
# skipped 0
# duration_ms ~950
```

Was 255/255 going into this pass; the three new sub-state tests
bring it to 258/258.
