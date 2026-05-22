"use client";

/**
 * LessonHeader — title row, recap button, depth pills, voice picker, and
 * the optional summary card. Extracted from teach/page.tsx on 2026-05-22.
 */

import {
  ACCENT, ACCENT_DIM, DEPTHS,
  btnGhost, pill,
  type Depth, type Lesson, type Turn,
} from "../types";
import { labelVoiceProfile } from "../hooks/useTeachVoice";
import type { VoiceOption } from "../../lib/voice-picker";

export interface LessonHeaderProps {
  active: Lesson;
  turns: Turn[];
  recapBusy: boolean;
  onRecap: () => void;
  onSetDepth: (d: Depth) => void;

  voices: VoiceOption[];
  selectedVoiceId: string;
  selectedVoice: VoiceOption | null;
  previewing: boolean;
  voiceMsg: string | null;
  autoplayVoice: boolean;
  playingReply: boolean;
  onSelectVoice: (id: string) => void;
  onPreview: () => void;
  onToggleAutoplay: (next: boolean) => void;
  onPlayLatest: () => void;
}

export function LessonHeader(props: LessonHeaderProps) {
  const {
    active, turns, recapBusy, onRecap, onSetDepth,
    voices, selectedVoiceId, selectedVoice,
    previewing, voiceMsg, autoplayVoice, playingReply,
    onSelectVoice, onPreview, onToggleAutoplay, onPlayLatest,
  } = props;

  return (
    <header style={{
      padding: "12px 20px",
      borderBottom: "1px solid var(--border, rgba(255,255,255,0.08))",
      display: "flex", flexDirection: "column", gap: 8,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{active.title}</h2>
        <button style={btnGhost} disabled={recapBusy || turns.length === 0} onClick={onRecap}>
          {recapBusy ? "Recapping…" : "Update summary"}
        </button>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {DEPTHS.map((d) => (
          <button key={d.key} style={pill(active.depth === d.key)} onClick={() => onSetDepth(d.key)} title={d.hint}>
            {d.label}
          </button>
        ))}
      </div>

      {voices.length > 0 && selectedVoice && (
        <div style={{
          display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center",
          fontSize: 12, color: "var(--text-muted, #888)",
          padding: "4px 0",
        }}>
          <label style={{
            fontFamily: "var(--font-mono, monospace)", fontSize: 11,
            color: ACCENT, letterSpacing: "0.06em", textTransform: "uppercase",
          }}>
            Voice
          </label>
          <select
            value={selectedVoiceId}
            onChange={(e) => onSelectVoice(e.target.value)}
            aria-label="Select voice for preview"
            style={{
              fontFamily: "var(--font-mono, monospace)", fontSize: 12,
              color: ACCENT, background: ACCENT_DIM,
              border: `1px solid ${ACCENT}33`, borderRadius: 10,
              padding: "3px 8px", cursor: "pointer",
            }}
          >
            {voices.map((v) => (
              <option key={v.id} value={v.id}>
                {labelVoiceProfile(v)}
              </option>
            ))}
          </select>
          <button
            style={{ ...btnGhost, fontSize: 12, padding: "3px 10px" }}
            onClick={onPreview}
            disabled={previewing}
            aria-label="Preview selected voice"
          >
            {previewing ? "Playing…" : "Preview"}
          </button>
          <label
            style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              fontSize: 12, color: "var(--text-secondary, #b8b6c3)",
              cursor: "pointer", userSelect: "none",
            }}
            title="Play assistant replies aloud with the selected voice"
          >
            <input
              type="checkbox"
              checked={autoplayVoice}
              onChange={(e) => onToggleAutoplay(e.target.checked)}
              aria-label="Auto-play assistant replies"
              style={{ accentColor: ACCENT, cursor: "pointer" }}
            />
            Auto voice
          </label>
          <button
            style={{ ...btnGhost, fontSize: 12, padding: "3px 10px" }}
            onClick={onPlayLatest}
            disabled={playingReply || turns.every((t) => t.role !== "assistant")}
            aria-label="Play latest assistant reply"
            title="Play the latest assistant reply with the selected voice"
          >
            {playingReply ? "Playing…" : "Play latest"}
          </button>
          {voiceMsg && (
            <span style={{ color: "var(--text-secondary, #b8b6c3)", fontStyle: "italic" }}>{voiceMsg}</span>
          )}
        </div>
      )}

      {active.summary && (
        <div style={{
          marginTop: 6, padding: "8px 12px", borderRadius: 8,
          background: ACCENT_DIM, border: `1px solid ${ACCENT}33`,
          fontSize: 13, color: "var(--text-secondary, #b8b6c3)", lineHeight: 1.6,
        }}>
          <div style={{ fontSize: 11, color: ACCENT, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>
            Summary so far
          </div>
          {active.summary}
        </div>
      )}
    </header>
  );
}
