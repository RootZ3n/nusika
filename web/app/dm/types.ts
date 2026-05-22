/**
 * Shared types, constants, and inline-style factories for the DM screen.
 * Extracted from the original 1,206-line page.tsx on 2026-05-22.
 */

import type { CSSProperties } from "react";

export const API_BASE = "/api/proxy";
export const ACCENT = "#a78bfa";
export const ACCENT_DIM = "rgba(167,139,250,0.10)";
export const NARRATION_BG = "rgba(167,139,250,0.07)";

export const SRD_CLASSES = [
  "barbarian", "bard", "cleric", "druid", "fighter", "monk",
  "paladin", "ranger", "rogue", "sorcerer", "warlock", "wizard",
] as const;
export type SrdClass = typeof SRD_CLASSES[number];

export const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;
export type Ability = typeof ABILITIES[number];

export const TURN_INTENTS = [
  "check", "save", "attack", "damage", "heal",
  "condition_add", "condition_remove", "end_turn",
] as const;
export type TurnIntent = typeof TURN_INTENTS[number];

export const NARRATION_STYLES = ["brief", "cinematic", "tactical"] as const;
export type NarrationStyle = typeof NARRATION_STYLES[number];

// ── Domain types (subset of server shapes) ──────────────────────────────────

export interface Campaign {
  id: string;
  user_id: string;
  title: string;
  setting_blurb: string | null;
  status: "active" | "paused" | "complete";
  current_scene: string | null;
  encounter_state: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface AbilityScores { str: number; dex: number; con: number; int: number; wis: number; cha: number }

export interface Character {
  id: string;
  campaign_id: string;
  name: string;
  ancestry: string;
  class_name: string;
  background: string | null;
  level: number;
  xp: number;
  abilities: AbilityScores;
  proficiency_bonus: number;
  hp_max: number;
  hp_current: number;
  hp_temp: number;
  hit_dice: { die: string; total: number; remaining: number };
  ac: number;
  speed: number;
  inventory: Array<{ id?: string; name?: string; quantity?: number; weight?: number; equipped?: boolean }>;
  conditions: string[];
  death_saves: { successes: number; failures: number };
}

export interface DmEvent {
  id: string;
  campaign_id: string;
  kind: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface RollResult {
  formula: string;
  total: number;
  rolls: number[];
  modifier: number;
  natural?: number;
  breakdown: string;
}

export interface VoiceCacheStatus { bytes: number; mb: number; maxMb: number }

// ── Inline-style factories ──────────────────────────────────────────────────

export const shell: CSSProperties = {
  display: "flex", flexWrap: "wrap", height: "100vh", minHeight: 0,
  fontFamily: "var(--font-body, system-ui, sans-serif)",
  background: "var(--bg-void, #060810)", color: "var(--text-primary, #e7e5f0)",
};
export const sidebar: CSSProperties = {
  width: 280, flex: "0 0 280px", padding: 16,
  borderRight: "1px solid var(--border, rgba(255,255,255,0.08))",
  display: "flex", flexDirection: "column", gap: 12, overflow: "hidden",
  minWidth: 240,
};
export const main: CSSProperties = {
  flex: "1 1 auto", display: "flex", flexDirection: "column",
  minHeight: 0, minWidth: 0,
};
export const panel: CSSProperties = {
  border: "1px solid var(--border, rgba(255,255,255,0.08))",
  borderRadius: 10, padding: 14,
  background: "rgba(20,22,40,0.4)",
};
export const btnPrimary: CSSProperties = {
  background: ACCENT, color: "#060810", border: "none",
  borderRadius: 8, padding: "8px 14px", fontSize: 14, fontWeight: 600,
  cursor: "pointer",
};
export const btnGhost: CSSProperties = {
  background: "transparent", color: "var(--text-secondary, #b8b6c3)",
  border: "1px solid var(--border, rgba(255,255,255,0.12))",
  borderRadius: 8, padding: "6px 12px", fontSize: 13, cursor: "pointer",
};
export const input: CSSProperties = {
  padding: "7px 10px", borderRadius: 8,
  border: "1px solid var(--border, rgba(255,255,255,0.12))",
  background: "rgba(255,255,255,0.03)", color: "inherit",
  fontFamily: "inherit", fontSize: 13,
};
export const select: CSSProperties = { ...input, padding: "6px 10px" };
export const label: CSSProperties = {
  fontSize: 11, color: "var(--text-muted, #888)",
  textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600,
  marginBottom: 4,
};
export const sectionTitle: CSSProperties = {
  fontFamily: "var(--font-display, system-ui)",
  fontSize: 13, fontWeight: 700, color: ACCENT,
  textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8,
};
