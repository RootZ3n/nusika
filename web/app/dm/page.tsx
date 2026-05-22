"use client";

/**
 * Dungeon Master mode — standalone screen.
 *
 * Lives outside web/app/page.tsx by design, mirroring /teach. Talks to
 * the same /api/proxy backend everything else uses. Adds no new server
 * surface — all endpoints already exist (Slice 4A/4B/4C-a).
 *
 * Architecture invariant carried over from the server: the deterministic
 * engine OWNS state. This UI never edits HP, conditions, hit dice, or
 * inventory directly — every mutation goes through a /turn or /rest
 * intent the server can verify.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  labelVoiceProfile,
  pickInitialVoice,
  readStoredVoiceId,
  sortVoiceOptions,
  writeStoredVoiceId,
  DM_VOICE_KEY,
  type VoiceOption,
} from "../lib/voice-picker";

const API_BASE = "/api/proxy";
const ACCENT = "#a78bfa";
const ACCENT_DIM = "rgba(167,139,250,0.10)";
const NARRATION_BG = "rgba(167,139,250,0.07)";

const SRD_CLASSES = [
  "barbarian", "bard", "cleric", "druid", "fighter", "monk",
  "paladin", "ranger", "rogue", "sorcerer", "warlock", "wizard",
] as const;

const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;
type Ability = typeof ABILITIES[number];

const TURN_INTENTS = [
  "check", "save", "attack", "damage", "heal",
  "condition_add", "condition_remove", "end_turn",
] as const;
type TurnIntent = typeof TURN_INTENTS[number];

const NARRATION_STYLES = ["brief", "cinematic", "tactical"] as const;
type NarrationStyle = typeof NARRATION_STYLES[number];

// ── Types matching server shape (subset) ────────────────────────────────────

interface Campaign {
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

interface AbilityScores { str: number; dex: number; con: number; int: number; wis: number; cha: number }

interface Character {
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

interface DmEvent {
  id: string;
  campaign_id: string;
  kind: string;
  payload: Record<string, unknown>;
  created_at: string;
}

interface RollResult {
  formula: string;
  total: number;
  rolls: number[];
  modifier: number;
  natural?: number;
  breakdown: string;
}

// ── API helpers ─────────────────────────────────────────────────────────────

async function apiGet<T>(path: string): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  try {
    const res = await fetch(`${API_BASE}${path}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, status: res.status, error: (data as { error?: string }).error ?? `HTTP ${res.status}` };
    }
    return { ok: true, data: data as T };
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

async function apiSend<T>(method: "POST" | "PATCH" | "DELETE", path: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(method === "DELETE" && body == null ? {} : { body: JSON.stringify(body ?? {}) }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, status: res.status, error: (data as { error?: string }).error ?? `HTTP ${res.status}` };
    }
    return { ok: true, data: data as T };
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Event renderer ──────────────────────────────────────────────────────────

interface EventViewProps { event: DmEvent }

function EventView({ event }: EventViewProps) {
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

  // Narration gets its own block.
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

// ── Main page ───────────────────────────────────────────────────────────────

export default function DmPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [character, setCharacter] = useState<Character | null>(null);
  const [events, setEvents] = useState<DmEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState<string | null>(null);

  // Voice picker (Slice 6F + 6G)
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>("varros-default");
  const [previewing, setPreviewing] = useState(false);
  const [voiceMsg, setVoiceMsg] = useState<string | null>(null);
  const [voiceCache, setVoiceCache] = useState<{ mb: number; maxMb: number; bytes: number } | null>(null);

  const selectedVoice = voices.find(v => v.id === selectedVoiceId) ?? null;

  // New campaign form
  const [newTitle, setNewTitle] = useState("");
  const [newBlurb, setNewBlurb] = useState("");

  // Character form
  const [chName, setChName] = useState("");
  const [chAncestry, setChAncestry] = useState("human");
  const [chClass, setChClass] = useState<typeof SRD_CLASSES[number]>("fighter");
  const [chBackground, setChBackground] = useState("");
  const [chAbilities, setChAbilities] = useState<AbilityScores>({
    str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8,
  });

  // Dice
  const [diceFormula, setDiceFormula] = useState("1d20");
  const [diceLabel, setDiceLabel] = useState("");
  const [lastRoll, setLastRoll] = useState<RollResult | null>(null);

  // Turn resolver
  const [turnIntent, setTurnIntent] = useState<TurnIntent>("check");
  const [turnAbility, setTurnAbility] = useState<Ability>("str");
  const [turnDc, setTurnDc] = useState(12);
  const [turnAmount, setTurnAmount] = useState(1);
  const [turnTargetId, setTurnTargetId] = useState("");
  const [turnCondition, setTurnCondition] = useState("");
  const [turnAttackName, setTurnAttackName] = useState("Longsword");
  const [turnAttackDice, setTurnAttackDice] = useState("1d8");
  const [turnAttackAc, setTurnAttackAc] = useState(13);
  const [turnAdvantage, setTurnAdvantage] = useState(false);
  const [turnDisadvantage, setTurnDisadvantage] = useState(false);

  // Rest
  const [spendDice, setSpendDice] = useState(0);

  // Narrate
  const [narrationStyle, setNarrationStyle] = useState<NarrationStyle>("brief");
  const [narrating, setNarrating] = useState(false);

  // ── Fetchers ──────────────────────────────────────────────────────────────

  const fetchCampaigns = useCallback(async () => {
    const r = await apiGet<{ campaigns: Campaign[] }>("/magister/dm/campaigns");
    if (r.ok) setCampaigns(r.data.campaigns ?? []);
  }, []);

  const fetchDetail = useCallback(async (id: string) => {
    setLoading(true);
    const r = await apiGet<{ campaign: Campaign; character: Character | null; events: DmEvent[] }>(
      `/magister/dm/campaigns/${id}?events=200`,
    );
    if (r.ok) {
      setCampaign(r.data.campaign);
      setCharacter(r.data.character);
      setEvents(r.data.events ?? []);
      setError(null);
    } else {
      setError(r.error);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void fetchCampaigns(); }, [fetchCampaigns]);

  // Voice picker (Slice 6G): fetch the full list, restore the
  // localStorage selection, fall back to Varros when missing.
  const fetchVoices = useCallback(async () => {
    const r = await apiGet<{ voices: VoiceOption[] }>("/magister/voices");
    if (!r.ok) return;
    const list = sortVoiceOptions(r.data.voices ?? []);
    setVoices(list);
    const stored = readStoredVoiceId(DM_VOICE_KEY);
    const initial = pickInitialVoice(list, stored, "varros-default");
    if (initial) setSelectedVoiceId(initial.id);
  }, []);

  const onSelectVoice = useCallback((id: string) => {
    setSelectedVoiceId(id);
    writeStoredVoiceId(DM_VOICE_KEY, id);
    setVoiceMsg(null);
  }, []);

  const fetchVoiceCache = useCallback(async () => {
    const r = await apiGet<{ bytes: number; mb: number; maxMb: number }>("/magister/voices/cache");
    if (r.ok) setVoiceCache({ bytes: r.data.bytes, mb: r.data.mb, maxMb: r.data.maxMb });
  }, []);

  useEffect(() => { void fetchVoices(); void fetchVoiceCache(); }, [fetchVoices, fetchVoiceCache]);

  const previewVoice = useCallback(async () => {
    if (!selectedVoice || previewing) return;
    setPreviewing(true);
    setVoiceMsg(null);
    const speakerName = selectedVoice.display_name.replace(/\s*\(default voice\)\s*$/i, "").trim()
      || selectedVoice.companion_id
      || "a Magister voice";
    try {
      const url = `${API_BASE}/magister/voices/preview/${encodeURIComponent(selectedVoice.engine)}/${encodeURIComponent(selectedVoice.voice_ref)}?name=${encodeURIComponent(speakerName)}`;
      const res = await fetch(url);
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        if (res.status === 503) {
          setVoiceMsg(data.error ?? "Voice preview unavailable.");
        } else {
          setVoiceMsg(data.error ?? `Preview failed (HTTP ${res.status}).`);
        }
        return;
      }
      const blob = await res.blob();
      const audioUrl = URL.createObjectURL(blob);
      const audio = new Audio(audioUrl);
      audio.onended = () => URL.revokeObjectURL(audioUrl);
      void audio.play();
      void fetchVoiceCache();
    } catch (err) {
      setVoiceMsg(err instanceof Error ? err.message : "Preview failed.");
    }
    setPreviewing(false);
  }, [selectedVoice, previewing, fetchVoiceCache]);

  const clearVoiceCache = useCallback(async () => {
    if (typeof window !== "undefined" && !window.confirm("Clear the voice cache? Generated voice WAVs will be removed.")) return;
    const r = await apiSend("DELETE", "/magister/voices/cache", null);
    if (r.ok) {
      setActionStatus("Voice cache cleared.");
      setTimeout(() => setActionStatus(null), 2500);
    } else {
      setError(r.error);
    }
    void fetchVoiceCache();
  }, [fetchVoiceCache]);
  useEffect(() => {
    if (activeId) void fetchDetail(activeId);
    else { setCampaign(null); setCharacter(null); setEvents([]); }
  }, [activeId, fetchDetail]);

  // ── Mutations ─────────────────────────────────────────────────────────────

  const createCampaign = useCallback(async () => {
    const title = newTitle.trim();
    if (!title) { setError("Title is required."); return; }
    const r = await apiSend<{ campaign: Campaign }>("POST", "/magister/dm/campaigns", {
      title,
      ...(newBlurb.trim() ? { setting_blurb: newBlurb.trim() } : {}),
    });
    if (r.ok) {
      setNewTitle(""); setNewBlurb(""); setError(null);
      await fetchCampaigns();
      setActiveId(r.data.campaign.id);
    } else {
      setError(r.error);
    }
  }, [newTitle, newBlurb, fetchCampaigns]);

  const createCharacter = useCallback(async () => {
    if (!activeId) return;
    const name = chName.trim();
    if (!name) { setError("Character name is required."); return; }
    const r = await apiSend<{ character: Character }>(
      "POST", `/magister/dm/campaigns/${activeId}/character`,
      {
        name,
        ancestry: chAncestry.trim() || "human",
        class_name: chClass,
        ...(chBackground.trim() ? { background: chBackground.trim() } : {}),
        abilities: chAbilities,
      },
    );
    if (r.ok) {
      setError(null); setActionStatus(`${name} created.`);
      setChName("");
      setTimeout(() => setActionStatus(null), 3500);
      await fetchDetail(activeId);
    } else if (r.status === 409) {
      setError("This campaign already has a character. Reload to see them.");
      await fetchDetail(activeId);
    } else {
      setError(r.error);
    }
  }, [activeId, chName, chAncestry, chClass, chBackground, chAbilities, fetchDetail]);

  const rollDice = useCallback(async () => {
    if (!activeId) return;
    const formula = diceFormula.trim() || "1d20";
    const r = await apiSend<{ result: RollResult }>(
      "POST", `/magister/dm/campaigns/${activeId}/roll`,
      { formula, ...(diceLabel.trim() ? { label: diceLabel.trim() } : {}) },
    );
    if (r.ok) {
      setLastRoll(r.data.result); setError(null);
      await fetchDetail(activeId);
    } else {
      setError(r.error);
    }
  }, [activeId, diceFormula, diceLabel, fetchDetail]);

  const submitTurn = useCallback(async () => {
    if (!activeId) return;
    const args: Record<string, unknown> = {};
    switch (turnIntent) {
      case "check":
      case "save":
        args.ability = turnAbility;
        args.dc = turnDc;
        if (turnAdvantage) args.advantage = true;
        if (turnDisadvantage) args.disadvantage = true;
        break;
      case "attack":
        args.attack = {
          name: turnAttackName,
          ability: turnAbility,
          proficient: true,
          damageDice: turnAttackDice,
        };
        args.target = { ac: turnAttackAc };
        if (turnAdvantage) args.advantage = true;
        if (turnDisadvantage) args.disadvantage = true;
        break;
      case "damage":
      case "heal":
        args.amount = turnAmount;
        if (turnTargetId.trim()) args.target_id = turnTargetId.trim();
        break;
      case "condition_add":
      case "condition_remove":
        args.condition = turnCondition.trim();
        if (turnTargetId.trim()) args.target_id = turnTargetId.trim();
        break;
      case "end_turn":
        break;
    }
    const r = await apiSend("POST", `/magister/dm/campaigns/${activeId}/turn`, {
      intent: turnIntent, args,
    });
    if (r.ok) {
      setError(null); setActionStatus(`Resolved: ${turnIntent}`);
      setTimeout(() => setActionStatus(null), 2500);
      await fetchDetail(activeId);
    } else {
      setError(r.error);
    }
  }, [
    activeId, turnIntent, turnAbility, turnDc, turnAmount, turnTargetId,
    turnCondition, turnAttackName, turnAttackDice, turnAttackAc,
    turnAdvantage, turnDisadvantage, fetchDetail,
  ]);

  const rest = useCallback(async (kind: "short" | "long") => {
    if (!activeId) return;
    const body: Record<string, unknown> = { kind };
    if (kind === "short" && spendDice > 0) body.spendHitDice = spendDice;
    const r = await apiSend("POST", `/magister/dm/campaigns/${activeId}/rest`, body);
    if (r.ok) {
      setError(null); setActionStatus(`${kind === "long" ? "Long" : "Short"} rest taken.`);
      setTimeout(() => setActionStatus(null), 2500);
      setSpendDice(0);
      await fetchDetail(activeId);
    } else {
      setError(r.error);
    }
  }, [activeId, spendDice, fetchDetail]);

  // Lossless archive: PATCH the campaign status to "complete". Character +
  // events stay in the DB; the row just stops being "active".
  const archiveCampaign = useCallback(async () => {
    if (!activeId) return;
    if (typeof window !== "undefined" && !window.confirm("Archive this campaign? It stays in your list with status=complete.")) return;
    const r = await apiSend("PATCH", `/magister/dm/campaigns/${activeId}`, { status: "complete" });
    if (r.ok) {
      setError(null); setActionStatus("Campaign archived.");
      setTimeout(() => setActionStatus(null), 2500);
      await fetchCampaigns();
      await fetchDetail(activeId);
    } else {
      setError(r.error);
    }
  }, [activeId, fetchCampaigns, fetchDetail]);

  // Hard delete: DELETE the campaign and cascade through to character + events.
  // Two confirmations because this is destructive and unrecoverable.
  const deleteCampaign = useCallback(async () => {
    if (!activeId) return;
    if (typeof window !== "undefined" && !window.confirm("Delete this campaign permanently? Character and event log will be lost.")) return;
    const r = await apiSend("DELETE", `/magister/dm/campaigns/${activeId}`, null);
    if (r.ok) {
      setError(null); setActionStatus("Campaign deleted.");
      setTimeout(() => setActionStatus(null), 2500);
      await fetchCampaigns();
      // Pick the most recent remaining campaign, or clear selection.
      setCampaigns(prev => {
        const remaining = prev.filter(c => c.id !== activeId);
        setActiveId(remaining[0]?.id ?? null);
        return remaining;
      });
    } else {
      setError(r.error);
    }
  }, [activeId, fetchCampaigns]);

  const narrate = useCallback(async () => {
    if (!activeId || narrating) return;
    setNarrating(true);
    const r = await apiSend("POST", `/magister/dm/campaigns/${activeId}/narrate`, {
      style: narrationStyle, limit: 8,
    });
    if (r.ok) {
      setError(null); setActionStatus("Narration added to log.");
      setTimeout(() => setActionStatus(null), 2500);
      await fetchDetail(activeId);
    } else if (r.status === 502) {
      setError("Narration unavailable because no LLM backend is configured.");
    } else if (r.status === 422) {
      setError("Narration model returned an empty response.");
    } else if (r.status === 400 && /No events available/i.test(r.error)) {
      setError("Nothing new to narrate yet.");
    } else {
      setError(r.error);
    }
    setNarrating(false);
  }, [activeId, narrating, narrationStyle, fetchDetail]);

  // ── Styles ────────────────────────────────────────────────────────────────

  const shell: React.CSSProperties = {
    display: "flex", flexWrap: "wrap", height: "100vh", minHeight: 0,
    fontFamily: "var(--font-body, system-ui, sans-serif)",
    background: "var(--bg-void, #060810)", color: "var(--text-primary, #e7e5f0)",
  };
  const sidebar: React.CSSProperties = {
    width: 280, flex: "0 0 280px", padding: 16,
    borderRight: "1px solid var(--border, rgba(255,255,255,0.08))",
    display: "flex", flexDirection: "column", gap: 12, overflow: "hidden",
    minWidth: 240,
  };
  const main: React.CSSProperties = {
    flex: "1 1 auto", display: "flex", flexDirection: "column",
    minHeight: 0, minWidth: 0,
  };
  const panel: React.CSSProperties = {
    border: "1px solid var(--border, rgba(255,255,255,0.08))",
    borderRadius: 10, padding: 14,
    background: "rgba(20,22,40,0.4)",
  };
  const btnPrimary: React.CSSProperties = {
    background: ACCENT, color: "#060810", border: "none",
    borderRadius: 8, padding: "8px 14px", fontSize: 14, fontWeight: 600,
    cursor: "pointer",
  };
  const btnGhost: React.CSSProperties = {
    background: "transparent", color: "var(--text-secondary, #b8b6c3)",
    border: "1px solid var(--border, rgba(255,255,255,0.12))",
    borderRadius: 8, padding: "6px 12px", fontSize: 13, cursor: "pointer",
  };
  const input: React.CSSProperties = {
    padding: "7px 10px", borderRadius: 8,
    border: "1px solid var(--border, rgba(255,255,255,0.12))",
    background: "rgba(255,255,255,0.03)", color: "inherit",
    fontFamily: "inherit", fontSize: 13,
  };
  const select: React.CSSProperties = { ...input, padding: "6px 10px" };
  const label: React.CSSProperties = {
    fontSize: 11, color: "var(--text-muted, #888)",
    textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600,
    marginBottom: 4,
  };
  const sectionTitle: React.CSSProperties = {
    fontFamily: "var(--font-display, system-ui)",
    fontSize: 13, fontWeight: 700, color: ACCENT,
    textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8,
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={shell}>
      {/* ── Sidebar: campaign list ──────────────────────────────────────── */}
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
            onChange={e => setNewTitle(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") void createCampaign(); }}
            placeholder="New campaign title"
            style={input}
          />
          <input
            value={newBlurb}
            onChange={e => setNewBlurb(e.target.value)}
            placeholder="Setting blurb (optional)"
            style={input}
          />
          <button style={btnPrimary} onClick={() => void createCampaign()}>Create campaign</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
          {campaigns.length === 0 && (
            <div style={{ fontSize: 13, color: "var(--text-muted, #888)", padding: 8 }}>
              No campaigns yet.
            </div>
          )}
          {campaigns.map(c => {
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

      {/* ── Main content ────────────────────────────────────────────────── */}
      <main style={main}>
        {!activeId && (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted, #888)", padding: 32, textAlign: "center" }}>
            Pick a campaign on the left, or start a new one.
          </div>
        )}

        {activeId && (
          <>
            {/* Header */}
            <header style={{
              padding: "12px 20px",
              borderBottom: "1px solid var(--border, rgba(255,255,255,0.08))",
              display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap",
            }}>
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{campaign?.title ?? "…"}</h2>
                {campaign?.setting_blurb && (
                  <div style={{ fontSize: 12, color: "var(--text-muted, #888)", marginTop: 2 }}>
                    {campaign.setting_blurb}
                  </div>
                )}
              </div>
              <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 11, color: ACCENT, background: ACCENT_DIM, padding: "3px 10px", borderRadius: 10 }}>
                  {campaign?.status ?? "…"}
                </span>
                {/* Voice picker (Slice 6G) */}
                {voices.length > 0 && selectedVoice && (
                  <>
                    <select
                      value={selectedVoiceId}
                      onChange={e => onSelectVoice(e.target.value)}
                      aria-label="Select voice for preview"
                      style={{
                        fontFamily: "var(--font-mono, monospace)", fontSize: 11,
                        color: ACCENT, background: ACCENT_DIM,
                        border: `1px solid ${ACCENT}33`, borderRadius: 10,
                        padding: "3px 8px", cursor: "pointer",
                      }}
                    >
                      {voices.map(v => (
                        <option key={v.id} value={v.id}>
                          {labelVoiceProfile(v)}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => void previewVoice()}
                      aria-label="Preview selected voice"
                      style={{ ...btnGhost, fontSize: 12, padding: "4px 10px" }}
                      disabled={previewing}
                    >{previewing ? "Playing…" : "Preview"}</button>
                  </>
                )}
                {campaign && campaign.status !== "complete" && (
                  <button
                    onClick={() => void archiveCampaign()}
                    aria-label="Archive campaign"
                    style={btnGhost}
                  >Archive campaign</button>
                )}
                {campaign && (
                  <button
                    onClick={() => void deleteCampaign()}
                    aria-label="Delete campaign permanently"
                    style={{ ...btnGhost, color: "#fca5a5", borderColor: "rgba(248,113,113,0.3)" }}
                  >Delete permanently</button>
                )}
              </div>
              {voiceMsg && (
                <div style={{ marginTop: 4, fontSize: 12, color: "var(--text-secondary, #b8b6c3)", fontStyle: "italic" }}>
                  {voiceMsg}
                </div>
              )}
            </header>

            {/* Status / error banner */}
            {(error || actionStatus) && (
              <div style={{
                margin: "10px 20px 0", padding: "8px 12px", borderRadius: 8,
                background: error ? "rgba(248,113,113,0.08)" : "rgba(74,222,128,0.08)",
                border: `1px solid ${error ? "rgba(248,113,113,0.3)" : "rgba(74,222,128,0.3)"}`,
                color: error ? "#fca5a5" : "#4ade80",
                fontSize: 13,
              }}>
                {error ?? actionStatus}
                {error && (
                  <button onClick={() => setError(null)} style={{ background: "none", border: "none", color: "inherit", float: "right", cursor: "pointer", fontSize: 13 }}>✕</button>
                )}
              </div>
            )}

            <div style={{
              flex: 1, display: "grid",
              gridTemplateColumns: "minmax(260px, 320px) 1fr",
              gridTemplateRows: "auto 1fr",
              gap: 14, padding: 14, minHeight: 0,
            }} className="dm-grid">
              {/* Top-left: Character sheet */}
              <section style={{ ...panel, gridColumn: "1 / 2", gridRow: "1 / 3", display: "flex", flexDirection: "column", overflow: "auto" }}>
                <div style={sectionTitle}>Character</div>
                {!character && (
                  <CharacterCreateForm
                    name={chName} setName={setChName}
                    ancestry={chAncestry} setAncestry={setChAncestry}
                    cls={chClass} setCls={setChClass}
                    background={chBackground} setBackground={setChBackground}
                    abilities={chAbilities} setAbilities={setChAbilities}
                    onSubmit={() => void createCharacter()}
                    inputStyle={input} btnStyle={btnPrimary} labelStyle={label} selectStyle={select}
                  />
                )}
                {character && (
                  <CharacterSheet character={character} />
                )}
              </section>

              {/* Top-right: Event log */}
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
                  {events.map(e => <EventView key={e.id} event={e} />)}
                </div>
              </section>

              {/* Bottom-right: Action bar */}
              <section style={{ gridColumn: "2 / 3", gridRow: "2 / 3", display: "flex", flexDirection: "column", gap: 12, overflowY: "auto", paddingRight: 4 }}>
                {/* Dice tray */}
                <div style={panel}>
                  <div style={sectionTitle}>Dice tray</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                    <div style={{ display: "flex", flexDirection: "column", flex: "0 0 110px" }}>
                      <span style={label}>Formula</span>
                      <input value={diceFormula} onChange={e => setDiceFormula(e.target.value)} style={input} />
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 120 }}>
                      <span style={label}>Label (optional)</span>
                      <input value={diceLabel} onChange={e => setDiceLabel(e.target.value)} placeholder="perception, sneak…" style={input} />
                    </div>
                    <button style={btnPrimary} onClick={() => void rollDice()}>Roll</button>
                  </div>
                  {lastRoll && (
                    <div style={{ marginTop: 8, fontSize: 13, color: "var(--text-secondary, #b8b6c3)" }}>
                      Last: <strong>{lastRoll.formula}</strong> = <strong>{lastRoll.total}</strong>{" "}
                      <span style={{ color: "var(--text-muted, #888)" }}>{lastRoll.breakdown}</span>
                    </div>
                  )}
                </div>

                {/* Turn resolver */}
                <div style={panel}>
                  <div style={sectionTitle}>Resolve a turn</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      <span style={label}>Intent</span>
                      <select value={turnIntent} onChange={e => setTurnIntent(e.target.value as TurnIntent)} style={select}>
                        {TURN_INTENTS.map(i => <option key={i} value={i}>{i}</option>)}
                      </select>
                    </div>

                    {(turnIntent === "check" || turnIntent === "save" || turnIntent === "attack") && (
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        <span style={label}>Ability</span>
                        <select value={turnAbility} onChange={e => setTurnAbility(e.target.value as Ability)} style={select}>
                          {ABILITIES.map(a => <option key={a} value={a}>{a}</option>)}
                        </select>
                      </div>
                    )}

                    {(turnIntent === "check" || turnIntent === "save") && (
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        <span style={label}>DC</span>
                        <input type="number" value={turnDc} onChange={e => setTurnDc(Number(e.target.value))} style={{ ...input, width: 70 }} />
                      </div>
                    )}

                    {turnIntent === "attack" && (
                      <>
                        <div style={{ display: "flex", flexDirection: "column" }}>
                          <span style={label}>Attack</span>
                          <input value={turnAttackName} onChange={e => setTurnAttackName(e.target.value)} style={{ ...input, width: 110 }} />
                        </div>
                        <div style={{ display: "flex", flexDirection: "column" }}>
                          <span style={label}>Dmg dice</span>
                          <input value={turnAttackDice} onChange={e => setTurnAttackDice(e.target.value)} style={{ ...input, width: 80 }} />
                        </div>
                        <div style={{ display: "flex", flexDirection: "column" }}>
                          <span style={label}>Target AC</span>
                          <input type="number" value={turnAttackAc} onChange={e => setTurnAttackAc(Number(e.target.value))} style={{ ...input, width: 70 }} />
                        </div>
                      </>
                    )}

                    {(turnIntent === "damage" || turnIntent === "heal") && (
                      <>
                        <div style={{ display: "flex", flexDirection: "column" }}>
                          <span style={label}>Amount</span>
                          <input type="number" value={turnAmount} onChange={e => setTurnAmount(Number(e.target.value))} style={{ ...input, width: 80 }} />
                        </div>
                        <div style={{ display: "flex", flexDirection: "column" }}>
                          <span style={label}>Target id (optional)</span>
                          <input value={turnTargetId} onChange={e => setTurnTargetId(e.target.value)} placeholder="defaults to character" style={{ ...input, width: 160 }} />
                        </div>
                      </>
                    )}

                    {(turnIntent === "condition_add" || turnIntent === "condition_remove") && (
                      <>
                        <div style={{ display: "flex", flexDirection: "column" }}>
                          <span style={label}>Condition</span>
                          <input value={turnCondition} onChange={e => setTurnCondition(e.target.value)} placeholder="prone, poisoned…" style={{ ...input, width: 140 }} />
                        </div>
                        <div style={{ display: "flex", flexDirection: "column" }}>
                          <span style={label}>Target id (optional)</span>
                          <input value={turnTargetId} onChange={e => setTurnTargetId(e.target.value)} placeholder="defaults to character" style={{ ...input, width: 160 }} />
                        </div>
                      </>
                    )}

                    {(turnIntent === "check" || turnIntent === "save" || turnIntent === "attack") && (
                      <div style={{ display: "flex", gap: 8, alignSelf: "flex-end" }}>
                        <label style={{ fontSize: 12, color: "var(--text-muted, #888)" }}>
                          <input type="checkbox" checked={turnAdvantage} onChange={e => setTurnAdvantage(e.target.checked)} /> adv
                        </label>
                        <label style={{ fontSize: 12, color: "var(--text-muted, #888)" }}>
                          <input type="checkbox" checked={turnDisadvantage} onChange={e => setTurnDisadvantage(e.target.checked)} /> dis
                        </label>
                      </div>
                    )}

                    <button style={btnPrimary} onClick={() => void submitTurn()}>Submit</button>
                  </div>
                </div>

                {/* Rest + narrate */}
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ ...panel, flex: 1, minWidth: 240 }}>
                    <div style={sectionTitle}>Rest</div>
                    <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                      <button style={btnPrimary} onClick={() => void rest("long")}>Long rest</button>
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        <span style={label}>Spend hit dice</span>
                        <input type="number" min={0} value={spendDice} onChange={e => setSpendDice(Number(e.target.value))} style={{ ...input, width: 70 }} />
                      </div>
                      <button style={btnGhost} onClick={() => void rest("short")}>Short rest</button>
                    </div>
                  </div>

                  <div style={{ ...panel, flex: 1, minWidth: 240 }}>
                    <div style={sectionTitle}>Varros narrates</div>
                    <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        <span style={label}>Style</span>
                        <select value={narrationStyle} onChange={e => setNarrationStyle(e.target.value as NarrationStyle)} style={select}>
                          {NARRATION_STYLES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                      <button style={btnPrimary} onClick={() => void narrate()} disabled={narrating}>
                        {narrating ? "Narrating…" : "Narrate latest events"}
                      </button>
                    </div>
                    <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted, #888)" }}>
                      Narration is descriptive; engine owns the rules.
                    </div>
                  </div>
                </div>

                {/* Voice cache footer (Slice 6F) */}
                {voiceCache && (
                  <div style={{
                    fontSize: 11, color: "var(--text-muted, #888)",
                    display: "flex", gap: 8, alignItems: "center",
                    padding: "0 4px",
                  }}>
                    <span>Voice cache: {voiceCache.mb} MB / {voiceCache.maxMb} MB</span>
                    {voiceCache.bytes > 0 && (
                      <button
                        style={{ background: "none", border: "none", color: ACCENT, cursor: "pointer", fontSize: 11, padding: 0, textDecoration: "underline" }}
                        onClick={() => void clearVoiceCache()}
                        aria-label="Clear voice cache"
                      >Clear</button>
                    )}
                  </div>
                )}
              </section>
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

// ── Subcomponents ───────────────────────────────────────────────────────────

interface CharacterCreateFormProps {
  name: string; setName: (v: string) => void;
  ancestry: string; setAncestry: (v: string) => void;
  cls: typeof SRD_CLASSES[number]; setCls: (v: typeof SRD_CLASSES[number]) => void;
  background: string; setBackground: (v: string) => void;
  abilities: AbilityScores; setAbilities: (v: AbilityScores) => void;
  onSubmit: () => void;
  inputStyle: React.CSSProperties; btnStyle: React.CSSProperties;
  labelStyle: React.CSSProperties; selectStyle: React.CSSProperties;
}

function CharacterCreateForm(p: CharacterCreateFormProps) {
  const setAbility = (k: Ability, v: number) =>
    p.setAbilities({ ...p.abilities, [k]: v });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 13, color: "var(--text-muted, #888)", lineHeight: 1.5 }}>
        Create a level-1 character. The engine will set HP, AC, and hit dice from your class and CON.
      </div>

      <label style={{ display: "flex", flexDirection: "column" }}>
        <span style={p.labelStyle}>Name</span>
        <input value={p.name} onChange={e => p.setName(e.target.value)} style={p.inputStyle} />
      </label>

      <label style={{ display: "flex", flexDirection: "column" }}>
        <span style={p.labelStyle}>Ancestry</span>
        <input value={p.ancestry} onChange={e => p.setAncestry(e.target.value)} style={p.inputStyle} />
      </label>

      <label style={{ display: "flex", flexDirection: "column" }}>
        <span style={p.labelStyle}>Class</span>
        <select value={p.cls} onChange={e => p.setCls(e.target.value as typeof SRD_CLASSES[number])} style={p.selectStyle}>
          {SRD_CLASSES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>

      <label style={{ display: "flex", flexDirection: "column" }}>
        <span style={p.labelStyle}>Background (optional)</span>
        <input value={p.background} onChange={e => p.setBackground(e.target.value)} style={p.inputStyle} />
      </label>

      <div>
        <span style={p.labelStyle}>Abilities</span>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
          {ABILITIES.map(a => (
            <label key={a} style={{ display: "flex", flexDirection: "column", fontSize: 11, color: "var(--text-muted, #888)" }}>
              {a.toUpperCase()}
              <input type="number" min={1} max={20} value={p.abilities[a]} onChange={e => setAbility(a, Number(e.target.value))} style={{ ...p.inputStyle, padding: "5px 8px" }} />
            </label>
          ))}
        </div>
      </div>

      <button style={p.btnStyle} onClick={p.onSubmit}>Create character</button>
    </div>
  );
}

function CharacterSheet({ character }: { character: Character }) {
  const c = character;
  const row: React.CSSProperties = { display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13 };
  const muted: React.CSSProperties = { color: "var(--text-muted, #888)" };

  const equipped = (c.inventory ?? []).filter(i => i.equipped);
  const carried = (c.inventory ?? []).filter(i => !i.equipped);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 18, fontWeight: 700 }}>{c.name}</div>
      <div style={{ fontSize: 12, color: "var(--text-muted, #888)" }}>
        {c.ancestry} {c.class_name} · level {c.level}{c.background ? ` · ${c.background}` : ""}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginTop: 8 }}>
        <div style={row}><span style={muted}>HP</span><strong>{c.hp_current}/{c.hp_max}{c.hp_temp ? ` (+${c.hp_temp})` : ""}</strong></div>
        <div style={row}><span style={muted}>AC</span><strong>{c.ac}</strong></div>
        <div style={row}><span style={muted}>Speed</span><strong>{c.speed}</strong></div>
        <div style={row}><span style={muted}>Prof</span><strong>+{c.proficiency_bonus}</strong></div>
        <div style={row}><span style={muted}>XP</span><strong>{c.xp}</strong></div>
        <div style={row}><span style={muted}>Hit dice</span><strong>{c.hit_dice.remaining}/{c.hit_dice.total} {c.hit_dice.die}</strong></div>
      </div>

      <div style={{ marginTop: 6 }}>
        <div style={{ fontSize: 11, color: "var(--text-muted, #888)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Abilities</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 4, fontSize: 13 }}>
          {ABILITIES.map(a => {
            const score = c.abilities[a];
            const mod = Math.floor((score - 10) / 2);
            return (
              <div key={a} style={{ textAlign: "center", padding: "4px 0", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 6 }}>
                <div style={{ fontSize: 10, color: "var(--text-muted, #888)", textTransform: "uppercase" }}>{a}</div>
                <div style={{ fontWeight: 600 }}>{score}</div>
                <div style={{ fontSize: 11, color: ACCENT }}>{mod >= 0 ? `+${mod}` : mod}</div>
              </div>
            );
          })}
        </div>
      </div>

      {c.conditions.length > 0 && (
        <div>
          <div style={{ fontSize: 11, color: "var(--text-muted, #888)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Conditions</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {c.conditions.map(k => (
              <span key={k} style={{ background: "rgba(248,113,113,0.1)", color: "#fca5a5", border: "1px solid rgba(248,113,113,0.3)", padding: "2px 8px", borderRadius: 12, fontSize: 11 }}>
                {k}
              </span>
            ))}
          </div>
        </div>
      )}

      {(c.death_saves.successes > 0 || c.death_saves.failures > 0) && (
        <div style={{ fontSize: 12, color: "var(--text-muted, #888)" }}>
          Death saves: ✓ {c.death_saves.successes} / ✗ {c.death_saves.failures}
        </div>
      )}

      {(equipped.length > 0 || carried.length > 0) && (
        <div>
          <div style={{ fontSize: 11, color: "var(--text-muted, #888)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
            Inventory
          </div>
          {equipped.length > 0 && (
            <ul style={{ fontSize: 12, paddingLeft: 18, margin: "2px 0" }}>
              {equipped.map((i, idx) => (
                <li key={i.id ?? idx}><strong>{i.name}</strong>{i.quantity && i.quantity > 1 ? ` ×${i.quantity}` : ""} <span style={muted}>(equipped)</span></li>
              ))}
            </ul>
          )}
          {carried.length > 0 && (
            <ul style={{ fontSize: 12, paddingLeft: 18, margin: "2px 0", color: "var(--text-secondary, #b8b6c3)" }}>
              {carried.map((i, idx) => (
                <li key={i.id ?? idx}>{i.name}{i.quantity && i.quantity > 1 ? ` ×${i.quantity}` : ""}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
