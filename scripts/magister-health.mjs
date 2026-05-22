#!/usr/bin/env node
/**
 * Magister service health probe.
 *
 * Hits each Magister surface in turn:
 *   - API           http://127.0.0.1:18793/health          (required)
 *   - Web           http://127.0.0.1:3003/                 (required)
 *   - Web→API proxy http://127.0.0.1:3003/api/proxy/...    (required)
 *   - Kokoro        http://127.0.0.1:18794/health          (optional)
 *   - Squidley      http://127.0.0.1:18791/magister/modules (optional, only
 *                   probed if Squidley API is actually listening)
 *
 * Then, if `tailscale` is on the PATH, prints the Tailscale URL
 * candidate (`http://<tailscale-ip>:3003`) and probes it too.
 *
 * Exits 0 only when every required check passes. Optional checks fail
 * loudly (printed to the log) but never affect the exit code, so this
 * script doubles as a CI/cron smoke and a "what's missing locally" tool.
 *
 * The Web→API proxy check matters: API + Web can both be up while the
 * proxy fails because of MAGISTER_API_URL drift. The 2026-05-21 audit
 * called this out as a top operational risk.
 *
 * Run with: `npm run service:health`.
 */

import { spawnSync } from "node:child_process";
import net from "node:net";

const TIMEOUT_MS = 4000;

const targets = [
  // The API itself.
  { name: "API",     url: "http://127.0.0.1:18793/health",                 required: true,  validate: (data) => data?.ok === true },
  // The web root is just an HTML page; any 2xx is fine.
  { name: "Web",     url: "http://127.0.0.1:3003/",                        required: true,  validate: null },
  // Critical: prove the web's proxy can actually reach the API. This is
  // what the browser experiences.
  { name: "Proxy",   url: "http://127.0.0.1:3003/api/proxy/magister/health", required: true, validate: (data) => data?.ok === true },
  { name: "Kokoro",  url: "http://127.0.0.1:18794/health",                  required: false, validate: null },
];

let failures = 0;

async function probe(target) {
  const tag = target.required ? "" : " (optional)";
  try {
    const res = await fetch(target.url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) {
      console.log(`[health] FAIL ${target.name.padEnd(7)} ${target.url} — HTTP ${res.status}${tag}`);
      if (target.required) failures += 1;
      return;
    }
    if (target.validate) {
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("application/json")) {
        console.log(`[health] FAIL ${target.name.padEnd(7)} ${target.url} — expected JSON, got ${ct}${tag}`);
        if (target.required) failures += 1;
        return;
      }
      const data = await res.json().catch(() => null);
      if (!target.validate(data)) {
        console.log(`[health] FAIL ${target.name.padEnd(7)} ${target.url} — payload not OK${tag}`);
        if (target.required) failures += 1;
        return;
      }
    }
    console.log(`[health] PASS ${target.name.padEnd(7)} ${target.url}${tag}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isTimeout = err instanceof DOMException && err.name === "TimeoutError";
    console.log(`[health] FAIL ${target.name.padEnd(7)} ${target.url} — ${isTimeout ? "timeout" : msg}${tag}`);
    if (target.required) failures += 1;
  }
}

function tailscaleIp() {
  // `tailscale ip -4` prints one IP per line; first is the device's own IP.
  const env = process.env.TAILSCALE_IP;
  if (env && env.trim()) return env.trim();
  const out = spawnSync("tailscale", ["ip", "-4"], { encoding: "utf8" });
  if (out.status !== 0) return null;
  const ip = (out.stdout ?? "").split(/\s+/).find((s) => /^\d+\.\d+\.\d+\.\d+$/.test(s));
  return ip ?? null;
}

async function probeTailscale() {
  const ip = tailscaleIp();
  if (!ip) {
    console.log("[health] INFO Tailscale not reachable (tailscale CLI missing or not logged in) — skipping.");
    return;
  }
  const url = `http://${ip}:3003/`;
  console.log(`[health] INFO Tailscale URL: ${url}`);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    console.log(`[health] ${res.ok ? "PASS" : "FAIL"} TS-Web ${url} — HTTP ${res.status} (informational)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isTimeout = err instanceof DOMException && err.name === "TimeoutError";
    console.log(`[health] FAIL TS-Web ${url} — ${isTimeout ? "timeout" : msg} (informational)`);
  }
}

async function isPortListening(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port, timeout: 500 });
    socket.once("connect", () => { socket.end(); resolve(true); });
    socket.once("error", () => { resolve(false); });
    socket.once("timeout", () => { socket.destroy(); resolve(false); });
  });
}

async function probeSquidley() {
  // Only probe if Squidley is actually listening — this script must work
  // on machines that don't run Squidley at all.
  const up = await isPortListening("127.0.0.1", 18791);
  if (!up) {
    console.log("[health] INFO Squidley API not listening on 127.0.0.1:18791 — skipping bridge probe.");
    return;
  }
  const url = "http://127.0.0.1:18791/magister/modules";
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) {
      console.log(`[health] FAIL Squidley ${url} — HTTP ${res.status} (bridge probe, informational)`);
      return;
    }
    const data = await res.json().catch(() => null);
    if (data && data.ok === true) {
      console.log(`[health] PASS Squidley ${url} (bridge to Magister works)`);
    } else {
      console.log(`[health] FAIL Squidley ${url} — payload not ok (informational)`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`[health] FAIL Squidley ${url} — ${msg} (informational)`);
  }
}

for (const t of targets) {
  await probe(t);
}
await probeSquidley();
await probeTailscale();

if (failures > 0) {
  console.log(`[health] ${failures} required check(s) failed`);
  process.exit(1);
}
console.log("[health] PASS — all required checks green");
