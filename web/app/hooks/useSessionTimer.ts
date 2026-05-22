"use client";

/**
 * useSessionTimer — owns the ticking session clock and ambient-audio state
 * machine. Pulled out of page.tsx during the 2026-05-22 refactor; logic and
 * timings are intentionally identical to the inline original.
 *
 * Responsibilities:
 *   - 1Hz second-counter while `sessionRunning` is true. Stops + resets the
 *     interval when paused. Cleans up on unmount.
 *   - Ambient audio state machine: silent -> opening -> active -> closing,
 *     driven by `sessionRunning` and the 10-minute-before-end warning.
 *   - Hands the caller a "warning bus" so the SessionView can push the
 *     wind-down speech bubble at the same tick it always did.
 *
 * The 10-min warning fires exactly once at `durationSec - 600`. The original
 * code relied on `sessionTimer === warningAt` strict equality; we preserve
 * that by tracking the tick we last fired on so a paused/rewound timer
 * cannot re-trigger the warning during the same session.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE, type AudioState, type MagisterModule, type MagisterSession } from "../types";

export interface SessionTimerOptions {
  sessionRunning: boolean;
  activeSession: MagisterSession | null;
  modules: MagisterModule[];
  ambientVolume: number;
  /** Reset to 0 whenever the caller starts a new session. */
  resetSignal: unknown;
  /** Fired exactly once per session at the 10-minute-remaining mark. */
  onTenMinuteWarning?: () => void;
}

export interface SessionTimerHook {
  sessionTimer: number;
  audioState: AudioState;
  audioRef: React.MutableRefObject<HTMLAudioElement | null>;
}

export function useSessionTimer(opts: SessionTimerOptions): SessionTimerHook {
  const { sessionRunning, activeSession, modules, ambientVolume, resetSignal, onTenMinuteWarning } = opts;

  const [sessionTimer, setSessionTimer] = useState(0);
  const [audioState, setAudioState] = useState<AudioState>("silent");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const warningFiredRef = useRef(false);

  // Reset the counter (and warning latch) when the caller signals a new
  // session. We avoid making resetSignal a number on purpose — any changing
  // value works (sessionId, an incrementing key, etc.).
  useEffect(() => {
    setSessionTimer(0);
    warningFiredRef.current = false;
  }, [resetSignal]);

  // ── 1Hz tick ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (sessionRunning) {
      timerRef.current = setInterval(() => {
        setSessionTimer((t) => t + 1);
      }, 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [sessionRunning]);

  // ── Ambient playback helpers ─────────────────────────────────────────────

  const playAmbient = useCallback((cue: string, volume = 0.15) => {
    if (!cue) return;
    try {
      const src = `${API_BASE}/magister/audio/${cue}.mp3`;
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = src;
      } else {
        audioRef.current = new Audio(src);
      }
      audioRef.current.volume = 0;
      audioRef.current.loop = true;
      audioRef.current.play().catch(() => { /* audio file not found — silent fallback */ });
      const fadeIn = setInterval(() => {
        if (audioRef.current && audioRef.current.volume < volume) {
          audioRef.current.volume = Math.min(volume, audioRef.current.volume + 0.01);
        } else {
          clearInterval(fadeIn);
        }
      }, 50);
    } catch { /* audio not available */ }
  }, []);

  const fadeOutAmbient = useCallback(() => {
    if (!audioRef.current) return;
    const audio = audioRef.current;
    const fadeOut = setInterval(() => {
      if (audio.volume > 0.01) {
        audio.volume = Math.max(0, audio.volume - 0.01);
      } else {
        clearInterval(fadeOut);
        audio.pause();
      }
    }, 50);
  }, []);

  // ── State machine ───────────────────────────────────────────────────────

  useEffect(() => {
    if (audioState === "opening" && activeSession) {
      const modConfig = modules.find((m) => m.id === activeSession.module_id);
      const ambientAudio = (modConfig as unknown as Record<string, unknown>)?.ambient_audio as
        | Record<string, string>
        | undefined;
      if (ambientAudio?.session_open) playAmbient(ambientAudio.session_open, ambientVolume * 1.3);
      const t = setTimeout(() => setAudioState("active"), 8000);
      return () => clearTimeout(t);
    } else if (audioState === "active" && activeSession) {
      const modConfig = modules.find((m) => m.id === activeSession.module_id);
      const ambientAudio = (modConfig as unknown as Record<string, unknown>)?.ambient_audio as
        | Record<string, string>
        | undefined;
      if (ambientAudio?.session_active) playAmbient(ambientAudio.session_active, ambientVolume);
    } else if (audioState === "closing") {
      if (audioRef.current) audioRef.current.volume = Math.min(0.25, audioRef.current.volume + 0.1);
    } else if (audioState === "silent") {
      fadeOutAmbient();
    }
  }, [audioState, activeSession, modules, ambientVolume, playAmbient, fadeOutAmbient]);

  // Unmount cleanup — silence any lingering audio.
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  // Start/stop ambient with the session.
  useEffect(() => {
    if (sessionRunning && activeSession && audioState === "silent") {
      setAudioState("opening");
    } else if (!sessionRunning && audioState !== "silent") {
      setAudioState("silent");
    }
  }, [sessionRunning, activeSession, audioState]);

  // 10-minute warning — fires exactly once per session.
  useEffect(() => {
    if (!sessionRunning || !activeSession) return;
    const durationSec = ((activeSession as unknown as Record<string, unknown>).duration_target as number ?? 10) * 60;
    const warningAt = durationSec - 600;
    if (warningAt <= 0) return;
    if (sessionTimer === warningAt && !warningFiredRef.current) {
      warningFiredRef.current = true;
      setAudioState("closing");
      onTenMinuteWarning?.();
    }
  }, [sessionTimer, sessionRunning, activeSession, onTenMinuteWarning]);

  return { sessionTimer, audioState, audioRef };
}
