#!/usr/bin/env bash
# Nusika voice service — repo-owned entrypoint (Kokoro 82M, loopback TTS).
#
# Canonical source lives here: /pehverse/repos/nusika/voice/
# Runtime artifacts (venv, real env file, HF model cache, generated WAVs)
# stay OUTSIDE git — see .gitignore.
#
# Usage:
#   ./start.sh
#
# Env (also honored by server.py at request time):
#   NUSIKA_KOKORO_HOST       default 127.0.0.1   (loopback only)
#   NUSIKA_KOKORO_PORT       default 18794
#   NUSIKA_KOKORO_LOG_LEVEL  default INFO
#   NUSIKA_VOICE_VENV        venv dir; default ./.venv. Point at an existing
#                            runtime venv (e.g. /pehverse/services/nusika-voice/.venv)
#                            to avoid rebuilding the ~5 GB environment.
#   HF_HOME                  Kokoro model cache location (keep off the home dir).
#
# An optional sibling env file is sourced if present: ./nusika-voice.env
# (gitignored). Copy nusika-voice.env.example to create it.

set -euo pipefail

cd "$(dirname "$0")"

# Load the local env file if the operator created one (gitignored).
if [ -f nusika-voice.env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./nusika-voice.env
  set +a
fi

VENV="${NUSIKA_VOICE_VENV:-.venv}"
PIP="${VENV}/bin/pip"
UVICORN="${VENV}/bin/uvicorn"

if [ ! -d "${VENV}" ]; then
  echo "[nusika-voice] creating venv at ${VENV}"
  python3 -m venv "${VENV}"
  "${PIP}" install --upgrade pip wheel
fi

# Install / refresh deps. Fast when nothing changed.
"${PIP}" install -r requirements.txt

# espeak-ng is a system binary. Kokoro's misaki[en] G2P normally uses the
# bundled binary from the espeakng-loader wheel, so a missing OS package is
# usually fine. Warn only.
if ! command -v espeak-ng >/dev/null 2>&1; then
  echo "[nusika-voice] note: system espeak-ng not on PATH; relying on bundled espeakng-loader." >&2
fi

HOST="${NUSIKA_KOKORO_HOST:-${MAGISTER_KOKORO_HOST:-127.0.0.1}}"
PORT="${NUSIKA_KOKORO_PORT:-${MAGISTER_KOKORO_PORT:-18794}}"

echo "[nusika-voice] starting on ${HOST}:${PORT} (venv=${VENV}, HF_HOME=${HF_HOME:-default})"
exec "${UVICORN}" server:app --host "${HOST}" --port "${PORT}" --log-level info
