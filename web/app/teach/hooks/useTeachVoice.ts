"use client";

/**
 * useTeachVoice — voice picker + preview + cache + opt-in reply autoplay.
 * Extracted from teach/page.tsx on 2026-05-22. Slice 6F/6G/6H behavior is
 * preserved verbatim (localStorage round-trips, autoplay restore on mount,
 * blob URL revocation, browser-autoplay fallback message).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  TEACH_VOICE_KEY,
  labelVoiceProfile,
  pickInitialVoice,
  readStoredVoiceId,
  sortVoiceOptions,
  writeStoredVoiceId,
  type VoiceOption,
} from "../../lib/voice-picker";
import {
  API_BASE, AUTOPLAY_KEY, VOICE_UNAVAILABLE_MSG,
  stripForTTS,
  type VoiceCacheStatus,
} from "../types";

export { labelVoiceProfile };

export interface TeachVoice {
  voices: VoiceOption[];
  selectedVoiceId: string;
  selectedVoice: VoiceOption | null;
  previewing: boolean;
  voiceMsg: string | null;
  setVoiceMsg: React.Dispatch<React.SetStateAction<string | null>>;
  voiceCache: VoiceCacheStatus | null;
  autoplayVoice: boolean;
  playingReply: boolean;

  onSelectVoice: (id: string) => void;
  onToggleAutoplay: (next: boolean) => void;
  previewVoice: () => Promise<void>;
  playReplyTTS: (text: string) => Promise<void>;
  stopReplyAudio: () => void;
  clearVoiceCache: () => Promise<void>;
}

export function useTeachVoice(): TeachVoice {
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>("varros-default");
  const [previewing, setPreviewing] = useState(false);
  const [voiceMsg, setVoiceMsg] = useState<string | null>(null);
  const [voiceCache, setVoiceCache] = useState<VoiceCacheStatus | null>(null);
  const [autoplayVoice, setAutoplayVoice] = useState(false);
  const [playingReply, setPlayingReply] = useState(false);
  const audioRef = useRef<{ audio: HTMLAudioElement; url: string } | null>(null);

  const selectedVoice = voices.find((v) => v.id === selectedVoiceId) ?? null;

  const fetchVoices = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/magister/voices`);
      if (!res.ok) return;
      const data = (await res.json()) as { voices?: VoiceOption[] };
      const list = sortVoiceOptions(data.voices ?? []);
      setVoices(list);
      const stored = readStoredVoiceId(TEACH_VOICE_KEY);
      const initial = pickInitialVoice(list, stored, "varros-default");
      if (initial) setSelectedVoiceId(initial.id);
    } catch { /* silent */ }
  }, []);

  const fetchVoiceCache = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/magister/voices/cache`);
      if (!res.ok) return;
      const data = (await res.json()) as VoiceCacheStatus & { ok?: boolean };
      setVoiceCache({ bytes: data.bytes, maxBytes: data.maxBytes, mb: data.mb, maxMb: data.maxMb });
    } catch { /* silent */ }
  }, []);

  useEffect(() => { void fetchVoices(); void fetchVoiceCache(); }, [fetchVoices, fetchVoiceCache]);

  // Slice 6H — restore the auto-voice toggle from localStorage on mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(AUTOPLAY_KEY);
      if (stored === "true") setAutoplayVoice(true);
    } catch { /* ignore */ }
  }, []);

  const onSelectVoice = useCallback((id: string) => {
    setSelectedVoiceId(id);
    writeStoredVoiceId(TEACH_VOICE_KEY, id);
    setVoiceMsg(null);
  }, []);

  const previewVoice = useCallback(async () => {
    if (!selectedVoice || previewing) return;
    setPreviewing(true);
    setVoiceMsg(null);
    const speakerName = selectedVoice.display_name.replace(/\s*\(default voice\)\s*$/i, "").trim()
      || selectedVoice.companion_id
      || "a Magister voice";
    try {
      const url = `${API_BASE}/magister/voices/preview/${encodeURIComponent(selectedVoice.engine)}/${encodeURIComponent(selectedVoice.voice_ref)}?name=${encodeURIComponent(speakerName)}`;
      const res = await fetch(url);
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (res.status === 503) {
          setVoiceMsg(data.error ?? "Voice preview unavailable. Start the Kokoro service to enable previews.");
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

  const stopReplyAudio = useCallback(() => {
    const cur = audioRef.current;
    if (!cur) return;
    try { cur.audio.onended = null; } catch { /* ignore */ }
    try { cur.audio.pause(); } catch { /* ignore */ }
    try { URL.revokeObjectURL(cur.url); } catch { /* ignore */ }
    audioRef.current = null;
    setPlayingReply(false);
  }, []);

  const playReplyTTS = useCallback(async (text: string) => {
    const clean = stripForTTS(text);
    if (!clean) return;

    stopReplyAudio();
    const voiceId = voices.some((v) => v.id === selectedVoiceId) ? selectedVoiceId : "varros-default";
    setVoiceMsg(null);
    setPlayingReply(true);

    let createdUrl: string | null = null;
    try {
      const res = await fetch(`${API_BASE}/magister/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: clean, voice: voiceId }),
      });
      if (!res.ok) {
        setVoiceMsg(VOICE_UNAVAILABLE_MSG);
        setPlayingReply(false);
        void fetchVoiceCache();
        return;
      }
      const blob = await res.blob();
      createdUrl = URL.createObjectURL(blob);
      const url = createdUrl;
      const audio = new Audio(url);
      audioRef.current = { audio, url };
      audio.onended = () => {
        try { URL.revokeObjectURL(url); } catch { /* ignore */ }
        if (audioRef.current?.audio === audio) audioRef.current = null;
        setPlayingReply(false);
      };
      try {
        await audio.play();
      } catch {
        // Browser autoplay policy or other playback rejection — clean up
        // without crashing and leave a small note for the user.
        if (audioRef.current?.audio === audio) audioRef.current = null;
        try { URL.revokeObjectURL(url); } catch { /* ignore */ }
        setVoiceMsg(VOICE_UNAVAILABLE_MSG);
        setPlayingReply(false);
      }
      void fetchVoiceCache();
    } catch {
      if (createdUrl) {
        try { URL.revokeObjectURL(createdUrl); } catch { /* ignore */ }
      }
      setVoiceMsg(VOICE_UNAVAILABLE_MSG);
      setPlayingReply(false);
    }
  }, [voices, selectedVoiceId, stopReplyAudio, fetchVoiceCache]);

  const onToggleAutoplay = useCallback((next: boolean) => {
    setAutoplayVoice(next);
    if (typeof window !== "undefined") {
      try { window.localStorage.setItem(AUTOPLAY_KEY, next ? "true" : "false"); } catch { /* ignore */ }
    }
    if (!next) stopReplyAudio();
  }, [stopReplyAudio]);

  const clearVoiceCache = useCallback(async () => {
    if (typeof window !== "undefined" && !window.confirm("Clear the voice cache? Generated voice WAVs will be removed.")) return;
    try {
      const res = await fetch(`${API_BASE}/magister/voices/cache`, { method: "DELETE" });
      if (res.ok) {
        setVoiceMsg("Voice cache cleared.");
        setTimeout(() => setVoiceMsg(null), 2500);
      } else {
        setVoiceMsg(`Could not clear cache (HTTP ${res.status}).`);
      }
    } catch (err) {
      setVoiceMsg(err instanceof Error ? err.message : "Cache clear failed.");
    }
    void fetchVoiceCache();
  }, [fetchVoiceCache]);

  // Pause + revoke any in-flight reply audio when the page unmounts.
  useEffect(() => {
    return () => { stopReplyAudio(); };
  }, [stopReplyAudio]);

  return {
    voices, selectedVoiceId, selectedVoice, previewing, voiceMsg, setVoiceMsg,
    voiceCache, autoplayVoice, playingReply,
    onSelectVoice, onToggleAutoplay, previewVoice, playReplyTTS, stopReplyAudio,
    clearVoiceCache,
  };
}
