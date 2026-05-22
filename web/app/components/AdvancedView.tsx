"use client";

/**
 * AdvancedView — "Advanced Studies" library shelf for lab-only / advanced
 * tier modules (CompTIA, prompt engineering, etc.).
 *
 * Extracted verbatim from page.tsx during the 2026-05-22 refactor. The
 * "Start Campaign" action pre-fills the new-campaign modal owned by the
 * page and bounces the user to the Hall screen, matching the original
 * inline behavior.
 */

import {
  ACCENT,
  btnPrimary,
  btnSecondary,
  companionColor,
  companionInitial,
  panelStyle,
  type MagisterModule,
  type Screen,
} from "../types";

export interface AdvancedViewProps {
  modules: MagisterModule[];
  advancedModules: MagisterModule[];
  loading: boolean;
  onInstallModule: (moduleId: string) => void;
  onStartCampaign: (moduleId: string, companionId: string | null) => void;
  onSetScreen: (s: Screen) => void;
}

export function AdvancedView(props: AdvancedViewProps) {
  const { advancedModules, loading, onInstallModule, onStartCampaign } = props;

  // Group into shelves-of-3 (visual rows). Same chunking the inline original
  // did — re-computed here from the already-filtered list.
  const advShelves: MagisterModule[][] = [];
  for (let i = 0; i < advancedModules.length; i += 3) advShelves.push(advancedModules.slice(i, i + 3));

  return (
    <div style={{ padding: "20px 16px", maxWidth: 1200, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: "24px", fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>
        Advanced Studies
      </h1>
      <p style={{ fontFamily: "var(--font-body)", fontSize: "14px", color: "var(--text-muted)", margin: 0, lineHeight: 1.6 }}>
        Lab-only campaigns for Jeff&apos;s professional development. CompTIA certifications, prompt engineering, and specialized technical training.
      </p>

      {/* Shelves — advanced modules only */}
      {advShelves.length > 0 ? (
        advShelves.map((shelf, si) => (
          <div key={si} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: 12,
            }}>
              {(shelf ?? []).map((m) => (
                <div
                  key={m.id}
                  style={{
                    ...panelStyle,
                    background: "linear-gradient(170deg, var(--bg-surface) 0%, var(--bg-raised) 100%)",
                    borderLeft: `3px solid ${ACCENT}`,
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontFamily: "var(--font-display)", fontSize: "15px", fontWeight: 700, color: ACCENT }}>
                        {m.campaign_world}
                      </div>
                      <div style={{ fontFamily: "var(--font-body)", fontSize: "14px", fontWeight: 600, color: "var(--text-primary)", marginTop: 2 }}>
                        {m.name}
                      </div>
                    </div>
                    <span style={{
                      fontFamily: "var(--font-mono)", fontSize: "10px",
                      color: m.age_track === "adult" ? "#60a5fa" : m.age_track === "teen" ? "#fbbf24" : "#4ade80",
                      background: m.age_track === "adult" ? "rgba(96,165,250,0.1)" : m.age_track === "teen" ? "rgba(251,191,36,0.1)" : "rgba(74,222,128,0.1)",
                      padding: "2px 8px",
                      borderRadius: 10,
                    }}>
                      {m.age_track}
                    </span>
                  </div>

                  <div style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--text-muted)" }}>
                    {m.subject}
                  </div>

                  <div style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--text-muted)", lineHeight: 1.5 }}>
                    {(m.summary ?? "").length > 140 ? (m.summary ?? "").slice(0, 140) + "..." : (m.summary ?? "")}
                  </div>

                  {/* Companions */}
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {(m.companions ?? []).map((c) => (
                      <span key={c.id} style={{
                        display: "inline-flex", alignItems: "center", gap: 4,
                        fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-muted)",
                        background: "var(--bg-void)", padding: "2px 8px", borderRadius: 10,
                      }}>
                        <span style={{
                          width: 14, height: 14, borderRadius: "50%",
                          background: companionColor(c.name),
                          display: "inline-flex", alignItems: "center", justifyContent: "center",
                          fontSize: "8px", fontWeight: 700, color: "#060810",
                        }}>
                          {companionInitial(c.name)}
                        </span>
                        {c.name}
                      </span>
                    ))}
                  </div>

                  {/* Status + Actions */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "auto", paddingTop: 8 }}>
                    <span style={{
                      fontFamily: "var(--font-mono)", fontSize: "11px",
                      color: m.installed ? "#4ade80" : "var(--text-muted)",
                    }}>
                      {m.installed ? "Installed" : "Available"}
                    </span>
                    <div style={{ display: "flex", gap: 6 }}>
                      {!m.installed && (
                        <button
                          style={{ ...btnSecondary, padding: "6px 14px", fontSize: "12px" }}
                          onClick={() => onInstallModule(m.id)}
                        >
                          Install
                        </button>
                      )}
                      {m.installed && (
                        <button
                          style={{ ...btnPrimary, padding: "6px 14px", fontSize: "12px" }}
                          onClick={() => {
                            const firstCompanion = (m.companions ?? []).length > 0 ? (m.companions ?? [])[0].id : null;
                            onStartCampaign(m.id, firstCompanion);
                          }}
                        >
                          Start Campaign
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Shelf edge */}
            <div style={{
              height: 4,
              background: "linear-gradient(90deg, transparent, var(--border-lit), transparent)",
              borderRadius: 2,
            }} />
          </div>
        ))
      ) : (
        <div style={{ ...panelStyle, textAlign: "center", padding: 40, color: "var(--text-muted)", fontSize: "14px" }}>
          {loading ? "Loading modules..." : "No modules found in this category."}
        </div>
      )}
    </div>
  );
}
