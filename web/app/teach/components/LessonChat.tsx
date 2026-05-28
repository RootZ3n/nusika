"use client";

/**
 * LessonChat — scrolling turn list with assistant markdown + receipt line,
 * the "Peh is thinking…" affordance, and the error banner. Extracted
 * from teach/page.tsx on 2026-05-22.
 */

import { MarkdownMessage } from "../../components/MarkdownMessage";
import { ACCENT, ACCENT_DIM, type Lesson, type Turn } from "../types";

export interface LessonChatProps {
  active: Lesson;
  turns: Turn[];
  sending: boolean;
  error: string | null;
}

export function LessonChat({ active, turns, sending, error }: LessonChatProps) {
  return (
    <section style={{ flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
      {turns.length === 0 && (
        <div style={{ color: "var(--text-muted, #888)", fontStyle: "italic", fontSize: 14 }}>
          Ask Peh anything about <strong>{active.title}</strong>.
        </div>
      )}
      {turns.map((t) => (
        <div key={t.id} style={{
          alignSelf: t.role === "user" ? "flex-end" : "flex-start",
          maxWidth: "75%",
          background: t.role === "user" ? "rgba(255,255,255,0.04)" : ACCENT_DIM,
          border: `1px solid ${t.role === "user" ? "var(--border, rgba(255,255,255,0.10))" : ACCENT + "33"}`,
          borderRadius: 12, padding: "10px 14px", fontSize: 15, lineHeight: 1.7,
        }}>
          {t.role === "assistant"
            ? <MarkdownMessage content={t.content} />
            : <span style={{ whiteSpace: "pre-wrap" }}>{t.content}</span>}
          {t.role === "assistant" && (t.model || t.tokens_in != null) && (
            <div style={{ fontSize: 11, color: "var(--text-muted, #888)", marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
              {t.model && <span style={{ color: ACCENT }}>{t.model.split("/").pop()}</span>}
              {t.tokens_in != null && <span>· {t.tokens_in}↑ {t.tokens_out}↓</span>}
              {t.depth_at && <span>· {t.depth_at}</span>}
            </div>
          )}
        </div>
      ))}
      {sending && (
        <div style={{ color: ACCENT, fontStyle: "italic", fontSize: 14 }}>Peh is thinking…</div>
      )}
      {error && (
        <div style={{
          alignSelf: "stretch", padding: "8px 12px", borderRadius: 8,
          background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.3)",
          color: "#fca5a5", fontSize: 13,
        }}>
          {error}
        </div>
      )}
    </section>
  );
}
