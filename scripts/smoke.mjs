#!/usr/bin/env node
/**
 * Magister smoke test.
 *
 * Spawns the server with `tsx server/index.ts` on a randomly-chosen high
 * port (or honors MAGISTER_PORT if set), waits for the listener to come
 * up, then probes /health and /magister/modules. Exits 0 on success and
 * non-zero on any failure. Always tears down the child process.
 *
 * Run with: `npm run smoke`
 */

import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");

const PORT = Number(process.env.MAGISTER_PORT ?? (40000 + Math.floor(Math.random() * 20000)));
const HOST = "127.0.0.1";
const BOOT_TIMEOUT_MS = 15_000;

let child = null;
let exitCode = 0;

function fail(msg) {
  console.error(`[smoke] FAIL: ${msg}`);
  exitCode = 1;
}

async function waitForListener() {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://${HOST}:${PORT}/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (res.ok) return;
    } catch { /* not up yet */ }
    await delay(250);
  }
  throw new Error(`server did not respond on ${HOST}:${PORT} within ${BOOT_TIMEOUT_MS}ms`);
}

async function probe(path, validator) {
  const url = `http://${HOST}:${PORT}${path}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (res.status !== 200) {
    fail(`${path} returned HTTP ${res.status}`);
    return;
  }
  const data = await res.json();
  const issue = validator(data);
  if (issue) fail(`${path} ${issue}`);
  else console.log(`[smoke] OK ${path}`);
}

try {
  child = spawn("npx", ["tsx", "server/index.ts"], {
    cwd: projectRoot,
    env: { ...process.env, MAGISTER_PORT: String(PORT), MAGISTER_HOST: HOST },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stderrChunks = [];
  child.stderr.on("data", (d) => stderrChunks.push(d.toString()));
  child.stdout.on("data", () => { /* drain */ });

  child.on("exit", (code) => {
    if (code !== null && code !== 0 && exitCode === 0) {
      console.error(`[smoke] server exited prematurely with code ${code}`);
      console.error(stderrChunks.join("").slice(-1000));
      exitCode = 1;
    }
  });

  await waitForListener();

  await probe("/health", (d) =>
    d?.ok === true && d?.status === "healthy" ? null : `unexpected payload: ${JSON.stringify(d).slice(0, 200)}`,
  );
  await probe("/magister/modules", (d) =>
    d?.ok === true && Array.isArray(d?.modules) && d.modules.length > 0
      ? null
      : `expected non-empty modules array, got: ${JSON.stringify(d).slice(0, 200)}`,
  );
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
} finally {
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await delay(300);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}

if (exitCode === 0) console.log("[smoke] PASS");
process.exit(exitCode);
