/**
 * Shared voice picker helpers for /teach and /dm.
 *
 * Slice 6G: per-user picker that persists selection in localStorage.
 * No DB persistence; no server changes; no companion-default mutations.
 *
 * The voice list comes from `GET /magister/voices`. Each picker reads
 * its own localStorage key so /teach and /dm selections don't collide.
 */

export interface VoiceOption {
  id: string;
  display_name: string;
  engine: "kokoro" | "piper" | "elevenlabs" | "none";
  voice_ref: string;
  companion_id?: string;
  available?: boolean;
}

/** localStorage keys (one per page so each picker stays independent). */
export const TEACH_VOICE_KEY = "magister.teach.voiceProfileId";
export const DM_VOICE_KEY = "magister.dm.voiceProfileId";
export const HALL_VOICE_KEY = "magister.hall.voiceProfileId";

/**
 * Discrete Kokoro engine state, derived from /magister/voices's
 * `engines.kokoro` shape (configured + detail). The registry side
 * lives in server/lib/voice-registry.ts; the detail-string parser
 * here is intentionally a string match so a future status field on
 * the registry can replace this without UI churn.
 *
 * Order roughly tracks severity for status banners:
 *   - unknown:        we haven't fetched yet, don't claim anything.
 *   - not-running:    network failure / nothing listening.
 *   - wrong-service:  identity check rejected a squatter.
 *   - error:          Kokoro loaded with errors; /generate will 503.
 *   - cold:           reachable, model not yet loaded (first /generate
 *                     will pay the cold cost).
 *   - ready:          reachable, model loaded — generation should work.
 *
 * See docs/MAGISTER_KOKORO_RUNTIME.md for the full state semantics.
 */
export type KokoroEngineState =
  | "unknown"
  | "not-running"
  | "wrong-service"
  | "error"
  | "cold"
  | "ready";

export interface KokoroEngineInfo {
  state: KokoroEngineState;
  /** Human-readable detail straight from the server, for the banner. */
  detail: string;
}

export function parseKokoroEngine(
  raw: { configured?: unknown; detail?: unknown } | null | undefined,
): KokoroEngineInfo {
  const detail = typeof raw?.detail === "string" ? raw.detail : "";
  if (!raw || typeof raw.configured !== "boolean") {
    return { state: "unknown", detail: detail || "Kokoro status unknown." };
  }
  // The order of these checks matters: "loaded with errors" is the
  // status:"error" string from kokoroEngineStatus(); "not Kokoro" is
  // the identity-check string from kokoroHealth(); the remaining
  // configured:false cases collapse into not-running.
  if (raw.configured === false) {
    if (/not Kokoro/i.test(detail)) return { state: "wrong-service", detail };
    if (/loaded with errors/i.test(detail)) return { state: "error", detail };
    return { state: "not-running", detail: detail || "Kokoro not running." };
  }
  if (/status: ready/i.test(detail)) return { state: "ready", detail };
  if (/status: cold/i.test(detail)) return { state: "cold", detail };
  // Reachable + ok but the detail didn't include either status word.
  // Treat as ready since the registry already gated on engine:"kokoro".
  return { state: "ready", detail: detail || "Kokoro reachable." };
}

/**
 * Build a short, picker-friendly label for a voice profile.
 *
 *   "Varros Default — am_michael"
 *   "Vermilion — bm_george"
 *
 * Strips the registry's `(default voice)` suffix because the picker
 * already implies "default" for any companion.
 */
export function labelVoiceProfile(p: VoiceOption): string {
  if (p.id === "varros-default") return `Varros Default — ${p.voice_ref}`;
  const cleanName = p.display_name.replace(/\s*\(default voice\)\s*$/i, "").trim();
  const displayed = cleanName.length > 0 ? cleanName : p.id;
  return `${displayed} — ${p.voice_ref}`;
}

/** Sort order for the dropdown: Varros first, then alphabetic by display name. */
export function sortVoiceOptions(voices: VoiceOption[]): VoiceOption[] {
  const copy = [...voices];
  copy.sort((a, b) => {
    if (a.id === "varros-default") return -1;
    if (b.id === "varros-default") return 1;
    return labelVoiceProfile(a).localeCompare(labelVoiceProfile(b));
  });
  return copy;
}

/**
 * Read a stored voice id. Safe across SSR and locked-down browsers
 * (returns null on any access failure).
 */
export function readStoredVoiceId(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Persist a voice id. Safe across SSR and locked-down browsers (silent on failure). */
export function writeStoredVoiceId(key: string, id: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, id);
  } catch {
    /* ignore quota/disabled-storage errors */
  }
}

/**
 * Pick the initial voice for a picker:
 *   1. Stored id, if it still resolves to a known voice.
 *   2. The configured fallback id (typically "varros-default").
 *   3. The first voice in the list.
 *   4. null if the list is empty.
 */
export function pickInitialVoice(
  voices: VoiceOption[],
  storedId: string | null,
  fallbackId: string,
): VoiceOption | null {
  if (storedId) {
    const found = voices.find(v => v.id === storedId);
    if (found) return found;
  }
  const fallback = voices.find(v => v.id === fallbackId);
  if (fallback) return fallback;
  return voices[0] ?? null;
}
