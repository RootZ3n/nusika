# Magister — Parking opencode-sidecar as a local service assumption

> **Date:** 2026-05-26
> **Scope:** narrow defensive change so Magister stops being confused by
> `opencode-sidecar` on port 18794, plus a paper trail for parking
> opencode-sidecar as a local development assumption.
> **Companion documents:** `docs/MAGISTER_TRUTH_AUDIT.md`,
> `docs/MAGISTER_PHASE1_DB_FIX.md`,
> `docs/MAGISTER_PHASE2_VOICE_IDENTITY_CLEANUP.md`.

## What was found

A full repo sweep for `opencode`, `opencode-sidecar`, port `18794`,
`uvicorn`, service scripts, env files, and systemd-related notes
yielded:

- **No code-level dependency on opencode-sidecar inside Magister.**
  Zero references to `opencode` exist in `server/`, `web/`,
  `curriculum/`, `scripts/`, `voices/`, `contrib/systemd/`, or `test/`.
  The only mention is in the truth audit itself
  (`docs/MAGISTER_TRUTH_AUDIT.md`), which described the squatting
  symptom.
- **No Magister script starts opencode-sidecar.** `package.json`,
  `scripts/install-systemd.mjs`, `scripts/smoke.mjs`,
  `scripts/magister-health.mjs`, `voices/kokoro/start.sh`, and every
  unit file in `contrib/systemd/` are clean.
- **Magister's expected use of `:18794` is exclusively Kokoro.**
  - `MAGISTER_KOKORO_URL=http://127.0.0.1:18794` in `.env.example` and
    `contrib/systemd/magister-api.service`.
  - `voices/kokoro/server.py` binds `MAGISTER_KOKORO_PORT` (default
    `18794`) via uvicorn.
  - `contrib/systemd/magister-kokoro.service` runs that same uvicorn.
  - `scripts/magister-health.mjs` probes `127.0.0.1:18794/health` and
    treats Kokoro as **optional** (`required: false`).
  - `server/lib/voices/kokoro.ts` defaults `DEFAULT_URL` to
    `http://127.0.0.1:18794`, overridable by `MAGISTER_KOKORO_URL`.
  - Tests across `test/voices-kokoro-client.test.ts`,
    `test/voice-preview.test.ts`, `test/voices-tts-dispatch.test.ts`,
    and `test/voice-registry.test.ts` reference the same port.
- **The squatter is observed at runtime, not configured by Magister.**
  An external `opencode-sidecar` uvicorn answers `/health` with
  `{"ok":true,"service":"opencode-sidecar","version":"1.0.0"}`. The
  pre-fix `kokoroHealth()` only checked `body.ok === true`, so the
  squatter passed the identity-free probe and the voice registry
  reported `engines.kokoro.configured: true` even though `/generate`
  calls always 503'd at runtime.
- **The repo authors already noted the footgun.**
  `test/voice-registry.test.ts:30` carries a comment explaining that
  "an unrelated service listening on 127.0.0.1:18794 (e.g. another
  tool's sidecar) could make the registry's Kokoro probe return
  reachable:true" — but the mitigation lived only inside test stubs,
  never in production code. This change closes that gap.

## Classification

**opencode-sidecar status, for Magister's purposes:**

- **NOT REQUIRED.** Nothing in this repo depends on opencode-sidecar.
- **NOT OPTIONAL.** opencode-sidecar is not even an optional Magister
  feature — it is an unrelated tool that happens to use the same port.
- **PARKED.** The user does not currently use opencode-sidecar much and
  intends to switch to Aedis once Aedis is working.
- **PORT CONFLICT.** When opencode-sidecar is running on the same
  machine as Magister, it must either be stopped or moved off
  `:18794` — otherwise Kokoro cannot bind. Magister now refuses to
  treat it as Kokoro even if Kokoro is down.

## What changed

### Code (the one functional change)

**`server/lib/voices/kokoro.ts` — `kokoroHealth()`.** The probe now
requires `engine: "kokoro"` in the `/health` response body in addition
to `ok: true`. If the response identifies as anything else
(`service: "opencode-sidecar"`, no engine field at all, or a different
engine string) the probe returns `reachable: false` with an actionable
detail naming the squatter and pointing at `MAGISTER_KOKORO_URL` for
override.

The Kokoro server at `voices/kokoro/server.py` already emits
`engine: "kokoro"` from `/health` in every status — ready, cold, and
error — so this check is safe across all real Kokoro states.

### Tests

**`test/voices-kokoro-client.test.ts`** adds three identity tests:

1. The exact `opencode-sidecar` body observed in the wild is rejected
   with a detail mentioning `opencode-sidecar` and
   `MAGISTER_KOKORO_URL`.
2. A bare `{ok: true}` is rejected (no engine field).
3. Real Kokoro responses in `cold` and `error` states are accepted, so
   we don't regress and reject Kokoro before its model is loaded.

### Docs and config

- `.env.example` — the Kokoro block now explains the identity check
  and how to point at a non-default URL when a squatter is present.
- `README.md` — the `/magister/voices` paragraph now states the
  identity check explicitly and names `opencode-sidecar` as the
  known squatter case.

## What did **not** change

- **No service was stopped from the repo.** Stopping or disabling the
  external `opencode-sidecar` process is a local operator action — see
  the operator notes below.
- **No Aedis integration paths were removed.** There aren't any in the
  repo today, so there is nothing to preserve at the file level; the
  recommendation in §"Future direction" below is the only place
  Aedis is mentioned.
- **No code dealing with opencode** (Magister has none).
- **No port renames.** Kokoro keeps `:18794`. The identity check is the
  right defense — port-hopping would just push the conflict somewhere
  else.

## Operator notes (run locally, not from this repo)

These are **suggestions for the human operator**, not commands the
repo will execute on your behalf.

```bash
# 1) See what is actually bound to :18794
ss -tlnp | grep 18794

# 2) Identify the service:
curl -s http://127.0.0.1:18794/health

# 3a) If it is opencode-sidecar and you want to park it for now:
#     - find and stop the process (systemd unit, launchd label, or PID)
#     - or move opencode-sidecar to a different port via its own config
#     Magister will then bind Kokoro to :18794 cleanly.

# 3b) If you want to keep opencode-sidecar where it is and run Kokoro
#     somewhere else, point Magister at the Kokoro instance:
#       export MAGISTER_KOKORO_URL=http://127.0.0.1:<other-port>
#     and start Kokoro at <other-port> via voices/kokoro/start.sh
#     (or the magister-kokoro.service after editing the unit).

# 4) Confirm Magister sees Kokoro correctly:
curl -s http://127.0.0.1:18793/magister/voices | jq '.engines.kokoro'
# Expected: { "configured": true, "detail": "Kokoro service ready at ..." }
# If you see configured:false with detail mentioning "not Kokoro
# (identified as ...)" — the identity check is doing its job and the
# squatter is still in place.
```

Nothing in this repo will start, stop, or restart opencode-sidecar.
That keeps the change reversible and avoids interfering with whatever
opencode setup lives outside Magister.

## Future direction

Magister's longer-term build/orchestration story is **Aedis**, not
opencode. When Aedis is ready:

- Any orchestration scripts that Magister adds (a watch-and-restart
  runner, a multi-service "bring everything up" script, a CI bridge)
  should target Aedis as the host.
- The `.aedis/repo-index.json` file in this repo is already a hint of
  that direction — Aedis is the intended consumer.
- opencode-sidecar should not be added back as a Magister assumption
  unless it earns first-class status as a deliberate integration; even
  then, it should never share a port with Kokoro.

Treat any future PR that re-introduces an opencode-sidecar assumption
(env var, script, systemd Wants=, README claim) as a regression of
this parking decision and link back to this document.

## Validation

```
$ npm test
# tests 247
# pass 247
# fail 0
# skipped 0
# duration_ms 750.423857
```

Three new identity tests (`opencode-sidecar squatter`,
`bare ok:true`, `Kokoro cold + error states still accepted`) all pass;
the existing 244 are unaffected.

```
$ npm run build
server/routes/modules.ts(51,17): error TS2352:
  Conversion of type 'MagisterModuleRecord' to type 'Record<string, unknown>'
  may be a mistake because neither type sufficiently overlaps with the other.
```

The build remains red on the same **pre-existing, unrelated** TS2352
in `server/routes/modules.ts:51` that Phase 1 (db migration) and
Phase 2 (voice identity) also documented. It is not introduced or
exacerbated by this change, and it is out of scope for the
opencode-sidecar parking task. It is still tracked as Phase 1 blocker
#2 in `docs/MAGISTER_TRUTH_AUDIT.md`.

## Files changed

- `server/lib/voices/kokoro.ts` — `kokoroHealth()` identity check.
- `test/voices-kokoro-client.test.ts` — three regression tests.
- `.env.example` — Kokoro block clarification.
- `README.md` — `/magister/voices` paragraph clarification.
- `docs/MAGISTER_OPENCODE_SIDECAR_PARKING.md` — this document.
