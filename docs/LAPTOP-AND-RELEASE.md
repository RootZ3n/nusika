# Nusika — Laptop & Release Modes

Nusika core (server `:18793` + web `:3003`) is lightweight and **text-only by
default**. Voice is fully optional and degrades gracefully — if the voice server
is unavailable, TTS routes return `503` and chat/learning continue uninterrupted.
Nothing needs to be "turned off" to run without voice.

## Modes (all supported by the code today)

| Mode | How | When |
|---|---|---|
| **Text-only** (default) | Don't configure any voice env; don't run Kokoro/Piper/Whisper | Laptops, public release, anywhere without a voice runtime |
| **Remote voice over Tailscale** | Set `NUSIKA_KOKORO_URL=http://<desktop-tailnet-host>:18794` | Laptop using the desktop's voice server |
| **Full local voice** (desktop-only) | Run the Kokoro service (`voice/`, uvicorn `:18794`, ~5 GB venv, model in `HF_HOME`) | The desktop, which has the model + runtime |
| **Disabled** | Same as text-only (voice is opt-in) | n/a |

## Laptop guidance
- **Skip the local voice runtime.** Do NOT install the Kokoro venv/model, Piper, or Whisper on the laptop.
- Run **text-only** (configure only an LLM: cloud key or local Ollama), **or** set
  `NUSIKA_KOKORO_URL` to the desktop's Kokoro over Tailscale for remote voice.
- Hardware: any modern CPU; no GPU; voice cache (`/pehverse/cache/huggingface`) is **desktop-only** and not needed.
- Ports: api `18793`, web `3003`; voice `18794` only if you run/point at a voice server.

## Public-release guidance
- Default to **text-only**; document optional voice as an add-on.
- **Exclude voice model files** from the release package (Kokoro model is fetched into `HF_HOME` at first use; not bundled).
- Remove the deprecated ElevenLabs path before public release.
- Before public exposure, add auth + rate-limiting + tighter CORS (the core is currently lab/Tailscale-trust only).
