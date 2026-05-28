/**
 * Shared types, constants, and style factories for the Teach screen.
 * Extracted from teach/page.tsx on 2026-05-22.
 */

import type { CSSProperties } from "react";

export const API_BASE = "/api/proxy";
export const ACCENT = "#a78bfa";
export const ACCENT_DIM = "rgba(167,139,250,0.10)";

// Slice 6H — opt-in auto-play TTS for assistant replies. Off by default;
// the value is mirrored to localStorage so the choice survives reload.
// Legacy: "magister.teach.autoplayVoice"
export const AUTOPLAY_KEY = "nusika.teach.autoplayVoice";
export const VOICE_UNAVAILABLE_MSG = "Voice playback unavailable. Start the Kokoro service or choose another voice.";

export type Depth = "intro" | "deeper" | "example" | "practice" | "review";
export type Status = "active" | "paused" | "complete";

export const DEPTHS: { key: Depth; label: string; hint: string }[] = [
  { key: "intro",    label: "Intro",    hint: "Start at the beginning, plain language." },
  { key: "deeper",   label: "Deeper",   hint: "Go one level deeper into mechanism." },
  { key: "example",  label: "Example",  hint: "Lead with a concrete example." },
  { key: "practice", label: "Practice", hint: "Give me something to try." },
  { key: "review",   label: "Review",   hint: "Summarize what we've covered." },
];

export interface Lesson {
  id: string;
  title: string;
  topic: string;
  depth: Depth;
  status: Status;
  summary: string | null;
  knowledge: string;
  turn_count: number;
  created_at: string;
  updated_at: string;
}

export interface Turn {
  id: string;
  lesson_id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  depth_at: Depth | null;
  model: string | null;
  provider: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  created_at: string;
}

export interface VoiceCacheStatus {
  bytes: number;
  maxBytes: number;
  mb: number;
  maxMb: number;
}

/** Strip light markdown so TTS narration doesn't speak '**' or '##'. */
export function stripForTTS(text: string): string {
  return text
    .replace(/\*\*([\s\S]*?)\*\*/g, "$1")
    .replace(/\*([\s\S]*?)\*/g, "$1")
    .replace(/#{1,6}\s+/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

// ── Style factories ─────────────────────────────────────────────────────────

export const shell: CSSProperties = {
  display: "flex", height: "100vh", minHeight: 0,
  fontFamily: "var(--font-body, system-ui, sans-serif)",
  background: "var(--bg-void, #060810)", color: "var(--text-primary, #e7e5f0)",
};

export const sidebar: CSSProperties = {
  width: 280, flexShrink: 0, padding: 16,
  borderRight: "1px solid var(--border, rgba(255,255,255,0.08))",
  display: "flex", flexDirection: "column", gap: 12, overflow: "hidden",
};

export const main: CSSProperties = {
  flex: 1, display: "flex", flexDirection: "column", minHeight: 0,
};

export const btnPrimary: CSSProperties = {
  background: ACCENT, color: "#060810", border: "none", borderRadius: 8,
  padding: "8px 14px", fontSize: 14, fontWeight: 600, cursor: "pointer",
};

export const btnGhost: CSSProperties = {
  background: "transparent", color: "var(--text-secondary, #b8b6c3)",
  border: "1px solid var(--border, rgba(255,255,255,0.12))",
  borderRadius: 8, padding: "6px 12px", fontSize: 13, cursor: "pointer",
};

export const pill = (active: boolean): CSSProperties => ({
  background: active ? ACCENT_DIM : "transparent",
  color: active ? ACCENT : "var(--text-muted, #888)",
  border: `1px solid ${active ? ACCENT : "var(--border, rgba(255,255,255,0.12))"}`,
  borderRadius: 18, padding: "4px 12px", fontSize: 12, cursor: "pointer",
  whiteSpace: "nowrap",
});
