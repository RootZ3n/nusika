"use client";

/**
 * useDmApi — campaign list + detail + every mutation the DM screen issues.
 * Extracted from page.tsx on 2026-05-22; no behavior changes.
 *
 * Returns a flat record of state + stable callbacks. Callers (page +
 * components) consume slices via destructuring. Errors are surfaced via
 * `error` / `actionStatus` strings the way the original inline code did —
 * the message + auto-clear timing is preserved exactly.
 */

import { useCallback, useEffect, useState } from "react";
import {
  API_BASE,
  type AbilityScores,
  type Campaign,
  type Character,
  type DmEvent,
  type NarrationStyle,
  type RollResult,
  type SrdClass,
  type TurnIntent,
  type Ability,
} from "../types";

type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

async function apiGet<T>(path: string): Promise<ApiResult<T>> {
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

async function apiSend<T>(method: "POST" | "PATCH" | "DELETE", path: string, body: unknown): Promise<ApiResult<T>> {
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

export interface CreateCharacterInput {
  name: string;
  ancestry: string;
  cls: SrdClass;
  background: string;
  abilities: AbilityScores;
}

export interface SubmitTurnInput {
  intent: TurnIntent;
  ability: Ability;
  dc: number;
  amount: number;
  targetId: string;
  condition: string;
  attackName: string;
  attackDice: string;
  attackAc: number;
  advantage: boolean;
  disadvantage: boolean;
}

export interface DmApi {
  campaigns: Campaign[];
  activeId: string | null;
  setActiveId: React.Dispatch<React.SetStateAction<string | null>>;
  campaign: Campaign | null;
  character: Character | null;
  events: DmEvent[];
  loading: boolean;
  error: string | null;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  actionStatus: string | null;
  setActionStatus: React.Dispatch<React.SetStateAction<string | null>>;
  lastRoll: RollResult | null;

  fetchCampaigns: () => Promise<void>;
  fetchDetail: (id: string) => Promise<void>;
  createCampaign: (title: string, blurb: string) => Promise<Campaign | null>;
  createCharacter: (input: CreateCharacterInput) => Promise<boolean>;
  rollDice: (formula: string, dlabel: string) => Promise<void>;
  submitTurn: (input: SubmitTurnInput) => Promise<void>;
  rest: (kind: "short" | "long", spendDice: number) => Promise<void>;
  archiveCampaign: () => Promise<void>;
  deleteCampaign: () => Promise<void>;
  narrate: (style: NarrationStyle, onSetNarrating: (b: boolean) => void) => Promise<void>;
}

export function useDmApi(): DmApi {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [character, setCharacter] = useState<Character | null>(null);
  const [events, setEvents] = useState<DmEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [lastRoll, setLastRoll] = useState<RollResult | null>(null);

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

  // Initial load + selection-driven detail fetch (mirror of original effects).
  useEffect(() => { void fetchCampaigns(); }, [fetchCampaigns]);
  useEffect(() => {
    if (activeId) void fetchDetail(activeId);
    else { setCampaign(null); setCharacter(null); setEvents([]); }
  }, [activeId, fetchDetail]);

  const createCampaign = useCallback(async (title: string, blurb: string): Promise<Campaign | null> => {
    if (!title) { setError("Title is required."); return null; }
    const r = await apiSend<{ campaign: Campaign }>("POST", "/magister/dm/campaigns", {
      title,
      ...(blurb.trim() ? { setting_blurb: blurb.trim() } : {}),
    });
    if (r.ok) {
      setError(null);
      await fetchCampaigns();
      setActiveId(r.data.campaign.id);
      return r.data.campaign;
    }
    setError(r.error);
    return null;
  }, [fetchCampaigns]);

  const createCharacter = useCallback(async (input: CreateCharacterInput): Promise<boolean> => {
    if (!activeId) return false;
    const name = input.name.trim();
    if (!name) { setError("Character name is required."); return false; }
    const r = await apiSend<{ character: Character }>(
      "POST", `/magister/dm/campaigns/${activeId}/character`,
      {
        name,
        ancestry: input.ancestry.trim() || "human",
        class_name: input.cls,
        ...(input.background.trim() ? { background: input.background.trim() } : {}),
        abilities: input.abilities,
      },
    );
    if (r.ok) {
      setError(null);
      setActionStatus(`${name} created.`);
      setTimeout(() => setActionStatus(null), 3500);
      await fetchDetail(activeId);
      return true;
    }
    if (r.status === 409) {
      setError("This campaign already has a character. Reload to see them.");
      await fetchDetail(activeId);
    } else {
      setError(r.error);
    }
    return false;
  }, [activeId, fetchDetail]);

  const rollDice = useCallback(async (formula: string, dlabel: string) => {
    if (!activeId) return;
    const f = formula.trim() || "1d20";
    const r = await apiSend<{ result: RollResult }>(
      "POST", `/magister/dm/campaigns/${activeId}/roll`,
      { formula: f, ...(dlabel.trim() ? { label: dlabel.trim() } : {}) },
    );
    if (r.ok) {
      setLastRoll(r.data.result);
      setError(null);
      await fetchDetail(activeId);
    } else {
      setError(r.error);
    }
  }, [activeId, fetchDetail]);

  const submitTurn = useCallback(async (t: SubmitTurnInput) => {
    if (!activeId) return;
    const args: Record<string, unknown> = {};
    switch (t.intent) {
      case "check":
      case "save":
        args.ability = t.ability;
        args.dc = t.dc;
        if (t.advantage) args.advantage = true;
        if (t.disadvantage) args.disadvantage = true;
        break;
      case "attack":
        args.attack = {
          name: t.attackName,
          ability: t.ability,
          proficient: true,
          damageDice: t.attackDice,
        };
        args.target = { ac: t.attackAc };
        if (t.advantage) args.advantage = true;
        if (t.disadvantage) args.disadvantage = true;
        break;
      case "damage":
      case "heal":
        args.amount = t.amount;
        if (t.targetId.trim()) args.target_id = t.targetId.trim();
        break;
      case "condition_add":
      case "condition_remove":
        args.condition = t.condition.trim();
        if (t.targetId.trim()) args.target_id = t.targetId.trim();
        break;
      case "end_turn":
        break;
    }
    const r = await apiSend("POST", `/magister/dm/campaigns/${activeId}/turn`, {
      intent: t.intent, args,
    });
    if (r.ok) {
      setError(null);
      setActionStatus(`Resolved: ${t.intent}`);
      setTimeout(() => setActionStatus(null), 2500);
      await fetchDetail(activeId);
    } else {
      setError(r.error);
    }
  }, [activeId, fetchDetail]);

  const rest = useCallback(async (kind: "short" | "long", spendDice: number) => {
    if (!activeId) return;
    const body: Record<string, unknown> = { kind };
    if (kind === "short" && spendDice > 0) body.spendHitDice = spendDice;
    const r = await apiSend("POST", `/magister/dm/campaigns/${activeId}/rest`, body);
    if (r.ok) {
      setError(null);
      setActionStatus(`${kind === "long" ? "Long" : "Short"} rest taken.`);
      setTimeout(() => setActionStatus(null), 2500);
      await fetchDetail(activeId);
    } else {
      setError(r.error);
    }
  }, [activeId, fetchDetail]);

  const archiveCampaign = useCallback(async () => {
    if (!activeId) return;
    if (typeof window !== "undefined" && !window.confirm("Archive this campaign? It stays in your list with status=complete.")) return;
    const r = await apiSend("PATCH", `/magister/dm/campaigns/${activeId}`, { status: "complete" });
    if (r.ok) {
      setError(null);
      setActionStatus("Campaign archived.");
      setTimeout(() => setActionStatus(null), 2500);
      await fetchCampaigns();
      await fetchDetail(activeId);
    } else {
      setError(r.error);
    }
  }, [activeId, fetchCampaigns, fetchDetail]);

  const deleteCampaign = useCallback(async () => {
    if (!activeId) return;
    if (typeof window !== "undefined" && !window.confirm("Delete this campaign permanently? Character and event log will be lost.")) return;
    const r = await apiSend("DELETE", `/magister/dm/campaigns/${activeId}`, null);
    if (r.ok) {
      setError(null);
      setActionStatus("Campaign deleted.");
      setTimeout(() => setActionStatus(null), 2500);
      await fetchCampaigns();
      setCampaigns((prev) => {
        const remaining = prev.filter((c) => c.id !== activeId);
        setActiveId(remaining[0]?.id ?? null);
        return remaining;
      });
    } else {
      setError(r.error);
    }
  }, [activeId, fetchCampaigns]);

  const narrate = useCallback(async (style: NarrationStyle, onSetNarrating: (b: boolean) => void) => {
    if (!activeId) return;
    onSetNarrating(true);
    const r = await apiSend("POST", `/magister/dm/campaigns/${activeId}/narrate`, { style, limit: 8 });
    if (r.ok) {
      setError(null);
      setActionStatus("Narration added to log.");
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
    onSetNarrating(false);
  }, [activeId, fetchDetail]);

  return {
    campaigns, activeId, setActiveId, campaign, character, events,
    loading, error, setError, actionStatus, setActionStatus, lastRoll,
    fetchCampaigns, fetchDetail,
    createCampaign, createCharacter, rollDice, submitTurn,
    rest, archiveCampaign, deleteCampaign, narrate,
  };
}
