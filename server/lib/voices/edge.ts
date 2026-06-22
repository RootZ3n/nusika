/**
 * Edge TTS voice engine client.
 *
 * Microsoft Edge's online neural voices, reached through the `edge-tts`
 * Python CLI (`pip install edge-tts`). Unlike Kokoro (a local HTTP
 * sub-service that wants a GPU) or Piper (a local binary + model files),
 * Edge TTS is:
 *
 *   - **Free** — no API key, no account. It uses Microsoft's public
 *     online endpoint, the same one the Edge "Read Aloud" feature uses.
 *   - **Zero-GPU** — synthesis runs in the cloud; the client only shells
 *     out to a tiny CLI and reads back an MP3.
 *   - **High quality** — hundreds of natural neural voices across many
 *     languages, so every Nusika companion can get a distinct voice.
 *
 * The trade-off is that it needs network access at synthesis time. The
 * client degrades honestly: a missing `edge-tts` binary or a failed call
 * surfaces a short, sanitised detail string (never a Python traceback)
 * and the route layer answers 503.
 *
 * Because companion configs today declare Kokoro voice ids (e.g.
 * `am_michael`), `mapKokoroToEdge()` maps each Kokoro voice to a
 * comparable Edge voice (matched on accent + gender) so Edge can serve
 * every existing companion with zero curriculum edits.
 *
 * Test seams: `__setEdgeSynthForTesting(fn)` / `__setEdgeHealthForTesting(fn)`
 * override the active synth / health implementations. Always pair with the
 * matching `__reset*ForTesting()` in a `finally` so production traffic
 * isn't affected by a stuck stub.
 *
 *   NUSIKA_EDGE_TTS_BIN=edge-tts   (override the CLI path/name)
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { mkdir, readFile, unlink } from "node:fs/promises";
import { stateDir } from "../paths.js";
import { nenv } from "../env.js";

const DEFAULT_BIN = "edge-tts";

/** Resolve the edge-tts CLI name/path from env at call time (test-friendly). */
export function edgeBin(): string {
  return nenv("EDGE_TTS_BIN", DEFAULT_BIN) ?? DEFAULT_BIN;
}

// ── Voice catalogue ──────────────────────────────────────────────────────────

/**
 * Curated set of Edge neural voice ids Nusika dispatches to. This is a
 * deliberately small, stable subset of the hundreds Edge exposes — the
 * ones the Kokoro→Edge map targets, plus a couple of common extras.
 * Used to validate a requested voice id (a typo'd id fails fast instead
 * of producing a confusing upstream error).
 */
export const EDGE_VOICE_IDS: ReadonlySet<string> = new Set([
  // American female
  "en-US-AriaNeural", "en-US-JennyNeural", "en-US-MichelleNeural",
  "en-US-AvaNeural", "en-US-EmmaNeural", "en-US-JaneNeural",
  "en-US-NancyNeural", "en-US-SaraNeural", "en-US-AshleyNeural",
  "en-US-CoraNeural", "en-US-ElizabethNeural", "en-US-MonicaNeural",
  // American male
  "en-US-GuyNeural", "en-US-ChristopherNeural", "en-US-EricNeural",
  "en-US-RogerNeural", "en-US-BrianNeural", "en-US-AndrewNeural",
  "en-US-BrandonNeural", "en-US-JasonNeural", "en-US-TonyNeural",
  "en-US-DavisNeural", "en-US-SteffanNeural",
  // British female
  "en-GB-SoniaNeural", "en-GB-LibbyNeural", "en-GB-MaisieNeural",
  "en-GB-AbbiNeural", "en-GB-BellaNeural", "en-GB-HollieNeural",
  "en-GB-OliviaNeural",
  // British male
  "en-GB-RyanNeural", "en-GB-ThomasNeural", "en-GB-AlfieNeural",
  "en-GB-ElliotNeural", "en-GB-EthanNeural", "en-GB-NoahNeural",
  "en-GB-OliverNeural",
]);

/**
 * Per-voice Kokoro → Edge map. Each Kokoro voice id (see
 * `KOKORO_VOICE_IDS` in ./kokoro.ts) maps to a distinct Edge voice that
 * matches its accent (af/am = American, bf/bm = British) and gender
 * (af/bf = female, am/bm = male). Keeping the mapping one-to-one means
 * companions stay sonically distinct after a switch to Edge instead of
 * all collapsing onto one default voice.
 */
const KOKORO_TO_EDGE: Readonly<Record<string, string>> = {
  // American female
  af_heart: "en-US-AriaNeural",
  af_alloy: "en-US-JennyNeural",
  af_aoede: "en-US-MichelleNeural",
  af_bella: "en-US-AvaNeural",
  af_jessica: "en-US-EmmaNeural",
  af_kore: "en-US-JaneNeural",
  af_nicole: "en-US-NancyNeural",
  af_nova: "en-US-SaraNeural",
  af_river: "en-US-AshleyNeural",
  af_sarah: "en-US-CoraNeural",
  af_sky: "en-US-MonicaNeural",
  // American male
  am_adam: "en-US-GuyNeural",
  am_echo: "en-US-ChristopherNeural",
  am_eric: "en-US-EricNeural",
  am_fenrir: "en-US-RogerNeural",
  am_liam: "en-US-BrianNeural",
  am_michael: "en-US-AndrewNeural",
  am_onyx: "en-US-BrandonNeural",
  am_puck: "en-US-JasonNeural",
  am_santa: "en-US-TonyNeural",
  // British female
  bf_alice: "en-GB-SoniaNeural",
  bf_emma: "en-GB-LibbyNeural",
  bf_isabella: "en-GB-MaisieNeural",
  bf_lily: "en-GB-AbbiNeural",
  // British male
  bm_daniel: "en-GB-RyanNeural",
  bm_fable: "en-GB-ThomasNeural",
  bm_george: "en-GB-AlfieNeural",
  bm_lewis: "en-GB-ElliotNeural",
};

/** Sensible per-category defaults for an unmapped Kokoro id. */
function edgeDefaultForPrefix(ref: string): string {
  if (ref.startsWith("af_")) return "en-US-AriaNeural";
  if (ref.startsWith("am_")) return "en-US-GuyNeural";
  if (ref.startsWith("bf_")) return "en-GB-SoniaNeural";
  if (ref.startsWith("bm_")) return "en-GB-RyanNeural";
  return "en-US-AriaNeural";
}

/**
 * Resolve a voice reference to an Edge voice id. Accepts:
 *   - an Edge voice id already (e.g. "en-US-AriaNeural") → returned as-is,
 *   - a known Kokoro voice id → its mapped Edge voice,
 *   - an unknown Kokoro-shaped id (af_/am_/bf_/bm_ prefix) → a category default,
 *   - anything else (empty / unrecognised) → the global default voice.
 *
 * Never throws — always returns a usable Edge voice id.
 */
export function mapKokoroToEdge(ref: string | undefined): string {
  const v = (ref ?? "").trim();
  if (!v) return "en-US-AriaNeural";
  // Already an Edge voice (locale-shaped or explicitly Neural).
  if (EDGE_VOICE_IDS.has(v)) return v;
  if (/^[a-z]{2}-[A-Z]{2}-.*Neural$/.test(v)) return v;
  const mapped = KOKORO_TO_EDGE[v];
  if (mapped) return mapped;
  return edgeDefaultForPrefix(v);
}

// ── Test seams ───────────────────────────────────────────────────────────────

export interface EdgeGenerateInput {
  /** An Edge voice id, or any ref accepted by mapKokoroToEdge(). */
  voice: string;
  text: string;
  /** Optional caller signal; merged with the timeout signal. */
  signal?: AbortSignal;
  /** Default 30 000 ms. */
  timeoutMs?: number;
}

export interface EdgeGenerateError extends Error {
  detail?: string;
  /** False when the CLI was missing/unspawnable; true when it ran but failed. */
  reachable?: boolean;
}

export interface EdgeHealth {
  /** True when the edge-tts CLI is present and runnable. */
  configured: boolean;
  detail: string;
}

type EdgeSynthFn = (input: EdgeGenerateInput) => Promise<Buffer>;
type EdgeHealthFn = () => Promise<EdgeHealth>;

let activeSynth: EdgeSynthFn = realEdgeSynth;
let activeHealth: EdgeHealthFn = realEdgeHealth;

export function __setEdgeSynthForTesting(fn: EdgeSynthFn): void { activeSynth = fn; }
export function __resetEdgeSynthForTesting(): void { activeSynth = realEdgeSynth; }
export function __setEdgeHealthForTesting(fn: EdgeHealthFn): void { activeHealth = fn; }
export function __resetEdgeHealthForTesting(): void { activeHealth = realEdgeHealth; }

// ── Health ───────────────────────────────────────────────────────────────────

/**
 * Probe whether the edge-tts CLI is installed and runnable. Never throws —
 * returns `configured:false` with an actionable detail when the binary is
 * missing. Runs `edge-tts --help`, which is offline and fast; a missing
 * binary surfaces as an ENOENT spawn error.
 */
export async function edgeTtsHealth(): Promise<EdgeHealth> {
  return activeHealth();
}

function realEdgeHealth(): Promise<EdgeHealth> {
  const bin = edgeBin();
  return new Promise<EdgeHealth>((resolveHealth) => {
    let settled = false;
    const done = (h: EdgeHealth): void => {
      if (settled) return;
      settled = true;
      resolveHealth(h);
    };
    try {
      const proc = spawn(bin, ["--help"], { stdio: ["ignore", "ignore", "pipe"], timeout: 5_000 });
      let stderr = "";
      proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
      proc.on("error", (err) => {
        done({ configured: false, detail: `edge-tts CLI not runnable (${bin}): ${shortDetail(err.message)}` });
      });
      proc.on("close", (code) => {
        if (code === 0) {
          done({ configured: true, detail: `edge-tts CLI available at "${bin}".` });
        } else {
          done({
            configured: false,
            detail: `edge-tts CLI "${bin}" exited ${code}: ${shortDetail(stderr) || "see server logs"}.`,
          });
        }
      });
    } catch (err) {
      done({
        configured: false,
        detail: `edge-tts CLI not runnable (${bin}): ${shortDetail(err instanceof Error ? err.message : String(err))}`,
      });
    }
  });
}

// ── Generate ─────────────────────────────────────────────────────────────────

/**
 * Synthesise speech via the edge-tts CLI. Returns MP3 audio bytes on
 * success; throws an `EdgeGenerateError` with a short, sanitised detail
 * on any failure. Never echoes Python tracebacks (capped at 240 chars).
 */
export async function edgeGenerate(input: EdgeGenerateInput): Promise<Buffer> {
  return activeSynth(input);
}

async function realEdgeSynth(input: EdgeGenerateInput): Promise<Buffer> {
  const bin = edgeBin();
  const voice = mapKokoroToEdge(input.voice);
  const timeoutMs = input.timeoutMs ?? 30_000;

  const dir = join(stateDir(), "tmp");
  await mkdir(dir, { recursive: true });
  const outFile = join(dir, `edge-${randomUUID()}.mp3`);

  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = input.signal ? AbortSignal.any([input.signal, timeoutSignal]) : timeoutSignal;

  try {
    await new Promise<void>((resolveSynth, rejectSynth) => {
      const proc = spawn(
        bin,
        ["--voice", voice, "--text", input.text, "--write-media", outFile],
        { stdio: ["ignore", "ignore", "pipe"], timeout: timeoutMs, signal },
      );
      let stderr = "";
      proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
      proc.on("error", (err) => {
        rejectSynth(edgeError({
          message: "Edge TTS CLI not runnable.",
          detail: err.message,
          reachable: false,
        }));
      });
      proc.on("close", (code) => {
        if (code === 0) resolveSynth();
        else rejectSynth(edgeError({
          message: "Edge TTS generation failed.",
          detail: `edge-tts exited ${code}: ${stderr.slice(0, 300)}`,
          reachable: true,
        }));
      });
    });

    const audio = await readFile(outFile);
    if (audio.length === 0) {
      throw edgeError({
        message: "Edge TTS produced no audio.",
        detail: "edge-tts wrote an empty file; the voice id or network may be unavailable.",
        reachable: true,
      });
    }
    return audio;
  } finally {
    unlink(outFile).catch(() => {});
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function shortDetail(s: string, max = 240): string {
  const line = (s || "").split("\n")[0] ?? "";
  if (line.length <= max) return line;
  return `${line.slice(0, max - 1)}…`;
}

function edgeError(input: { message: string; detail?: string; reachable?: boolean }): EdgeGenerateError {
  const err = new Error(input.message) as EdgeGenerateError;
  if (input.detail !== undefined) err.detail = shortDetail(input.detail);
  if (input.reachable !== undefined) err.reachable = input.reachable;
  return err;
}
