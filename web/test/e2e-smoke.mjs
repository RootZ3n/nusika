#!/usr/bin/env node
/**
 * Nusika web — end-to-end HTTP smoke.
 *
 * Pure Node (no Playwright, no Puppeteer): boots the built dist API
 * server and `next start` for the prebuilt web app, then fetches each
 * top-level route and asserts substrings of the rendered HTML.
 *
 * What this catches:
 *   - the page route exists and returns 200
 *   - SSR did not crash (no Next.js error boundary, no <title>Error</title>)
 *   - the page contains its expected heading/copy
 *   - /api/proxy/* still proxies through to the API
 *
 * What this does NOT catch (defer to a future Playwright slice):
 *   - JS-driven interactions (click → confirm → DELETE)
 *   - the in-browser red error banner that appears after a failed chat
 *
 * Prerequisites:
 *   - npm run build (project root) — emits dist/
 *   - cd web && npm run build       — emits .next/
 *
 * Run:
 *   cd web && npm run test:e2e
 */

import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "..");
const projectRoot = resolve(webRoot, "..");

const distEntry = resolve(projectRoot, "dist/server/index.js");
const nextBuildId = resolve(webRoot, ".next/BUILD_ID");
const nextBin = resolve(webRoot, "node_modules/.bin/next");

if (!existsSync(distEntry)) {
  console.error(`[web-smoke] FAIL: ${distEntry} missing. Run \`npm run build\` from the project root first.`);
  process.exit(1);
}
if (!existsSync(nextBuildId)) {
  console.error(`[web-smoke] FAIL: ${nextBuildId} missing. Run \`npm run build\` from web/ first.`);
  process.exit(1);
}
if (!existsSync(nextBin)) {
  console.error(`[web-smoke] FAIL: ${nextBin} missing. Run \`npm install\` from web/ first.`);
  process.exit(1);
}

const API_PORT = 40000 + Math.floor(Math.random() * 10000);
const WEB_PORT = API_PORT + 1;
const HOST = "127.0.0.1";

let apiProc = null;
let webProc = null;
let exitCode = 0;

function fail(msg) {
  console.error(`[web-smoke] FAIL: ${msg}`);
  exitCode = 1;
}

async function pollUntilReady(url, deadlineMs = 30_000) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
      // any non-5xx response means the server is alive enough to respond
      if (res.status < 500) return true;
    } catch { /* not up yet */ }
    await delay(300);
  }
  return false;
}

async function checkPage(label, path, expectedSubstrings) {
  const url = `http://${HOST}:${WEB_PORT}${path}`;
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  } catch (err) {
    fail(`${label} (${path}) fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  if (res.status !== 200) {
    fail(`${label} (${path}) returned HTTP ${res.status}`);
    return;
  }
  const html = await res.text();

  // Crash markers.
  if (/Application error:\s*a client-side exception has occurred/i.test(html)) {
    fail(`${label} (${path}) shows Next.js client-side error boundary`);
    return;
  }
  if (/<title>Error<\/title>/i.test(html) || /Internal Server Error/.test(html)) {
    fail(`${label} (${path}) renders an Error page`);
    return;
  }

  // Required substrings.
  const missing = expectedSubstrings.filter(s => !html.includes(s));
  if (missing.length > 0) {
    fail(`${label} (${path}) missing expected text: ${JSON.stringify(missing)}`);
    return;
  }

  console.log(`[web-smoke] OK ${label} ${path}`);
}

async function checkProxy() {
  // Lookup is the safest probe: it never calls the LLM, never mutates state,
  // and has a stable contract (`{ ok: true, supported: false, reason }`).
  const url = `http://${HOST}:${WEB_PORT}/api/proxy/nusika/lookup`;
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "smoke probe" }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (err) {
    fail(`proxy probe fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  if (res.status !== 200) {
    fail(`proxy → /nusika/lookup returned HTTP ${res.status}`);
    return;
  }
  const body = await res.json().catch(() => ({}));
  if (body.ok !== true || body.supported !== false) {
    fail(`proxy → /nusika/lookup unexpected body: ${JSON.stringify(body).slice(0, 200)}`);
    return;
  }
  console.log("[web-smoke] OK proxy → /nusika/lookup honest no-browse contract");
}

async function checkVoicesRegistry() {
  // Slice 6B contract: GET /nusika/voices is always 200, lists Peh and
  // every companion, reports Kokoro as not wired, never crashes on missing
  // binaries. Probe through the proxy to verify the proxy + registry work.
  const url = `http://${HOST}:${WEB_PORT}/api/proxy/nusika/voices`;
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  } catch (err) {
    fail(`voices probe fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  if (res.status !== 200) {
    fail(`proxy → /nusika/voices returned HTTP ${res.status}`);
    return;
  }
  const body = await res.json().catch(() => ({}));
  if (body.ok !== true || !Array.isArray(body.voices)) {
    fail(`proxy → /nusika/voices unexpected body: ${JSON.stringify(body).slice(0, 200)}`);
    return;
  }
  const ids = body.voices.map((v) => v.id);
  if (!ids.includes("peh-default")) {
    fail(`/nusika/voices missing peh-default: got ${ids.slice(0, 6).join(", ")}…`);
    return;
  }
  // Slice 6D: the registry probes Kokoro live. Assert the field exists
  // with the right shape; its boolean depends on whether the local
  // Kokoro sub-service happens to be running.
  if (typeof body.engines?.kokoro?.configured !== "boolean") {
    fail(`/nusika/voices kokoro.configured must be boolean; got ${JSON.stringify(body.engines?.kokoro)}`);
    return;
  }
  if (typeof body.engines?.kokoro?.detail !== "string") {
    fail(`/nusika/voices kokoro.detail must be a string; got ${JSON.stringify(body.engines?.kokoro)}`);
    return;
  }
  if (body.engines?.elevenlabs?.deprecated !== true) {
    fail(`/nusika/voices elevenlabs must be deprecated:true; got ${JSON.stringify(body.engines?.elevenlabs)}`);
    return;
  }
  const kokoroState = body.engines.kokoro.configured ? "live" : "down";
  console.log(`[web-smoke] OK proxy → /nusika/voices (${ids.length} voices, kokoro ${kokoroState})`);
}

try {
  console.log(`[web-smoke] starting API on port ${API_PORT} and web on port ${WEB_PORT}`);

  apiProc = spawn("node", [distEntry], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NUSIKA_PORT: String(API_PORT),
      NUSIKA_HOST: HOST,
      // Force the LLM client to a dead address so any accidental call fails fast
      // with the friendly 502 contract — never reaches a real provider.
      NUSIKA_LOCAL_OLLAMA_URL: "http://127.0.0.1:1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  apiProc.stdout.on("data", () => {});
  apiProc.stderr.on("data", () => {});
  apiProc.on("exit", (code) => {
    if (code !== null && code !== 0 && exitCode === 0) {
      console.error(`[web-smoke] API exited prematurely with code ${code}`);
      exitCode = 1;
    }
  });

  if (!(await pollUntilReady(`http://${HOST}:${API_PORT}/health`))) {
    fail(`API did not become healthy on port ${API_PORT}`);
    throw new Error("API failed to start");
  }
  console.log("[web-smoke] OK API ready");

  webProc = spawn(nextBin, ["start", "-p", String(WEB_PORT)], {
    cwd: webRoot,
    env: {
      ...process.env,
      NUSIKA_API_URL: `http://${HOST}:${API_PORT}`,
      // Suppress noisy Next.js telemetry prompts in CI/scripts.
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  webProc.stdout.on("data", () => {});
  webProc.stderr.on("data", () => {});
  webProc.on("exit", (code) => {
    if (code !== null && code !== 0 && exitCode === 0) {
      console.error(`[web-smoke] web exited prematurely with code ${code}`);
      exitCode = 1;
    }
  });

  if (!(await pollUntilReady(`http://${HOST}:${WEB_PORT}/`))) {
    fail(`web did not become ready on port ${WEB_PORT}`);
    throw new Error("web failed to start");
  }
  console.log("[web-smoke] OK web ready");

  // Ittunaha (/) — renders a "Loading Nusika…" shell during SSR
  // and only surfaces the narrator greeting + /teach + /dm links after
  // client-side hydration. We therefore assert what SSR actually emits:
  // the tab labels (which are static) and the loading shell.
  // To verify the targets of the post-hydration links exist, the /teach
  // and /dm checks below hit them directly — if either responds 200,
  // navigation from Ittunaha is reachable.
  await checkPage("Ittunaha", "/", [
    "Ittunaha",                     // active tab label
    "The Session",                  // sibling tab label, always SSR'd
    "Shukha Anumpa",                // sibling tab label, always SSR'd
    "Loading Nusika",               // loading shell — proves SSR completed
  ]);

  // Teach Me Anything (/teach) — fully SSR'd standalone page.
  await checkPage("Teach", "/teach", [
    "Teach Me Anything",
    "lesson",                       // empty state mentions lessons
  ]);

  // Dungeon Master (/dm) — fully SSR'd standalone page.
  await checkPage("DM", "/dm", [
    "Dungeon Master",
    "campaign",                     // empty state mentions campaigns
  ]);

  await checkProxy();
  await checkVoicesRegistry();
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
} finally {
  for (const p of [webProc, apiProc]) {
    if (p && p.exitCode === null) {
      p.kill("SIGTERM");
      await delay(300);
      if (p.exitCode === null) p.kill("SIGKILL");
    }
  }
}

if (exitCode === 0) console.log("[web-smoke] PASS");
process.exit(exitCode);
