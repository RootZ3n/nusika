"use client";

/**
 * MapView — concept-mastery map, exam-readiness gauge, and the companion's
 * journal. Extracted verbatim from page.tsx during the 2026-05-22 refactor.
 *
 * The view is read-only aside from picking a module from the session list
 * when none is selected — the picker re-uses the page's fetchProgress +
 * fetchMemories callbacks so it doesn't duplicate fetch logic.
 */

import {
  ACCENT,
  MASTERY_COLORS,
  MASTERY_LABELS,
  btnGhost,
  cardStyle,
  panelStyle,
  timeAgo,
  type CompanionMemory,
  type NusikaModule,
  type NusikaSession,
  type ModuleProgress,
  type Screen,
} from "../types";

export interface MapViewProps {
  modules: NusikaModule[];
  sessions: NusikaSession[];
  mapModuleId: string | null;
  setMapModuleId: (id: string | null) => void;
  mapCompanionId: string | null;
  setMapCompanionId: (id: string | null) => void;
  moduleProgress: ModuleProgress | null;
  companionMemories: CompanionMemory[];
  fetchProgress: (moduleId: string) => Promise<void>;
  fetchMemories: (companionId: string) => Promise<void>;
  onSetScreen: (s: Screen) => void;
}

export function MapView(props: MapViewProps) {
  const {
    modules, sessions, mapModuleId, setMapModuleId, mapCompanionId, setMapCompanionId,
    moduleProgress, companionMemories, fetchProgress, fetchMemories, onSetScreen,
  } = props;

  const mod = modules.find((m) => m.id === mapModuleId);

  return (
    <div style={{ padding: "20px 16px", maxWidth: 900, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: "24px", fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>
            The Map
          </h1>
          {mod && (
            <p style={{ fontFamily: "var(--font-body)", fontSize: "14px", color: "var(--text-muted)", marginTop: 4 }}>
              {mod.campaign_world} — {mod.name}
            </p>
          )}
        </div>
        <button style={btnGhost} onClick={() => onSetScreen("hall")}>
          Back to Hall
        </button>
      </div>

      {/* Select module if none selected */}
      {!mapModuleId && (
        <div style={panelStyle}>
          <p style={{ fontFamily: "var(--font-body)", fontSize: "14px", color: "var(--text-muted)", marginBottom: 12 }}>
            Select a campaign to view its progress map:
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {(sessions ?? []).map((s) => (
              <button
                key={s.id}
                style={{ ...cardStyle, textAlign: "left" }}
                onClick={() => {
                  setMapModuleId(s.module_id);
                  setMapCompanionId(s.companion_id);
                  void fetchProgress(s.module_id);
                  void fetchMemories(s.companion_id);
                }}
              >
                <div style={{ fontFamily: "var(--font-body)", fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>
                  {s.module_name}
                </div>
                <div style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--text-muted)" }}>
                  with {s.companion_name}
                </div>
              </button>
            ))}
            {sessions.length === 0 && (
              <p style={{ fontFamily: "var(--font-body)", fontSize: "13px", color: "var(--text-muted)" }}>
                No active sessions. Start a campaign first.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Concept Progress */}
      {mapModuleId && (
        <section>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "18px", fontWeight: 700, color: "var(--text-primary)", marginBottom: 12 }}>
            Concept Mastery
          </h2>
          <div style={{ ...panelStyle, display: "flex", flexDirection: "column", gap: 8 }}>
            {moduleProgress && (moduleProgress.concepts ?? []).length > 0 ? (
              (moduleProgress.concepts ?? []).map((c, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "10px 14px",
                  background: "var(--bg-raised)",
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--border)",
                }}>
                  <span style={{ fontFamily: "var(--font-body)", fontSize: "14px", color: "var(--text-primary)" }}>
                    {c.concept}
                  </span>
                  <span style={{
                    fontFamily: "var(--font-mono)", fontSize: "11px",
                    color: MASTERY_COLORS[c.mastery],
                    background: `${MASTERY_COLORS[c.mastery]}18`,
                    padding: "3px 10px",
                    borderRadius: 10,
                    fontWeight: 600,
                  }}>
                    {MASTERY_LABELS[c.mastery]}
                  </span>
                </div>
              ))
            ) : (
              <div style={{ padding: 20, textAlign: "center" }}>
                <p style={{ fontFamily: "var(--font-body)", fontSize: "13px", color: "var(--text-muted)" }}>
                  No concepts tracked yet. Complete some sessions to see your progress.
                </p>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Exam Readiness */}
      {moduleProgress && moduleProgress.exam_readiness !== null && (
        <section>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "18px", fontWeight: 700, color: "var(--text-primary)", marginBottom: 12 }}>
            Exam Readiness
          </h2>
          <div style={panelStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <div style={{
                width: 64, height: 64, borderRadius: "50%",
                border: `3px solid ${moduleProgress.exam_readiness >= 80 ? "#4ade80" : moduleProgress.exam_readiness >= 50 ? "#fbbf24" : "#f87171"}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontFamily: "var(--font-display)", fontSize: "22px", fontWeight: 700,
                color: moduleProgress.exam_readiness >= 80 ? "#4ade80" : moduleProgress.exam_readiness >= 50 ? "#fbbf24" : "#f87171",
              }}>
                {Math.round(moduleProgress.exam_readiness)}%
              </div>
              <div>
                <div style={{ fontFamily: "var(--font-body)", fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>
                  {moduleProgress.exam_readiness >= 80 ? "Ready for certification" : moduleProgress.exam_readiness >= 50 ? "Getting closer" : "Keep studying"}
                </div>
                <div style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--text-muted)" }}>
                  Based on concept mastery across all topics
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Companion's Journal */}
      {mapCompanionId && (
        <section>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "18px", fontWeight: 700, color: "var(--text-primary)", marginBottom: 12 }}>
            Companion&apos;s Journal
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {companionMemories.length > 0 ? (
              (companionMemories ?? []).slice(0, 5).map((mem: CompanionMemory, i: number) => (
                <div key={mem.id || i} style={{
                  ...panelStyle,
                  background: "var(--bg-raised)",
                  borderLeft: `3px solid ${ACCENT}`,
                  fontStyle: "italic",
                }}>
                  <p style={{
                    fontFamily: "var(--font-body)", fontSize: "13px",
                    color: "var(--text-primary)", lineHeight: 1.6,
                    letterSpacing: "0.02em",
                  }}>
                    &ldquo;{mem.text}&rdquo;
                  </p>
                  <span style={{
                    fontFamily: "var(--font-mono)", fontSize: "10px",
                    color: "var(--text-muted)", marginTop: 6, display: "block",
                  }}>
                    {timeAgo(mem.created_at)}
                  </span>
                </div>
              ))
            ) : (
              <div style={{ ...panelStyle, textAlign: "center", padding: 20 }}>
                <p style={{ fontFamily: "var(--font-body)", fontSize: "13px", color: "var(--text-muted)" }}>
                  Your companion has not written any journal entries yet.
                </p>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
