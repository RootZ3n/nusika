# nusika-voice — migration notes

**Date:** 2026-05-31
**Machine:** pop-peh
**What:** Rebuilt Nusika's local voice layer cleanly on pop-peh.

## Background

Before the grand migration, Nusika ("Magister" at the time) had a local
voice server for narration / companion voice output. It was never split
into its own repo and did not migrate cleanly — the service skeleton
existed in the Nusika repo (`voices/kokoro/`) but was **never deployed**:
no venv, the `kokoro` package was never installed, nothing listened on
its port. Voice output was therefore 100% non-functional after the
migration.

## What was done

- **No transfer from Mushin. No dependency on Mushin.** The Kokoro
  service code was already native to the Nusika repo on pop-peh; it was
  deployed fresh here.
- Created the deployed runtime at `/pehverse/services/nusika-voice`
  (machine convention), with its own `.venv`, `requirements.txt`,
  `start.sh`, `nusika-voice.env`, and systemd unit.
- Installed Kokoro 82M + deps into the venv. Model + HF cache pinned to
  `/pehverse/cache/huggingface` (NOT the home dir, NOT `/mnt/ai`,
  NOT `/hogwarts`).
- Backend chosen: **Kokoro** (Piper was not installed; the Nusika client
  is purpose-built for the Kokoro HTTP contract).
- Port: **18794** — matches the Nusika client's existing default, so no
  code change. 18794/18893/18894 were all free; 18794 chosen to avoid
  any config churn.
- Activated `NUSIKA_KOKORO_URL=http://127.0.0.1:18794` and
  `NUSIKA_VOICE_CACHE_MAX_MB=500` in `/pehverse/repos/nusika/.env`.
- systemd unit `nusika-voice.service` authored, staged in
  `/pehverse/services/systemd/`. Loopback-only bind, restart-on-failure,
  start-on-boot.

## Validation (all green)

- `GET /health` → `{ok:true, engine:"kokoro", status:ready, model_loaded:true}`
- `GET /voices` → 28 voices
- `POST /generate` → valid 24 kHz mono WAV (`samples/test-welcome.wav`)
- `POST /nusika/tts` (voice=peh) → routed to Kokoro, `x-tts-provider: kokoro`,
  valid WAV; repeat call served from cache (`kokoro-cached`)
- Nusika `npm run typecheck` → clean
- Nusika `npm run build` → clean
- Nusika `npm test` → 293/293 pass

## Enveloped into the repo (2026-05-31, second pass)

Ownership/packaging pass — behavior unchanged, no backend rewrite:

- The service was relocated within the Nusika repo from `voices/kokoro/`
  to **`voice/`** via `git mv` (history preserved), making `voice/` the
  single canonical home.
- Packaging artifacts that previously lived ONLY in the runtime dir
  (`/pehverse/services/nusika-voice`) were brought into the repo:
  `MIGRATION-NOTES.md`, `nusika-voice.env.example`,
  `systemd/nusika-voice.service`, `samples/README.md`, and an updated
  repo-owned `start.sh` + `README.md`.
- `start.sh` now honors `NUSIKA_VOICE_VENV` so systemd/operators can reuse
  the existing ~5 GB runtime venv instead of rebuilding it.
- The systemd unit template now runs the **repo-owned** `start.sh`
  (`WorkingDirectory=/pehverse/repos/nusika/voice`).
- `.gitignore` hardened: `.venv/`, `__pycache__/`, `*.wav`, `samples/*.wav`,
  `cache/`, `models/`, and the real `nusika-voice.env` stay out of git.
  The 5.2 GB venv and Kokoro model files are never committed.
- Top-level `README.md` path references updated `voices/kokoro/` → `voice/`.
- Moving the Python dir broke no code: the only `voices/kokoro` references
  in source are imports of the unrelated TS client
  `server/lib/voices/kokoro.ts`.

Runtime stays at `/pehverse/services/nusika-voice` (venv + real env file +
HF cache); canonical source/templates/docs now live in `voice/`.

## Out of scope / left as-is

- **STT (whisper.cpp):** Nusika's `/nusika/stt` still points at
  `/mnt/ai/whisper.cpp/...` (a forbidden runtime path) and the binary is
  absent. This is speech *input*, not the voice *output* layer this task
  covers. Flagged for a future pass: relocate whisper.cpp under
  `/pehverse` and update `WHISPER_BIN` / `WHISPER_MODEL`.
- **Piper:** not installed; not needed. `NUSIKA_VOICE_FALLBACK` left off so
  a Kokoro failure surfaces a clear 503 rather than silently failing into
  an absent Piper.

## Remaining manual step

Installing a system-level systemd unit needs sudo (not available
non-interactively in this session). Run once:

```bash
sudo install -m 644 /pehverse/services/systemd/nusika-voice.service \
  /etc/systemd/system/nusika-voice.service
sudo systemctl daemon-reload
sudo systemctl enable --now nusika-voice.service
```

Until then the service is running detached (uvicorn on 127.0.0.1:18794)
for live use and validation.
