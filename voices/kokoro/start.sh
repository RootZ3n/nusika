#!/usr/bin/env bash
# Magister Kokoro voice service — Slice 6C
#
# Usage:
#   ./start.sh
#
# Env overrides (also honored by server.py at request time):
#   MAGISTER_KOKORO_HOST   default 127.0.0.1
#   MAGISTER_KOKORO_PORT   default 18794
#   MAGISTER_KOKORO_LOG_LEVEL  default INFO

set -euo pipefail

cd "$(dirname "$0")"

VENV=".venv"
PY="${VENV}/bin/python"
PIP="${VENV}/bin/pip"
UVICORN="${VENV}/bin/uvicorn"

if [ ! -d "${VENV}" ]; then
  echo "[kokoro] creating venv at ${VENV}"
  python3 -m venv "${VENV}"
  "${PIP}" install --upgrade pip wheel
fi

# Install / refresh deps. pip is fast when nothing changed.
"${PIP}" install -r requirements.txt

# espeak-ng is a system binary, not a pip package. Warn loudly if missing —
# Kokoro will fail at first /generate without it.
if ! command -v espeak-ng >/dev/null 2>&1; then
  cat <<'WARN' >&2
[kokoro] WARNING: espeak-ng is not installed.
        Kokoro's G2P backend (misaki[en]) needs espeak-ng to run.
        /health and /voices will work, but /generate will return 503.
        Install:
          Debian/Ubuntu: sudo apt install espeak-ng
          macOS:         brew install espeak-ng
          Fedora:        sudo dnf install espeak-ng
WARN
fi

HOST="${MAGISTER_KOKORO_HOST:-127.0.0.1}"
PORT="${MAGISTER_KOKORO_PORT:-18794}"

echo "[kokoro] starting on ${HOST}:${PORT}"
exec "${UVICORN}" server:app --host "${HOST}" --port "${PORT}" --log-level info
