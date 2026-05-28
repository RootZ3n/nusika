"use client";

/**
 * Service health banner.
 *
 * Polls /api/proxy/nusika/health/services every POLL_INTERVAL_MS and
 * renders a visible banner whenever any required sub-service is degraded:
 *
 *   - API unreachable (proxy returns 502)            → red, blocking
 *   - API up but DB unreachable                       → red, blocking
 *   - LLM unavailable (ollama down in local-only)     → amber, advisory
 *   - Kokoro unreachable                              → amber, advisory
 *
 * When the API is unreachable the banner is full-width and announces that
 * Nusika is offline — the rest of the UI is still rendered so the user
 * can read existing state, but actions will fail. We deliberately do NOT
 * silently hide errors; the audit on 2026-05-21 flagged "frontend shell,
 * backend corpse" as a top operational risk.
 */

import { useEffect, useState } from "react";

const POLL_INTERVAL_MS = 15_000;
const PROBE_TIMEOUT_MS = 4_000;
const PROBE_URL = "/api/proxy/nusika/health/services";

type ServiceHealth = {
  ok: boolean;
  api: { ok: boolean };
  db: { ok: boolean; detail?: string };
  kokoro: { ok: boolean; url: string; detail?: string };
  llm: {
    ok: boolean;
    mode: "local-only" | "cloud" | "cloud-with-local-fallback" | "unconfigured";
    ollama: { ok: boolean; url: string; probed: boolean; detail?: string };
    openrouter: { configured: boolean };
  };
};

type ProbeState =
  | { kind: "initial" }
  | { kind: "api-down"; detail: string }
  | { kind: "healthy"; data: ServiceHealth }
  | { kind: "degraded"; data: ServiceHealth };

async function probe(): Promise<ProbeState> {
  try {
    const res = await fetch(PROBE_URL, {
      cache: "no-store",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      const text = await res.text().catch(() => "");
      return { kind: "api-down", detail: text || `proxy returned HTTP ${res.status}` };
    }
    if (!res.ok) {
      return { kind: "api-down", detail: `health endpoint returned HTTP ${res.status}` };
    }
    const data = (await res.json()) as ServiceHealth;
    const degraded = !data.db.ok || !data.kokoro.ok || !data.llm.ok;
    return { kind: degraded ? "degraded" : "healthy", data };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { kind: "api-down", detail: msg };
  }
}

export function ServiceHealthBanner() {
  const [state, setState] = useState<ProbeState>({ kind: "initial" });

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const next = await probe();
      if (!cancelled) setState(next);
    };
    void run();
    const id = setInterval(() => { void run(); }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (state.kind === "initial" || state.kind === "healthy") return null;

  if (state.kind === "api-down") {
    return (
      <div
        role="alert"
        style={{
          background: "#7a1f1f",
          color: "#ffe5e5",
          padding: "10px 16px",
          fontSize: 14,
          textAlign: "center",
          borderBottom: "1px solid #4a0e0e",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        <strong>Nusika API offline.</strong> Lessons, sessions, voice and DM
        actions will fail. Try{" "}
        <code style={{ background: "rgba(0,0,0,0.25)", padding: "1px 5px", borderRadius: 3 }}>
          systemctl --user start nusika-api
        </code>
        . <span style={{ opacity: 0.7 }}>({state.detail.slice(0, 140)})</span>
      </div>
    );
  }

  // Degraded — API is up but a sub-service is not. Advisory amber.
  const d = state.data;
  const parts: string[] = [];
  if (!d.db.ok) parts.push(`DB unreachable${d.db.detail ? ` — ${d.db.detail}` : ""}`);
  if (!d.llm.ok) {
    if (d.llm.mode === "local-only") {
      parts.push(`LLM offline — Ollama not reachable at ${d.llm.ollama.url} (NUSIKA_LOCAL_ONLY=true)`);
    } else if (d.llm.mode === "unconfigured") {
      parts.push("LLM unconfigured — set OPENROUTER_API_KEY or NUSIKA_LOCAL_ONLY=true with Ollama running");
    } else {
      parts.push("LLM unavailable");
    }
  }
  if (!d.kokoro.ok) parts.push(`Kokoro voice unreachable at ${d.kokoro.url}`);

  // DB down is effectively as bad as API down — keep banner red in that case.
  const blocking = !d.db.ok;
  return (
    <div
      role="alert"
      style={{
        background: blocking ? "#7a1f1f" : "#7a5a1f",
        color: blocking ? "#ffe5e5" : "#fff3d6",
        padding: "8px 16px",
        fontSize: 13,
        textAlign: "center",
        borderBottom: blocking ? "1px solid #4a0e0e" : "1px solid #4a3a0e",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <strong>{blocking ? "Nusika degraded:" : "Nusika partial:"}</strong>{" "}
      {parts.join(" · ")}
    </div>
  );
}
