"use client";

/**
 * useHallVoice — voice picker + Preview button state for the Hall's
 * Session view. Modeled on web/app/dm/hooks/useDmVoice.ts so the UX
 * matches /teach and /dm; intentionally narrower (no autoplay toggle,
 * no audio cache UI) because the Hall path's runtime narration is
 * already owned by useVoicePlayback and the Comfort drawer.
 *
 * Wire contract: this hook's Preview calls POST /nusika/tts with
 *   { text, voice: <profile-id> }
 * which is the same shape /teach uses for its reply autoplay. The
 * server resolves the profile id through the voice registry — so an
 * audible Preview here is the human confirmation that the same path
 * the Hall's 🔊 Repeat button (which sends `scope: companionId`) is
 * also resolving correctly. Both routes through resolveVoiceProfile;
 * see server/routes/voice.ts for the equivalence proof.
 *
 * Browser autoplay policies sometimes refuse the first <audio>.play()
 * before the user has clicked the page. The Preview button is itself
 * a user gesture, so the click that triggers Preview also satisfies
 * the policy — no extra workaround needed.
 */

import { useCallback, useEffect, useState } from "react";
import { API_BASE } from "../types";
import {
  HALL_VOICE_KEY,
  labelVoiceProfile,
  parseKokoroEngine,
  pickInitialVoice,
  readStoredVoiceId,
  sortVoiceOptions,
  writeStoredVoiceId,
  type KokoroEngineInfo,
  type VoiceOption,
} from "../lib/voice-picker";

export { labelVoiceProfile };

/** Local UI state for the Preview-running indicator + last result. */
export type PreviewState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "ok" }
  | { kind: "error"; reason: string };

export interface HallVoice {
  voices: VoiceOption[];
  selectedVoiceId: string;
  selectedVoice: VoiceOption | null;
  engine: KokoroEngineInfo;
  previewState: PreviewState;
  onSelectVoice: (id: string) => void;
  previewVoice: () => Promise<void>;
}

const PREVIEW_TEXT_FALLBACK = "Hello. I'm a Nusika voice.";
const VOICE_UNAVAILABLE_MSG =
  "Voice playback unavailable. Start Kokoro or pick a different voice.";

export function useHallVoice(): HallVoice {
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>("varros-default");
  const [engine, setEngine] = useState<KokoroEngineInfo>({
    state: "unknown",
    detail: "Kokoro status unknown.",
  });
  const [previewState, setPreviewState] = useState<PreviewState>({ kind: "idle" });

  const selectedVoice = voices.find((v) => v.id === selectedVoiceId) ?? null;

  const fetchVoices = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/nusika/voices`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        voices?: VoiceOption[];
        engines?: { kokoro?: { configured?: boolean; detail?: string } };
      };
      const list = sortVoiceOptions(data.voices ?? []);
      setVoices(list);
      const stored = readStoredVoiceId(HALL_VOICE_KEY);
      const initial = pickInitialVoice(list, stored, "varros-default");
      if (initial) setSelectedVoiceId(initial.id);
      setEngine(parseKokoroEngine(data.engines?.kokoro ?? null));
    } catch {
      /* Network failure — leave engine state as-is so the banner
         doesn't flicker between "unknown" and a transient error. */
    }
  }, []);

  useEffect(() => {
    void fetchVoices();
  }, [fetchVoices]);

  const onSelectVoice = useCallback((id: string) => {
    setSelectedVoiceId(id);
    writeStoredVoiceId(HALL_VOICE_KEY, id);
    setPreviewState({ kind: "idle" });
  }, []);

  const previewVoice = useCallback(async () => {
    if (!selectedVoice || previewState.kind === "running") return;
    setPreviewState({ kind: "running" });
    const speakerName = selectedVoice.display_name
      .replace(/\s*\(default voice\)\s*$/i, "")
      .trim() ||
      selectedVoice.companion_id ||
      "a Nusika voice";
    const text = speakerName === "a Nusika voice"
      ? PREVIEW_TEXT_FALLBACK
      : `Hello. I am ${speakerName}.`;

    let createdUrl: string | null = null;
    try {
      const res = await fetch(`${API_BASE}/nusika/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice: selectedVoice.id }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
        const reason = body.error ?? body.detail ?? `Preview failed (HTTP ${res.status}).`;
        setPreviewState({ kind: "error", reason });
        // Refresh the engine banner so the operator sees the live
        // reason (e.g. squatter on port) without re-mounting.
        void fetchVoices();
        return;
      }
      const blob = await res.blob();
      createdUrl = URL.createObjectURL(blob);
      const url = createdUrl;
      const audio = new Audio(url);
      audio.onended = () => {
        try { URL.revokeObjectURL(url); } catch { /* ignore */ }
      };
      try {
        await audio.play();
        setPreviewState({ kind: "ok" });
      } catch {
        // Autoplay policy or other playback rejection — surface
        // honestly rather than pretend it worked.
        try { URL.revokeObjectURL(url); } catch { /* ignore */ }
        setPreviewState({ kind: "error", reason: VOICE_UNAVAILABLE_MSG });
      }
    } catch (err) {
      if (createdUrl) {
        try { URL.revokeObjectURL(createdUrl); } catch { /* ignore */ }
      }
      const reason = err instanceof Error ? err.message : "Preview failed.";
      setPreviewState({ kind: "error", reason });
    }
  }, [selectedVoice, previewState, fetchVoices]);

  return {
    voices,
    selectedVoiceId,
    selectedVoice,
    engine,
    previewState,
    onSelectVoice,
    previewVoice,
  };
}
