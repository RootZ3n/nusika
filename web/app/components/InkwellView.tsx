"use client";

/**
 * InkwellView — three-pane writing workshop: drafts list (left), editor
 * (center), Peh's feedback (right). Extracted verbatim from page.tsx
 * during the 2026-05-22 refactor.
 *
 * Drafts persistence + Peh feedback go through the parent's
 * useNusikaApi hook so the component itself stays display-focused. UI-
 * local state (current title/text/feedback/save-message) lives here
 * because nothing outside this view consumes it.
 */

import { useEffect, useState } from "react";
import type { InkwellDraft } from "../types";

const INKWELL_ACCENT = "#a78bfa";

export interface InkwellViewProps {
  drafts: InkwellDraft[];
  fetchDrafts: () => Promise<void>;
  saveDraft: (input: { title: string; content: string; feedback?: string }) => Promise<boolean>;
  deleteDraft: (draftId: string) => Promise<boolean>;
  requestFeedback: (input: { content: string; title?: string }) => Promise<{ ok: boolean; feedback?: string; error?: string }>;
}

export function InkwellView(props: InkwellViewProps) {
  const { drafts, fetchDrafts, saveDraft, deleteDraft, requestFeedback } = props;

  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [feedback, setFeedback] = useState("");
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // Refresh drafts whenever the view mounts — matches the original
  // `useEffect(...,[screen])` that re-fetched on entry to the Inkwell.
  useEffect(() => {
    void fetchDrafts();
  }, [fetchDrafts]);

  const mono: React.CSSProperties = { fontFamily: "var(--font-mono)", fontSize: 14 };

  async function shareWithPeh() {
    if (!text.trim() || feedbackLoading) return;
    setFeedbackLoading(true);
    setFeedback("");
    const result = await requestFeedback({
      content: text,
      ...(title.trim() ? { title: title.trim() } : {}),
    });
    if (result.ok && typeof result.feedback === "string") {
      setFeedback(result.feedback);
    } else {
      setFeedback(`Peh is unavailable right now: ${result.error ?? "unknown error"}`);
    }
    setFeedbackLoading(false);
  }

  async function handleSaveDraft() {
    if (!text.trim()) return;
    const derivedTitle = title.trim() || text.split("\n")[0]?.slice(0, 60) || "Untitled Draft";
    const ok = await saveDraft({
      title: derivedTitle,
      content: text,
      ...(feedback ? { feedback } : {}),
    });
    if (ok) {
      setSaveMsg(`Saved: ${derivedTitle}`);
    } else {
      setSaveMsg("Save failed");
    }
    setTimeout(() => setSaveMsg(null), 3000);
  }

  async function handleDeleteDraft(draftId: string, draftTitle: string) {
    if (!confirm(`Delete draft "${draftTitle}"? This cannot be undone.`)) return;
    const ok = await deleteDraft(draftId);
    if (ok) {
      // If the deleted draft is the one currently in the editor, clear it.
      const currentlyEditing = drafts.find(
        (d) => d.id === draftId && d.content === text && d.title === title,
      );
      if (currentlyEditing) {
        setText("");
        setTitle("");
        setFeedback("");
      }
      setSaveMsg(`Deleted: ${draftTitle}`);
    } else {
      setSaveMsg("Delete failed");
    }
    setTimeout(() => setSaveMsg(null), 3000);
  }

  return (
    <div style={{ display: "flex", height: "100%", minHeight: 0, overflow: "hidden" }}>
      {/* ── Left: Drafts ─────────────────────────────────────────────── */}
      <div style={{ width: 220, flexShrink: 0, borderRight: "1px solid var(--border)", overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ ...mono, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 4 }}>Drafts</div>
        <button
          onClick={() => { setText(""); setTitle(""); setFeedback(""); }}
          style={{ ...mono, padding: "6px 10px", borderRadius: 6, border: `1px solid ${INKWELL_ACCENT}30`, background: `${INKWELL_ACCENT}10`, color: INKWELL_ACCENT, cursor: "pointer", fontWeight: 700, textAlign: "left" }}
        >+ New Draft</button>
        {drafts.map((d) => (
          <div key={d.id} style={{ display: "flex", gap: 4, alignItems: "stretch" }}>
            <button
              onClick={() => { setText(d.content); setTitle(d.title); setFeedback(d.feedback ?? ""); }}
              style={{ ...mono, flex: 1, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "rgba(17,21,40,0.5)", color: "var(--text-primary)", cursor: "pointer", textAlign: "left", minWidth: 0 }}
            >
              <div style={{ fontWeight: 600, marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.title}</div>
              <div style={{ color: "var(--text-muted)", fontSize: 14 }}>{d.createdAt ? new Date(d.createdAt).toLocaleDateString() : ""}</div>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); void handleDeleteDraft(d.id, d.title); }}
              aria-label="Delete draft"
              title="Delete draft"
              style={{ ...mono, flex: "0 0 28px", padding: "0 8px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: 14 }}
            >✕</button>
          </div>
        ))}
        {drafts.length === 0 && (
          <div style={{ ...mono, color: "var(--text-muted)", padding: 8 }}>No drafts yet. Start writing.</div>
        )}
      </div>

      {/* ── Center: Writing Area ─────────────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, padding: "16px 20px" }}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title (optional — auto-generated from first line)"
          style={{ background: "none", border: "none", outline: "none", fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 700, color: "var(--text-primary)", marginBottom: 12, padding: "4px 0", borderBottom: "1px solid var(--border)" }}
        />
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Write here. When you're ready for feedback, share with Peh."
          style={{
            flex: 1, background: "none", border: "none", outline: "none", resize: "none",
            fontFamily: "var(--font-body)", fontSize: 15, lineHeight: 1.8,
            color: "var(--text-primary)", padding: 0,
          }}
        />
        <div style={{ display: "flex", gap: 8, paddingTop: 12, borderTop: "1px solid var(--border)", flexShrink: 0 }}>
          <button
            onClick={() => void shareWithPeh()}
            disabled={!text.trim() || feedbackLoading}
            style={{
              padding: "9px 16px", borderRadius: 8, border: "none",
              background: text.trim() ? `linear-gradient(135deg, ${INKWELL_ACCENT}, #f472b6)` : "var(--bg-raised)",
              color: text.trim() ? "#060810" : "var(--text-muted)",
              fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 700,
              cursor: text.trim() ? "pointer" : "default",
            }}
          >{feedbackLoading ? "Peh is reading..." : "Share with Peh"}</button>
          <button
            onClick={() => void handleSaveDraft()}
            disabled={!text.trim()}
            style={{
              padding: "9px 16px", borderRadius: 8,
              border: `1px solid ${INKWELL_ACCENT}30`,
              background: `${INKWELL_ACCENT}08`,
              color: text.trim() ? INKWELL_ACCENT : "var(--text-muted)",
              fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 700,
              cursor: text.trim() ? "pointer" : "default",
            }}
          >Save Draft</button>
          {saveMsg && (
            <span style={{ ...mono, color: saveMsg.startsWith("Saved") ? "#4ade80" : "#f87171", alignSelf: "center" }}>{saveMsg}</span>
          )}
          <span style={{ ...mono, color: "var(--text-muted)", marginLeft: "auto", alignSelf: "center" }}>
            {text.length > 0 ? `${text.split(/\s+/).filter(Boolean).length} words` : ""}
          </span>
        </div>
      </div>

      {/* ── Right: Peh's Feedback ────────────────────────────────────── */}
      <div style={{ width: 320, flexShrink: 0, borderLeft: "1px solid var(--border)", overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 28, height: 28, borderRadius: "50%", background: INKWELL_ACCENT, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 700, color: "#060810" }}>P</div>
          <div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 700, color: INKWELL_ACCENT }}>Peh</div>
            <div style={{ ...mono, color: "var(--text-muted)" }}>Senior Editor</div>
          </div>
        </div>
        {feedbackLoading && (
          <div style={{ fontFamily: "var(--font-body)", fontSize: 14, color: "var(--text-muted)", fontStyle: "italic", lineHeight: 1.6 }}>
            Reading your draft carefully...
          </div>
        )}
        {!feedbackLoading && feedback && (
          <div style={{
            fontFamily: "var(--font-body)", fontSize: 14, color: "var(--text-secondary)",
            lineHeight: 1.8, whiteSpace: "pre-wrap",
            padding: "14px 16px", borderRadius: 10,
            background: `${INKWELL_ACCENT}08`, border: `1px solid ${INKWELL_ACCENT}15`,
          }}>
            {feedback}
          </div>
        )}
        {!feedbackLoading && !feedback && (
          <div style={{ fontFamily: "var(--font-body)", fontSize: 14, color: "var(--text-muted)", lineHeight: 1.6, fontStyle: "italic" }}>
            Write something and share it with me. I&apos;ll read every word.
          </div>
        )}
      </div>
    </div>
  );
}
