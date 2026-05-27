"use client";

/**
 * useVoicePlayback — owns TTS (companion voice) playback and STT (mic
 * capture -> /magister/stt) for the Hall's Session screen.
 *
 * Pulled out of page.tsx during the 2026-05-22 refactor.
 *
 * Voice contract: the server route `POST /magister/tts` accepts
 *   { text, voice?, scope? }
 * where `voice` / `scope` may be a voice-profile id (e.g.
 * "varros-default"), a companion id (e.g. "marcus", "cronk"), a legacy
 * Piper voice basename, or omitted (default voice). The Hall path
 * doesn't have a voice picker yet — it dispatches by companion id, so
 * it sends `scope: <companion_id>` and lets the server resolve the
 * matching profile through the voice registry.
 *
 * Historical bug: this hook used to send `{ role: companionId }`, which
 * the route silently ignored (no such field in the schema), and every
 * companion played the default Piper voice. The Phase 2 voice contract
 * fix (2026-05-27) renamed the parameter + the payload field to the
 * names the route actually reads.
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
  /**
   * Play a stripped-markdown TTS clip via the API. No-op when narration
   * is disabled or the input is empty. `companionId` is the value the
   * route resolves through the voice registry; omit it (or pass null /
   * undefined) to let the server fall back to its default voice.
   */
  playTTS: (text: string, companionId?: string | null) => Promise<void>;
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
    async (text: string, companionId?: string | null) => {
      const clean = stripForTTS(text);
      if (!clean || !narrationEnabled) return;
      // Route through the standard /magister/tts dispatch. When a
      // companion id is in hand we pass it as `scope` — the contract
      // resolves it through the voice registry (kokoro/piper/elevenlabs
      // per profile). Omitting the field means "use the server default
      // voice", which is what we want when we don't know who is
      // speaking.
      const trimmedId = typeof companionId === "string" ? companionId.trim() : "";
      try {
        const ttsRes = await fetch(`${API_BASE}/magister/tts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: clean,
            ...(trimmedId ? { scope: trimmedId } : {}),
          }),
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
