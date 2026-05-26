/**
 * Kokoro local voice service client (Slice 6D).
 *
 * Talks HTTP to the Python sub-service that lives in voices/kokoro/.
 * Loopback-only by default (127.0.0.1:18794). Override via env:
 *
 *   MAGISTER_KOKORO_URL=http://127.0.0.1:18794
 *
 * The client never throws on a network failure during a health probe —
 * it returns `{ reachable: false }` so the registry can render an honest
 * "not reachable" status without slowing the route.
 *
 * Test seam: `__setKokoroFetchForTesting(fn)` overrides the active
 * fetch implementation. Always pair with `__resetKokoroFetchForTesting()`
 * in a `finally` so production traffic isn't affected by a stuck stub.
 */

const DEFAULT_URL = "http://127.0.0.1:18794";

/**
 * Canonical Kokoro voice id set. Must match `KOKORO_VOICES` in
 * `voices/kokoro/server.py` — both lists are baked in by hand for now.
 * If the Python service grows or shrinks its list, mirror the change here.
 *
 * Used by:
 *   - voice-registry to render the available preset list at /magister/voices
 *   - curriculum/test assertions that no companion references an unknown id
 *   - any future voice-picker UI
 */
export const KOKORO_VOICE_IDS: ReadonlySet<string> = new Set([
  // American female
  "af_heart", "af_alloy", "af_aoede", "af_bella", "af_jessica", "af_kore",
  "af_nicole", "af_nova", "af_river", "af_sarah", "af_sky",
  // American male
  "am_adam", "am_echo", "am_eric", "am_fenrir", "am_liam", "am_michael",
  "am_onyx", "am_puck", "am_santa",
  // British female
  "bf_alice", "bf_emma", "bf_isabella", "bf_lily",
  // British male
  "bm_daniel", "bm_fable", "bm_george", "bm_lewis",
]);

/** Read the Kokoro service URL from env at call time (test-friendly). */
export function kokoroBaseUrl(): string {
  return (process.env["MAGISTER_KOKORO_URL"] ?? DEFAULT_URL).replace(/\/+$/, "");
}

// ── Test seam ────────────────────────────────────────────────────────────────

let activeFetch: typeof fetch = globalThis.fetch.bind(globalThis);

export function __setKokoroFetchForTesting(fn: typeof fetch): void { activeFetch = fn; }
export function __resetKokoroFetchForTesting(): void {
  activeFetch = globalThis.fetch.bind(globalThis);
}

// ── Health ───────────────────────────────────────────────────────────────────

export interface KokoroHealth {
  reachable: boolean;
  ok?: boolean;
  status?: "cold" | "ready" | "error";
  model_loaded?: boolean;
  detail?: string;
  /** The URL we probed, for logging/debug. */
  url: string;
}

export interface KokoroHealthOptions {
  /** Default 750ms — short enough that /magister/voices stays snappy. */
  timeoutMs?: number;
}

/**
/**
 * Probe the Kokoro service. Never throws on network failure — returns
 * `reachable: false` with a `detail` string the registry can surface.
 *
 * Identity guarantee: the probe requires the response body to carry
 * `engine: "kokoro"`. Without this, ANY uvicorn-shaped sidecar that
 * happens to answer `{ ok: true }` on /health (notably `opencode-sidecar`,
 * which has historically squatted port 18794 on developer machines)
 * would be accepted as a working Kokoro and the registry would falsely
 * report Kokoro voices as available — until the first /generate call
 * failed at runtime. The identity check fails closed instead.
 *
 * The Kokoro server.py at voices/kokoro/server.py always emits
 * `engine: "kokoro"` from /health, including in cold/error states, so
 * this check is safe across all Kokoro-internal status values.
 *
 * The 750ms default timeout means /magister/voices stays under a second
 * even when the service is missing entirely.
 */
export async function kokoroHealth(opts: KokoroHealthOptions = {}): Promise<KokoroHealth> {
  const url = kokoroBaseUrl();
  const timeoutMs = opts.timeoutMs ?? 750;
  try {
    const res = await activeFetch(`${url}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) {
      return { reachable: false, url, detail: `Kokoro returned HTTP ${res.status} at ${url}.` };
    }
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean; engine?: string; service?: string;
      status?: string; model_loaded?: boolean; detail?: string;
    };
    if (!body || body.ok !== true) {
      return { reachable: false, url, detail: `Kokoro reported unhealthy at ${url}.` };
    }
    if (body.engine !== "kokoro") {
      // A different service is bound to the Kokoro port. Surface what
      // we saw so the operator can debug instead of guessing.
      const seen = typeof body.service === "string" && body.service.length > 0
        ? body.service
        : typeof body.engine === "string" && body.engine.length > 0
          ? body.engine
          : "unknown";
      return {
        reachable: false,
        url,
        detail: `Service at ${url} is not Kokoro (identified as "${seen}"). ` +
          `Stop or move the other service, or override MAGISTER_KOKORO_URL.`,
      };
    }
    const out: KokoroHealth = { reachable: true, ok: true, url };
    if (body.status === "cold" || body.status === "ready" || body.status === "error") {
      out.status = body.status;
    }
    if (body.model_loaded !== undefined) out.model_loaded = !!body.model_loaded;
    if (body.detail) out.detail = String(body.detail);
    return out;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { reachable: false, url, detail: `Kokoro service not reachable at ${url}: ${shortDetail(detail)}` };
  }
}

// ── Generate ─────────────────────────────────────────────────────────────────

export interface KokoroGenerateInput {
  voice: string;
  text: string;
  /** Optional caller signal; merged with the timeout signal. */
  signal?: AbortSignal;
  /** Default 30 000 ms. */
  timeoutMs?: number;
}

export interface KokoroGenerateError extends Error {
  status?: number;
  detail?: string;
  reachable?: boolean;
}

/**
 * Synthesise a WAV via the Kokoro service. Returns the audio bytes on
 * success; throws a `KokoroGenerateError` on any failure with a short,
 * sanitised detail string suitable for end-user display.
 *
 * Never echoes Python tracebacks. The Python service already trims its
 * error detail to one line; we additionally cap to 240 chars here.
 */
export async function kokoroGenerate(input: KokoroGenerateInput): Promise<Buffer> {
  const url = kokoroBaseUrl();
  const timeoutMs = input.timeoutMs ?? 30_000;

  // Merge caller signal with timeout signal.
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = input.signal ? anySignal([input.signal, timeoutSignal]) : timeoutSignal;

  let res: Response;
  try {
    res = await activeFetch(`${url}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voice: input.voice, text: input.text, format: "wav" }),
      signal,
    });
  } catch (err) {
    throw kokoroError({
      message: "Kokoro service not reachable.",
      detail: err instanceof Error ? err.message : String(err),
      reachable: false,
    });
  }

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string; detail?: string };
      if (body.error) detail = body.error;
      if (body.detail) detail = `${detail}: ${body.detail}`;
    } catch {
      // body wasn't JSON — keep the HTTP status line as detail
    }
    throw kokoroError({
      message: "Kokoro generation failed.",
      detail,
      status: res.status,
      reachable: true,
    });
  }

  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function shortDetail(s: string, max = 240): string {
  const line = (s || "").split("\n")[0] ?? "";
  if (line.length <= max) return line;
  // Ellipsis included in the cap so callers can rely on `length <= max`.
  return `${line.slice(0, max - 1)}…`;
}

function kokoroError(input: { message: string; detail?: string; status?: number; reachable?: boolean }): KokoroGenerateError {
  const err = new Error(input.message) as KokoroGenerateError;
  if (input.detail !== undefined) err.detail = shortDetail(input.detail);
  if (input.status !== undefined) err.status = input.status;
  if (input.reachable !== undefined) err.reachable = input.reachable;
  return err;
}

/**
 * Combine multiple AbortSignals into one. Aborts as soon as any input
 * aborts. Tiny ponyfill for AbortSignal.any (which is Node 20+).
 */
function anySignal(signals: AbortSignal[]): AbortSignal {
  if (typeof (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any === "function") {
    return (AbortSignal as unknown as { any: (s: AbortSignal[]) => AbortSignal }).any(signals);
  }
  const ctrl = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      ctrl.abort(s.reason);
      return ctrl.signal;
    }
    s.addEventListener("abort", () => ctrl.abort(s.reason), { once: true });
  }
  return ctrl.signal;
}
