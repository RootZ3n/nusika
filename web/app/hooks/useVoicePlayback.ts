"use client";

/**
 * useVoicePlayback — owns TTS (companion voice) playback and STT (mic
 * capture -> /magister/stt) for the Session screen.
 *
 * Pulled out of page.tsx during the 2026-05-22 refactor. No behavior
 * changes: the original TTS path still routes through the local Piper
 * (or Kokoro server-side fall-through), and the STT path still POSTs the
 * recorded webm blob to `/magister/stt` with the module-derived language.
 */

import { useCallback, useRef, useState } from "react";
import { API_BASE, stripForTTS } from "../types";

export interface VoicePlayback {
  voiceMode: "push" | "toggle";
  setVoiceMode: React.Dispatch<React.SetStateAction<"push" | "toggle">>;
  voiceActive: boolean;
  voiceLoading: boolean;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  /** Plays a stripped-markdown TTS clip via the API. No-op if narration is off. */
  playTTS: (text: string, companionRole?: string) => Promise<void>;
}

export interface VoicePlaybackOptions {
  /** Module id (e.g. "vietnamese", "mandarin") used to derive STT language. */
  moduleId: string | null | undefined;
  /** Narration master switch — if explicitly false, TTS calls are no-ops. */
  narrationEnabled: boolean;
  /** Callback fired with the recognised transcript when STT returns. */
  onTranscript: (text: string) => void;
}

export function useVoicePlayback(opts: VoicePlaybackOptions): VoicePlayback {
  const { moduleId, narrationEnabled, onTranscript } = opts;

  const [voiceMode, setVoiceMode] = useState<"push" | "toggle">("push");
  const [voiceActive, setVoiceActive] = useState(false);
  const [voiceLoading, setVoiceLoading] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const playTTS = useCallback(
    async (text: string, companionRole?: string) => {
      const clean = stripForTTS(text);
      if (!clean || !narrationEnabled) return;
      // Always route through local Piper. ElevenLabs path exists server-side
      // but there is no product-level toggle to switch on yet.
      try {
        const ttsRes = await fetch(`${API_BASE}/magister/tts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: clean, ...(companionRole ? { role: companionRole } : {}) }),
        });
        if (ttsRes.ok) {
          const blob = await ttsRes.blob();
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          audio.play();
          audio.onended = () => URL.revokeObjectURL(url);
        }
      } catch { /* TTS failed silently */ }
    },
    [narrationEnabled],
  );

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        setVoiceActive(false);
        setVoiceLoading(true);

        // Same language-derivation rule as the original inline code.
        const modId = moduleId ?? "";
        const lang = modId === "vietnamese" ? "vi" : modId === "mandarin" ? "zh" : "en";

        const formData = new FormData();
        formData.append("audio", blob, `magister-${Date.now()}.webm`);
        formData.append("language", lang);

        try {
          const res = await fetch(`${API_BASE}/magister/stt`, { method: "POST", body: formData });
          const data = (await res.json()) as { ok?: boolean; transcript?: string };
          if (data.ok && data.transcript) {
            onTranscript(data.transcript);
          }
        } catch { /* silent */ }
        setVoiceLoading(false);
      };
      mr.start();
      mediaRecorderRef.current = mr;
      setVoiceActive(true);
    } catch { /* mic not available */ }
  }, [moduleId, onTranscript]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && voiceActive) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }
  }, [voiceActive]);

  return { voiceMode, setVoiceMode, voiceActive, voiceLoading, startRecording, stopRecording, playTTS };
}
