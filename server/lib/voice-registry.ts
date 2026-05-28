/**
 * Nusika voice registry.
 *
 * Slice 6B: registry-only. Reads companion voice configs (none today;
 * Slice 6E will add them), generates fallback Piper-default profiles
 * for every companion across all 17 curriculum modules plus Varros,
 * and reports per-engine availability.
 *
 * No engine dispatch here. The actual `POST /nusika/tts` route still
 * routes everything through Piper. Slice 6D adds Kokoro routing.
 *
 * Failure mode: this module never throws on missing binaries / missing
 * curriculum / unreadable configs. A missing dependency marks affected
 * voices as `available: false` with a `reason` string.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { NusikaDB } from "../db.js";
import { getProductNarrator } from "./narrator.js";
import {
  piperBin,
  piperVoicesDir,
  ttsDefaultVoice,
  voiceModelPath,
} from "../routes/voice.js";
import { kokoroHealth, kokoroBaseUrl } from "./voices/kokoro.js";

export type VoiceEngine = "piper" | "kokoro" | "elevenlabs" | "none";
export type VoiceRole = "narrator" | "companion" | "fallback";

export interface VoiceProfile {
  /** Globally unique within the registry. Format: `<companion_id-or-narrator>-default` for placeholders. */
  id: string;
  display_name: string;
  engine: VoiceEngine;
  /** Engine-specific reference: a Piper voice basename, a Kokoro voice id, an ElevenLabs voice id, etc. */
  voice_ref: string;
  /** Companion id if this profile is bound to one. */
  companion_id?: string;
  role?: VoiceRole;
  /** Module that registers this companion, when applicable. */
  module_id?: string;
  language?: string;
  style?: string;
  available: boolean;
  reason?: string;
}

export interface EngineStatus {
  configured: boolean;
  detail?: string;
  /** Marked true for engines on the way out (currently just ElevenLabs). */
  deprecated?: boolean;
}

export interface VoiceRegistry {
  voices: VoiceProfile[];
  engines: {
    piper: EngineStatus;
    kokoro: EngineStatus;
    elevenlabs: EngineStatus;
  };
}

// ── Engine status ────────────────────────────────────────────────────────────

/**
 * Piper is "configured" if the binary exists. Voice-file existence is a
 * per-voice check that lands on each VoiceProfile, not on the engine.
 */
function piperEngineStatus(): EngineStatus {
  const bin = piperBin();
  if (!existsSync(bin)) {
    return { configured: false, detail: `PIPER_BIN not found at ${bin}.` };
  }
  return { configured: true, detail: `PIPER_BIN at ${bin}.` };
}

/**
 * Kokoro is configured iff the local Python service responds healthy.
 * Slice 6D wires the probe; the previous slice always returned false.
 *
 * The probe is async (default 750ms timeout) and is only run when the
 * caller asks for it — `buildVoiceRegistry({ probeKokoro: true })`.
 * The dispatch path skips the probe to keep `/nusika/tts` snappy.
 */
async function kokoroEngineStatus(probe: boolean): Promise<EngineStatus> {
  const url = kokoroBaseUrl();
  if (!probe) {
    return {
      configured: false,
      detail: `Kokoro probe skipped (would query ${url}/health).`,
    };
  }
  const health = await kokoroHealth();
  if (!(health.reachable && health.ok === true)) {
    // Not reachable, or the response wasn't Kokoro (identity check
    // failure from the opencode-sidecar parking work). kokoroHealth
    // already returns an actionable detail in both shapes.
    return {
      configured: false,
      detail: health.detail ?? `Kokoro service not reachable at ${url}.`,
    };
  }
  // The service is up and identifies as Kokoro. Distinguish the three
  // sub-states the Python server can report (see voices/kokoro/server.py):
  //   - "ready" → pipeline loaded, generation should work.
  //   - "cold"  → reachable but model not yet loaded; first /generate
  //               will load it (lazy). Voices are usable from the
  //               dispatch layer's POV — we report configured:true.
  //   - "error" → load attempt failed. /generate will 503 until the
  //               service is restarted. We report configured:false so
  //               per-voice availability stops claiming usability;
  //               the detail surfaces the upstream error verbatim.
  if (health.status === "error") {
    return {
      configured: false,
      detail: health.detail
        ? `Kokoro service at ${url} loaded with errors: ${health.detail}`
        : `Kokoro service at ${url} reported status:"error"; restart the service.`,
    };
  }
  const stateNote = health.status === "ready"
    ? "status: ready, model loaded"
    : health.status === "cold"
      ? "status: cold, model loads on first /generate call (lazy)"
      : `status: ${health.status ?? "unknown"}`;
  return {
    configured: true,
    detail: `Kokoro service at ${url} — ${stateNote}.`,
  };
}

/**
 * ElevenLabs is treated as deprecated. The route still exists but the
 * registry never reports it as a primary engine. `configured` reflects
 * whether the API key is present, purely as a deployment signal.
 */
function elevenLabsEngineStatus(): EngineStatus {
  const hasKey = !!process.env["ELEVENLABS_API_KEY"];
  return {
    configured: hasKey,
    detail: hasKey
      ? "ELEVENLABS_API_KEY is set, but ElevenLabs is deprecated; prefer local engines."
      : "ELEVENLABS_API_KEY not set.",
    deprecated: true,
  };
}

// ── Voice file availability ──────────────────────────────────────────────────

interface PiperVoiceCheck { available: boolean; reason?: string }

function checkPiperVoice(voice: string, piperConfigured: boolean): PiperVoiceCheck {
  if (!piperConfigured) {
    return { available: false, reason: `PIPER_BIN not found at ${piperBin()}.` };
  }
  const path = voiceModelPath(voice);
  if (!existsSync(path)) {
    return { available: false, reason: `Piper voice file missing at ${path}.` };
  }
  return { available: true };
}

// ── Companion config loading ─────────────────────────────────────────────────

interface CompanionConfigEntry {
  id: string;
  name?: string;
  /** Optional voice override (Slice 6E will populate these). */
  voice?: {
    engine?: VoiceEngine;
    voice_ref?: string;
    voice_id?: string; // legacy alias for voice_ref (e.g. existing inkwell ElevenLabs id)
    language?: string;
    style?: string;
  };
  /**
   * Legacy top-level ElevenLabs id. The Inkwell companion (formerly Maren)
   * used to ship one here; the curriculum no longer does, but the field is
   * still honored so any older or third-party config file still loads
   * through the deprecated ElevenLabs path instead of crashing.
   */
  voice_id?: string;
  [key: string]: unknown;
}

interface ModuleConfig {
  id?: string;
  companions?: Array<CompanionConfigEntry | string>;
  [key: string]: unknown;
}

/** Read a module's on-disk config.json. Never throws — returns null on any error. */
async function loadModuleConfig(configPath: string | null): Promise<ModuleConfig | null> {
  if (!configPath) return null;
  try {
    const raw = await readFile(configPath, "utf-8");
    return JSON.parse(raw) as ModuleConfig;
  } catch {
    return null;
  }
}

/**
 * Resolve a companion's voice profile from optional curriculum config.
 * Returns null when the entry is just a string (legacy id-only form).
 */
function profileFromCompanion(
  entry: CompanionConfigEntry,
  moduleId: string,
  defaults: RegistryDefaults,
): VoiceProfile {
  const id = `${entry.id}-default`;
  const display_name = entry.name ? `${entry.name} (default voice)` : `${entry.id} (default voice)`;

  // Pull a voice override from curriculum config if present. Slice 6B did
  // NOT populate these — Slice 6E will. The accessor is forward-looking.
  const override = entry.voice;
  const legacyElevenLabs = typeof entry.voice_id === "string" ? entry.voice_id : undefined;

  if (override?.engine === "kokoro") {
    const ref = override.voice_ref ?? override.voice_id ?? "";
    return {
      id, display_name,
      engine: "kokoro",
      voice_ref: ref,
      companion_id: entry.id,
      role: "companion",
      module_id: moduleId,
      ...(override.language ? { language: override.language } : {}),
      ...(override.style ? { style: override.style } : {}),
      available: defaults.kokoroConfigured,
      ...(defaults.kokoroConfigured
        ? {}
        : { reason: defaults.kokoroDetail ?? "Kokoro service not reachable." }),
    };
  }

  if (override?.engine && override.engine !== "piper" && override.engine !== "none") {
    const ref = override.voice_ref ?? override.voice_id ?? "";
    return {
      id, display_name,
      engine: override.engine,
      voice_ref: ref,
      companion_id: entry.id,
      role: "companion",
      module_id: moduleId,
      ...(override.language ? { language: override.language } : {}),
      ...(override.style ? { style: override.style } : {}),
      available: false,
      reason: `Engine "${override.engine}" not dispatched in this slice.`,
    };
  }

  if (legacyElevenLabs && !override) {
    // Any companion shipped with a top-level ElevenLabs voice_id (the
    // Inkwell companion used to, before the Maren → Varros rebind) is
    // surfaced honestly: engine reported as elevenlabs, available reflects
    // whether the key is set.
    const hasKey = !!process.env["ELEVENLABS_API_KEY"];
    return {
      id, display_name,
      engine: "elevenlabs",
      voice_ref: legacyElevenLabs,
      companion_id: entry.id,
      role: "companion",
      module_id: moduleId,
      available: hasKey,
      reason: hasKey
        ? "ElevenLabs is deprecated; this voice will move to a local engine in Slice 6E."
        : "ELEVENLABS_API_KEY not set; this voice will move to a local engine in Slice 6E.",
    };
  }

  // Default fallback: use the configured Piper voice.
  const voice = override?.voice_ref ?? defaults.defaultPiperVoice;
  const check = checkPiperVoice(voice, defaults.piperConfigured);
  return {
    id, display_name,
    engine: "piper",
    voice_ref: voice,
    companion_id: entry.id,
    role: "companion",
    module_id: moduleId,
    ...(override?.language ? { language: override.language } : {}),
    ...(override?.style ? { style: override.style } : {}),
    available: check.available,
    ...(check.reason ? { reason: check.reason } : {}),
  };
}

interface RegistryDefaults {
  piperConfigured: boolean;
  defaultPiperVoice: string;
  kokoroConfigured: boolean;
  kokoroDetail?: string;
}

/**
 * Build the Varros narrator profile. Honors `narrator.voice` when set
 * (Slice 6E onwards); otherwise falls back to the configured Piper voice.
 */
function varrosProfile(defaults: RegistryDefaults): VoiceProfile {
  const narrator = getProductNarrator();
  const id = `${narrator.id}-default`;
  const display_name = `${narrator.name} (default voice)`;

  if (narrator.voice && narrator.voice.engine === "kokoro") {
    return {
      id, display_name,
      engine: "kokoro",
      voice_ref: narrator.voice.voice_ref,
      companion_id: narrator.id,
      role: "narrator",
      ...(narrator.voice.language ? { language: narrator.voice.language } : {}),
      style: narrator.voice.style ?? "warm narrator",
      available: defaults.kokoroConfigured,
      ...(defaults.kokoroConfigured
        ? {}
        : { reason: defaults.kokoroDetail ?? "Kokoro service not reachable." }),
    };
  }

  if (narrator.voice && narrator.voice.engine === "piper") {
    const voice = narrator.voice.voice_ref;
    const check = checkPiperVoice(voice, defaults.piperConfigured);
    return {
      id, display_name,
      engine: "piper",
      voice_ref: voice,
      companion_id: narrator.id,
      role: "narrator",
      ...(narrator.voice.language ? { language: narrator.voice.language } : {}),
      style: narrator.voice.style ?? "warm narrator",
      available: check.available,
      ...(check.reason ? { reason: check.reason } : {}),
    };
  }

  // Default fallback: Piper with the system default voice.
  const voice = defaults.defaultPiperVoice;
  const check = checkPiperVoice(voice, defaults.piperConfigured);
  return {
    id, display_name,
    engine: "piper",
    voice_ref: voice,
    companion_id: narrator.id,
    role: "narrator",
    style: "warm narrator",
    available: check.available,
    ...(check.reason ? { reason: check.reason } : {}),
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Build the full registry. Pure data; route layer wraps in `{ ok: true }`.
 *
 * Accepts an optional `loader` for tests that want to bypass on-disk config
 * reads. Production callers omit it and the function reads each module's
 * `config_path` directly.
 */
export async function buildVoiceRegistry(
  db: NusikaDB,
  opts: {
    loader?: (configPath: string | null) => Promise<ModuleConfig | null>;
    /** When true, probes the Kokoro service /health (default 750 ms timeout). */
    probeKokoro?: boolean;
  } = {},
): Promise<VoiceRegistry> {
  const piperStatus = piperEngineStatus();
  const kokoroStatus = await kokoroEngineStatus(opts.probeKokoro ?? false);
  const defaults: RegistryDefaults = {
    piperConfigured: piperStatus.configured,
    defaultPiperVoice: ttsDefaultVoice(),
    kokoroConfigured: kokoroStatus.configured,
    ...(kokoroStatus.detail ? { kokoroDetail: kokoroStatus.detail } : {}),
  };
  const load = opts.loader ?? loadModuleConfig;

  const voices: VoiceProfile[] = [];
  voices.push(varrosProfile(defaults));

  const seen = new Set<string>();
  for (const mod of db.listModules()) {
    const cfg = await load(mod.config_path);
    // companions: prefer rich config from disk; fall back to id-list from DB.
    const companionEntries: CompanionConfigEntry[] = [];
    if (cfg && Array.isArray(cfg.companions)) {
      for (const c of cfg.companions) {
        if (typeof c === "string") {
          companionEntries.push({ id: c });
        } else if (c && typeof c === "object" && typeof c.id === "string") {
          companionEntries.push(c);
        }
      }
    } else {
      // db.listModules() already parses the stored JSON into a string[]
      // of companion ids, so we can iterate it directly.
      for (const id of mod.companions) {
        if (typeof id === "string") companionEntries.push({ id });
      }
    }

    for (const entry of companionEntries) {
      if (!entry.id || seen.has(entry.id)) continue;
      seen.add(entry.id);
      voices.push(profileFromCompanion(entry, mod.id, defaults));
    }
  }

  return {
    voices,
    engines: {
      piper: piperStatus,
      kokoro: kokoroStatus,
      elevenlabs: elevenLabsEngineStatus(),
    },
  };
}

/**
 * Resolve a single voice profile by id-or-companion-id, without probing
 * the Kokoro service. Used by `POST /nusika/tts` to look up the dispatch
 * target without slowing the route.
 *
 * Returns null when the query matches neither a profile id nor a companion
 * id. Callers should treat that as "not a registry match" (e.g. legacy
 * Piper voice basename).
 */
export async function resolveVoiceProfile(
  db: NusikaDB,
  query: string,
  opts: { loader?: (configPath: string | null) => Promise<ModuleConfig | null> } = {},
): Promise<VoiceProfile | null> {
  const reg = await buildVoiceRegistry(db, {
    probeKokoro: false,
    ...(opts.loader ? { loader: opts.loader } : {}),
  });
  const byId = reg.voices.find(v => v.id === query);
  if (byId) return byId;
  const byCompanion = reg.voices.find(v => v.companion_id === query);
  if (byCompanion) return byCompanion;
  return null;
}
