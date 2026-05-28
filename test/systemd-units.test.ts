/**
 * Slice 7A — static checks on the systemd unit files.
 *
 * No process is started. We only assert that the unit files exist and
 * encode the correct port + interface assumptions:
 *   - API and Kokoro must bind to 127.0.0.1 (loopback only).
 *   - Web is the only public surface; binding to 0.0.0.0 is allowed
 *     there, but we still assert the expected port (3003).
 *   - The web unit must talk to the API via the loopback URL.
 *
 * If the unit files are renamed or their bind values change in a way
 * that would expose API/Kokoro publicly, this test fires.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const UNIT_DIR = resolve(REPO_ROOT, "contrib", "systemd");

function readUnit(name: string): string {
  const path = resolve(UNIT_DIR, name);
  assert.ok(existsSync(path), `unit file missing: ${path}`);
  return readFileSync(path, "utf8");
}

test("nusika-api unit binds API to 127.0.0.1:18793 only", () => {
  const text = readUnit("nusika-api.service");
  assert.match(text, /Environment=NUSIKA_HOST=127\.0\.0\.1/, "API host must be loopback");
  assert.match(text, /Environment=NUSIKA_PORT=18793/, "API port must be 18793");
  assert.match(text, /Environment=NUSIKA_ALLOW_PUBLIC_BIND=false/, "public bind guard must be off");
  assert.doesNotMatch(text, /NUSIKA_HOST=0\.0\.0\.0/, "API must never set HOST=0.0.0.0");
});

test("nusika-kokoro unit binds Kokoro to 127.0.0.1:18794 only", () => {
  const text = readUnit("nusika-kokoro.service");
  assert.match(text, /--host 127\.0\.0\.1/, "Kokoro must bind to loopback");
  assert.match(text, /--port 18794/, "Kokoro port must be 18794");
  assert.match(text, /NUSIKA_KOKORO_HOST=127\.0\.0\.1/, "Kokoro env host must be loopback");
  assert.match(text, /NUSIKA_KOKORO_PORT=18794/, "Kokoro env port must be 18794");
  assert.doesNotMatch(text, /--host 0\.0\.0\.0/, "Kokoro must never bind 0.0.0.0");
});

test("nusika-web unit exposes Next on 0.0.0.0:3003 and proxies to loopback API", () => {
  const text = readUnit("nusika-web.service");
  assert.match(text, /-p 3003/, "Web port must be 3003");
  assert.match(text, /-H 0\.0\.0\.0/, "Web is the public surface; expected 0.0.0.0");
  assert.match(text, /NUSIKA_API_URL=http:\/\/127\.0\.0\.1:18793/, "Web must proxy to loopback API");
});

test("nusika.target Requires API and Wants Web/Kokoro (truth model)", () => {
  const text = readUnit("nusika.target");
  // API is the load-bearing piece — must be Requires= so the target
  // transitions out of active when API dies (no more "lies by omission").
  assert.match(text, /Requires=.*nusika-api\.service/, "target must Require API for truth tracking");
  // Web + Kokoro are useful on their own; Wants= so a partial stack still
  // surfaces a degraded banner instead of cascade-stopping.
  assert.match(text, /Wants=.*nusika-web\.service/, "target must Want Web");
  assert.match(text, /Wants=.*nusika-kokoro\.service/, "target must Want Kokoro");
  // Explicitly forbid API in Wants= — that's the prior buggy setup.
  assert.doesNotMatch(
    text,
    /^Wants=[^\n]*nusika-api\.service/m,
    "target must NOT have API in Wants= — switched to Requires= on 2026-05-22",
  );
});

test("nusika-api unit uses Restart=always (load-bearing service)", () => {
  const text = readUnit("nusika-api.service");
  // Restart=on-failure would not restart after a clean SIGTERM (status 0).
  // That's the failure mode that left the API dead on 2026-05-10.
  assert.match(text, /^Restart=always/m, "API must use Restart=always so a clean exit also restarts");
});
