"use client";

/**
 * Teach Me Anything (Varros) — standalone screen.
 *
 * Lives outside web/app/page.tsx by design so the existing 2400-line
 * Hall/Session/Map/Inkwell monolith doesn't grow further. Talks to the same
 * /api/proxy backend everything else uses.
 *
 * UI:
 *  - Left: lesson list + "new lesson" form
 *  - Right: chat with Varros + depth toggle + summary panel
 *
 * Lookups: when the model says "I'd want to look this up", we do nothing
 * automatic — the lookup hook is intentionally a placeholder server-side.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { MarkdownMessage } from "../components/MarkdownMessage";
import {
  labelVoiceProfile,
  pickInitialVoice,
  readStoredVoiceId,
  sortVoiceOptions,
  writeStoredVoiceId,
  TEACH_VOICE_KEY,
  type VoiceOption,
} from "../lib/voice-picker";

const API_BASE = "/api/proxy";
const ACCENT = "#a78bfa";
const ACCENT_DIM = "rgba(167,139,250,0.10)";

// Slice 6H — opt-in auto-play TTS for assistant replies. Off by default;
// the value is mirrored to localStorage so the choice survives reload.
const AUTOPLAY_KEY = "magister.teach.autoplayVoice";
const VOICE_UNAVAILABLE_MSG = "Voice playback unavailable. Start the Kokoro service or choose another voice.";

/** Strip light markdown so TTS narration doesn't speak '**' or '##'. */
function stripForTTS(text: string): string {
  return text
    .replace(/\*\*([\s\S]*?)\*\*/g, "$1")
    .replace(/\*([\s\S]*?)\*/g, "$1")
    .replace(/#{1,6}\s+/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

type Depth = "intro" | "deeper" | "example" | "practice" | "review";
type Status = "active" | "paused" | "complete";

const DEPTHS: { key: Depth; label: string; hint: string }[] = [
  { key: "intro",    label: "Intro",    hint: "Start at the beginning, plain language." },
  { key: "deeper",   label: "Deeper",   hint: "Go one level deeper into mechanism." },
  { key: "example",  label: "Example",  hint: "Lead with a concrete example." },
  { key: "practice", label: "Practice", hint: "Give me something to try." },
  { key: "review",   label: "Review",   hint: "Summarize what we've covered." },
];

interface Lesson {
  id: string;
  title: string;
  topic: string;
  depth: Depth;
  status: Status;
  summary: string | null;
  knowledge: string;
  turn_count: number;
  created_at: string;
  updated_at: string;
}

interface Turn {
  id: string;
  lesson_id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  depth_at: Depth | null;
  model: string | null;
  provider: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  created_at: string;
}

interface VoiceCacheStatus {
  bytes: number;
  maxBytes: number;
  mb: number;
  maxMb: number;
}

export default function TeachPage() {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [active, setActive] = useState<Lesson | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [newTitle, setNewTitle] = useState("");
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recapBusy, setRecapBusy] = useState(false);

  // Voice picker (Slice 6F + 6G)
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>("varros-default");
  const [previewing, setPreviewing] = useState(false);
  const [voiceMsg, setVoiceMsg] = useState<string | null>(null);
  const [voiceCache, setVoiceCache] = useState<VoiceCacheStatus | null>(null);

  // Slice 6H — opt-in auto-play of assistant replies + manual "Play latest".
  const [autoplayVoice, setAutoplayVoice] = useState(false);
  const [playingReply, setPlayingReply] = useState(false);
  const audioRef = useRef<{ audio: HTMLAudioElement; url: string } | null>(null);

  const selectedVoice = voices.find(v => v.id === selectedVoiceId) ?? null;

  const fetchLessons = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/magister/lessons`);
      if (!res.ok) return;
      const data = await res.json() as { lessons?: Lesson[] };
      setLessons(data.lessons ?? []);
    } catch { /* silent */ }
  }, []);

  const fetchLesson = useCallback(async (id: string): Promise<Turn[] | null> => {
    try {
      const res = await fetch(`${API_BASE}/magister/lessons/${id}`);
      if (!res.ok) return null;
      const data = await res.json() as { lesson?: Lesson; turns?: Turn[] };
      if (data.lesson) setActive(data.lesson);
      const next = data.turns ?? [];
      setTurns(next);
      return next;
    } catch { /* silent */ }
    return null;
  }, []);

  // Voice picker (Slice 6G): fetch the full voice list, restore the
  // localStorage-stored selection, fall back to Varros when stored
  // selection is missing or no longer in the registry.
  const fetchVoices = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/magister/voices`);
      if (!res.ok) return;
      const data = await res.json() as { voices?: VoiceOption[] };
      const list = sortVoiceOptions(data.voices ?? []);
      setVoices(list);
      const stored = readStoredVoiceId(TEACH_VOICE_KEY);
      const initial = pickInitialVoice(list, stored, "varros-default");
      if (initial) setSelectedVoiceId(initial.id);
    } catch { /* silent */ }
  }, []);

  const onSelectVoice = useCallback((id: string) => {
    setSelectedVoiceId(id);
    writeStoredVoiceId(TEACH_VOICE_KEY, id);
    setVoiceMsg(null);
  }, []);

  const fetchVoiceCache = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/magister/voices/cache`);
      if (!res.ok) return;
      const data = await res.json() as VoiceCacheStatus & { ok?: boolean };
      setVoiceCache({ bytes: data.bytes, maxBytes: data.maxBytes, mb: data.mb, maxMb: data.maxMb });
    } catch { /* silent */ }
  }, []);

  const previewVoice = useCallback(async () => {
    if (!selectedVoice || previewing) return;
    setPreviewing(true);
    setVoiceMsg(null);
    // Use the companion display name for the spoken sample so the preview
    // sentence reads naturally regardless of which voice is picked.
    const speakerName = selectedVoice.display_name.replace(/\s*\(default voice\)\s*$/i, "").trim()
      || selectedVoice.companion_id
      || "a Magister voice";
    try {
      const url = `${API_BASE}/magister/voices/preview/${encodeURIComponent(selectedVoice.engine)}/${encodeURIComponent(selectedVoice.voice_ref)}?name=${encodeURIComponent(speakerName)}`;
      const res = await fetch(url);
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        if (res.status === 503) {
          setVoiceMsg(data.error ?? "Voice preview unavailable. Start the Kokoro service to enable previews.");
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

  // ── Slice 6H — assistant-reply TTS playback ───────────────────────────────

  /** Stop any in-flight reply audio and free its blob URL. Safe to call repeatedly. */
  const stopReplyAudio = useCallback(() => {
    const cur = audioRef.current;
    if (!cur) return;
    try { cur.audio.onended = null; } catch { /* ignore */ }
    try { cur.audio.pause(); } catch { /* ignore */ }
    try { URL.revokeObjectURL(cur.url); } catch { /* ignore */ }
    audioRef.current = null;
    setPlayingReply(false);
  }, []);

  /**
   * Fetch a TTS clip for `text` using the picker's selected voice and play it.
   * Falls back to "varros-default" if the picker selection is no longer in
   * the registry. Failures surface as a small voiceMsg line — the lesson
   * chat stream is never blocked or marked as failed.
   */
  const playReplyTTS = useCallback(async (text: string) => {
    const clean = stripForTTS(text);
    if (!clean) return;

    stopReplyAudio();
    const voiceId = voices.some(v => v.id === selectedVoiceId) ? selectedVoiceId : "varros-default";
    setVoiceMsg(null);
    setPlayingReply(true);

    let createdUrl: string | null = null;
    try {
      const res = await fetch(`${API_BASE}/magister/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: clean, voice: voiceId }),
      });
      if (!res.ok) {
        setVoiceMsg(VOICE_UNAVAILABLE_MSG);
        setPlayingReply(false);
        void fetchVoiceCache();
        return;
      }
      const blob = await res.blob();
      createdUrl = URL.createObjectURL(blob);
      const url = createdUrl;
      const audio = new Audio(url);
      audioRef.current = { audio, url };
      audio.onended = () => {
        try { URL.revokeObjectURL(url); } catch { /* ignore */ }
        if (audioRef.current?.audio === audio) audioRef.current = null;
        setPlayingReply(false);
      };
      try {
        await audio.play();
      } catch {
        // Browser autoplay policy or other playback rejection — clean up
        // without crashing and leave a small note for the user.
        if (audioRef.current?.audio === audio) audioRef.current = null;
        try { URL.revokeObjectURL(url); } catch { /* ignore */ }
        setVoiceMsg(VOICE_UNAVAILABLE_MSG);
        setPlayingReply(false);
      }
      void fetchVoiceCache();
    } catch {
      if (createdUrl) {
        try { URL.revokeObjectURL(createdUrl); } catch { /* ignore */ }
      }
      setVoiceMsg(VOICE_UNAVAILABLE_MSG);
      setPlayingReply(false);
    }
  }, [voices, selectedVoiceId, stopReplyAudio, fetchVoiceCache]);

  /** Manual replay of the most recent assistant reply. Useful when auto voice is off. */
  const playLatestReply = useCallback(() => {
    for (let i = turns.length - 1; i >= 0; i -= 1) {
      const t = turns[i];
      if (t && t.role === "assistant" && t.content) {
        void playReplyTTS(t.content);
        return;
      }
    }
    setVoiceMsg("No assistant reply yet.");
  }, [turns, playReplyTTS]);

  const onToggleAutoplay = useCallback((next: boolean) => {
    setAutoplayVoice(next);
    if (typeof window !== "undefined") {
      try { window.localStorage.setItem(AUTOPLAY_KEY, next ? "true" : "false"); } catch { /* ignore */ }
    }
    if (!next) stopReplyAudio();
  }, [stopReplyAudio]);

  const clearVoiceCache = useCallback(async () => {
    if (typeof window !== "undefined" && !window.confirm("Clear the voice cache? Generated voice WAVs will be removed.")) return;
    try {
      const res = await fetch(`${API_BASE}/magister/voices/cache`, { method: "DELETE" });
      if (res.ok) {
        setVoiceMsg("Voice cache cleared.");
        setTimeout(() => setVoiceMsg(null), 2500);
      } else {
        setVoiceMsg(`Could not clear cache (HTTP ${res.status}).`);
      }
    } catch (err) {
      setVoiceMsg(err instanceof Error ? err.message : "Cache clear failed.");
    }
    void fetchVoiceCache();
  }, [fetchVoiceCache]);

  useEffect(() => { void fetchLessons(); }, [fetchLessons]);
  useEffect(() => { void fetchVoices(); void fetchVoiceCache(); }, [fetchVoices, fetchVoiceCache]);
  useEffect(() => {
    if (activeId) void fetchLesson(activeId);
    else { setActive(null); setTurns([]); }
  }, [activeId, fetchLesson]);

  // Slice 6H — restore the auto-voice toggle from localStorage on mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(AUTOPLAY_KEY);
      if (stored === "true") setAutoplayVoice(true);
    } catch { /* ignore */ }
  }, []);

  // Slice 6H — pause + revoke any in-flight reply audio when the page unmounts.
  useEffect(() => {
    return () => { stopReplyAudio(); };
  }, [stopReplyAudio]);

  const createLesson = useCallback(async () => {
    const title = newTitle.trim();
    if (!title) return;
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/magister/lessons`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) {
        setError("Could not create lesson.");
        return;
      }
      const data = await res.json() as { lesson?: Lesson };
      setNewTitle("");
      await fetchLessons();
      if (data.lesson) setActiveId(data.lesson.id);
    } catch {
      setError("Could not create lesson.");
    }
  }, [newTitle, fetchLessons]);

  const deleteLesson = useCallback(async (lessonId: string, lessonTitle: string) => {
    if (typeof window !== "undefined" && !window.confirm(`Delete lesson "${lessonTitle}"? This cannot be undone.`)) return;
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/magister/lessons/${lessonId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        setError(data.error ?? `Delete failed (HTTP ${res.status}).`);
        return;
      }
      // Pick a sensible next selection: the most recent remaining lesson, or none.
      if (activeId === lessonId) {
        const remaining = lessons.filter(l => l.id !== lessonId);
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
      await fetch(`${API_BASE}/magister/lessons/${active.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ depth }),
      });
    } catch { /* silent */ }
  }, [active]);

  const send = useCallback(async () => {
    if (!active || !input.trim() || sending) return;
    const message = input.trim();
    setInput("");
    setSending(true);
    setError(null);

    // Stop any prior assistant-reply audio so the user isn't talked over
    // while their next message is being processed.
    stopReplyAudio();

    // Optimistic user turn so the UI shows it immediately.
    const optimistic: Turn = {
      id: `optimistic-${Date.now()}`,
      lesson_id: active.id, role: "user", content: message,
      depth_at: active.depth, model: null, provider: null,
      tokens_in: null, tokens_out: null,
      created_at: new Date().toISOString(),
    };
    setTurns(prev => [...prev, optimistic]);

    let chatOk = true;
    let freshTurns: Turn[] | null = null;
    try {
      const res = await fetch(`${API_BASE}/magister/lessons/${active.id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, depth: active.depth }),
      });
      if (!res.ok) {
        chatOk = false;
        const data = await res.json().catch(() => ({})) as { error?: string };
        if (res.status === 502) {
          setError(`Varros is unavailable: ${data.error ?? "no LLM backend reachable."}`);
        } else {
          setError(data.error ?? `HTTP ${res.status}`);
        }
      }
      // Refresh to get the persisted turns from the server (replaces our optimistic one).
      freshTurns = await fetchLesson(active.id);
    } catch (err) {
      chatOk = false;
      setError(err instanceof Error ? err.message : "Send failed.");
      freshTurns = await fetchLesson(active.id);
    }
    setSending(false);

    // Slice 6H — fire-and-forget: text is already on screen at this point.
    // We never block the chat send on TTS, never retry, and never elevate
    // a TTS error to a chat error.
    if (chatOk && autoplayVoice && freshTurns && freshTurns.length > 0) {
      const last = freshTurns[freshTurns.length - 1];
      if (last && last.role === "assistant" && last.content) {
        void playReplyTTS(last.content);
      }
    }
  }, [active, input, sending, fetchLesson, autoplayVoice, playReplyTTS, stopReplyAudio]);

  const recap = useCallback(async () => {
    if (!active || recapBusy) return;
    setRecapBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/magister/lessons/${active.id}/recap`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({})) as { ok?: boolean; error?: string };
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

  // ── Styles ────────────────────────────────────────────────────────────────

  const shell: React.CSSProperties = {
    display: "flex", height: "100vh", minHeight: 0,
    fontFamily: "var(--font-body, system-ui, sans-serif)",
    background: "var(--bg-void, #060810)", color: "var(--text-primary, #e7e5f0)",
  };
  const sidebar: React.CSSProperties = {
    width: 280, flexShrink: 0, padding: 16,
    borderRight: "1px solid var(--border, rgba(255,255,255,0.08))",
    display: "flex", flexDirection: "column", gap: 12, overflow: "hidden",
  };
  const main: React.CSSProperties = { flex: 1, display: "flex", flexDirection: "column", minHeight: 0 };
  const btnPrimary: React.CSSProperties = {
    background: ACCENT, color: "#060810", border: "none", borderRadius: 8,
    padding: "8px 14px", fontSize: 14, fontWeight: 600, cursor: "pointer",
  };
  const btnGhost: React.CSSProperties = {
    background: "transparent", color: "var(--text-secondary, #b8b6c3)",
    border: "1px solid var(--border, rgba(255,255,255,0.12))",
    borderRadius: 8, padding: "6px 12px", fontSize: 13, cursor: "pointer",
  };
  const pill = (active: boolean): React.CSSProperties => ({
    background: active ? ACCENT_DIM : "transparent",
    color: active ? ACCENT : "var(--text-muted, #888)",
    border: `1px solid ${active ? ACCENT : "var(--border, rgba(255,255,255,0.12))"}`,
    borderRadius: 18, padding: "4px 12px", fontSize: 12, cursor: "pointer",
    whiteSpace: "nowrap",
  });

  return (
    <div style={shell}>
      {/* ── Sidebar: lesson list ────────────────────────────────────────── */}
      <aside style={sidebar}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Teach Me Anything</h1>
          <Link href="/" style={{ fontSize: 12, color: ACCENT, marginLeft: "auto", textDecoration: "none" }}>← Hall</Link>
        </div>
        <p style={{ fontSize: 12, color: "var(--text-muted, #888)", margin: 0, lineHeight: 1.5 }}>
          Open-ended lessons with Varros. Pick a topic and start.
        </p>

        <div style={{ display: "flex", gap: 6 }}>
          <input
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") void createLesson(); }}
            placeholder="Lesson title (e.g. compound interest)"
            style={{
              flex: 1, padding: "8px 10px", borderRadius: 8,
              border: "1px solid var(--border, rgba(255,255,255,0.12))",
              background: "rgba(255,255,255,0.03)", color: "inherit",
              fontFamily: "inherit", fontSize: 13,
            }}
          />
          <button style={btnPrimary} onClick={() => void createLesson()}>Start</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
          {lessons.length === 0 && (
            <div style={{ fontSize: 13, color: "var(--text-muted, #888)", padding: 8 }}>
              No lessons yet.
            </div>
          )}
          {lessons.map(l => (
            <div key={l.id} style={{ display: "flex", gap: 4, alignItems: "stretch" }}>
              <button
                onClick={() => setActiveId(l.id)}
                style={{
                  ...btnGhost,
                  flex: 1, minWidth: 0,
                  textAlign: "left",
                  background: activeId === l.id ? ACCENT_DIM : "transparent",
                  borderColor: activeId === l.id ? ACCENT : "var(--border, rgba(255,255,255,0.12))",
                  color: activeId === l.id ? ACCENT : "var(--text-secondary, #b8b6c3)",
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {l.title}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted, #888)" }}>
                  {l.depth} · {l.turn_count} turn{l.turn_count === 1 ? "" : "s"} · {l.status}
                </div>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); void deleteLesson(l.id, l.title); }}
                aria-label="Delete lesson"
                title="Delete lesson"
                style={{ ...btnGhost, flex: "0 0 28px", padding: "0 8px", color: "var(--text-muted, #888)", fontSize: 14 }}
              >✕</button>
            </div>
          ))}
        </div>
      </aside>

      {/* ── Main: chat ──────────────────────────────────────────────────── */}
      <main style={main}>
        {!active && (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted, #888)", padding: 32, textAlign: "center" }}>
            Pick a lesson on the left, or start a new one. Varros will meet you here.
          </div>
        )}

        {active && (
          <>
            <header style={{
              padding: "12px 20px",
              borderBottom: "1px solid var(--border, rgba(255,255,255,0.08))",
              display: "flex", flexDirection: "column", gap: 8,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
                <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{active.title}</h2>
                <button style={btnGhost} disabled={recapBusy || turns.length === 0} onClick={() => void recap()}>
                  {recapBusy ? "Recapping…" : "Update summary"}
                </button>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {DEPTHS.map(d => (
                  <button key={d.key} style={pill(active.depth === d.key)} onClick={() => void setDepth(d.key)} title={d.hint}>
                    {d.label}
                  </button>
                ))}
              </div>

              {/* Voice picker (Slice 6G) */}
              {voices.length > 0 && selectedVoice && (
                <div style={{
                  display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center",
                  fontSize: 12, color: "var(--text-muted, #888)",
                  padding: "4px 0",
                }}>
                  <label style={{
                    fontFamily: "var(--font-mono, monospace)", fontSize: 11,
                    color: ACCENT, letterSpacing: "0.06em", textTransform: "uppercase",
                  }}>
                    Voice
                  </label>
                  <select
                    value={selectedVoiceId}
                    onChange={e => onSelectVoice(e.target.value)}
                    aria-label="Select voice for preview"
                    style={{
                      fontFamily: "var(--font-mono, monospace)", fontSize: 12,
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
                    style={{ ...btnGhost, fontSize: 12, padding: "3px 10px" }}
                    onClick={() => void previewVoice()}
                    disabled={previewing}
                    aria-label="Preview selected voice"
                  >
                    {previewing ? "Playing…" : "Preview"}
                  </button>
                  {/* Slice 6H — opt-in auto-play TTS for assistant replies */}
                  <label
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      fontSize: 12, color: "var(--text-secondary, #b8b6c3)",
                      cursor: "pointer", userSelect: "none",
                    }}
                    title="Play assistant replies aloud with the selected voice"
                  >
                    <input
                      type="checkbox"
                      checked={autoplayVoice}
                      onChange={e => onToggleAutoplay(e.target.checked)}
                      aria-label="Auto-play assistant replies"
                      style={{ accentColor: ACCENT, cursor: "pointer" }}
                    />
                    Auto voice
                  </label>
                  <button
                    style={{ ...btnGhost, fontSize: 12, padding: "3px 10px" }}
                    onClick={() => playLatestReply()}
                    disabled={playingReply || turns.every(t => t.role !== "assistant")}
                    aria-label="Play latest assistant reply"
                    title="Play the latest assistant reply with the selected voice"
                  >
                    {playingReply ? "Playing…" : "Play latest"}
                  </button>
                  {voiceMsg && (
                    <span style={{ color: "var(--text-secondary, #b8b6c3)", fontStyle: "italic" }}>{voiceMsg}</span>
                  )}
                </div>
              )}
              {active.summary && (
                <div style={{
                  marginTop: 6, padding: "8px 12px", borderRadius: 8,
                  background: ACCENT_DIM, border: `1px solid ${ACCENT}33`,
                  fontSize: 13, color: "var(--text-secondary, #b8b6c3)", lineHeight: 1.6,
                }}>
                  <div style={{ fontSize: 11, color: ACCENT, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>
                    Summary so far
                  </div>
                  {active.summary}
                </div>
              )}
            </header>

            <section style={{ flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
              {turns.length === 0 && (
                <div style={{ color: "var(--text-muted, #888)", fontStyle: "italic", fontSize: 14 }}>
                  Ask Varros anything about <strong>{active.title}</strong>.
                </div>
              )}
              {turns.map(t => (
                <div key={t.id} style={{
                  alignSelf: t.role === "user" ? "flex-end" : "flex-start",
                  maxWidth: "75%",
                  background: t.role === "user" ? "rgba(255,255,255,0.04)" : ACCENT_DIM,
                  border: `1px solid ${t.role === "user" ? "var(--border, rgba(255,255,255,0.10))" : ACCENT + "33"}`,
                  borderRadius: 12, padding: "10px 14px", fontSize: 15, lineHeight: 1.7,
                }}>
                  {t.role === "assistant"
                    ? <MarkdownMessage content={t.content} />
                    : <span style={{ whiteSpace: "pre-wrap" }}>{t.content}</span>}
                  {t.role === "assistant" && (t.model || t.tokens_in != null) && (
                    <div style={{ fontSize: 11, color: "var(--text-muted, #888)", marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {t.model && <span style={{ color: ACCENT }}>{t.model.split("/").pop()}</span>}
                      {t.tokens_in != null && <span>· {t.tokens_in}↑ {t.tokens_out}↓</span>}
                      {t.depth_at && <span>· {t.depth_at}</span>}
                    </div>
                  )}
                </div>
              ))}
              {sending && (
                <div style={{ color: ACCENT, fontStyle: "italic", fontSize: 14 }}>Varros is thinking…</div>
              )}
              {error && (
                <div style={{
                  alignSelf: "stretch", padding: "8px 12px", borderRadius: 8,
                  background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.3)",
                  color: "#fca5a5", fontSize: 13,
                }}>
                  {error}
                </div>
              )}
            </section>

            <footer style={{ padding: "12px 20px", borderTop: "1px solid var(--border, rgba(255,255,255,0.08))" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                <textarea
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  placeholder={`Ask Varros (${active.depth})…  ⌃Enter for newline`}
                  rows={2}
                  style={{
                    flex: 1, padding: 10, borderRadius: 8,
                    border: "1px solid var(--border, rgba(255,255,255,0.12))",
                    background: "rgba(255,255,255,0.03)", color: "inherit",
                    fontFamily: "inherit", fontSize: 14, resize: "none",
                  }}
                />
                <button style={btnPrimary} onClick={() => void send()} disabled={sending || !input.trim()}>
                  Send
                </button>
              </div>
              {voiceCache && (
                <div style={{
                  marginTop: 8, fontSize: 11, color: "var(--text-muted, #888)",
                  display: "flex", gap: 8, alignItems: "center",
                }}>
                  <span>Voice cache: {voiceCache.mb} MB / {voiceCache.maxMb} MB</span>
                  {voiceCache.bytes > 0 && (
                    <button
                      style={{ background: "none", border: "none", color: ACCENT, cursor: "pointer", fontSize: 11, padding: 0, textDecoration: "underline" }}
                      onClick={() => void clearVoiceCache()}
                      aria-label="Clear voice cache"
                    >
                      Clear
                    </button>
                  )}
                </div>
              )}
            </footer>
          </>
        )}
      </main>
    </div>
  );
}
