"use client";

/**
 * EventLog — scrolling list of campaign events with kind-specific renderers
 * for narration, rolls, checks/saves, attacks, damage/heal, conditions,
 * rests, and encounter ticks. Extracted from page.tsx on 2026-05-22.
 */

import { ACCENT, NARRATION_BG, panel, sectionTitle, type DmEvent } from "../types";

export interface EventLogProps {
  events: DmEvent[];
  loading: boolean;
}

export function EventLog({ events, loading }: EventLogProps) {
  return (
    <section style={{ ...panel, gridColumn: "2 / 3", gridRow: "1 / 2", display: "flex", flexDirection: "column", minHeight: 200, maxHeight: "55vh" }}>
      <div style={{ ...sectionTitle, display: "flex", alignItems: "baseline", gap: 8 }}>
        Event Log
        <span style={{ fontSize: 11, color: "var(--text-muted, #888)", textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>
          {events.length} events {loading ? "(loading…)" : ""}
        </span>
      </div>
      <div style={{ flex: 1, overflowY: "auto", paddingRight: 8 }}>
        {events.length === 0 && (
          <div style={{ color: "var(--text-muted, #888)", fontSize: 13, fontStyle: "italic" }}>
            No events yet.
          </div>
        )}
        {events.map((e) => <EventView key={e.id} event={e} />)}
      </div>
    </section>
  );
}

function EventView({ event }: { event: DmEvent }) {
  const p = event.payload;
  const style: React.CSSProperties = {
    fontSize: 13, lineHeight: 1.6, color: "var(--text-secondary, #b8b6c3)",
    padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.04)",
    fontFamily: "var(--font-body, system-ui)",
  };
  const tag = (text: string, color = ACCENT): React.CSSProperties => ({
    display: "inline-block", fontFamily: "var(--font-mono, monospace)",
    fontSize: 10, color, background: "rgba(167,139,250,0.1)",
    padding: "1px 6px", borderRadius: 4, marginRight: 8,
    textTransform: "uppercase", letterSpacing: "0.05em",
  });

  if (event.kind === "narration") {
    return (
      <div style={{
        margin: "10px 0", padding: "12px 14px", borderRadius: 10,
        background: NARRATION_BG, border: `1px solid ${ACCENT}33`,
        fontSize: 14, lineHeight: 1.75, color: "var(--text-primary, #e7e5f0)",
        fontFamily: "Georgia, serif", whiteSpace: "pre-wrap",
      }}>
        <div style={tag("narration", ACCENT)}>Varros narrates</div>
        {String(p.text ?? "")}
      </div>
    );
  }

  let line: React.ReactNode = null;
  switch (event.kind) {
    case "campaign_created":
      line = <>Campaign created: <strong>{String(p.title ?? "")}</strong></>;
      break;
    case "campaign_updated": {
      const fields = Object.keys(p).join(", ");
      line = <>Campaign updated <span style={{ color: "var(--text-muted, #888)" }}>({fields || "no visible fields"})</span></>;
      break;
    }
    case "character_created":
      line = (
        <>
          Character created: <strong>{String(p.name ?? "")}</strong>, level 1 {String(p.class_name ?? "")}
          {p.ancestry ? ` (${String(p.ancestry)})` : ""},
          {" "}HP {String(p.hp_max ?? "?")}, AC {String(p.ac ?? "?")}
        </>
      );
      break;
    case "roll": {
      const label = p.label ? `${String(p.label)}` : "roll";
      line = (
        <>
          🎲 <strong>{label}</strong> {String(p.formula ?? "")} ={" "}
          <strong>{String(p.total ?? "")}</strong>{" "}
          <span style={{ color: "var(--text-muted, #888)" }}>{String(p.breakdown ?? "")}</span>
        </>
      );
      break;
    }
    case "check":
    case "save": {
      const verb = event.kind === "check" ? "Ability check" : "Save";
      const success = !!p.success;
      line = (
        <>
          {verb}: <strong>{String(p.ability ?? "")}</strong> vs DC {String(p.dc ?? "?")} →{" "}
          <strong>{String(p.total ?? "?")}</strong> (nat {String(p.natural ?? "?")}) →{" "}
          <span style={{ color: success ? "#4ade80" : "#f87171", fontWeight: 600 }}>
            {success ? "success" : "failure"}
          </span>
        </>
      );
      break;
    }
    case "attack": {
      const outcome = p.crit ? "CRITICAL HIT" : p.miss ? "auto miss" : p.hit ? "hit" : "miss";
      const color = p.crit ? "#fbbf24" : p.hit ? "#4ade80" : "#f87171";
      line = (
        <>
          ⚔️ <strong>{String(p.attack ?? "")}</strong>: {String(p.total ?? "?")} (nat {String(p.natural ?? "?")}) vs AC {String(p.ac ?? "?")} →{" "}
          <span style={{ color, fontWeight: 600 }}>{outcome}</span>
        </>
      );
      break;
    }
    case "damage":
      line = (
        <>
          🗡️ <strong>damage</strong> to {String(p.target_id ?? "?")}: {String(p.amount ?? 0)}
          {p.hp_current != null && <> · HP now <strong>{String(p.hp_current)}</strong></>}
        </>
      );
      break;
    case "heal":
      line = (
        <>
          ✚ <strong>healing</strong> on {String(p.target_id ?? "?")}: {String(p.amount ?? 0)}
          {p.hp_current != null && <> · HP now <strong>{String(p.hp_current)}</strong></>}
        </>
      );
      break;
    case "condition_add":
      line = <>Condition added: <strong>{String(p.condition ?? "")}</strong> on {String(p.target_id ?? "?")}</>;
      break;
    case "condition_remove":
      line = <>Condition removed: <strong>{String(p.condition ?? "")}</strong> on {String(p.target_id ?? "?")}</>;
      break;
    case "rest":
      if (p.kind === "long") {
        line = <>🌙 <strong>Long rest</strong>: HP restored to {String(p.hp_restored_to ?? "?")}, hit dice to {String(p.hit_dice_restored_to ?? "?")}</>;
      } else if (p.spent != null) {
        line = <>🌙 <strong>Short rest</strong>: spent {String(p.spent)} hit die/dice → heal {String(p.heal ?? "?")}, HP {String(p.hp_after ?? "?")}</>;
      } else {
        line = <>🌙 <strong>Short rest</strong></>;
      }
      break;
    case "encounter_start": {
      const order = (p.order as string[] | undefined) ?? [];
      line = <>⚔️ <strong>Encounter begins</strong>. Initiative: {order.join(", ") || "(empty)"}</>;
      break;
    }
    case "end_turn":
      line = (
        <>
          ⏭ Turn ended → round <strong>{String(p.round ?? "?")}</strong>, slot {String(p.next_turn_index ?? "?")}
          {p.wrapped ? " (round bumped)" : ""}
        </>
      );
      break;
    default:
      line = (
        <details>
          <summary style={{ cursor: "pointer" }}>{event.kind}</summary>
          <pre style={{ fontSize: 11, color: "var(--text-muted, #888)", margin: "4px 0", overflow: "auto" }}>
            {JSON.stringify(p, null, 2)}
          </pre>
        </details>
      );
  }

  return (
    <div style={style}>
      <span style={tag(event.kind)}>{event.kind}</span>
      {line}
    </div>
  );
}
