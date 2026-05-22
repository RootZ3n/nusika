"""
Magister Kokoro voice service — local, loopback-only, preset voices only.

Slice 6C scope: standalone Python service. Magister itself does NOT call
this service yet; the wiring lands in Slice 6D. Until then, this is a
side-car you can curl by hand or smoke with voices/kokoro/smoke.sh.

Endpoints:
    GET  /health    — liveness + lazy-load status (never touches the model)
    GET  /voices    — preset voice list (never touches the model)
    POST /generate  — text-to-speech, returns audio/wav

Design rules:
    - No GPU assumptions. CPU-only is fine.
    - Bind 127.0.0.1 by default. Override via MAGISTER_KOKORO_HOST/PORT.
    - Lazy-load the Kokoro pipeline on first /generate call.
    - On any model/generation failure, return 503 with a short, safe detail.
      Never expose Python tracebacks to clients; log the full traceback
      server-side instead.
    - No cloning. Preset voices only.

System requirement (NOT a Python package):
    espeak-ng must be installed at the OS level. Kokoro's G2P backend
    (misaki[en]) calls into it via phonemizer. On Debian/Ubuntu:
        sudo apt install espeak-ng
    On macOS:
        brew install espeak-ng
"""

from __future__ import annotations

import io
import logging
import os
from typing import Optional

import numpy as np
import soundfile as sf
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field


# ── Logging ───────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=os.environ.get("MAGISTER_KOKORO_LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s [kokoro] %(message)s",
)
log = logging.getLogger("kokoro")


# ── Constants ─────────────────────────────────────────────────────────────────

# Conservative documented preset list. The Kokoro package ships ~50 voices;
# this subset is enough to map every Magister companion plus Varros.
# Slice 6E will pick one per companion. Add to this list as needed.
#
# Naming convention from upstream Kokoro:
#   af_*  = American female
#   am_*  = American male
#   bf_*  = British female
#   bm_*  = British male
#   jf_*, jm_* = Japanese
#   zf_*, zm_* = Chinese
KOKORO_VOICES: list[dict[str, str]] = [
    # American female
    {"id": "af_heart",    "name": "Heart",    "gender": "female", "language": "en-us"},
    {"id": "af_alloy",    "name": "Alloy",    "gender": "female", "language": "en-us"},
    {"id": "af_aoede",    "name": "Aoede",    "gender": "female", "language": "en-us"},
    {"id": "af_bella",    "name": "Bella",    "gender": "female", "language": "en-us"},
    {"id": "af_jessica",  "name": "Jessica",  "gender": "female", "language": "en-us"},
    {"id": "af_kore",     "name": "Kore",     "gender": "female", "language": "en-us"},
    {"id": "af_nicole",   "name": "Nicole",   "gender": "female", "language": "en-us"},
    {"id": "af_nova",     "name": "Nova",     "gender": "female", "language": "en-us"},
    {"id": "af_river",    "name": "River",    "gender": "female", "language": "en-us"},
    {"id": "af_sarah",    "name": "Sarah",    "gender": "female", "language": "en-us"},
    {"id": "af_sky",      "name": "Sky",      "gender": "female", "language": "en-us"},
    # American male
    {"id": "am_adam",     "name": "Adam",     "gender": "male",   "language": "en-us"},
    {"id": "am_echo",     "name": "Echo",     "gender": "male",   "language": "en-us"},
    {"id": "am_eric",     "name": "Eric",     "gender": "male",   "language": "en-us"},
    {"id": "am_fenrir",   "name": "Fenrir",   "gender": "male",   "language": "en-us"},
    {"id": "am_liam",     "name": "Liam",     "gender": "male",   "language": "en-us"},
    {"id": "am_michael",  "name": "Michael",  "gender": "male",   "language": "en-us"},
    {"id": "am_onyx",     "name": "Onyx",     "gender": "male",   "language": "en-us"},
    {"id": "am_puck",     "name": "Puck",     "gender": "male",   "language": "en-us"},
    {"id": "am_santa",    "name": "Santa",    "gender": "male",   "language": "en-us"},
    # British female
    {"id": "bf_alice",    "name": "Alice",    "gender": "female", "language": "en-gb"},
    {"id": "bf_emma",     "name": "Emma",     "gender": "female", "language": "en-gb"},
    {"id": "bf_isabella", "name": "Isabella", "gender": "female", "language": "en-gb"},
    {"id": "bf_lily",     "name": "Lily",     "gender": "female", "language": "en-gb"},
    # British male
    {"id": "bm_daniel",   "name": "Daniel",   "gender": "male",   "language": "en-gb"},
    {"id": "bm_fable",    "name": "Fable",    "gender": "male",   "language": "en-gb"},
    {"id": "bm_george",   "name": "George",   "gender": "male",   "language": "en-gb"},
    {"id": "bm_lewis",    "name": "Lewis",    "gender": "male",   "language": "en-gb"},
]

VOICE_IDS = {v["id"] for v in KOKORO_VOICES}

# Maximum input length. Generation is per-sentence under the hood, but
# this is a defensive ceiling so a runaway input can't pin the process.
MAX_TEXT_CHARS = 4000

# Kokoro generates at 24 kHz PCM.
SAMPLE_RATE = 24000


# ── Lazy model loader ─────────────────────────────────────────────────────────

_pipeline = None  # type: ignore[var-annotated]
_pipeline_load_error: Optional[str] = None


def _load_pipeline():
    """Import + instantiate Kokoro on first use. Cached after success.

    A previous failure is sticky (we don't retry on every request), but a
    process restart will retry.
    """
    global _pipeline, _pipeline_load_error
    if _pipeline is not None:
        return _pipeline
    if _pipeline_load_error is not None:
        # Don't keep retrying a known-bad import on every request.
        raise RuntimeError(_pipeline_load_error)

    try:
        # Import inside the function so /health and /voices stay reachable
        # even if the kokoro package isn't installed.
        from kokoro import KPipeline  # type: ignore[import-not-found]
    except Exception as e:  # noqa: BLE001 — capture any import failure
        msg = f"Failed to import kokoro: {e!s}"
        log.exception(msg)
        _pipeline_load_error = msg
        raise RuntimeError(msg) from e

    try:
        # `lang_code='a'` selects American English G2P. We pick the lang
        # from the requested voice id at generate time; KPipeline accepts
        # voice IDs across languages once instantiated.
        _pipeline = KPipeline(lang_code="a")
        log.info("kokoro pipeline loaded")
    except Exception as e:  # noqa: BLE001
        msg = f"Failed to instantiate Kokoro pipeline: {e!s}"
        log.exception(msg)
        _pipeline_load_error = msg
        raise RuntimeError(msg) from e

    return _pipeline


def _voice_lang_code(voice_id: str) -> str:
    """Pick the G2P lang_code to use for a given voice id.

    Kokoro voices encode language in the prefix:
        af_/am_  → American English ('a')
        bf_/bm_  → British English  ('b')
        jf_/jm_  → Japanese          ('j')
        zf_/zm_  → Mandarin          ('z')
    Anything else falls back to 'a'.
    """
    prefix = voice_id[:2] if len(voice_id) >= 2 else ""
    if prefix in ("af", "am"):
        return "a"
    if prefix in ("bf", "bm"):
        return "b"
    if prefix in ("jf", "jm"):
        return "j"
    if prefix in ("zf", "zm"):
        return "z"
    return "a"


# ── Pydantic shapes ───────────────────────────────────────────────────────────


class GenerateBody(BaseModel):
    voice: str = Field(..., description="Kokoro voice id (e.g. 'af_heart').")
    text: str = Field(..., description="Text to synthesise. Max 4000 chars.")
    format: str = Field("wav", description="Output format. 'wav' only in 6C.")


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Magister Kokoro voice service",
    version="0.1.0",
    description="Loopback-only local TTS for Magister. Slice 6C — service skeleton.",
)


@app.get("/health")
def health() -> dict[str, object]:
    """Liveness + lazy-load status. Never touches the model.

    Status meanings:
        - "ready" if the pipeline has been loaded successfully.
        - "cold" if the model has not yet been loaded (lazy).
        - "error" if a previous load attempt failed; restart to retry.
    """
    if _pipeline is not None:
        return {"ok": True, "engine": "kokoro", "status": "ready", "model_loaded": True}
    if _pipeline_load_error is not None:
        return {
            "ok": True,
            "engine": "kokoro",
            "status": "error",
            "model_loaded": False,
            "detail": _pipeline_load_error[:200],
        }
    return {"ok": True, "engine": "kokoro", "status": "cold", "model_loaded": False}


@app.get("/voices")
def voices() -> dict[str, object]:
    """Static documented preset list. Never touches the model."""
    return {"ok": True, "voices": KOKORO_VOICES, "engine": "kokoro"}


@app.post("/generate")
def generate(body: GenerateBody, request: Request) -> Response:
    """Generate a WAV from text using the requested preset voice.

    Returns audio/wav on success.
    Returns 400 JSON on bad input.
    Returns 503 JSON on engine/generation failure (no traceback exposed).
    """
    text = (body.text or "").strip()
    if not text:
        return JSONResponse(
            {"ok": False, "error": "text required"},
            status_code=400,
        )
    if len(text) > MAX_TEXT_CHARS:
        return JSONResponse(
            {
                "ok": False,
                "error": f"text exceeds {MAX_TEXT_CHARS} characters",
            },
            status_code=400,
        )

    voice_id = (body.voice or "").strip()
    if not voice_id:
        return JSONResponse(
            {"ok": False, "error": "voice required"},
            status_code=400,
        )
    if voice_id not in VOICE_IDS:
        return JSONResponse(
            {
                "ok": False,
                "error": f"unknown voice '{voice_id}'",
                "detail": "GET /voices for the supported list.",
            },
            status_code=400,
        )

    if body.format and body.format.lower() != "wav":
        return JSONResponse(
            {"ok": False, "error": f"unsupported format '{body.format}'", "detail": "Only 'wav' in Slice 6C."},
            status_code=400,
        )

    # Load pipeline (lazy). All failures from here on collapse into a 503.
    try:
        pipeline = _load_pipeline()
    except Exception as e:  # noqa: BLE001
        log.exception("kokoro pipeline load failed")
        return JSONResponse(
            {
                "ok": False,
                "error": "Kokoro engine not configured.",
                "detail": _short(str(e)),
            },
            status_code=503,
        )

    # The pipeline is bound to a single lang_code at __init__ time, but we
    # advertise voices across multiple languages. If the requested voice's
    # language differs from the loaded pipeline's, we instantiate a second
    # pipeline lazily for that language. Cached per language to avoid
    # repeated heavy loads.
    lang = _voice_lang_code(voice_id)
    try:
        active_pipeline = _pipeline_for(lang, pipeline)
    except Exception as e:  # noqa: BLE001
        log.exception("kokoro language pipeline load failed for lang=%s", lang)
        return JSONResponse(
            {
                "ok": False,
                "error": "Kokoro language pipeline not available.",
                "detail": _short(str(e)),
            },
            status_code=503,
        )

    # Generate.
    try:
        audio_chunks: list[np.ndarray] = []
        for _gs, _ps, audio in active_pipeline(text, voice=voice_id):
            audio_chunks.append(audio)
        if not audio_chunks:
            log.error("kokoro returned no audio for voice=%s text_len=%d", voice_id, len(text))
            return JSONResponse(
                {
                    "ok": False,
                    "error": "Kokoro generation produced no audio.",
                    "detail": "Model returned an empty audio stream.",
                },
                status_code=503,
            )
        full = np.concatenate(audio_chunks).astype(np.float32)
    except Exception as e:  # noqa: BLE001
        log.exception("kokoro generation failed voice=%s text_len=%d", voice_id, len(text))
        return JSONResponse(
            {
                "ok": False,
                "error": "Kokoro generation failed.",
                "detail": _short(str(e)),
            },
            status_code=503,
        )

    # Encode to 16-bit PCM WAV.
    buf = io.BytesIO()
    try:
        sf.write(buf, full, SAMPLE_RATE, subtype="PCM_16", format="WAV")
    except Exception as e:  # noqa: BLE001
        log.exception("wav encoding failed")
        return JSONResponse(
            {"ok": False, "error": "WAV encoding failed.", "detail": _short(str(e))},
            status_code=503,
        )

    audio_bytes = buf.getvalue()
    log.info(
        "kokoro generated voice=%s text_len=%d audio_bytes=%d sample_rate=%d",
        voice_id, len(text), len(audio_bytes), SAMPLE_RATE,
    )
    return Response(
        content=audio_bytes,
        media_type="audio/wav",
        headers={
            "X-Voice-Engine": "kokoro",
            "X-Voice-Id": voice_id,
            "X-Sample-Rate": str(SAMPLE_RATE),
            "X-Voice-Service": "magister-kokoro/0.1.0",
        },
    )


# ── Per-language pipeline cache ───────────────────────────────────────────────


_lang_pipelines: dict[str, object] = {}


def _pipeline_for(lang: str, default_pipeline):  # type: ignore[no-untyped-def]
    """Return a KPipeline bound to `lang`. Default cached pipeline is `'a'`."""
    if lang == "a":
        return default_pipeline
    if lang in _lang_pipelines:
        return _lang_pipelines[lang]
    from kokoro import KPipeline  # type: ignore[import-not-found]
    pipeline = KPipeline(lang_code=lang)
    _lang_pipelines[lang] = pipeline
    return pipeline


# ── Helpers ───────────────────────────────────────────────────────────────────


def _short(msg: str, limit: int = 200) -> str:
    """Trim long messages so HTTP clients don't see Python tracebacks."""
    line = msg.splitlines()[0] if msg else msg
    return line[:limit]


# ── Entrypoint ────────────────────────────────────────────────────────────────


def _resolve_addr() -> tuple[str, int]:
    host = os.environ.get("MAGISTER_KOKORO_HOST", "127.0.0.1")
    try:
        port = int(os.environ.get("MAGISTER_KOKORO_PORT", "18794"))
    except ValueError:
        port = 18794
    return host, port


if __name__ == "__main__":
    import uvicorn

    host, port = _resolve_addr()
    log.info("starting Magister Kokoro service on %s:%d", host, port)
    uvicorn.run(app, host=host, port=port, log_level="info")
