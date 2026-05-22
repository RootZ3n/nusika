"use client";

/**
 * useMagisterApi — central data hook for the root Magister UI.
 *
 * Owns:
 *   - Module + session lists (and the derived streak).
 *   - Module progress + companion memories (lazy, by id).
 *   - Product config: accessibility settings + narrator identity.
 *   - Inkwell drafts list + write/delete helpers.
 *
 * All fetches go through /api/proxy/* (web -> Magister API). The hook
 * exposes fetchers as stable `useCallback`s and state via plain returns —
 * components and other hooks `const { modules } = useMagisterApi()` and
 * compose freely.
 *
 * Lifted from the original page.tsx without behavior changes. Anywhere the
 * original code silently swallowed errors, this hook does the same — the
 * UI surfaces failure through the ServiceHealthBanner instead.
 */

import { useCallback, useEffect, useState } from "react";
import {
  API_BASE,
  DEFAULT_NARRATOR,
  type AccessibilitySettings,
  type CompanionMemory,
  type InkwellDraft,
  type MagisterModule,
  type MagisterSession,
  type ModuleProgress,
  type NarratorIdentity,
} from "../types";

export interface MagisterApi {
  // Module/session listings.
  modules: MagisterModule[];
  setModules: React.Dispatch<React.SetStateAction<MagisterModule[]>>;
  sessions: MagisterSession[];
  streak: number;
  loading: boolean;
  error: string | null;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  refreshSessions: () => Promise<void>;

  // Module progress + companion memories (lazy).
  moduleProgress: ModuleProgress | null;
  setModuleProgress: React.Dispatch<React.SetStateAction<ModuleProgress | null>>;
  companionMemories: CompanionMemory[];
  setCompanionMemories: React.Dispatch<React.SetStateAction<CompanionMemory[]>>;
  fetchProgress: (moduleId: string) => Promise<void>;
  fetchMemories: (companionId: string) => Promise<void>;

  // Session detail (raw fetch — the caller orchestrates UI state).
  fetchSessionDetail: (sessionId: string) => Promise<MagisterSession | null>;

  // Product config: a11y + narrator.
  narrator: NarratorIdentity;
  sessionSettings: AccessibilitySettings | null;
  setSessionSettings: React.Dispatch<React.SetStateAction<AccessibilitySettings | null>>;
  useDyslexicFont: boolean;
  setUseDyslexicFont: React.Dispatch<React.SetStateAction<boolean>>;
  wideLetterSpacing: boolean;
  setWideLetterSpacing: React.Dispatch<React.SetStateAction<boolean>>;
  comfortMode: boolean;
  setComfortMode: React.Dispatch<React.SetStateAction<boolean>>;
  ambientVolume: number;
  setAmbientVolume: React.Dispatch<React.SetStateAction<number>>;

  // Inkwell drafts.
  inkwellDrafts: InkwellDraft[];
  fetchInkwellDrafts: () => Promise<void>;
  saveInkwellDraft: (input: { title: string; content: string; feedback?: string }) => Promise<boolean>;
  deleteInkwellDraft: (draftId: string) => Promise<boolean>;
  inkwellFeedback: (input: { content: string; title?: string }) => Promise<{ ok: boolean; feedback?: string; error?: string }>;
}

export function useMagisterApi(): MagisterApi {
  const [modules, setModules] = useState<MagisterModule[]>([]);
  const [sessions, setSessions] = useState<MagisterSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [streak, setStreak] = useState(0);

  const [moduleProgress, setModuleProgress] = useState<ModuleProgress | null>(null);
  const [companionMemories, setCompanionMemories] = useState<CompanionMemory[]>([]);

  const [sessionSettings, setSessionSettings] = useState<AccessibilitySettings | null>(null);
  const [narrator, setNarrator] = useState<NarratorIdentity>(DEFAULT_NARRATOR);
  const [useDyslexicFont, setUseDyslexicFont] = useState(false);
  const [wideLetterSpacing, setWideLetterSpacing] = useState(false);
  const [comfortMode, setComfortMode] = useState(false);
  const [ambientVolume, setAmbientVolume] = useState(0.15);

  const [inkwellDrafts, setInkwellDrafts] = useState<InkwellDraft[]>([]);

  // ── Fetchers ─────────────────────────────────────────────────────────────

  const fetchModules = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/magister/modules`);
      if (res.ok) {
        const data = await res.json();
        setModules(Array.isArray(data) ? data : data.modules ?? []);
      }
    } catch { /* silent — ServiceHealthBanner reflects API outages */ }
  }, []);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/magister/sessions`);
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data) ? data : data.sessions ?? [];
        setSessions(list);
        // Derive streak from session updated_at timestamps — same algorithm
        // as the original inline code.
        const dates = new Set((list ?? []).map((s: MagisterSession) => new Date(s.updated_at).toDateString()));
        let streakCount = 0;
        const today = new Date();
        for (let i = 0; i < 365; i++) {
          const d = new Date(today);
          d.setDate(d.getDate() - i);
          if (dates.has(d.toDateString())) {
            streakCount++;
          } else if (i > 0) {
            break;
          }
        }
        setStreak(streakCount);
      }
    } catch { /* silent */ }
  }, []);

  const fetchProductConfig = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/magister/config`);
      if (!res.ok) return;
      const data = (await res.json()) as { config?: AccessibilitySettings; narrator?: NarratorIdentity };
      const settings = data.config ?? null;
      setSessionSettings(settings);
      if (data.narrator) setNarrator(data.narrator);
      if (settings) {
        setUseDyslexicFont(!!settings.dyslexic_font);
        setWideLetterSpacing(!!settings.wide_spacing);
        setAmbientVolume(typeof settings.narration_volume === "number" ? settings.narration_volume : 0.15);
        setComfortMode(!!settings.comfort_mode);
      }
    } catch { /* silent */ }
  }, []);

  const fetchProgress = useCallback(async (moduleId: string) => {
    try {
      const res = await fetch(`${API_BASE}/magister/progress/${moduleId}`);
      if (res.ok) {
        const data = await res.json();
        // API returns { ok, progress: [], readiness: { readinessPercent } }
        setModuleProgress({
          module_id: moduleId,
          concepts: Array.isArray(data.progress) ? data.progress : Array.isArray(data.concepts) ? data.concepts : [],
          exam_readiness: data.readiness?.readinessPercent ?? data.exam_readiness ?? null,
        });
      }
    } catch { /* silent */ }
  }, []);

  const fetchMemories = useCallback(async (companionId: string) => {
    try {
      const res = await fetch(`${API_BASE}/magister/memory/${companionId}`);
      if (res.ok) {
        const data = await res.json();
        setCompanionMemories(Array.isArray(data) ? data : data.memories ?? []);
      }
    } catch { /* silent */ }
  }, []);

  const fetchSessionDetail = useCallback(async (sessionId: string): Promise<MagisterSession | null> => {
    try {
      const res = await fetch(`${API_BASE}/magister/sessions/${sessionId}`);
      if (res.ok) {
        const data = await res.json();
        return (data.session ?? data) as MagisterSession;
      }
    } catch { /* silent */ }
    return null;
  }, []);

  // ── Inkwell ──────────────────────────────────────────────────────────────

  const fetchInkwellDrafts = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/magister/inkwell/drafts`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        ok?: boolean;
        drafts?: Array<{ id: string; title: string | null; content: string | null; feedback: string | null; createdAt: string }>;
      };
      const drafts = (data.drafts ?? []).map((d) => ({
        id: d.id,
        title: d.title ?? "Untitled Draft",
        content: d.content ?? "",
        feedback: d.feedback ?? undefined,
        createdAt: new Date(d.createdAt).getTime(),
      }));
      setInkwellDrafts(drafts);
    } catch { /* silent */ }
  }, []);

  const saveInkwellDraft = useCallback(
    async (input: { title: string; content: string; feedback?: string }): Promise<boolean> => {
      try {
        const res = await fetch(`${API_BASE}/magister/inkwell/drafts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: input.title,
            content: input.content,
            ...(input.feedback ? { feedback: input.feedback } : {}),
          }),
        });
        if (res.ok) {
          await fetchInkwellDrafts();
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },
    [fetchInkwellDrafts],
  );

  const deleteInkwellDraft = useCallback(
    async (draftId: string): Promise<boolean> => {
      try {
        const res = await fetch(`${API_BASE}/magister/inkwell/drafts/${draftId}`, { method: "DELETE" });
        if (res.ok) {
          await fetchInkwellDrafts();
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },
    [fetchInkwellDrafts],
  );

  const inkwellFeedback = useCallback(
    async (input: { content: string; title?: string }): Promise<{ ok: boolean; feedback?: string; error?: string }> => {
      try {
        const res = await fetch(`${API_BASE}/magister/inkwell/feedback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: input.content,
            ...(input.title ? { title: input.title } : {}),
          }),
        });
        const data = (await res.json()) as { ok?: boolean; feedback?: string; error?: string; detail?: string };
        if (res.ok && data.ok && typeof data.feedback === "string") {
          return { ok: true, feedback: data.feedback };
        }
        return { ok: false, error: data.error ?? `HTTP ${res.status}` };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    [],
  );

  // ── Initial load ─────────────────────────────────────────────────────────

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchModules(), fetchSessions(), fetchProductConfig()]).finally(() => setLoading(false));
  }, [fetchModules, fetchSessions, fetchProductConfig]);

  // Debounced sync of accessibility settings back to the server. Same logic
  // as the original `useEffect` in page.tsx — fires 250ms after the last
  // change to any tracked toggle.
  useEffect(() => {
    if (!sessionSettings) return;
    const next: AccessibilitySettings = {
      ...sessionSettings,
      dyslexic_font: useDyslexicFont,
      wide_spacing: wideLetterSpacing,
      narration_volume: ambientVolume,
      comfort_mode: comfortMode,
    };
    const timeout = setTimeout(() => {
      setSessionSettings(next);
      fetch(`${API_BASE}/magister/settings/accessibility`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      }).catch(() => {});
    }, 250);
    return () => clearTimeout(timeout);
  }, [useDyslexicFont, wideLetterSpacing, ambientVolume, comfortMode, sessionSettings]);

  // OpenDyslexic font loader — appends a CDN <link> when the toggle is on
  // and removes it otherwise.
  useEffect(() => {
    if (useDyslexicFont) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href =
        "https://cdnjs.cloudflare.com/ajax/libs/open-dyslexic/latest/OpenDyslexic.css";
      link.id = "opendyslexic-css";
      document.head.appendChild(link);
      return () => {
        document.getElementById("opendyslexic-css")?.remove();
      };
    } else {
      document.getElementById("opendyslexic-css")?.remove();
    }
  }, [useDyslexicFont]);

  return {
    modules,
    setModules,
    sessions,
    streak,
    loading,
    error,
    setError,
    refreshSessions: fetchSessions,

    moduleProgress,
    setModuleProgress,
    companionMemories,
    setCompanionMemories,
    fetchProgress,
    fetchMemories,

    fetchSessionDetail,

    narrator,
    sessionSettings,
    setSessionSettings,
    useDyslexicFont,
    setUseDyslexicFont,
    wideLetterSpacing,
    setWideLetterSpacing,
    comfortMode,
    setComfortMode,
    ambientVolume,
    setAmbientVolume,

    inkwellDrafts,
    fetchInkwellDrafts,
    saveInkwellDraft,
    deleteInkwellDraft,
    inkwellFeedback,
  };
}
