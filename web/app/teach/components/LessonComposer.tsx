"use client";

/**
 * LessonComposer — textarea + Send button (Enter sends, Shift+Enter inserts
 * newline) and the voice-cache footer. Extracted from teach/page.tsx on
 * 2026-05-22. Owns its own input draft state since nothing outside this
 * surface reads the in-progress text.
 */

import { useState } from "react";
import {
  ACCENT,
  btnPrimary,
  type Depth, type VoiceCacheStatus,
} from "../types";

export interface LessonComposerProps {
  depth: Depth;
  sending: boolean;
  onSend: (message: string) => void;
  voiceCache: VoiceCacheStatus | null;
  onClearVoiceCache: () => void;
}

export function LessonComposer(props: LessonComposerProps) {
  const { depth, sending, onSend, voiceCache, onClearVoiceCache } = props;
  const [input, setInput] = useState("");

  function send() {
    const msg = input.trim();
    if (!msg || sending) return;
    setInput("");
    onSend(msg);
  }

  return (
    <footer style={{ padding: "12px 20px", borderTop: "1px solid var(--border, rgba(255,255,255,0.08))" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={`Ask Varros (${depth})…  ⌃Enter for newline`}
          rows={2}
          style={{
            flex: 1, padding: 10, borderRadius: 8,
            border: "1px solid var(--border, rgba(255,255,255,0.12))",
            background: "rgba(255,255,255,0.03)", color: "inherit",
            fontFamily: "inherit", fontSize: 14, resize: "none",
          }}
        />
        <button style={btnPrimary} onClick={send} disabled={sending || !input.trim()}>
          Send
        </button>
      </div>
      {voiceCache && (
        <div style={{
          marginTop: 8, fontSize: 11, color: "var(--text-muted, #888)",
          display: "flex", gap: 8, alignItems: "center",
        }}>
          <span>Voice cache: {voiceCache.mb} MB / {voiceCache.maxMb} MB</span>
          {voiceCache.bytes > 0 && (
            <button
              style={{ background: "none", border: "none", color: ACCENT, cursor: "pointer", fontSize: 11, padding: 0, textDecoration: "underline" }}
              onClick={onClearVoiceCache}
              aria-label="Clear voice cache"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </footer>
  );
}
