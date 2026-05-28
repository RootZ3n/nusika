/**
 * Shared types, constants, helpers, and inline-style factories used across
 * the root Nusika screens (Hall, Session, Map, Advanced, Inkwell).
 *
 * Lifted out of the original 2,537-line `page.tsx` during the structural
 * refactor on 2026-05-22. Nothing here is new — every export was already
 * defined inline in that file. Keep this file purely declarative: no React,
 * no hooks. Style factories return plain `React.CSSProperties` so they can
 * be consumed by any view without importing React state.
 */

import type { CSSProperties } from "react";

// ── Server constants ─────────────────────────────────────────────────────────

export const API_BASE = "/api/proxy";

// ── Theme constants ──────────────────────────────────────────────────────────

export const ACCENT = "#a78bfa";
export const ACCENT_DIM = "rgba(139,92,246,0.08)";
export const ACCENT_GLOW = "rgba(139,92,246,0.20)";
export const CYAN = "#22d3ee";
export const VIOLET = "#8b5cf6";
export const MAGENTA = "#ec4899";
export const GRADIENT_ACCENT = "linear-gradient(135deg, #8b5cf6, rgba(139,92,246,0.7))";

// OpenDyslexic CDN URL — loaded dynamically by the accessibility effect when
// the dyslexic-font toggle is on.
export const OPEN_DYSLEXIC_CDN =
  "https://cdnjs.cloudflare.com/ajax/libs/open-dyslexic/latest/OpenDyslexic.css";

// ── Domain types ─────────────────────────────────────────────────────────────

export interface NusikaModule {
  id: string;
  name: string;
  subject: string;
  campaign_world: string;
  companions: {
    id: string;
    name: string;
    role: string;
    accent_color?: string;
    teaching_rules?: string;
    personality?: string;
    speech_pattern?: string;
  }[];
  summary: string;
  age_track: string;
  category: string;
  installed: boolean;
}

export interface NusikaSession {
  id: string;
  module_id: string;
  module_name: string;
  companion_id: string;
  companion_name: string;
  progress: number;
  last_summary: string;
  teaching_mode: string;
  duration_target: number;
  started_at: string;
  updated_at: string;
  status: string;
}

export interface CompanionMemory {
  id: string;
  text: string;
  created_at: string;
}

export interface ConceptProgress {
  concept: string;
  mastery: "introduced" | "practiced" | "mastered" | "reaffirmed";
}

export interface ModuleProgress {
  module_id: string;
  concepts: ConceptProgress[];
  exam_readiness: number | null;
}

// The server's GET /nusika/config returns
//   { ok, config: AccessibilitySettings, narrator: NarratorIdentity }.
// Provider/mode/safety/visibility envelopes are not yet exposed — when they
// are, widen this type to match.
export interface AccessibilitySettings {
  dyslexic_font: boolean;
  wide_spacing: boolean;
  narration_enabled: boolean;
  narration_volume: number;
  speed: "slow" | "standard" | "fast";
  comfort_mode: boolean;
}

export interface NarratorIdentity {
  id: string;
  name: string;
  role: string;
  personality: string;
  speech_pattern: string;
  greeting_idle: string;
  greeting_active: string;
}

export const DEFAULT_NARRATOR: NarratorIdentity = {
  id: "peh",
  name: "Peh",
  role: "Nusika Narrator & Guide",
  personality: "",
  speech_pattern: "",
  greeting_idle:
    "Welcome. I'm Peh. Take a look around — when something here calls to you, tell me and we'll begin.",
  greeting_active: "You're back. Where would you like to pick up?",
};

export type Screen = "hall" | "session" | "map" | "advanced" | "inkwell";

export const TABS: { key: Screen; label: string }[] = [
  { key: "hall", label: "The Hall" },
  { key: "session", label: "The Session" },
  { key: "map", label: "The Map" },
  { key: "advanced", label: "Advanced Studies" },
  { key: "inkwell", label: "The Inkwell" },
];

// Learner profile for adaptive pacing.
export interface LearnerProfile {
  pace: "adaptive";
  chunk_size: "adaptive";
  repetition_comfort: number; // 1-10
  complexity_ceiling: number; // 1-10
  engagement_signals: string[];
  preferred_modality: "adaptive";
}

export const DEFAULT_LEARNER_PROFILE: LearnerProfile = {
  pace: "adaptive",
  chunk_size: "adaptive",
  repetition_comfort: 5,
  complexity_ceiling: 5,
  engagement_signals: [],
  preferred_modality: "adaptive",
};

// Audio state for ambient session audio.
export type AudioState = "opening" | "active" | "closing" | "silent";

// Chat receipt — the metering block we render under assistant content.
export interface ChatReceipt {
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  durationMs?: number;
}

// Practice-mode chat message.
export interface PracticeMessage {
  role: "user" | "assistant";
  content: string;
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  durationMs?: number;
}

// Inkwell draft (client-side shape; createdAt is millis since epoch).
export interface InkwellDraft {
  id: string;
  title: string;
  content: string;
  feedback?: string;
  createdAt: number;
}

export const MASTERY_COLORS: Record<string, string> = {
  introduced: "#6b7280",
  practiced: "#fbbf24",
  mastered: "#4ade80",
  reaffirmed: "#a78bfa",
};

export const MASTERY_LABELS: Record<string, string> = {
  introduced: "Introduced",
  practiced: "Practiced",
  mastered: "Mastered",
  reaffirmed: "Reaffirmed",
};

export const DURATION_OPTIONS = [5, 10, 20];

export const TEACHING_MODES: { key: string; label: string }[] = [
  { key: "narrative", label: "Narrative" },
  { key: "direct", label: "Direct" },
  { key: "socratic", label: "Socratic" },
];

// Language modules that get the "Practice" quick-button + Telex toggle.
export const LANGUAGE_MODULE_IDS = ["spanish", "french", "vietnamese", "mandarin", "latin"] as const;

// ── Helpers ──────────────────────────────────────────────────────────────────

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function companionInitial(name?: string | null): string {
  if (!name) return "?";
  return name.charAt(0).toUpperCase();
}

export function companionColor(name?: string | null): string {
  const colors = ["#a78bfa", "#4df5c8", "#f472b6", "#60a5fa", "#fb923c", "#fbbf24", "#4ade80"];
  if (!name) return colors[0]!;
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length]!;
}

// Strip lightweight markdown for TTS so the voice doesn't read asterisks.
export function stripForTTS(text: string): string {
  return text
    .replace(/\*\*([\s\S]*?)\*\*/g, "$1")
    .replace(/\*([\s\S]*?)\*/g, "$1")
    .replace(/#{1,6}\s+/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

/**
 * Telex Vietnamese input — folds the last two characters of `text` into a
 * single Vietnamese-script character when they spell a known digraph or
 * tone-mark pair (e.g. "dd" -> "đ", "a1" -> "á"). Pass-through otherwise.
 */
export function applyTelex(text: string): string {
  if (text.length < 2) return text;
  const last2 = text.slice(-2);
  const prefix = text.slice(0, -2);

  const replacements: Record<string, string> = {
    "dd": "đ", "DD": "Đ", "aa": "â", "AA": "Â", "aw": "ă", "AW": "Ă",
    "ee": "ê", "EE": "Ê", "oo": "ô", "OO": "Ô", "ow": "ơ", "OW": "Ơ", "uw": "ư", "UW": "Ư",
    "a1": "á", "a2": "à", "a3": "ả", "a4": "ã", "a5": "ạ",
    "A1": "Á", "A2": "À", "A3": "Ả", "A4": "Ã", "A5": "Ạ",
    "o1": "ó", "o2": "ò", "o3": "ỏ", "o4": "õ", "o5": "ọ",
    "O1": "Ó", "O2": "Ò", "O3": "Ỏ", "O4": "Õ", "O5": "Ọ",
    "e1": "é", "e2": "è", "e3": "ẻ", "e4": "ẽ", "e5": "ẹ",
    "E1": "É", "E2": "È", "E3": "Ẻ", "E4": "Ẽ", "E5": "Ẹ",
    "u1": "ú", "u2": "ù", "u3": "ủ", "u4": "ũ", "u5": "ụ",
    "U1": "Ú", "U2": "Ù", "U3": "Ủ", "U4": "Ũ", "U5": "Ụ",
    "i1": "í", "i2": "ì", "i3": "ỉ", "i4": "ĩ", "i5": "ị",
    "I1": "Í", "I2": "Ì", "I3": "Ỉ", "I4": "Ĩ", "I5": "Ị",
  };

  if (replacements[last2]) return prefix + replacements[last2];
  return text;
}

// ── Inline-style factories ───────────────────────────────────────────────────
//
// The original page.tsx defined these inside the component function so they
// could close over `ACCENT`, etc. Pulling them up here keeps every view
// visually identical without any runtime indirection. None of them depend on
// component state.

export const panelStyle: CSSProperties = {
  background: "rgba(22,18,52,0.78)",
  border: "1px solid rgba(139,92,246,0.15)",
  borderRadius: "20px",
  padding: "16px",
  backdropFilter: "blur(16px)",
  WebkitBackdropFilter: "blur(16px)",
  boxShadow: "0 8px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(139,92,246,0.15)",
};

export const cardStyle: CSSProperties = {
  ...panelStyle,
  cursor: "pointer",
  transition: "border-color 0.18s, background 0.18s",
};

export const btnPrimary: CSSProperties = {
  background: GRADIENT_ACCENT,
  color: "#fff",
  border: "1px solid rgba(139,92,246,0.4)",
  borderRadius: 999,
  padding: "10px 22px",
  fontFamily: "var(--font-body)",
  fontSize: "13px",
  fontWeight: 600,
  cursor: "pointer",
  minHeight: 44,
  minWidth: 44,
  transition: "all 0.16s ease",
  letterSpacing: "0.03em",
};

export const btnSecondary: CSSProperties = {
  background: "rgba(139,92,246,0.06)",
  color: "var(--text-primary)",
  border: "1px solid rgba(139,92,246,0.25)",
  borderRadius: 999,
  padding: "10px 22px",
  fontFamily: "var(--font-body)",
  fontSize: "13px",
  fontWeight: 600,
  cursor: "pointer",
  minHeight: 44,
  transition: "all 0.16s ease",
  letterSpacing: "0.03em",
};

export const btnGhost: CSSProperties = {
  background: "transparent",
  color: "var(--text-muted)",
  border: "1px solid rgba(139,92,246,0.15)",
  borderRadius: 999,
  padding: "8px 16px",
  fontFamily: "var(--font-body)",
  fontSize: "12px",
  cursor: "pointer",
  transition: "all 0.16s ease",
};

export const pillStyle = (active: boolean): CSSProperties => ({
  background: active ? "rgba(139,92,246,0.12)" : "transparent",
  color: active ? "#fff" : "var(--text-muted)",
  border: `1px solid ${active ? "rgba(139,92,246,0.4)" : "rgba(139,92,246,0.15)"}`,
  borderRadius: 999,
  padding: "6px 16px",
  fontFamily: "var(--font-body)",
  fontSize: "12px",
  fontWeight: active ? 600 : 500,
  cursor: "pointer",
  minHeight: 44,
  display: "inline-flex",
  alignItems: "center",
  transition: "all 0.16s ease",
  whiteSpace: "nowrap",
  letterSpacing: "0.03em",
});

export const tabBarStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 6,
  padding: "4px",
  borderRadius: 16,
  background: "rgba(139,92,246,0.04)",
  border: "1px solid rgba(139,92,246,0.15)",
};

export const tabStyle = (active: boolean): CSSProperties => ({
  flex: "1 1 auto",
  border: `1px solid ${active ? "rgba(139,92,246,0.4)" : "transparent"}`,
  borderRadius: 10,
  background: active
    ? "linear-gradient(135deg, rgba(139,92,246,0.35), rgba(139,92,246,0.2))"
    : "transparent",
  color: active ? "#fff" : "var(--text-muted)",
  padding: "12px 16px",
  fontFamily: "var(--font-body)",
  fontSize: "13px",
  fontWeight: 600,
  cursor: "pointer",
  transition: "all 0.16s ease",
  whiteSpace: "nowrap",
  boxShadow: active ? "0 0 16px rgba(139,92,246,0.2), inset 0 1px 0 rgba(255,255,255,0.08)" : "none",
});
