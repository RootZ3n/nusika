"use client";

/**
 * CampaignSidebar — left rail: heading, "← Hall" link, blurb, new-campaign
 * form, and the campaigns list with active highlighting. Extracted from
 * page.tsx on 2026-05-22.
 */

import Link from "next/link";
import { useState } from "react";
import {
  ACCENT, ACCENT_DIM,
  btnGhost, btnPrimary, input, sidebar,
  type Campaign,
} from "../types";

export interface CampaignSidebarProps {
  campaigns: Campaign[];
  activeId: string | null;
  setActiveId: (id: string) => void;
  onCreateCampaign: (title: string, blurb: string) => Promise<Campaign | null>;
}

export function CampaignSidebar(props: CampaignSidebarProps) {
  const { campaigns, activeId, setActiveId, onCreateCampaign } = props;
  const [newTitle, setNewTitle] = useState("");
  const [newBlurb, setNewBlurb] = useState("");

  async function create() {
    const c = await onCreateCampaign(newTitle.trim(), newBlurb);
    if (c) {
      setNewTitle("");
      setNewBlurb("");
    }
  }

  return (
    <aside style={sidebar}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Dungeon Master</h1>
        <Link href="/" style={{ fontSize: 12, color: ACCENT, marginLeft: "auto", textDecoration: "none" }}>← Hall</Link>
      </div>
      <p style={{ fontSize: 12, color: "var(--text-muted, #888)", margin: 0, lineHeight: 1.5 }}>
        A solo fantasy campaign with Varros as DM. The engine owns the rules; Varros narrates.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void create(); }}
          placeholder="New campaign title"
          style={input}
        />
        <input
          value={newBlurb}
          onChange={(e) => setNewBlurb(e.target.value)}
          placeholder="Setting blurb (optional)"
          style={input}
        />
        <button style={btnPrimary} onClick={() => void create()}>Create campaign</button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
        {campaigns.length === 0 && (
          <div style={{ fontSize: 13, color: "var(--text-muted, #888)", padding: 8 }}>
            No campaigns yet.
          </div>
        )}
        {campaigns.map((c) => {
          const isActive = c.id === activeId;
          return (
            <button
              key={c.id}
              onClick={() => setActiveId(c.id)}
              style={{
                ...btnGhost,
                textAlign: "left",
                background: isActive ? ACCENT_DIM : "transparent",
                borderColor: isActive ? ACCENT : "var(--border, rgba(255,255,255,0.12))",
                color: isActive ? ACCENT : "var(--text-secondary, #b8b6c3)",
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {c.title}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted, #888)" }}>
                {c.status} · {new Date(c.updated_at).toLocaleDateString()}
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
