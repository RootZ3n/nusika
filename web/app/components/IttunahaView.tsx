"use client";

/**
 * IttunahaView — the gathering place: narrator greeting, streak chip, Active
 * Adventures list, "Start Adventure" CTA + new-campaign modal, and the
 * Module Library preview row.
 *
 * Ittunaha is Nusika's meeting place — the common fire where learners
 * gather before venturing into sessions, tales, and adventures.
 */

import Link from "next/link";
import {
  ACCENT,
  ACCENT_DIM,
  DURATION_OPTIONS,
  LANGUAGE_MODULE_IDS,
  TEACHING_MODES,
  btnGhost,
  btnPrimary,
  cardStyle,
  companionColor,
  companionInitial,
  panelStyle,
  pillStyle,
  type NusikaModule,
  type NusikaSession,
  type NarratorIdentity,
  type Screen,
} from "../types";

export interface IttunahaViewProps {
  recapStatus: string | null;
  narrator: NarratorIdentity;
  useDyslexicFont: boolean;
  wideLetterSpacing: boolean;
  streak: number;
  activeSessions: NusikaSession[];
  campaignModules: NusikaModule[];
  modules: NusikaModule[];
  loading: boolean;
  onStartSession: (sessionId: string) => void;
  onSetScreen: (s: Screen) => void;
  onStartPractice: (moduleId: string) => void;
  onStopSession: (sessionId: string) => void;

  showNewCampaign: boolean;
  setShowNewCampaign: (v: boolean) => void;
  selectedModuleId: string | null;
  setSelectedModuleId: (id: string | null) => void;
  selectedCompanionId: string | null;
  setSelectedCompanionId: (id: string | null) => void;
  selectedDuration: number;
  setSelectedDuration: (d: number) => void;
  selectedMode: string;
  setSelectedMode: (m: string) => void;
  onCreateCampaign: () => void;
}

export function IttunahaView(props: IttunahaViewProps) {
  const {
    recapStatus, narrator, useDyslexicFont, wideLetterSpacing, streak,
    activeSessions, campaignModules, modules, loading,
    onStartSession, onSetScreen, onStartPractice, onStopSession,
    showNewCampaign, setShowNewCampaign,
    selectedModuleId, setSelectedModuleId,
    selectedCompanionId, setSelectedCompanionId,
    selectedDuration, setSelectedDuration,
    selectedMode, setSelectedMode, onCreateCampaign,
  } = props;

  return (
    <div style={{ padding: "20px 16px", maxWidth: 1200, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>
      {recapStatus && (
        <div style={{
          padding: "10px 14px", borderRadius: 10,
          background: "rgba(167,139,250,0.06)", border: "1px solid rgba(167,139,250,0.18)",
          fontFamily: "var(--font-body)", fontSize: 14, color: "var(--text-secondary)",
        }}>
          {recapStatus}
        </div>
      )}
      {/* Welcome + Streak */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: "24px", fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>
            Ittunaha
          </h1>
          {/* Product narrator greeting (Peh by default) */}
          <div style={{
            display: "flex", alignItems: "flex-start", gap: 10, marginTop: 10,
            padding: "12px 16px", borderRadius: 12,
            background: "rgba(167,139,250,0.06)", border: "1px solid rgba(167,139,250,0.12)",
          }}>
            <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#a78bfa", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 700, color: "#060810", flexShrink: 0 }}>
              {narrator.name.charAt(0)}
            </div>
            <div style={{
              fontFamily: useDyslexicFont ? "'OpenDyslexic', var(--font-body)" : "var(--font-body)",
              fontSize: "15px", color: "var(--text-secondary)", lineHeight: 1.8,
              letterSpacing: wideLetterSpacing ? "0.08em" : undefined,
            }}>
              {activeSessions.length > 0 ? narrator.greeting_active : narrator.greeting_idle}
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                <Link href="/teach" style={{ color: ACCENT, textDecoration: "underline", textDecorationColor: "rgba(167,139,250,0.5)" }}>
                  Ask {narrator.name} to teach you anything
                </Link>
                <Link href="/dm" style={{ color: ACCENT, textDecoration: "underline", textDecorationColor: "rgba(167,139,250,0.5)" }}>
                  Play a campaign with {narrator.name} as DM
                </Link>
                <Link href="/chahta-anumpa" style={{ color: "#f59e0b", textDecoration: "underline", textDecorationColor: "rgba(245,158,11,0.5)" }}>
                  Practice Chahta Anumpa (Choctaw)
                </Link>
              </div>
            </div>
          </div>
        </div>
        <div style={{
          ...panelStyle,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 18px",
        }}>
          <span style={{ fontSize: "22px" }}>&#128293;</span>
          <div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: "20px", fontWeight: 700, color: ACCENT }}>
              {streak}
            </div>
            <div style={{ fontFamily: "var(--font-body)", fontSize: "11px", color: "var(--text-muted)" }}>
              day streak
            </div>
          </div>
        </div>
      </div>

      {/* Active Adventures */}
      {activeSessions.length > 0 && (
        <section>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "18px", fontWeight: 700, color: "var(--text-primary)", marginBottom: 12 }}>
            Active Adventures
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
            {(activeSessions ?? []).map((s) => (
              <div
                key={s.id}
                style={cardStyle}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = ACCENT;
                  e.currentTarget.style.background = "var(--bg-raised)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "var(--border)";
                  e.currentTarget.style.background = "var(--bg-surface)";
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <div>
                    <div style={{ fontFamily: "var(--font-body)", fontSize: "15px", fontWeight: 600, color: "var(--text-primary)" }}>
                      {s.module_name}
                    </div>
                    <div style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--text-muted)", marginTop: 2 }}>
                      with {s.companion_name}
                    </div>
                  </div>
                  <span style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "11px",
                    color: s.status === "active" ? "#4ade80" : "#fbbf24",
                    background: s.status === "active" ? "rgba(74,222,128,0.1)" : "rgba(251,191,36,0.1)",
                    padding: "2px 8px",
                    borderRadius: 10,
                  }}>
                    {s.status}
                  </span>
                </div>
                {s.last_summary && (
                  <p style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--text-muted)", marginBottom: 10, lineHeight: 1.5 }}>
                    {(s.last_summary ?? "").length > 120 ? (s.last_summary ?? "").slice(0, 120) + "..." : (s.last_summary ?? "No summary")}
                  </p>
                )}
                {/* Progress bar */}
                <div style={{ background: "var(--bg-void)", borderRadius: 6, height: 6, marginBottom: 10, overflow: "hidden" }}>
                  <div style={{
                    width: `${Math.min(100, Math.max(0, s.progress))}%`,
                    height: "100%",
                    background: `linear-gradient(90deg, ${ACCENT}, #4df5c8)`,
                    borderRadius: 6,
                    transition: "width 0.3s",
                  }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-muted)" }}>
                    {Math.round(s.progress)}% complete
                  </span>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      style={{ ...btnGhost, padding: "6px 10px", fontSize: "11px", color: "var(--text-muted)" }}
                      onClick={(e) => { e.stopPropagation(); onStopSession(s.id); }}
                      title="Stop and remove this campaign"
                    >
                      × Stop
                    </button>
                    <button
                      style={btnPrimary}
                      onClick={(e) => { e.stopPropagation(); onStartSession(s.id); }}
                      onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.85"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
                    >
                      Continue
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* New Campaign Button */}
      <div style={{ display: "flex", gap: 12 }}>
        <button
          style={btnPrimary}
          onClick={() => setShowNewCampaign(true)}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.85"; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
        >
          Start Adventure
        </button>
      </div>

      {/* New Campaign Modal */}
      {showNewCampaign && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 100,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
        }} onClick={() => setShowNewCampaign(false)}>
          <div style={{ ...panelStyle, maxWidth: 520, width: "100%", padding: 24, maxHeight: "80vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: "20px", fontWeight: 700, color: "var(--text-primary)", marginBottom: 16 }}>
              Start Adventure
            </h2>

            {/* Module Selection */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontFamily: "var(--font-body)", fontSize: "13px", color: "var(--text-muted)", display: "block", marginBottom: 6 }}>
                Choose a Module
              </label>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {(modules ?? []).filter((m) => m.installed).map((m) => (
                  <button
                    key={m.id}
                    style={{
                      ...cardStyle,
                      padding: "10px 14px",
                      borderColor: selectedModuleId === m.id ? ACCENT : "var(--border)",
                      background: selectedModuleId === m.id ? ACCENT_DIM : "var(--bg-surface)",
                      textAlign: "left",
                    }}
                    onClick={() => {
                      setSelectedModuleId(m.id);
                      setSelectedCompanionId((m.companions ?? []).length > 0 ? (m.companions ?? [])[0].id : null);
                    }}
                  >
                    <div style={{ fontFamily: "var(--font-body)", fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>
                      {m.campaign_world}
                    </div>
                    <div style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--text-muted)" }}>
                      {m.name} — {m.subject}
                    </div>
                  </button>
                ))}
                {(modules ?? []).filter((m) => m.installed).length === 0 && (
                  <p style={{ fontFamily: "var(--font-body)", fontSize: "13px", color: "var(--text-muted)" }}>
                    No modules installed. Visit The Library to install one.
                  </p>
                )}
              </div>
            </div>

            {/* Companion Selection */}
            {selectedModuleId && (() => {
              const mod = modules.find((m) => m.id === selectedModuleId);
              if (!mod || (mod.companions ?? []).length === 0) return null;
              return (
                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontFamily: "var(--font-body)", fontSize: "13px", color: "var(--text-muted)", display: "block", marginBottom: 6 }}>
                    Choose Companion
                  </label>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {(mod.companions ?? []).map((c) => (
                      <button
                        key={c.id}
                        style={{
                          ...pillStyle(selectedCompanionId === c.id),
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                        onClick={() => setSelectedCompanionId(c.id)}
                      >
                        <span style={{
                          width: 24, height: 24, borderRadius: "50%", background: companionColor(c.name),
                          display: "inline-flex", alignItems: "center", justifyContent: "center",
                          fontSize: "12px", fontWeight: 700, color: "#060810",
                        }}>
                          {companionInitial(c.name)}
                        </span>
                        {c.name}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Duration */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontFamily: "var(--font-body)", fontSize: "13px", color: "var(--text-muted)", display: "block", marginBottom: 6 }}>
                Duration
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                {DURATION_OPTIONS.map((d) => (
                  <button key={d} style={pillStyle(selectedDuration === d)} onClick={() => setSelectedDuration(d)}>
                    {d} min
                  </button>
                ))}
              </div>
            </div>

            {/* Teaching Mode */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontFamily: "var(--font-body)", fontSize: "13px", color: "var(--text-muted)", display: "block", marginBottom: 6 }}>
                Teaching Mode
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                {TEACHING_MODES.map((tm) => (
                  <button key={tm.key} style={pillStyle(selectedMode === tm.key)} onClick={() => setSelectedMode(tm.key)}>
                    {tm.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button style={btnGhost} onClick={() => setShowNewCampaign(false)}>Cancel</button>
              <button
                style={{ ...btnPrimary, opacity: (!selectedModuleId || !selectedCompanionId) ? 0.4 : 1 }}
                disabled={!selectedModuleId || !selectedCompanionId}
                onClick={onCreateCampaign}
              >
                Begin Campaign
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Module Library Preview */}
      <section>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "18px", fontWeight: 700, color: "var(--text-primary)" }}>
            Module Library
          </h2>
          <button
            style={{ ...btnGhost, fontSize: "12px" }}
            onClick={() => onSetScreen("advanced")}
          >
            View All
          </button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
          {campaignModules.slice(0, 6).map((m) => (
            <div
              key={m.id}
              style={{
                ...cardStyle,
                background: "linear-gradient(160deg, var(--bg-surface) 0%, var(--bg-raised) 100%)",
                borderLeft: `3px solid ${ACCENT}`,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = ACCENT; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.borderLeftColor = ACCENT; }}
            >
              <div style={{ fontFamily: "var(--font-display)", fontSize: "15px", fontWeight: 700, color: ACCENT, marginBottom: 2 }}>
                {m.campaign_world}
              </div>
              <div style={{ fontFamily: "var(--font-body)", fontSize: "14px", fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>
                {m.name}
              </div>
              <div style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--text-muted)", marginBottom: 6 }}>
                {m.subject}
              </div>
              <div style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--text-muted)", marginBottom: 8, lineHeight: 1.5 }}>
                {(m.summary ?? "").length > 100 ? (m.summary ?? "").slice(0, 100) + "..." : (m.summary ?? "")}
              </div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
                {(m.companions ?? []).map((c) => (
                  <span key={c.id} style={{
                    fontFamily: "var(--font-mono)", fontSize: 14, color: "var(--text-muted)",
                    background: "var(--bg-void)", padding: "2px 8px", borderRadius: 10,
                  }}>
                    {c.name}
                  </span>
                ))}
                {LANGUAGE_MODULE_IDS.includes(m.id as typeof LANGUAGE_MODULE_IDS[number]) && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onStartPractice(m.id); }}
                    style={{ ...btnGhost, fontSize: 14, padding: "2px 8px", marginLeft: "auto" }}
                  >Practice</button>
                )}
              </div>
            </div>
          ))}
        </div>
        {modules.length === 0 && !loading && (
          <div style={{ ...panelStyle, textAlign: "center", padding: 32, color: "var(--text-muted)", fontSize: "14px" }}>
            No modules available yet. Check back soon.
          </div>
        )}
      </section>
    </div>
  );
}
