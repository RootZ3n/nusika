# Nusika Kokoro voice service

Local, loopback-only Python sub-service that runs the
[Kokoro 82M](https://github.com/hexgrad/kokoro) TTS engine for Nusika.

> **Slice 6C scope:** standalone service skeleton. Nusika itself does
> NOT call this service yet — wiring lands in **Slice 6D**. Until then,
> this is a side-car you start and curl by hand. The voice registry
> (`GET /nusika/voices`) continues to report Kokoro as
> `configured: false` until 6D flips that switch.

## Why this exists

Nusika's voice path is currently Piper (local) or ElevenLabs (cloud,
deprecated). Kokoro is a small (82M parameters), Apache-2.0, CPU-friendly
local TTS engine with ~50 baked-in preset voices. Adding it gives every
companion a stable local voice without a subscription, GPU, or cloning
flow.

## Requirements

- **Python 3.11+** (tested on 3.11.2).
- **espeak-ng** at the OS level — usually NOT required because the
  `espeakng-loader` Python wheel (a transitive dep) ships a bundled
  espeak-ng binary that Kokoro picks up automatically. If `/generate`
  returns **503** with a phonemizer error, install the system package
  as a fallback:
  ```bash
  # Debian / Ubuntu
  sudo apt install espeak-ng
  # macOS
  brew install espeak-ng
  # Fedora
  sudo dnf install espeak-ng
  ```
  `/health` and `/voices` always respond regardless.
- **~330 MB** of disk for the first model download (cached under
  `~/.cache/huggingface/`). The download happens automatically on the
  first `/generate` call.
- **~1 GB RAM** during inference. CPU-only is fine; no GPU needed.
- **Network** for the first run only. After the model is cached,
  generation is fully offline.

## Run

```bash
cd voices/kokoro
./start.sh
```

The script creates `.venv/` on first run, pip-installs `requirements.txt`,
warns if `espeak-ng` is missing, and starts uvicorn on `127.0.0.1:18794`.

Override the bind address with environment variables (also honored by
`server.py` itself):

| Variable                   | Default       | Notes                          |
|----------------------------|---------------|--------------------------------|
| `NUSIKA_KOKORO_HOST`       | `127.0.0.1`   | Loopback only by default.      |
| `NUSIKA_KOKORO_PORT`       | `18794`       | Nusika API uses 18793.         |
| `NUSIKA_KOKORO_LOG_LEVEL`  | `INFO`        | Standard logging level string. |

> **Legacy compatibility:** The `MAGISTER_KOKORO_HOST`, `MAGISTER_KOKORO_PORT`,
> and `MAGISTER_KOKORO_LOG_LEVEL` env vars are still accepted as fallbacks
> if the `NUSIKA_` equivalents are not set.

## Endpoints

### `GET /health`

Liveness probe. Never touches the model.

```json
{
  "ok": true,
  "engine": "kokoro",
  "status": "cold",       // "cold" | "ready" | "error"
  "model_loaded": false
}
```

### `GET /voices`

Static documented preset list. Never touches the model. Returns 28
American + British voices today; Slice 6E will pick one per Nusika
companion.

```json
{
  "ok": true,
  "engine": "kokoro",
  "voices": [
    { "id": "af_heart", "name": "Heart", "gender": "female", "language": "en-us" },
    { "id": "am_michael", "name": "Michael", "gender": "male", "language": "en-us" }
  ]
}
```

### `POST /generate`

Synthesise a WAV. Lazy-loads the model on first call.

```bash
curl -sS -X POST http://127.0.0.1:18794/generate \
  -H 'content-type: application/json' \
  -d '{"voice":"af_heart","text":"Hello, I am Peh."}' \
  --output sample.wav
file sample.wav
# → sample.wav: RIFF (little-endian) data, WAVE audio, ...
```

Status codes:

| Code | When                                                                          |
|------|-------------------------------------------------------------------------------|
| 200  | WAV body returned (24 kHz, 16-bit PCM).                                       |
| 400  | Empty/missing `voice` or `text`, unknown voice id, or `format != "wav"`.       |
| 503  | Model failed to load (e.g. `espeak-ng` missing) or generation crashed. Body has a short safe `detail`; full traceback is in the server log. |

Sanitisation: the route never echoes a Python traceback to the client.
Detailed errors land in the server log at INFO/ERROR level.

## Smoke test

After `./start.sh` is running in another terminal:

```bash
./smoke.sh
```

Hits `/health` + `/voices` + `/generate` and verifies a WAV came back.

## Voice cloning

**Not supported in Slice 6C.** Cloning requires user-supplied reference
audio plus a consent flow that Nusika doesn't have yet. Preset voices
are honest and shippable today; cloning lands in a separate slice when
the consent UX is designed.

## Storage layout

```
voices/kokoro/
├── server.py           # FastAPI app (this slice)
├── requirements.txt    # pip deps
├── start.sh            # venv bootstrap + uvicorn
├── smoke.sh            # /health, /voices, /generate probe
├── README.md           # this file
├── .gitignore
└── .venv/              # created on first run, gitignored
```

The Kokoro model itself caches under `~/.cache/huggingface/` (or
`HF_HOME` if set). It is NOT stored inside this directory.

## Rollback

This service is entirely additive. To remove it:

```bash
rm -rf voices/kokoro/.venv voices/kokoro/*.wav
```

To remove the cached model as well:

```bash
rm -rf ~/.cache/huggingface/hub/models--hexgrad--Kokoro-82M
```

## License

- This service code: same as Nusika.
- Kokoro model: [Apache-2.0](https://github.com/hexgrad/kokoro/blob/main/LICENSE).
- FastAPI / uvicorn / pydantic / soundfile / numpy: standard permissive
  open-source licenses.

## What's next (Slice 6D)

A small Nusika-side client (`server/lib/voices/kokoro.ts`) will:
1. Probe this service's `/health` at registry-build time and flip
   `engines.kokoro.configured` to `true` when the service is reachable.
2. Dispatch `POST /nusika/tts` calls with a Kokoro-engine voice profile
   to this service's `/generate`.
3. Cache returned WAVs under `state/voices/cache/<sha256>.wav`.
4. Fall back to Piper on a 503 from this service.

Until 6D ships, this directory is a side-car you can ignore unless you
want to play with it directly.
