#!/usr/bin/env bash
# Nusika Kokoro smoke — checks /health, /voices, and /generate.
# Assumes the service is already running on NUSIKA_KOKORO_HOST/PORT
# (defaults: 127.0.0.1:18794). Run start.sh in another terminal first.

set -uo pipefail

HOST="${NUSIKA_KOKORO_HOST:-${MAGISTER_KOKORO_HOST:-127.0.0.1}}"
PORT="${NUSIKA_KOKORO_PORT:-${MAGISTER_KOKORO_PORT:-18794}}"
BASE="http://${HOST}:${PORT}"

fail() { echo "[smoke] FAIL: $*" >&2; exit 1; }

echo "[smoke] GET ${BASE}/health"
HEALTH="$(curl -sS --fail-with-body "${BASE}/health" 2>&1)" \
  || fail "/health unreachable: ${HEALTH}"
echo "${HEALTH}" | python3 -c '
import json, sys
d = json.load(sys.stdin)
assert d["ok"] is True, d
assert d["engine"] == "kokoro", d
assert d["status"] in ("ready", "cold"), d
status = d["status"]
loaded = d["model_loaded"]
print("[smoke] OK /health status=" + status + " model_loaded=" + str(loaded))' \
  || fail "/health body unexpected: ${HEALTH}"

echo "[smoke] GET ${BASE}/voices"
VOICES="$(curl -sS --fail-with-body "${BASE}/voices" 2>&1)" \
  || fail "/voices unreachable: ${VOICES}"
echo "${VOICES}" | python3 -c '
import json, sys
d = json.load(sys.stdin)
assert d["ok"] is True, d
assert isinstance(d["voices"], list) and len(d["voices"]) > 0, d
print("[smoke] OK /voices count=" + str(len(d["voices"])))' \
  || fail "/voices body unexpected: ${VOICES}"

OUT="$(mktemp -t kokoro-smoke-XXXXXX.wav)"
echo "[smoke] POST ${BASE}/generate -> ${OUT}"
HTTP="$(curl -sS -o "${OUT}" -w '%{http_code}' \
  -X POST "${BASE}/generate" \
  -H 'content-type: application/json' \
  -d '{"voice":"af_heart","text":"Hello, I am Varros."}')"
case "${HTTP}" in
  200)
    if [ ! -s "${OUT}" ]; then
      fail "/generate returned 200 but file is empty"
    fi
    if command -v file >/dev/null 2>&1; then
      DESC="$(file "${OUT}")"
      case "${DESC}" in
        *WAVE\ audio*|*RIFF*WAVE*) echo "[smoke] OK /generate ${DESC}";;
        *) fail "/generate output is not a WAV: ${DESC}";;
      esac
    else
      head -c 4 "${OUT}" | grep -q "RIFF" \
        && echo "[smoke] OK /generate (RIFF header present, $(wc -c <"${OUT}") bytes)" \
        || fail "/generate output is not a WAV (no RIFF header)"
    fi
    ;;
  503)
    BODY="$(cat "${OUT}")"
    echo "[smoke] /generate returned 503 (engine unavailable):" >&2
    echo "${BODY}" >&2
    echo "[smoke] This is expected if espeak-ng or the kokoro model is missing." >&2
    fail "/generate engine unavailable"
    ;;
  *)
    fail "/generate unexpected HTTP ${HTTP}, body $(cat "${OUT}")"
    ;;
esac

echo "[smoke] PASS"
