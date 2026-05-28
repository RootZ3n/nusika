"use client";

/**
 * useDmVoice — voice picker + preview + cache stats for the DM screen.
 * Slice 6F/6G logic extracted from page.tsx on 2026-05-22; behavior
 * preserved including localStorage round-trip and confirm-on-clear.
 */

import { useCallback, useEffect, useState } from "react";
import {
  DM_VOICE_KEY,
  labelVoiceProfile,
  pickInitialVoice,
  readStoredVoiceId,
  sortVoiceOptions,
  writeStoredVoiceId,
  type VoiceOption,
} from "../../lib/voice-picker";
import { API_BASE, type VoiceCacheStatus } from "../types";

export { labelVoiceProfile };

export interface DmVoice {
  voices: VoiceOption[];
  selectedVoiceId: string;
  selectedVoice: VoiceOption | null;
  previewing: boolean;
  voiceMsg: string | null;
  voiceCache: VoiceCacheStatus | null;
  onSelectVoice: (id: string) => void;
  previewVoice: () => Promise<void>;
  clearVoiceCache: (onStatus: (msg: string) => void) => Promise<void>;
}

export function useDmVoice(): DmVoice {
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>("peh-default");
  const [previewing, setPreviewing] = useState(false);
  const [voiceMsg, setVoiceMsg] = useState<string | null>(null);
  const [voiceCache, setVoiceCache] = useState<VoiceCacheStatus | null>(null);

  const selectedVoice = voices.find((v) => v.id === selectedVoiceId) ?? null;

  const fetchVoices = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/nusika/voices`);
      if (!res.ok) return;
      const data = (await res.json()) as { voices?: VoiceOption[] };
      const list = sortVoiceOptions(data.voices ?? []);
      setVoices(list);
      const stored = readStoredVoiceId(DM_VOICE_KEY);
      const initial = pickInitialVoice(list, stored, "peh-default");
      if (initial) setSelectedVoiceId(initial.id);
    } catch { /* silent */ }
  }, []);

  const fetchVoiceCache = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/nusika/voices/cache`);
      if (!res.ok) return;
      const data = (await res.json()) as { bytes: number; mb: number; maxMb: number };
      setVoiceCache({ bytes: data.bytes, mb: data.mb, maxMb: data.maxMb });
    } catch { /* silent */ }
  }, []);

  useEffect(() => { void fetchVoices(); void fetchVoiceCache(); }, [fetchVoices, fetchVoiceCache]);

  const onSelectVoice = useCallback((id: string) => {
    setSelectedVoiceId(id);
    writeStoredVoiceId(DM_VOICE_KEY, id);
    setVoiceMsg(null);
  }, []);

  const previewVoice = useCallback(async () => {
    if (!selectedVoice || previewing) return;
    setPreviewing(true);
    setVoiceMsg(null);
    const speakerName = selectedVoice.display_name.replace(/\s*\(default voice\)\s*$/i, "").trim()
      || selectedVoice.companion_id
      || "a Nusika voice";
    try {
      const url = `${API_BASE}/nusika/voices/preview/${encodeURIComponent(selectedVoice.engine)}/${encodeURIComponent(selectedVoice.voice_ref)}?name=${encodeURIComponent(speakerName)}`;
      const res = await fetch(url);
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (res.status === 503) {
          setVoiceMsg(data.error ?? "Voice preview unavailable.");
        } else {
          setVoiceMsg(data.error ?? `Preview failed (HTTP ${res.status}).`);
        }
        return;
      }
      const blob = await res.blob();
      const audioUrl = URL.createObjectURL(blob);
      const audio = new Audio(audioUrl);
      audio.onended = () => URL.revokeObjectURL(audioUrl);
      void audio.play();
      void fetchVoiceCache();
    } catch (err) {
      setVoiceMsg(err instanceof Error ? err.message : "Preview failed.");
    }
    setPreviewing(false);
  }, [selectedVoice, previewing, fetchVoiceCache]);

  const clearVoiceCache = useCallback(async (onStatus: (msg: string) => void) => {
    if (typeof window !== "undefined" && !window.confirm("Clear the voice cache? Generated voice WAVs will be removed.")) return;
    try {
      const res = await fetch(`${API_BASE}/nusika/voices/cache`, { method: "DELETE" });
      if (res.ok) {
        onStatus("Voice cache cleared.");
      } else {
        setVoiceMsg(`Could not clear cache (HTTP ${res.status}).`);
      }
    } catch (err) {
      setVoiceMsg(err instanceof Error ? err.message : "Cache clear failed.");
    }
    void fetchVoiceCache();
  }, [fetchVoiceCache]);

  return {
    voices, selectedVoiceId, selectedVoice, previewing, voiceMsg, voiceCache,
    onSelectVoice, previewVoice, clearVoiceCache,
  };
}
