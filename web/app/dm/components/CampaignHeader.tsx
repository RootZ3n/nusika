"use client";

/**
 * CampaignHeader — title row with status pill, voice picker, archive/
 * delete buttons, and the optional voice-preview status line.
 * Extracted from page.tsx on 2026-05-22.
 */

import { ACCENT, ACCENT_DIM, btnGhost, type Campaign } from "../types";
import { labelVoiceProfile } from "../hooks/useDmVoice";
import type { VoiceOption } from "../../lib/voice-picker";

export interface CampaignHeaderProps {
  campaign: Campaign | null;
  voices: VoiceOption[];
  selectedVoiceId: string;
  selectedVoice: VoiceOption | null;
  previewing: boolean;
  voiceMsg: string | null;
  onSelectVoice: (id: string) => void;
  onPreview: () => void;
  onArchive: () => void;
  onDelete: () => void;
}

export function CampaignHeader(props: CampaignHeaderProps) {
  const { campaign, voices, selectedVoiceId, selectedVoice, previewing, voiceMsg,
    onSelectVoice, onPreview, onArchive, onDelete } = props;

  return (
    <header style={{
      padding: "12px 20px",
      borderBottom: "1px solid var(--border, rgba(255,255,255,0.08))",
      display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap",
    }}>
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{campaign?.title ?? "…"}</h2>
        {campaign?.setting_blurb && (
          <div style={{ fontSize: 12, color: "var(--text-muted, #888)", marginTop: 2 }}>
            {campaign.setting_blurb}
          </div>
        )}
      </div>
      <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 11, color: ACCENT, background: ACCENT_DIM, padding: "3px 10px", borderRadius: 10 }}>
          {campaign?.status ?? "…"}
        </span>
        {voices.length > 0 && selectedVoice && (
          <>
            <select
              value={selectedVoiceId}
              onChange={(e) => onSelectVoice(e.target.value)}
              aria-label="Select voice for preview"
              style={{
                fontFamily: "var(--font-mono, monospace)", fontSize: 11,
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
              onClick={onPreview}
              aria-label="Preview selected voice"
              style={{ ...btnGhost, fontSize: 12, padding: "4px 10px" }}
              disabled={previewing}
            >{previewing ? "Playing…" : "Preview"}</button>
          </>
        )}
        {campaign && campaign.status !== "complete" && (
          <button onClick={onArchive} aria-label="Archive campaign" style={btnGhost}>
            Archive campaign
          </button>
        )}
        {campaign && (
          <button
            onClick={onDelete}
            aria-label="Delete campaign permanently"
            style={{ ...btnGhost, color: "#fca5a5", borderColor: "rgba(248,113,113,0.3)" }}
          >Delete permanently</button>
        )}
      </div>
      {voiceMsg && (
        <div style={{ marginTop: 4, fontSize: 12, color: "var(--text-secondary, #b8b6c3)", fontStyle: "italic" }}>
          {voiceMsg}
        </div>
      )}
    </header>
  );
}
