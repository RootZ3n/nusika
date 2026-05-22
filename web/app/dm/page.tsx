"use client";

/**
 * Dungeon Master mode — orchestration shell.
 *
 * The original 1,206-line monolith lives across:
 *   - dm/types.ts                         types + constants + styles
 *   - dm/hooks/useDmApi.ts                campaign/character/event API
 *   - dm/hooks/useDmVoice.ts              voice picker + cache
 *   - dm/components/CampaignSidebar.tsx   left rail
 *   - dm/components/CampaignHeader.tsx    title + voice picker + archive
 *   - dm/components/CharacterPanel.tsx    create form + sheet
 *   - dm/components/EventLog.tsx          event list + EventView
 *   - dm/components/ActionBar.tsx         dice + turn + rest + narrate
 *
 * Architecture invariant carried over from the server: the deterministic
 * engine OWNS state. This UI never edits HP, conditions, hit dice, or
 * inventory directly — every mutation goes through a /turn or /rest
 * intent the server can verify.
 */

import { CampaignSidebar } from "./components/CampaignSidebar";
import { CampaignHeader } from "./components/CampaignHeader";
import { CharacterPanel } from "./components/CharacterPanel";
import { EventLog } from "./components/EventLog";
import { ActionBar } from "./components/ActionBar";
import { useDmApi } from "./hooks/useDmApi";
import { useDmVoice } from "./hooks/useDmVoice";
import { main, shell } from "./types";

export default function DmPage() {
  const api = useDmApi();
  const voice = useDmVoice();

  // Hook the voice-cache "clear" status into the page's action-status
  // toast so the message style matches every other mutation.
  function clearVoiceCache() {
    void voice.clearVoiceCache((msg) => {
      api.setActionStatus(msg);
      setTimeout(() => api.setActionStatus(null), 2500);
    });
  }

  return (
    <div style={shell}>
      <CampaignSidebar
        campaigns={api.campaigns}
        activeId={api.activeId}
        setActiveId={api.setActiveId}
        onCreateCampaign={api.createCampaign}
      />

      <main style={main}>
        {!api.activeId && (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted, #888)", padding: 32, textAlign: "center" }}>
            Pick a campaign on the left, or start a new one.
          </div>
        )}

        {api.activeId && (
          <>
            <CampaignHeader
              campaign={api.campaign}
              voices={voice.voices}
              selectedVoiceId={voice.selectedVoiceId}
              selectedVoice={voice.selectedVoice}
              previewing={voice.previewing}
              voiceMsg={voice.voiceMsg}
              onSelectVoice={voice.onSelectVoice}
              onPreview={() => void voice.previewVoice()}
              onArchive={() => void api.archiveCampaign()}
              onDelete={() => void api.deleteCampaign()}
            />

            {(api.error || api.actionStatus) && (
              <div style={{
                margin: "10px 20px 0", padding: "8px 12px", borderRadius: 8,
                background: api.error ? "rgba(248,113,113,0.08)" : "rgba(74,222,128,0.08)",
                border: `1px solid ${api.error ? "rgba(248,113,113,0.3)" : "rgba(74,222,128,0.3)"}`,
                color: api.error ? "#fca5a5" : "#4ade80",
                fontSize: 13,
              }}>
                {api.error ?? api.actionStatus}
                {api.error && (
                  <button
                    onClick={() => api.setError(null)}
                    style={{ background: "none", border: "none", color: "inherit", float: "right", cursor: "pointer", fontSize: 13 }}
                  >✕</button>
                )}
              </div>
            )}

            <div
              style={{
                flex: 1, display: "grid",
                gridTemplateColumns: "minmax(260px, 320px) 1fr",
                gridTemplateRows: "auto 1fr",
                gap: 14, padding: 14, minHeight: 0,
              }}
              className="dm-grid"
            >
              <CharacterPanel character={api.character} onCreate={api.createCharacter} />
              <EventLog events={api.events} loading={api.loading} />
              <ActionBar
                lastRoll={api.lastRoll}
                onRoll={api.rollDice}
                onSubmitTurn={api.submitTurn}
                onRest={api.rest}
                onNarrate={api.narrate}
                voiceCache={voice.voiceCache}
                onClearVoiceCache={clearVoiceCache}
              />
            </div>
          </>
        )}
      </main>

      {/* Mobile-friendly fallback: stack the grid below ~900px */}
      <style dangerouslySetInnerHTML={{ __html: `
        @media (max-width: 900px) {
          .dm-grid {
            grid-template-columns: 1fr !important;
            grid-template-rows: auto auto auto !important;
          }
          .dm-grid > section:nth-child(1) { grid-column: 1 / 2 !important; grid-row: 1 / 2 !important; }
          .dm-grid > section:nth-child(2) { grid-column: 1 / 2 !important; grid-row: 2 / 3 !important; }
          .dm-grid > section:nth-child(3) { grid-column: 1 / 2 !important; grid-row: 3 / 4 !important; }
        }
      ` }} />
    </div>
  );
}
