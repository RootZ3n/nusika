# Nusika voice service (`nusika-voice`)

Local, loopback-only **Kokoro 82M** text-to-speech for Nusika — narration
and companion voice output. CPU-only, no cloud, no GPU, no internet at
runtime after the one-time model download. No Mushin dependency.

**This directory is the canonical home of the voice layer — Nusika owns
it.** It ships the service source, the systemd unit template, the env
template, docs, and helper scripts. Runtime artifacts (the ~5 GB venv,
the Kokoro model cache, the real env file, generated WAVs) live OUTSIDE
git — see [`.gitignore`](.gitignore).

| Property | Value |
|---|---|
| Service name | `nusika-voice` (systemd `nusika-voice.service`) |
| Canonical source | `/pehverse/repos/nusika/voice/` (this dir) |
| Backend | Kokoro 82M (Apache-2.0), CPU-only |
| Bind | `127.0.0.1:18794` (loopback only) |
| Health | `GET http://127.0.0.1:18794/health` |
| Voices | `GET http://127.0.0.1:18794/voices` (28 presets) |
| Generate | `POST http://127.0.0.1:18794/generate` |
| Nusika dispatch | `POST /nusika/tts` (voice=`peh` → Kokoro) |
| Default narrator voice | `am_michael` (Peh) |
| Model cache | `/pehverse/cache/huggingface` (~330 MB) |

## Layout

```
voice/
├── server.py                  # FastAPI app (Kokoro wrapper)
├── requirements.txt           # pip deps
├── start.sh                   # repo-owned entrypoint: venv + uvicorn
├── smoke.sh                   # /health + /voices + /generate probe
├── nusika-voice.env.example   # env TEMPLATE (copy → nusika-voice.env, gitignored)
├── systemd/
│   └── nusika-voice.service   # unit template (runs this start.sh)
├── samples/                   # generated WAVs land here (gitignored)
│   └── README.md
├── README.md                  # this file
├── MIGRATION-NOTES.md         # why/how this was rebuilt on pop-peh
└── .gitignore
```

## Why Kokoro (not Piper)

Piper isn't installed on pop-peh and has no downloaded voices. The entire
Nusika voice client (`server/lib/voices/kokoro.ts`, voice registry, TTS
dispatch, audio cache) is purpose-built around the Kokoro HTTP contract.
Kokoro is small, Apache-2.0, CPU-friendly, and fully offline after the
first model fetch.

## Endpoints (stable contract — do not change)

### `GET /health`
Liveness + lazy-load status. Never touches the model.
```json
{ "ok": true, "engine": "kokoro", "status": "cold", "model_loaded": false }
```
`status` is `cold` | `ready` | `error`. The `engine:"kokoro"` field is an
identity guard — Nusika rejects any non-Kokoro service squatting the port.

### `GET /voices`
Static preset list (28 voices). Never touches the model.

### `POST /generate`
Body `{ voice, text, format? }` (`format` must be `"wav"`). Returns
24 kHz / 16-bit mono PCM WAV. `400` on bad input, `503` on engine failure
(short safe `detail`; full traceback only in the journal). Not
OpenAI-compatible — Nusika has its own client.

```bash
curl -sS -X POST http://127.0.0.1:18794/generate \
  -H 'content-type: application/json' \
  -d '{"voice":"af_heart","text":"Hello, I am Peh."}' \
  --output sample.wav
```

## Install / update the venv

The venv is gitignored and large (~5 GB; `kokoro` pulls in `torch`). On
pop-peh it already exists at `/pehverse/services/nusika-voice/.venv` and is
reused via `NUSIKA_VOICE_VENV` (set in `nusika-voice.env`). To build or
refresh it from scratch:

```bash
cd /pehverse/repos/nusika/voice
cp nusika-voice.env.example nusika-voice.env   # then edit paths if needed
# Build into the path NUSIKA_VOICE_VENV points at (or ./.venv by default):
NUSIKA_VOICE_VENV=/pehverse/services/nusika-voice/.venv \
  python3 -m venv /pehverse/services/nusika-voice/.venv
HF_HOME=/pehverse/cache/huggingface \
  /pehverse/services/nusika-voice/.venv/bin/pip install -r requirements.txt
```

`start.sh` also creates/refreshes the venv automatically on each run.

## Run (manual)

```bash
cd /pehverse/repos/nusika/voice
./start.sh        # sources nusika-voice.env, ensures venv, runs uvicorn
```

## Service management (systemd)

The unit template lives at
[`systemd/nusika-voice.service`](systemd/nusika-voice.service) and runs
this `start.sh`. Install once (needs sudo):

```bash
sudo install -m 644 /pehverse/repos/nusika/voice/systemd/nusika-voice.service \
  /etc/systemd/system/nusika-voice.service
sudo systemctl daemon-reload
sudo systemctl enable --now nusika-voice.service
```

Starts on boot, restarts on failure, loopback-only. Logs / status / port:

```bash
journalctl -u nusika-voice -n 50 --no-pager
systemctl status nusika-voice
ss -tulpn | grep 18794
```

NOTE: `nusika-voice` is intentionally NOT added to the arrays in
`/pehverse/services/install-lab-services.sh` — that installer expects
api+web product pairs (187xx + 30xx); the voice service is neither.

## Test / validate

```bash
# health + voices
curl -sS http://127.0.0.1:18794/health
curl -sS http://127.0.0.1:18794/voices

# generate a phrase directly from Kokoro
curl -sS -X POST http://127.0.0.1:18794/generate \
  -H 'content-type: application/json' \
  -d '{"voice":"am_michael","text":"Welcome to Nusika. Peh has entered the library."}' \
  --output /tmp/voice-test.wav && file /tmp/voice-test.wav

# full path through Nusika (dispatches to Kokoro for voice=peh)
curl -sS -X POST http://127.0.0.1:18793/nusika/tts \
  -H 'content-type: application/json' \
  -d '{"text":"Welcome to Nusika. Peh has entered the library.","voice":"peh"}' \
  --output /tmp/nusika-peh.wav && file /tmp/nusika-peh.wav

# or the bundled smoke probe
./smoke.sh
```

## Nusika integration

Nusika reaches this service via `NUSIKA_KOKORO_URL=http://127.0.0.1:18794`
(set in `/pehverse/repos/nusika/.env`; 18794 is also the client default).

- `GET /nusika/voices` probes `/health` and reports `engines.kokoro.configured`.
- `POST /nusika/tts` with a Kokoro-engine voice profile (e.g. `voice:"peh"`)
  dispatches here; WAVs are cached at `state/voices/cache/<sha256>.wav`.
- Peh's default voice is the Kokoro preset `am_michael`
  (`server/lib/narrator.ts`).

## Voices

28 presets via `GET /voices`: American female (`af_*`), American male
(`am_*`), British female (`bf_*`), British male (`bm_*`). The model ships
~50; the documented subset covers every Nusika companion.

## Rollback

```bash
sudo systemctl disable --now nusika-voice.service
sudo rm /etc/systemd/system/nusika-voice.service && sudo systemctl daemon-reload
rm -rf /pehverse/services/nusika-voice/.venv
rm -rf /pehverse/cache/huggingface/hub/models--hexgrad--Kokoro-82M
```

## License

- Service code: same as Nusika.
- Kokoro model: [Apache-2.0](https://github.com/hexgrad/kokoro/blob/main/LICENSE).
- FastAPI / uvicorn / pydantic / soundfile / numpy: permissive OSS.
