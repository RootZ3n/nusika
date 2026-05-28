"use client";

/**
 * LessonSidebar — left rail: heading, "← Ittunaha" link, blurb, new-lesson
 * form, and the lessons list with per-row delete. Extracted from
 * teach/page.tsx on 2026-05-22.
 */

import Link from "next/link";
import { useState } from "react";
import {
  ACCENT, ACCENT_DIM,
  btnGhost, btnPrimary, sidebar,
  type Lesson,
} from "../types";

export interface LessonSidebarProps {
  lessons: Lesson[];
  activeId: string | null;
  setActiveId: (id: string) => void;
  onCreateLesson: (title: string) => Promise<Lesson | null>;
  onDeleteLesson: (lessonId: string, lessonTitle: string) => Promise<void>;
}

export function LessonSidebar(props: LessonSidebarProps) {
  const { lessons, activeId, setActiveId, onCreateLesson, onDeleteLesson } = props;
  const [newTitle, setNewTitle] = useState("");

  async function create() {
    const l = await onCreateLesson(newTitle);
    if (l) setNewTitle("");
  }

  return (
    <aside style={sidebar}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Teach Me Anything</h1>
        <Link href="/" style={{ fontSize: 12, color: ACCENT, marginLeft: "auto", textDecoration: "none" }}>← Ittunaha</Link>
      </div>
      <p style={{ fontSize: 12, color: "var(--text-muted, #888)", margin: 0, lineHeight: 1.5 }}>
        Open-ended lessons with Peh. Pick a topic and start.
      </p>

      <div style={{ display: "flex", gap: 6 }}>
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void create(); }}
          placeholder="Lesson title (e.g. compound interest)"
          style={{
            flex: 1, padding: "8px 10px", borderRadius: 8,
            border: "1px solid var(--border, rgba(255,255,255,0.12))",
            background: "rgba(255,255,255,0.03)", color: "inherit",
            fontFamily: "inherit", fontSize: 13,
          }}
        />
        <button style={btnPrimary} onClick={() => void create()}>Start</button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
        {lessons.length === 0 && (
          <div style={{ fontSize: 13, color: "var(--text-muted, #888)", padding: 8 }}>
            No lessons yet.
          </div>
        )}
        {lessons.map((l) => (
          <div key={l.id} style={{ display: "flex", gap: 4, alignItems: "stretch" }}>
            <button
              onClick={() => setActiveId(l.id)}
              style={{
                ...btnGhost,
                flex: 1, minWidth: 0,
                textAlign: "left",
                background: activeId === l.id ? ACCENT_DIM : "transparent",
                borderColor: activeId === l.id ? ACCENT : "var(--border, rgba(255,255,255,0.12))",
                color: activeId === l.id ? ACCENT : "var(--text-secondary, #b8b6c3)",
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {l.title}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted, #888)" }}>
                {l.depth} · {l.turn_count} turn{l.turn_count === 1 ? "" : "s"} · {l.status}
              </div>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); void onDeleteLesson(l.id, l.title); }}
              aria-label="Delete lesson"
              title="Delete lesson"
              style={{ ...btnGhost, flex: "0 0 28px", padding: "0 8px", color: "var(--text-muted, #888)", fontSize: 14 }}
            >✕</button>
          </div>
        ))}
      </div>
    </aside>
  );
}
