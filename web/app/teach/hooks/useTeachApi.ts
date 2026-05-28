"use client";

/**
 * useTeachApi — lessons list + active lesson + chat send + recap.
 * Extracted from teach/page.tsx on 2026-05-22. Behavior preserved
 * including optimistic user-turn insertion and re-fetch on completion.
 */

import { useCallback, useEffect, useState } from "react";
import { API_BASE, type Depth, type Lesson, type Turn } from "../types";

export interface TeachApi {
  lessons: Lesson[];
  activeId: string | null;
  setActiveId: React.Dispatch<React.SetStateAction<string | null>>;
  active: Lesson | null;
  setActive: React.Dispatch<React.SetStateAction<Lesson | null>>;
  turns: Turn[];
  setTurns: React.Dispatch<React.SetStateAction<Turn[]>>;
  sending: boolean;
  recapBusy: boolean;
  error: string | null;
  setError: React.Dispatch<React.SetStateAction<string | null>>;

  fetchLessons: () => Promise<void>;
  fetchLesson: (id: string) => Promise<Turn[] | null>;
  createLesson: (title: string) => Promise<Lesson | null>;
  deleteLesson: (lessonId: string, lessonTitle: string) => Promise<void>;
  setDepth: (depth: Depth) => Promise<void>;
  /**
   * Send a chat message. Returns the refreshed turn list (or null on error)
   * so the page can fire-and-forget reply-TTS without re-querying.
   * `onBeforeSend` runs after state is reset; use it to stop any audio.
   */
  send: (message: string, onBeforeSend: () => void) => Promise<{ ok: boolean; turns: Turn[] | null }>;
  recap: () => Promise<void>;
}

export function useTeachApi(): TeachApi {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [active, setActive] = useState<Lesson | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [sending, setSending] = useState(false);
  const [recapBusy, setRecapBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLessons = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/nusika/lessons`);
      if (!res.ok) return;
      const data = (await res.json()) as { lessons?: Lesson[] };
      setLessons(data.lessons ?? []);
    } catch { /* silent */ }
  }, []);

  const fetchLesson = useCallback(async (id: string): Promise<Turn[] | null> => {
    try {
      const res = await fetch(`${API_BASE}/nusika/lessons/${id}`);
      if (!res.ok) return null;
      const data = (await res.json()) as { lesson?: Lesson; turns?: Turn[] };
      if (data.lesson) setActive(data.lesson);
      const next = data.turns ?? [];
      setTurns(next);
      return next;
    } catch { /* silent */ }
    return null;
  }, []);

  // Initial load + active-id-driven detail fetch (mirror of original effects).
  useEffect(() => { void fetchLessons(); }, [fetchLessons]);
  useEffect(() => {
    if (activeId) void fetchLesson(activeId);
    else { setActive(null); setTurns([]); }
  }, [activeId, fetchLesson]);

  const createLesson = useCallback(async (title: string): Promise<Lesson | null> => {
    const t = title.trim();
    if (!t) return null;
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/nusika/lessons`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: t }),
      });
      if (!res.ok) {
        setError("Could not create lesson.");
        return null;
      }
      const data = (await res.json()) as { lesson?: Lesson };
      await fetchLessons();
      if (data.lesson) {
        setActiveId(data.lesson.id);
        return data.lesson;
      }
    } catch {
      setError("Could not create lesson.");
    }
    return null;
  }, [fetchLessons]);

  const deleteLesson = useCallback(async (lessonId: string, lessonTitle: string) => {
    if (typeof window !== "undefined" && !window.confirm(`Delete lesson "${lessonTitle}"? This cannot be undone.`)) return;
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/nusika/lessons/${lessonId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `Delete failed (HTTP ${res.status}).`);
        return;
      }
      // Pick a sensible next selection: the most recent remaining lesson.
      if (activeId === lessonId) {
        const remaining = lessons.filter((l) => l.id !== lessonId);
        setActiveId(remaining[0]?.id ?? null);
      }
      await fetchLessons();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    }
  }, [activeId, lessons, fetchLessons]);

  const setDepth = useCallback(async (depth: Depth) => {
    if (!active) return;
    setActive({ ...active, depth });
    try {
      await fetch(`${API_BASE}/nusika/lessons/${active.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ depth }),
      });
    } catch { /* silent */ }
  }, [active]);

  const send = useCallback(async (message: string, onBeforeSend: () => void): Promise<{ ok: boolean; turns: Turn[] | null }> => {
    if (!active || !message.trim() || sending) return { ok: false, turns: null };
    const msg = message.trim();
    setSending(true);
    setError(null);
    onBeforeSend();

    // Optimistic user turn so the UI shows it immediately.
    const optimistic: Turn = {
      id: `optimistic-${Date.now()}`,
      lesson_id: active.id, role: "user", content: msg,
      depth_at: active.depth, model: null, provider: null,
      tokens_in: null, tokens_out: null,
      created_at: new Date().toISOString(),
    };
    setTurns((prev) => [...prev, optimistic]);

    let chatOk = true;
    let freshTurns: Turn[] | null = null;
    try {
      const res = await fetch(`${API_BASE}/nusika/lessons/${active.id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, depth: active.depth }),
      });
      if (!res.ok) {
        chatOk = false;
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (res.status === 502) {
          setError(`Varros is unavailable: ${data.error ?? "no LLM backend reachable."}`);
        } else {
          setError(data.error ?? `HTTP ${res.status}`);
        }
      }
      freshTurns = await fetchLesson(active.id);
    } catch (err) {
      chatOk = false;
      setError(err instanceof Error ? err.message : "Send failed.");
      freshTurns = await fetchLesson(active.id);
    }
    setSending(false);
    return { ok: chatOk, turns: freshTurns };
  }, [active, sending, fetchLesson]);

  const recap = useCallback(async () => {
    if (!active || recapBusy) return;
    setRecapBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/nusika/lessons/${active.id}/recap`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? `Recap failed (HTTP ${res.status}).`);
      } else {
        await fetchLesson(active.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Recap failed.");
    }
    setRecapBusy(false);
  }, [active, recapBusy, fetchLesson]);

  return {
    lessons, activeId, setActiveId, active, setActive, turns, setTurns,
    sending, recapBusy, error, setError,
    fetchLessons, fetchLesson,
    createLesson, deleteLesson, setDepth, send, recap,
  };
}
