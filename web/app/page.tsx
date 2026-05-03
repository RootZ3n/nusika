"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { MarkdownMessage } from "./components/MarkdownMessage";

const API_BASE = "/api/proxy";
const ACCENT = "#a78bfa";
const ACCENT_DIM = "rgba(167,139,250,0.08)";
const ACCENT_GLOW = "rgba(167,139,250,0.20)";

// ── Types ─────────────────────────────────────────────────────────────────────

interface MagisterModule {
  id: string;
  name: string;
  subject: string;
  campaign_world: string;
  companions: { id: string; name: string; role: string; accent_color?: string; teaching_rules?: string; personality?: string; speech_pattern?: string }[];
  summary: string;
  age_track: string;
  category: string;
  installed: boolean;
}

interface MagisterSession {
  id: string;
  module_id: string;
  module_name: string;
  companion_id: string;
  companion_name: string;
  progress: number;
  last_summary: string;
  teaching_mode: string;
  duration_target: number;
  started_at: string;
  updated_at: string;
  status: string;
}

interface CompanionMemory {
  id: string;
  text: string;
  created_at: string;
}

interface ConceptProgress {
  concept: string;
  mastery: "introduced" | "practiced" | "mastered" | "reaffirmed";
}

interface ModuleProgress {
  module_id: string;
  concepts: ConceptProgress[];
  exam_readiness: number | null;
}

interface MagisterProductConfig {
  mode: { local_only: boolean; cloud_enabled: boolean };
  providers: {
    llm_primary: string;
    llm_local_fallback: string;
    voice_mode: "local" | "premium";
    premium_voice_provider: string;
    premium_voice_enabled: boolean;
    minimax_model: string;
    local_model: string;
    local_provider: string;
  };
  safety: { child_safe_mode: boolean; prompt_injection_defense: boolean; output_filtering: boolean; receipt_logging: boolean };
  visibility: { show_receipts: boolean; show_provider_details: boolean };
}

interface AccessibilitySettings {
  dyslexic_font: boolean;
  wide_spacing: boolean;
  narration_enabled: boolean;
  narration_volume: number;
  speed: "slow" | "standard" | "fast";
  comfort_mode: boolean;
}

interface AdaptiveEnvelope {
  level: "supportive" | "steady" | "stretch";
  pace: "slow" | "standard" | "fast";
  scaffolding: "high" | "medium" | "low";
  feedback_line: string;
  micro_task: string;
  lesson_loop: string;
}

type Screen = "hall" | "session" | "map" | "advanced" | "inkwell";

const TABS: { key: Screen; label: string }[] = [
  { key: "hall", label: "The Hall" },
  { key: "session", label: "The Session" },
  { key: "map", label: "The Map" },
  { key: "advanced", label: "Advanced Studies" },
  { key: "inkwell", label: "The Inkwell" },
];

// Learner profile for adaptive pacing
interface LearnerProfile {
  pace: "adaptive";
  chunk_size: "adaptive";
  repetition_comfort: number;    // 1-10
  complexity_ceiling: number;     // 1-10
  engagement_signals: string[];
  preferred_modality: "adaptive";
}

const DEFAULT_LEARNER_PROFILE: LearnerProfile = {
  pace: "adaptive",
  chunk_size: "adaptive",
  repetition_comfort: 5,
  complexity_ceiling: 5,
  engagement_signals: [],
  preferred_modality: "adaptive",
};

// Audio state for ambient session audio
type AudioState = "opening" | "active" | "closing" | "silent";

// OpenDyslexic CDN
const OPEN_DYSLEXIC_CDN = "https://cdnjs.cloudflare.com/ajax/libs/open-dyslexic/latest/OpenDyslexic.css";

const MASTERY_COLORS: Record<string, string> = {
  introduced: "#6b7280",
  practiced: "#fbbf24",
  mastered: "#4ade80",
  reaffirmed: "#a78bfa",
};

const MASTERY_LABELS: Record<string, string> = {
  introduced: "Introduced",
  practiced: "Practiced",
  mastered: "Mastered",
  reaffirmed: "Reaffirmed",
};

const DURATION_OPTIONS = [5, 10, 20];
const TEACHING_MODES: { key: string; label: string }[] = [
  { key: "narrative", label: "Narrative" },
  { key: "direct", label: "Direct" },
  { key: "socratic", label: "Socratic" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function companionInitial(name?: string | null): string {
  if (!name) return "?";
  return name.charAt(0).toUpperCase();
}

function companionColor(name?: string | null): string {
  const colors = ["#a78bfa", "#4df5c8", "#f472b6", "#60a5fa", "#fb923c", "#fbbf24", "#4ade80"];
  if (!name) return colors[0]!;
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length]!;
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function MagisterPage() {
  const [screen, setScreen] = useState<Screen>("hall");
  const [modules, setModules] = useState<MagisterModule[]>([]);
  const [sessions, setSessions] = useState<MagisterSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Session screen state
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<MagisterSession | null>(null);
  const [sessionTimer, setSessionTimer] = useState(0);
  const [sessionRunning, setSessionRunning] = useState(false);
  const [hintLevel, setHintLevel] = useState(0);
  const [speechBubbles, setSpeechBubbles] = useState<string[]>(["Welcome back! Ready to continue our journey?"]);
  const [contentText, setContentText] = useState("Begin your session to start learning...");
  const [editorText, setEditorText] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Voice state
  const [voiceMode, setVoiceMode] = useState<"push" | "toggle">("push");
  const [voiceActive, setVoiceActive] = useState(false);
  const [voiceLoading, setVoiceLoading] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Telex Vietnamese input
  const [telexEnabled, setTelexEnabled] = useState(false);

  // Adaptive learning
  const [learnerProfile, setLearnerProfile] = useState<LearnerProfile>(DEFAULT_LEARNER_PROFILE);
  const [pacingFeedback, setPacingFeedback] = useState<"too_fast" | "just_right" | "too_slow" | null>(null);

  // Audio
  const [audioState, setAudioState] = useState<AudioState>("silent");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [ambientVolume, setAmbientVolume] = useState(0.15);

  // Accessibility
  const [useDyslexicFont, setUseDyslexicFont] = useState(false);
  const [wideLetterSpacing, setWideLetterSpacing] = useState(false);
  const [comfortOpen, setComfortOpen] = useState(false);
  const [comfortMode, setComfortMode] = useState(false);
  const [productConfig, setProductConfig] = useState<MagisterProductConfig | null>(null);
  const [sessionSettings, setSessionSettings] = useState<AccessibilitySettings | null>(null);
  const [sessionAdaptive, setSessionAdaptive] = useState<AdaptiveEnvelope | null>(null);
  const [providerState, setProviderState] = useState<{ provider?: string; model?: string; local_only?: boolean; cloud_enabled?: boolean } | null>(null);

  // Translate + Repeat
  const [translatedText, setTranslatedText] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const [repeating, setRepeating] = useState(false);

  // Practice Mode
  const [practiceModuleId, setPracticeModuleId] = useState<string | null>(null);
  const [practiceInput, setPracticeInput] = useState("");
  const [practiceHistory, setPracticeHistory] = useState<Array<{ role: "user" | "assistant"; content: string; model?: string; tokensIn?: number; tokensOut?: number; costUsd?: number; durationMs?: number }>>([]);
  const [practiceSending, setPracticeSending] = useState(false);
  const [practiceSessionId, setPracticeSessionId] = useState<string | null>(null);
  const [lastReceipt, setLastReceipt] = useState<{ model?: string; tokensIn?: number; tokensOut?: number; costUsd?: number; durationMs?: number } | null>(null);

  // New campaign state
  const [showNewCampaign, setShowNewCampaign] = useState(false);
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
  const [selectedCompanionId, setSelectedCompanionId] = useState<string | null>(null);
  const [selectedDuration, setSelectedDuration] = useState(10);
  const [selectedMode, setSelectedMode] = useState("narrative");

  // Map screen state
  const [mapModuleId, setMapModuleId] = useState<string | null>(null);
  const [moduleProgress, setModuleProgress] = useState<ModuleProgress | null>(null);
  const [companionMemories, setCompanionMemories] = useState<CompanionMemory[]>([]);
  const [mapCompanionId, setMapCompanionId] = useState<string | null>(null);

  // Library state
  const [_libraryFilter] = useState("All"); // unused but kept for type compat

  // Inkwell state
  const [inkwellText, setInkwellText] = useState("");
  const [inkwellFeedback, setInkwellFeedback] = useState("");
  const [inkwellFeedbackLoading, setInkwellFeedbackLoading] = useState(false);
  const [inkwellDrafts, setInkwellDrafts] = useState<Array<{ id: string; title: string; content: string; feedback?: string; createdAt: number }>>([]);
  const [inkwellTitle, setInkwellTitle] = useState("");
  const [inkwellSaveMsg, setInkwellSaveMsg] = useState<string | null>(null);

  // Streak
  const [streak, setStreak] = useState(0);

  // ── TTS helper ────────────────────────────────────────────────────────────

  function stripForTTS(text: string): string {
    return text
      .replace(/\*\*([\s\S]*?)\*\*/g, "$1")
      .replace(/\*([\s\S]*?)\*/g, "$1")
      .replace(/#{1,6}\s+/g, "")
      .replace(/`([^`]+)`/g, "$1")
      .trim();
  }

  const playTTS = useCallback(async (text: string, companionRole?: string) => {
    const clean = stripForTTS(text);
    if (!clean || sessionSettings?.narration_enabled === false) return;
    try {
      const endpoint = productConfig?.providers.voice_mode === "premium"
        ? `${API_BASE}/magister/tts/elevenlabs`
        : `${API_BASE}/magister/tts`;
      const ttsRes = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: clean, ...(companionRole ? { role: companionRole } : {}) }),
      });
      if (ttsRes.ok) {
        const blob = await ttsRes.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.play();
        audio.onended = () => URL.revokeObjectURL(url);
      }
    } catch { /* TTS failed silently */ }
  }, [productConfig, sessionSettings?.narration_enabled]);

  const fetchProductConfig = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/magister/config`);
      if (!res.ok) return;
      const data = await res.json();
      setProductConfig(data.config ?? null);
      setSessionSettings(data.settings ?? null);
      if (data.settings) {
        setUseDyslexicFont(!!data.settings.dyslexic_font);
        setWideLetterSpacing(!!data.settings.wide_spacing);
        setAmbientVolume(typeof data.settings.narration_volume === "number" ? data.settings.narration_volume : 0.15);
        setComfortMode(!!data.settings.comfort_mode);
      }
    } catch { /* silent */ }
  }, []);

  // ── Data fetching ─────────────────────────────────────────────────────────

  const fetchModules = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/magister/modules`);
      if (res.ok) {
        const data = await res.json();
        setModules(Array.isArray(data) ? data : data.modules ?? []);
      }
    } catch { /* silent */ }
  }, []);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/magister/sessions`);
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data) ? data : data.sessions ?? [];
        setSessions(list);
        // Calculate streak from sessions
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

  const fetchSessionDetail = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch(`${API_BASE}/magister/sessions/${sessionId}`);
      if (res.ok) {
        const data = await res.json();
        // API returns { ok, session: {...} } — unwrap
        const session = data.session ?? data;
        setActiveSession(session);

        // If session has a summary from last time, show it; otherwise request opening message
        if (session.last_summary) {
          setContentText(session.last_summary);
          setSpeechBubbles([`Welcome back! Last time we covered: ${(session.last_summary ?? "").slice(0, 80)}...`]);
        } else {
          setContentText("Your companion is preparing...");
          setSpeechBubbles(["Preparing your lesson..."]);
          // Trigger companion opening message
          try {
            const chatRes = await fetch(`${API_BASE}/magister/sessions/${sessionId}/chat`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                message: "Begin our session. Introduce yourself and the concept we're exploring today. Set the scene.",
                history: [],
              }),
            });
            if (chatRes.ok) {
              const chatData = await chatRes.json();
              const reply = chatData.reply ?? chatData.text ?? "";
              if (reply) {
                setContentText(reply);
                setSpeechBubbles([reply.length > 200 ? reply.slice(0, 200) + "..." : reply]);
                setLastReceipt({ model: chatData.model, tokensIn: chatData.tokensIn, tokensOut: chatData.tokensOut, costUsd: chatData.costUsd, durationMs: chatData.durationMs });
                setSessionAdaptive(chatData.adaptive ?? null);
                setProviderState({
                  provider: chatData.provider ?? chatData.providerSelection?.provider,
                  model: chatData.model,
                  local_only: chatData.state?.local_only,
                  cloud_enabled: chatData.state?.cloud_enabled,
                });
                // Auto-play TTS for opening message — use companion's Nous voice role
                void playTTS(reply, session.companion_id);
              }
            }
          } catch { /* opening message failed — static text stays */ }
        }
      }
    } catch { /* silent */ }
  }, [playTTS]);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchModules(), fetchSessions(), fetchProductConfig()]).finally(() => setLoading(false));
  }, [fetchModules, fetchSessions, fetchProductConfig]);

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

  // ── Ambient audio system ──────────────────────────────────────────────────
  // Loads audio from /state/uploads/magister/audio/{cue}.mp3
  // Falls back gracefully if files don't exist — never blocks the session
  function playAmbient(cue: string, volume = 0.15) {
    if (!cue) return;
    try {
      const src = `/api/proxy/magister/audio/${cue}.mp3`;
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = src;
      } else {
        audioRef.current = new Audio(src);
      }
      audioRef.current.volume = 0;
      audioRef.current.loop = true;
      audioRef.current.play().catch(() => { /* audio file not found — silent fallback */ });
      // Fade in
      const fadeIn = setInterval(() => {
        if (audioRef.current && audioRef.current.volume < volume) {
          audioRef.current.volume = Math.min(volume, audioRef.current.volume + 0.01);
        } else {
          clearInterval(fadeIn);
        }
      }, 50);
    } catch { /* audio not available */ }
  }

  function fadeOutAmbient() {
    if (!audioRef.current) return;
    const audio = audioRef.current;
    const fadeOut = setInterval(() => {
      if (audio.volume > 0.01) {
        audio.volume = Math.max(0, audio.volume - 0.01);
      } else {
        clearInterval(fadeOut);
        audio.pause();
      }
    }, 50);
  }

  // Audio state transitions
  useEffect(() => {
    if (audioState === "opening" && activeSession) {
      const modConfig = modules.find(m => m.id === activeSession.module_id);
      const ambientAudio = (modConfig as unknown as Record<string, unknown>)?.ambient_audio as Record<string, string> | undefined;
      if (ambientAudio?.session_open) playAmbient(ambientAudio.session_open, ambientVolume * 1.3);
      // Transition to active after 8 seconds
      setTimeout(() => setAudioState("active"), 8000);
    } else if (audioState === "active" && activeSession) {
      const modConfig = modules.find(m => m.id === activeSession.module_id);
      const ambientAudio = (modConfig as unknown as Record<string, unknown>)?.ambient_audio as Record<string, string> | undefined;
      if (ambientAudio?.session_active) playAmbient(ambientAudio.session_active, ambientVolume);
    } else if (audioState === "closing") {
      // Swell ambient slightly for closing
      if (audioRef.current) audioRef.current.volume = Math.min(0.25, audioRef.current.volume + 0.1);
    } else if (audioState === "silent") {
      fadeOutAmbient();
    }
  }, [audioState, activeSession, modules]);

  // Clean up audio on unmount
  useEffect(() => {
    return () => { if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; } };
  }, []);

  // Start ambient when session starts
  useEffect(() => {
    if (sessionRunning && activeSession && audioState === "silent") {
      setAudioState("opening");
    } else if (!sessionRunning && audioState !== "silent") {
      setAudioState("silent");
    }
  }, [sessionRunning, activeSession, audioState]);

  // OpenDyslexic font loader
  useEffect(() => {
    if (useDyslexicFont) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = OPEN_DYSLEXIC_CDN;
      link.id = "opendyslexic-css";
      document.head.appendChild(link);
      return () => { document.getElementById("opendyslexic-css")?.remove(); };
    } else {
      document.getElementById("opendyslexic-css")?.remove();
    }
  }, [useDyslexicFont]);

  // 10-minute warning — inject into companion context
  useEffect(() => {
    if (!sessionRunning || !activeSession) return;
    const durationSec = ((activeSession as unknown as Record<string, unknown>).duration_target as number ?? 10) * 60;
    const warningAt = durationSec - 600; // 10 min before end
    if (warningAt <= 0) return;
    if (sessionTimer === warningAt) {
      setAudioState("closing");
      setSpeechBubbles(prev => [...prev.slice(-4), "[Session winding down — companion will offer a natural wrap-up]"]);
    }
  }, [sessionTimer, sessionRunning, activeSession]);

  // Timer logic
  useEffect(() => {
    if (sessionRunning) {
      timerRef.current = setInterval(() => {
        setSessionTimer((t) => t + 1);
      }, 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [sessionRunning]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const startSession = useCallback(async (sessionId: string) => {
    setActiveSessionId(sessionId);
    setScreen("session");
    setSessionTimer(0);
    setSessionRunning(true);
    setHintLevel(0);
    setEditorText("");
    await fetchSessionDetail(sessionId);
  }, [fetchSessionDetail]);

  const pauseSession = useCallback(async () => {
    setSessionRunning(false);
    if (activeSessionId) {
      try {
        await fetch(`${API_BASE}/magister/sessions/${activeSessionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "paused" }),
        });
      } catch { /* silent */ }
    }
  }, [activeSessionId]);

  const resumeSession = useCallback(() => {
    setSessionRunning(true);
  }, []);

  // ── Send message to companion ────────────────────────────────────────────
  const sendUserMessage = useCallback(async () => {
    if (!editorText.trim() || !activeSessionId || sendingMessage) return;
    setSendingMessage(true);
    try {
      const res = await fetch(`${API_BASE}/magister/sessions/${activeSessionId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: editorText.trim(), history: [] }),
      });
      if (res.ok) {
        const data = await res.json() as {
          reply?: string; text?: string; model?: string; provider?: string;
          tokensIn?: number; tokensOut?: number; costUsd?: number; durationMs?: number;
          adaptive?: AdaptiveEnvelope; state?: { local_only?: boolean; cloud_enabled?: boolean };
        };
        const reply = data.reply ?? data.text ?? "";
        if (reply) {
          setContentText(reply);
          setSpeechBubbles(prev => [...prev.slice(-4), reply.length > 200 ? reply.slice(0, 200) + "..." : reply]);
        }
        setLastReceipt({ model: data.model, tokensIn: data.tokensIn, tokensOut: data.tokensOut, costUsd: data.costUsd, durationMs: data.durationMs });
        setSessionAdaptive(data.adaptive ?? null);
        setProviderState({ provider: data.provider, model: data.model, local_only: data.state?.local_only, cloud_enabled: data.state?.cloud_enabled });
        setEditorText("");
      }
    } catch { /* silent */ }
    setSendingMessage(false);
  }, [editorText, activeSessionId, sendingMessage]);

  // ── Voice recording ─────────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        setVoiceActive(false);
        setVoiceLoading(true);

        // Derive language from module
        const modId = activeSession?.module_id ?? "";
        const lang = modId === "vietnamese" ? "vi" : modId === "mandarin" ? "zh" : "en";

        const formData = new FormData();
        formData.append("audio", blob, `magister-${Date.now()}.webm`);
        formData.append("language", lang);

        try {
          const res = await fetch(`${API_BASE}/magister/stt`, { method: "POST", body: formData });
          const data = await res.json() as { ok?: boolean; transcript?: string };
          if (data.ok && data.transcript) {
            setEditorText(prev => prev ? prev + " " + data.transcript : data.transcript!);
          }
        } catch { /* silent */ }
        setVoiceLoading(false);
      };
      mr.start();
      mediaRecorderRef.current = mr;
      setVoiceActive(true);
    } catch { /* mic not available */ }
  }, [activeSession?.module_id]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && voiceActive) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }
  }, [voiceActive]);

  // ── Telex Vietnamese input ──────────────────────────────────────────────
  function applyTelex(text: string): string {
    if (text.length < 2) return text;
    const last2 = text.slice(-2);
    const prefix = text.slice(0, -2);

    const replacements: Record<string, string> = {
      "dd": "đ", "DD": "Đ", "aa": "â", "AA": "Â", "aw": "ă", "AW": "Ă",
      "ee": "ê", "EE": "Ê", "oo": "ô", "OO": "Ô", "ow": "ơ", "OW": "Ơ", "uw": "ư", "UW": "Ư",
      // Tone marks
      "a1": "á", "a2": "à", "a3": "ả", "a4": "ã", "a5": "ạ",
      "A1": "Á", "A2": "À", "A3": "Ả", "A4": "Ã", "A5": "Ạ",
      "o1": "ó", "o2": "ò", "o3": "ỏ", "o4": "õ", "o5": "ọ",
      "O1": "Ó", "O2": "Ò", "O3": "Ỏ", "O4": "Õ", "O5": "Ọ",
      "e1": "é", "e2": "è", "e3": "ẻ", "e4": "ẽ", "e5": "ẹ",
      "E1": "É", "E2": "È", "E3": "Ẻ", "E4": "Ẽ", "E5": "Ẹ",
      "u1": "ú", "u2": "ù", "u3": "ủ", "u4": "ũ", "u5": "ụ",
      "U1": "Ú", "U2": "Ù", "U3": "Ủ", "U4": "Ũ", "U5": "Ụ",
      "i1": "í", "i2": "ì", "i3": "ỉ", "i4": "ĩ", "i5": "ị",
      "I1": "Í", "I2": "Ì", "I3": "Ỉ", "I4": "Ĩ", "I5": "Ị",
    };

    if (replacements[last2]) return prefix + replacements[last2];
    return text;
  }

  const requestHint = useCallback(() => {
    setHintLevel((prev) => {
      const next = Math.min(prev + 1, 3);
      const hints = [
        "Think about what we discussed earlier...",
        "Remember the key principle: connections between concepts matter.",
        "Here is the direct answer to guide you forward.",
      ];
      setSpeechBubbles((b) => [...b.slice(-4), hints[next - 1]]);
      return next;
    });
  }, []);

  const createCampaign = useCallback(async () => {
    if (!selectedModuleId || !selectedCompanionId) return;
    try {
      const res = await fetch(`${API_BASE}/magister/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          module_id: selectedModuleId,
          companion_id: selectedCompanionId,
          duration_target: selectedDuration,
          teaching_mode: selectedMode,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setShowNewCampaign(false);
        setSelectedModuleId(null);
        setSelectedCompanionId(null);
        await fetchSessions();
        const sessionId = data.session?.id ?? data.id;
        if (sessionId) startSession(sessionId);
      } else {
        setError("Failed to create campaign");
      }
    } catch {
      setError("Failed to create campaign");
    }
  }, [selectedModuleId, selectedCompanionId, selectedDuration, selectedMode, fetchSessions, startSession]);

  const installModule = useCallback(async (moduleId: string) => {
    setModules((prev) =>
      prev.map((m) => (m.id === moduleId ? { ...m, installed: true } : m))
    );
  }, []);

  const openMap = useCallback((moduleId: string, companionId?: string) => {
    setMapModuleId(moduleId);
    setMapCompanionId(companionId ?? null);
    setScreen("map");
    fetchProgress(moduleId);
    if (companionId) fetchMemories(companionId);
  }, [fetchProgress, fetchMemories]);

  // ── Filtered modules for library ──────────────────────────────────────────

  // Module tier filtering
  const campaignModules = (modules ?? []).filter((m) => m.id !== "inkwell");
  const hallModules = campaignModules.filter((m) => {
    const tier = (m as unknown as Record<string, unknown>).tier as string | undefined;
    const labOnly = (m as unknown as Record<string, unknown>).lab_only as boolean | undefined;
    return !labOnly && tier !== "advanced";
  });
  const advancedModules = campaignModules.filter((m) => {
    const tier = (m as unknown as Record<string, unknown>).tier as string | undefined;
    const labOnly = (m as unknown as Record<string, unknown>).lab_only as boolean | undefined;
    return labOnly || tier === "advanced";
  });
  const filteredModules = hallModules;

  // Group modules into shelf rows of 3
  const shelves: MagisterModule[][] = [];
  for (let i = 0; i < filteredModules.length; i += 3) {
    shelves.push(filteredModules.slice(i, i + 3));
  }

  const activeSessions = (sessions ?? []).filter((s) => s.status === "active" || s.status === "paused");

  // ── Styles ────────────────────────────────────────────────────────────────

  const panelStyle: React.CSSProperties = {
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-md)",
    padding: "16px",
    backdropFilter: "blur(12px)",
  };

  const cardStyle: React.CSSProperties = {
    ...panelStyle,
    cursor: "pointer",
    transition: "border-color 0.2s, background 0.2s",
  };

  const btnPrimary: React.CSSProperties = {
    background: ACCENT,
    color: "#060810",
    border: "none",
    borderRadius: "var(--radius-sm)",
    padding: "10px 20px",
    fontFamily: "var(--font-body)",
    fontSize: "14px",
    fontWeight: 600,
    cursor: "pointer",
    minHeight: 44,
    minWidth: 44,
    transition: "opacity 0.2s",
  };

  const btnSecondary: React.CSSProperties = {
    background: "transparent",
    color: ACCENT,
    border: `1px solid ${ACCENT}`,
    borderRadius: "var(--radius-sm)",
    padding: "10px 20px",
    fontFamily: "var(--font-body)",
    fontSize: "14px",
    fontWeight: 500,
    cursor: "pointer",
    minHeight: 44,
    minWidth: 44,
    transition: "opacity 0.2s, background 0.2s",
  };

  const btnGhost: React.CSSProperties = {
    background: "transparent",
    color: "var(--text-secondary)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    padding: "8px 16px",
    fontFamily: "var(--font-body)",
    fontSize: "13px",
    cursor: "pointer",
    minHeight: 44,
    minWidth: 44,
    transition: "background 0.2s",
  };

  const pillStyle = (active: boolean): React.CSSProperties => ({
    background: active ? ACCENT_DIM : "transparent",
    color: active ? ACCENT : "var(--text-muted)",
    border: `1px solid ${active ? ACCENT : "var(--border)"}`,
    borderRadius: 20,
    padding: "6px 16px",
    fontFamily: "var(--font-body)",
    fontSize: "13px",
    cursor: "pointer",
    minHeight: 44,
    display: "inline-flex",
    alignItems: "center",
    transition: "all 0.2s",
    whiteSpace: "nowrap",
  });

  const tabBarStyle: React.CSSProperties = {
    display: "flex",
    gap: 4,
    padding: "8px 16px",
    overflowX: "auto",
    WebkitOverflowScrolling: "touch",
    background: "var(--bg-deep)",
    borderBottom: "1px solid var(--border)",
    position: "sticky",
    top: 0,
    zIndex: 20,
  };

  const tabStyle = (active: boolean): React.CSSProperties => ({
    background: active ? ACCENT_DIM : "transparent",
    color: active ? ACCENT : "var(--text-muted)",
    border: `1px solid ${active ? ACCENT : "transparent"}`,
    borderRadius: "var(--radius-sm)",
    padding: "8px 18px",
    fontFamily: "var(--font-body)",
    fontSize: "14px",
    fontWeight: active ? 600 : 400,
    cursor: "pointer",
    minHeight: 44,
    whiteSpace: "nowrap",
    transition: "all 0.2s",
    flexShrink: 0,
  });

  // ── Render: The Hall ──────────────────────────────────────────────────────

  function renderHall() {
    return (
      <div style={{ padding: "20px 16px", maxWidth: 1200, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>
        {/* Welcome + Streak */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ fontFamily: "var(--font-display)", fontSize: "24px", fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>
              The Hall
            </h1>
            {/* Maren's greeting */}
            <div style={{
              display: "flex", alignItems: "flex-start", gap: 10, marginTop: 10,
              padding: "12px 16px", borderRadius: 12,
              background: "rgba(167,139,250,0.06)", border: "1px solid rgba(167,139,250,0.12)",
            }}>
              <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#a78bfa", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 700, color: "#060810", flexShrink: 0 }}>M</div>
              <div style={{
                fontFamily: useDyslexicFont ? "'OpenDyslexic', var(--font-body)" : "var(--font-body)",
                fontSize: "15px", color: "var(--text-secondary)", lineHeight: 1.8,
                letterSpacing: wideLetterSpacing ? "0.08em" : undefined,
              }}>
                {activeSessions.length > 0
                  ? `Ah, you're back. ${activeSessions[0]?.companion_name ? `${activeSessions[0].companion_name} was asking about you` : "Your companion was waiting"} — the world doesn't close when you leave, it just gets quieter. Where would you like to go today?`
                  : "Welcome. I'm Maren. I've been keeping these worlds for a long time. Take a look around — there's no rush. When you find one that calls to you, I'll take you there."}
              </div>
            </div>
          </div>
          <div style={{
            ...panelStyle,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 18px",
          }}>
            <span style={{ fontSize: "22px" }}>&#128293;</span>
            <div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: "20px", fontWeight: 700, color: ACCENT }}>
                {streak}
              </div>
              <div style={{ fontFamily: "var(--font-body)", fontSize: "11px", color: "var(--text-muted)" }}>
                day streak
              </div>
            </div>
          </div>
        </div>

        {/* Active Adventures */}
        {activeSessions.length > 0 && (
          <section>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: "18px", fontWeight: 700, color: "var(--text-primary)", marginBottom: 12 }}>
              Active Adventures
            </h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
              {(activeSessions ?? []).map((s) => (
                <div
                  key={s.id}
                  style={cardStyle}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = ACCENT;
                    e.currentTarget.style.background = "var(--bg-raised)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "var(--border)";
                    e.currentTarget.style.background = "var(--bg-surface)";
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                    <div>
                      <div style={{ fontFamily: "var(--font-body)", fontSize: "15px", fontWeight: 600, color: "var(--text-primary)" }}>
                        {s.module_name}
                      </div>
                      <div style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--text-muted)", marginTop: 2 }}>
                        with {s.companion_name}
                      </div>
                    </div>
                    <span style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "11px",
                      color: s.status === "active" ? "#4ade80" : "#fbbf24",
                      background: s.status === "active" ? "rgba(74,222,128,0.1)" : "rgba(251,191,36,0.1)",
                      padding: "2px 8px",
                      borderRadius: 10,
                    }}>
                      {s.status}
                    </span>
                  </div>
                  {s.last_summary && (
                    <p style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--text-muted)", marginBottom: 10, lineHeight: 1.5 }}>
                      {(s.last_summary ?? "").length > 120 ? (s.last_summary ?? "").slice(0, 120) + "..." : (s.last_summary ?? "No summary")}
                    </p>
                  )}
                  {/* Progress bar */}
                  <div style={{ background: "var(--bg-void)", borderRadius: 6, height: 6, marginBottom: 10, overflow: "hidden" }}>
                    <div style={{
                      width: `${Math.min(100, Math.max(0, s.progress))}%`,
                      height: "100%",
                      background: `linear-gradient(90deg, ${ACCENT}, #4df5c8)`,
                      borderRadius: 6,
                      transition: "width 0.3s",
                    }} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-muted)" }}>
                      {Math.round(s.progress)}% complete
                    </span>
                    <button
                      style={btnPrimary}
                      onClick={(e) => { e.stopPropagation(); startSession(s.id); }}
                      onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.85"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
                    >
                      Continue
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* New Campaign Button */}
        <div style={{ display: "flex", gap: 12 }}>
          <button
            style={btnPrimary}
            onClick={() => setShowNewCampaign(true)}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.85"; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
          >
            Start Adventure
          </button>
        </div>

        {/* New Campaign Modal */}
        {showNewCampaign && (
          <div style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 100,
            display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
          }} onClick={() => setShowNewCampaign(false)}>
            <div style={{ ...panelStyle, maxWidth: 520, width: "100%", padding: 24, maxHeight: "80vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
              <h2 style={{ fontFamily: "var(--font-display)", fontSize: "20px", fontWeight: 700, color: "var(--text-primary)", marginBottom: 16 }}>
                Start Adventure
              </h2>

              {/* Module Selection */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontFamily: "var(--font-body)", fontSize: "13px", color: "var(--text-muted)", display: "block", marginBottom: 6 }}>
                  Choose a Module
                </label>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {(modules ?? []).filter((m) => m.installed).map((m) => (
                    <button
                      key={m.id}
                      style={{
                        ...cardStyle,
                        padding: "10px 14px",
                        borderColor: selectedModuleId === m.id ? ACCENT : "var(--border)",
                        background: selectedModuleId === m.id ? ACCENT_DIM : "var(--bg-surface)",
                        textAlign: "left",
                      }}
                      onClick={() => {
                        setSelectedModuleId(m.id);
                        setSelectedCompanionId((m.companions ?? []).length > 0 ? (m.companions ?? [])[0].id : null);
                      }}
                    >
                      <div style={{ fontFamily: "var(--font-body)", fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>
                        {m.campaign_world}
                      </div>
                      <div style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--text-muted)" }}>
                        {m.name} — {m.subject}
                      </div>
                    </button>
                  ))}
                  {(modules ?? []).filter((m) => m.installed).length === 0 && (
                    <p style={{ fontFamily: "var(--font-body)", fontSize: "13px", color: "var(--text-muted)" }}>
                      No modules installed. Visit The Library to install one.
                    </p>
                  )}
                </div>
              </div>

              {/* Companion Selection */}
              {selectedModuleId && (() => {
                const mod = modules.find((m) => m.id === selectedModuleId);
                if (!mod || (mod.companions ?? []).length === 0) return null;
                return (
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ fontFamily: "var(--font-body)", fontSize: "13px", color: "var(--text-muted)", display: "block", marginBottom: 6 }}>
                      Choose Companion
                    </label>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {(mod.companions ?? []).map((c) => (
                        <button
                          key={c.id}
                          style={{
                            ...pillStyle(selectedCompanionId === c.id),
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                          onClick={() => setSelectedCompanionId(c.id)}
                        >
                          <span style={{
                            width: 24, height: 24, borderRadius: "50%", background: companionColor(c.name),
                            display: "inline-flex", alignItems: "center", justifyContent: "center",
                            fontSize: "12px", fontWeight: 700, color: "#060810",
                          }}>
                            {companionInitial(c.name)}
                          </span>
                          {c.name}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Duration */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontFamily: "var(--font-body)", fontSize: "13px", color: "var(--text-muted)", display: "block", marginBottom: 6 }}>
                  Duration
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  {DURATION_OPTIONS.map((d) => (
                    <button key={d} style={pillStyle(selectedDuration === d)} onClick={() => setSelectedDuration(d)}>
                      {d} min
                    </button>
                  ))}
                </div>
              </div>

              {/* Teaching Mode */}
              <div style={{ marginBottom: 20 }}>
                <label style={{ fontFamily: "var(--font-body)", fontSize: "13px", color: "var(--text-muted)", display: "block", marginBottom: 6 }}>
                  Teaching Mode
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  {TEACHING_MODES.map((tm) => (
                    <button key={tm.key} style={pillStyle(selectedMode === tm.key)} onClick={() => setSelectedMode(tm.key)}>
                      {tm.label}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button style={btnGhost} onClick={() => setShowNewCampaign(false)}>Cancel</button>
                <button
                  style={{ ...btnPrimary, opacity: (!selectedModuleId || !selectedCompanionId) ? 0.4 : 1 }}
                  disabled={!selectedModuleId || !selectedCompanionId}
                  onClick={createCampaign}
                >
                  Begin Campaign
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Module Library Preview */}
        <section>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: "18px", fontWeight: 700, color: "var(--text-primary)" }}>
              Module Library
            </h2>
            <button
              style={{ ...btnGhost, fontSize: "12px" }}
              onClick={() => setScreen("advanced")}
            >
              View All
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
            {campaignModules.slice(0, 6).map((m) => (
              <div
                key={m.id}
                style={{
                  ...cardStyle,
                  background: "linear-gradient(160deg, var(--bg-surface) 0%, var(--bg-raised) 100%)",
                  borderLeft: `3px solid ${ACCENT}`,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = ACCENT; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.borderLeftColor = ACCENT; }}
              >
                <div style={{ fontFamily: "var(--font-display)", fontSize: "15px", fontWeight: 700, color: ACCENT, marginBottom: 2 }}>
                  {m.campaign_world}
                </div>
                <div style={{ fontFamily: "var(--font-body)", fontSize: "14px", fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>
                  {m.name}
                </div>
                <div style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--text-muted)", marginBottom: 6 }}>
                  {m.subject}
                </div>
                <div style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--text-muted)", marginBottom: 8, lineHeight: 1.5 }}>
                  {(m.summary ?? "").length > 100 ? (m.summary ?? "").slice(0, 100) + "..." : (m.summary ?? "")}
                </div>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
                  {(m.companions ?? []).map((c) => (
                    <span key={c.id} style={{
                      fontFamily: "var(--font-mono)", fontSize: 14, color: "var(--text-muted)",
                      background: "var(--bg-void)", padding: "2px 8px", borderRadius: 10,
                    }}>
                      {c.name}
                    </span>
                  ))}
                  {/* Practice button for language modules */}
                  {["spanish", "french", "vietnamese", "mandarin", "latin"].includes(m.id) && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setPracticeModuleId(m.id); setScreen("session"); setPracticeHistory([]); }}
                      style={{ ...btnGhost, fontSize: 14, padding: "2px 8px", marginLeft: "auto" }}
                    >Practice</button>
                  )}
                </div>
              </div>
            ))}
          </div>
          {modules.length === 0 && !loading && (
            <div style={{ ...panelStyle, textAlign: "center", padding: 32, color: "var(--text-muted)", fontSize: "14px" }}>
              No modules available yet. Check back soon.
            </div>
          )}
        </section>
      </div>
    );
  }

  // ── Render: The Session ───────────────────────────────────────────────────

  // ── Practice Mode send ──────────────────────────────────────────────────
  async function sendPractice() {
    if (!practiceInput.trim() || practiceSending || !practiceModuleId) return;
    const msg = practiceInput.trim();
    setPracticeInput("");
    setPracticeHistory(prev => [...prev, { role: "user", content: msg }]);
    setPracticeSending(true);
    try {
      const mod = modules.find(m => m.id === practiceModuleId);
      const companion = (mod?.companions ?? [])[0];
      const companionId = companion?.id;
      let res: Response | null = null;

      // Route through companion chat endpoint so personality, world, memory all work
      if (companionId) {
        // Create a practice session once, reuse for the whole practice conversation
        let sessionId = practiceSessionId;
        if (!sessionId) {
          try {
            const sessRes = await fetch(`${API_BASE}/magister/sessions`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ module_id: practiceModuleId, companion_id: companionId, teaching_mode: "narrative" }),
            });
            if (sessRes.ok) {
              const sessData = await sessRes.json() as { session?: { id?: string } };
              sessionId = sessData.session?.id ?? null;
              if (sessionId) setPracticeSessionId(sessionId);
            }
          } catch { /* practice session creation failed */ }
        }

        if (sessionId) {
          res = await fetch(`${API_BASE}/magister/sessions/${sessionId}/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: msg, history: practiceHistory.slice(-10) }),
          });
        }
      }
      if (!res) {
        setPracticeHistory(prev => [...prev, {
          role: "assistant",
          content: "Practice is temporarily unavailable because Magister could not start a protected session. No unsafe fallback was used.",
        }]);
      } else if (res.ok) {
        const data = await res.json() as { text?: string; model?: string; tokensIn?: number; tokensOut?: number; costUsd?: number; durationMs?: number };
        if (data.text) setPracticeHistory(prev => [...prev, { role: "assistant", content: data.text!, model: data.model, tokensIn: data.tokensIn, tokensOut: data.tokensOut, costUsd: data.costUsd, durationMs: data.durationMs }]);
      }
    } catch { /* silent */ }
    setPracticeSending(false);
  }

  function renderSession() {
    // Practice mode — free conversation with companion
    if (practiceModuleId) {
      const mod = modules.find(m => m.id === practiceModuleId);
      const companion = (mod?.companions ?? [])[0];
      const cName = companion?.name ?? "Companion";
      const cColor = companion?.accent_color ?? ACCENT;

      return (
        <div style={{ display: "flex", height: "calc(100vh - 110px)", minHeight: 0, overflow: "hidden" }}>
          {/* Left: Practice history */}
          <div style={{ width: 220, flexShrink: 0, borderRight: "1px solid var(--border)", overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 700, color: cColor, letterSpacing: "0.08em", textTransform: "uppercase" }}>Practice Mode</div>
            <div style={{ fontFamily: "var(--font-body)", fontSize: 14, color: "var(--text-muted)" }}>{mod?.name ?? practiceModuleId}</div>
            <button onClick={async () => {
              // TODO(magister-standalone): Practice transcripts used to be saved to
              // squidley's Archivum (POST /archivum/paste) on session end. The
              // standalone has /magister/creative for module-scoped works but no
              // generalized Archivum yet. For now the transcript is dropped on exit
              // — wire to /magister/creative/<moduleId> once we agree on schema.
              setPracticeModuleId(null); setPracticeHistory([]); setPracticeSessionId(null);
            }} style={{ ...btnGhost, fontSize: 14 }}>Finish Practice</button>
          </div>

          {/* Center: Chat */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div style={{ flex: 1, overflowY: "auto", padding: "14px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
              {practiceHistory.length === 0 && (
                <div style={{ fontFamily: "var(--font-body)", fontSize: 16, color: "var(--text-muted)", fontStyle: "italic", lineHeight: 1.8, padding: "20px 0" }}>
                  Practice with {cName}. Just talk and learn together.
                </div>
              )}
              {practiceHistory.map((msg, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: msg.role === "user" ? "flex-end" : "flex-start", flexDirection: msg.role === "user" ? "row-reverse" : "row" }}>
                  {msg.role === "assistant" && <div style={{ width: 28, height: 28, borderRadius: "50%", background: cColor, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 700, color: "#060810", flexShrink: 0 }}>{cName[0]}</div>}
                  <div style={{
                    maxWidth: "75%", padding: "10px 14px", borderRadius: 14,
                    background: msg.role === "user" ? `${ACCENT}15` : `${cColor}10`,
                    border: `1px solid ${msg.role === "user" ? ACCENT + "30" : cColor + "20"}`,
                    fontFamily: useDyslexicFont ? "'OpenDyslexic', var(--font-body)" : "var(--font-body)",
                    fontSize: 15, color: "var(--text-primary)", lineHeight: 1.8,
                    letterSpacing: wideLetterSpacing ? "0.08em" : undefined,
                  }}>
                    {msg.role === "assistant" ? <MarkdownMessage content={msg.content} /> : <span style={{ whiteSpace: "pre-wrap" }}>{msg.content}</span>}
                    {/* Translate + Repeat on assistant bubbles */}
                    {msg.role === "assistant" && (
                      <div style={{ display: "flex", gap: 6, marginTop: 6, paddingTop: 4, borderTop: `1px solid ${cColor}15` }}>
                        <button onClick={() => void playTTS(msg.content, companion?.id)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "var(--text-muted)", padding: "2px 4px" }} title="Repeat">🔊</button>
                        <button onClick={async (e) => {
                          const btn = e.currentTarget;
                          const existing = btn.parentElement?.querySelector(".practice-translation");
                          if (existing) { existing.remove(); return; }
                          try {
                            const res = await fetch(`${API_BASE}/magister/translate`, {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ text: msg.content.slice(0, 1000), module_id: practiceModuleId }),
                            });
                            if (res.ok) {
                              const data = await res.json() as { text?: string };
                              if (data.text) {
                                const div = document.createElement("div");
                                div.className = "practice-translation";
                                div.style.cssText = `margin-top:6px;padding:6px 10px;border-radius:6px;background:rgba(96,165,250,0.06);border:1px solid rgba(96,165,250,0.12);font-size:14px;color:var(--text-secondary);line-height:1.7`;
                                div.textContent = data.text;
                                btn.parentElement?.parentElement?.appendChild(div);
                              }
                            }
                          } catch { /* silent */ }
                        }} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "var(--text-muted)", padding: "2px 4px" }} title="Translate">🌐</button>
                      </div>
                    )}
                    {msg.role === "assistant" && msg.model && (
                      <div style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--text-muted)", marginTop: 4, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                        <span style={{ color: cColor, fontWeight: 600 }}>{msg.model.split("/").pop()}</span>
                        {msg.tokensIn != null && <><span style={{ opacity: 0.5 }}>·</span><span>{msg.tokensIn}↑ {msg.tokensOut}↓</span></>}
                        {msg.costUsd != null && <><span style={{ opacity: 0.5 }}>·</span><span style={{ color: "#4ade80" }}>${msg.costUsd.toFixed(6)}</span></>}
                        {msg.durationMs != null && <><span style={{ opacity: 0.5 }}>·</span><span>{msg.durationMs}ms</span></>}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {practiceSending && <div style={{ fontFamily: "var(--font-body)", fontSize: 15, color: cColor, fontStyle: "italic" }}>{cName} is thinking...</div>}
            </div>
            <div style={{ flexShrink: 0, padding: "10px 14px", borderTop: "1px solid var(--border)" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                <textarea
                  value={practiceInput}
                  onChange={e => setPracticeInput(telexEnabled ? applyTelex(e.target.value) : e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendPractice(); } }}
                  placeholder={`Practice with ${cName}...`}
                  rows={2}
                  style={{
                    flex: 1, background: "rgba(11,14,28,0.8)", border: `1px solid ${cColor}30`,
                    borderRadius: 10, padding: "8px 14px", color: "var(--text-primary)",
                    fontFamily: useDyslexicFont ? "'OpenDyslexic', var(--font-body)" : "var(--font-body)",
                    fontSize: 16, outline: "none", resize: "none", lineHeight: 1.6,
                  }}
                />
                <button
                  onClick={() => void sendPractice()}
                  disabled={!practiceInput.trim() || practiceSending}
                  style={{
                    ...btnPrimary, width: 40, height: 40, borderRadius: 10, padding: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    opacity: practiceInput.trim() ? 1 : 0.4,
                  }}
                >▶</button>
              </div>
            </div>
          </div>

          {/* Right: Companion focus panel */}
          <div style={{ width: 280, flexShrink: 0, borderLeft: "1px solid var(--border)", overflowY: "auto", padding: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <div style={{ width: 28, height: 28, borderRadius: "50%", background: cColor, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 700, color: "#060810" }}>{cName[0]}</div>
              <div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 700, color: cColor }}>{cName}</div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 14, color: "var(--text-muted)" }}>Observing</div>
              </div>
            </div>
            <div style={{ fontFamily: "var(--font-body)", fontSize: 14, color: "var(--text-muted)", lineHeight: 1.7 }}>
              {(() => {
                const userMsgs = practiceHistory.filter(h => h.role === "user");
                const count = userMsgs.length;
                if (count === 0) return `${cName} is watching quietly. Start talking and patterns will emerge.`;

                const avgLen = Math.round(userMsgs.reduce((s, m) => s + m.content.length, 0) / count);
                const observations: string[] = [];
                observations.push(`${count} exchange${count !== 1 ? "s" : ""} so far.`);
                if (avgLen < 20) observations.push("Short responses — could mean confidence or uncertainty. Keep going.");
                else if (avgLen > 80) observations.push("Writing longer responses — good engagement signal.");
                if (count >= 3) observations.push("Conversation is flowing. Patterns becoming visible.");
                if (count >= 6) observations.push("Solid practice session. The language is starting to stick.");
                return observations.join(" ");
              })()}
            </div>
          </div>
        </div>
      );
    }

    const companion = activeSession ? {
      name: activeSession.companion_name,
      color: companionColor(activeSession.companion_name),
    } : { name: "Companion", color: ACCENT };

    const durationSeconds = (activeSession?.duration_target ?? 10) * 60;
    const progressPct = Math.min(100, (sessionTimer / durationSeconds) * 100);

    return (
      <div style={{
        display: "flex",
        flexDirection: "column",
        height: "calc(100vh - 110px)",
        background: "var(--bg-void)",
      }}>
        {/* Teaching mode badge + world map link */}
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "8px 16px", borderBottom: "1px solid var(--border)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{
              fontFamily: "var(--font-mono)", fontSize: "11px",
              color: ACCENT, background: ACCENT_DIM,
              padding: "3px 10px", borderRadius: 10,
            }}>
              {activeSession?.teaching_mode ?? "narrative"}
            </span>
            {activeSession && (
              <span style={{ fontFamily: "var(--font-body)", fontSize: "13px", color: "var(--text-muted)" }}>
                {activeSession.module_name}
              </span>
            )}
          </div>
          <button
            style={{ ...btnGhost, fontSize: "12px", padding: "6px 12px" }}
            onClick={() => {
              if (activeSession) openMap(activeSession.module_id, activeSession.companion_id);
            }}
          >
            World Map
          </button>
        </div>

        {/* Main session layout */}
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          {/* Companion Panel */}
          <div style={{
            width: 280,
            minWidth: 220,
            borderRight: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            padding: 16,
            gap: 12,
            overflowY: "auto",
            background: "var(--bg-deep)",
          }} className="magister-companion-panel">
            {/* Portrait */}
            <div style={{
              width: 80, height: 80, borderRadius: "50%",
              background: companion.color, margin: "0 auto 8px",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "32px", fontWeight: 700, color: "#060810",
              fontFamily: "var(--font-display)",
              boxShadow: `0 0 24px ${companion.color}44`,
            }}>
              {companionInitial(companion.name)}
            </div>
            <div style={{ textAlign: "center", fontFamily: "var(--font-body)", fontSize: "15px", fontWeight: 600, color: "var(--text-primary)" }}>
              {companion.name}
            </div>
            <div style={{ textAlign: "center", fontFamily: "var(--font-body)", fontSize: "12px", color: companion.color, opacity: 0.9 }}>
              {voiceActive ? `${companion.name} is listening...` : sendingMessage ? `${companion.name} is shaping the next step...` : `${companion.name} is guiding this lesson.`}
            </div>

            {/* Speech bubbles */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
              {(speechBubbles ?? []).map((bubble, i) => (
                <div key={i} style={{
                  background: "var(--bg-surface)",
                  border: "1px solid var(--border)",
                  borderRadius: "12px 12px 12px 4px",
                  padding: "10px 14px",
                  fontFamily: "var(--font-body)",
                  fontSize: "13px",
                  color: "var(--text-primary)",
                  lineHeight: 1.5,
                }}>
                  {bubble}
                </div>
              ))}
            </div>

            <div style={{ ...panelStyle, padding: 12 }}>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
                Lesson Path
              </div>
              <div style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--text-primary)", lineHeight: 1.6 }}>
                {providerState?.local_only ? "Local Only is active." : "Approved cloud mode is available."}{" "}
                {providerState?.provider ? `Using ${providerState.provider.split(".").pop()}${providerState.model ? ` · ${providerState.model}` : ""}.` : ""}
              </div>
            </div>
          </div>

          {/* Content Area */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
              <div style={{
                ...panelStyle,
                minHeight: 200,
                fontFamily: useDyslexicFont ? "'OpenDyslexic', var(--font-body)" : "var(--font-body)",
                fontSize: "16px",
                color: "var(--text-primary)",
                lineHeight: 2.0,
                letterSpacing: wideLetterSpacing ? "0.08em" : undefined,
              }}>
                <MarkdownMessage content={contentText} />

                {/* Translate + Repeat buttons */}
                {contentText && contentText !== "Begin your session to start learning..." && contentText !== "Your companion is preparing..." && (
                  <div style={{ display: "flex", gap: 8, marginTop: 14, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
                    {/* Repeat — TTS */}
                    <button
                      onClick={async () => {
                        if (repeating) return;
                        setRepeating(true);
                        await playTTS(contentText, activeSession?.companion_id);
                        setRepeating(false);
                      }}
                      style={{ ...btnGhost, display: "flex", alignItems: "center", gap: 4 }}
                    >
                      {repeating ? "..." : "🔊"} Repeat
                    </button>

                    {/* Translate */}
                    <button
                      onClick={async () => {
                        if (translating) return;
                        setTranslating(true);
                        setTranslatedText(null);
                        try {
                          const res = await fetch(`${API_BASE}/magister/translate`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ text: contentText.slice(0, 1000), module_id: activeSession?.module_id }),
                          });
                          if (res.ok) {
                            const data = await res.json() as { text?: string };
                            setTranslatedText(data.text ?? null);
                          }
                        } catch { /* translate failed */ }
                        setTranslating(false);
                      }}
                      style={{ ...btnGhost, display: "flex", alignItems: "center", gap: 4 }}
                    >
                      {translating ? "..." : "🌐"} Translate
                    </button>
                  </div>
                )}

                {/* Inline translation */}
                {translatedText && (
                  <div style={{
                    marginTop: 10, padding: "10px 14px", borderRadius: 8,
                    background: "rgba(96,165,250,0.06)", border: "1px solid rgba(96,165,250,0.15)",
                    fontFamily: "var(--font-body)", fontSize: "15px", color: "var(--text-secondary)",
                    lineHeight: 1.8, whiteSpace: "pre-wrap",
                  }}>
                    {translatedText}
                  </div>
                )}

                {sessionAdaptive && (
                  <div style={{
                    marginTop: 14,
                    padding: "12px 14px",
                    borderRadius: 10,
                    background: "rgba(77,245,200,0.06)",
                    border: "1px solid rgba(77,245,200,0.18)",
                  }}>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#4df5c8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
                      Adaptive Guidance
                    </div>
                    <div style={{ fontFamily: "var(--font-body)", fontSize: 14, color: "var(--text-primary)", lineHeight: 1.7 }}>
                      {sessionAdaptive.feedback_line}
                    </div>
                    <div style={{ marginTop: 8, fontFamily: "var(--font-body)", fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.7 }}>
                      Next micro task: {sessionAdaptive.micro_task}
                    </div>
                  </div>
                )}

                {/* Receipt line */}
                {lastReceipt?.model && (
                  <div style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--text-muted)", marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    <span style={{ color: companion.color, fontWeight: 600 }}>{lastReceipt.model.split("/").pop()}</span>
                    {providerState?.provider && <><span style={{ opacity: 0.5 }}>·</span><span>{providerState.provider.split(".").pop()}</span></>}
                    {providerState?.local_only !== undefined && <><span style={{ opacity: 0.5 }}>·</span><span>{providerState.local_only ? "LOCAL ONLY" : "CLOUD OK"}</span></>}
                    {lastReceipt.tokensIn != null && <><span style={{ opacity: 0.5 }}>·</span><span>{lastReceipt.tokensIn}↑ {lastReceipt.tokensOut}↓</span></>}
                    {lastReceipt.costUsd != null && <><span style={{ opacity: 0.5 }}>·</span><span style={{ color: "#4ade80" }}>${lastReceipt.costUsd.toFixed(6)}</span></>}
                    {lastReceipt.durationMs != null && <><span style={{ opacity: 0.5 }}>·</span><span>{lastReceipt.durationMs}ms</span></>}
                  </div>
                )}
              </div>

              {/* Editor area */}
              <div style={{ marginTop: 16 }}>
                <textarea
                  value={editorText}
                  onChange={(e) => {
                    const val = telexEnabled ? applyTelex(e.target.value) : e.target.value;
                    setEditorText(val);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void sendUserMessage();
                    }
                  }}
                  placeholder={sendingMessage ? "Your companion is thinking..." : "Speak your answer or type it here. Press Enter to send."}
                  disabled={sendingMessage}
                  style={{
                    width: "100%",
                    minHeight: 120,
                    background: "var(--bg-surface)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-md)",
                    padding: 14,
                    fontFamily: "var(--font-body)",
                    fontSize: "14px",
                    color: "var(--text-primary)",
                    resize: "vertical",
                    outline: "none",
                    lineHeight: 1.6,
                  }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = ACCENT; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = "var(--border)"; }}
                />
              </div>
            </div>

            {/* Bottom bar */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "10px 24px", borderTop: "1px solid var(--border)",
              background: "var(--bg-deep)",
              gap: 12,
              flexWrap: "wrap",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {/* Send button */}
                <button
                  style={{ ...btnPrimary, opacity: (!editorText.trim() || sendingMessage) ? 0.4 : 1 }}
                  disabled={!editorText.trim() || sendingMessage}
                  onClick={() => void sendUserMessage()}
                >
                  {sendingMessage ? "..." : "Send"}
                </button>

                {/* Voice button */}
                <button
                  onMouseDown={voiceMode === "push" ? () => void startRecording() : undefined}
                  onMouseUp={voiceMode === "push" ? stopRecording : undefined}
                  onMouseLeave={voiceMode === "push" && voiceActive ? stopRecording : undefined}
                  onTouchStart={voiceMode === "push" ? (e) => { e.preventDefault(); void startRecording(); } : undefined}
                  onTouchEnd={voiceMode === "push" ? (e) => { e.preventDefault(); stopRecording(); } : undefined}
                  onClick={voiceMode === "toggle" ? () => {
                    if (voiceActive) stopRecording();
                    else void startRecording();
                  } : undefined}
                  style={{
                    ...btnGhost,
                    background: voiceActive ? `${ACCENT}20` : voiceLoading ? "rgba(167,139,250,0.12)" : undefined,
                    borderColor: voiceActive ? ACCENT : voiceLoading ? "#a78bfa" : undefined,
                    color: voiceActive ? ACCENT : voiceLoading ? "#a78bfa" : undefined,
                    animation: voiceActive ? "breathe 1s ease-in-out infinite" : undefined,
                  }}
                  title={voiceMode === "push" ? "Hold to talk" : voiceActive ? "Click to stop" : "Click to record"}
                >
                  {voiceLoading ? "..." : voiceActive ? "Listening..." : "Speak your answer"}
                </button>
                <button
                  style={{ ...btnGhost, fontSize: "10px", padding: "4px 6px", minHeight: 0 }}
                  onClick={() => setVoiceMode(v => v === "push" ? "toggle" : "push")}
                  title={voiceMode === "push" ? "Push-to-talk mode" : "Toggle mode"}
                >
                  {voiceMode === "push" ? "PTT" : "ON"}
                </button>

                {/* Telex toggle — Vietnamese/Mandarin only */}
                {(activeSession?.module_id === "vietnamese" || activeSession?.module_id === "mandarin") && (
                  <button
                    style={telexEnabled ? { ...btnPrimary, fontSize: "11px", padding: "4px 8px", minHeight: 0 } : { ...btnGhost, fontSize: "11px", padding: "4px 8px", minHeight: 0 }}
                    onClick={() => setTelexEnabled(v => !v)}
                    title="Telex Vietnamese input"
                  >
                    VI
                  </button>
                )}

                {/* Timer */}
                <span style={{
                  fontFamily: "var(--font-mono)", fontSize: "13px",
                  color: progressPct >= 100 ? "#4ade80" : "var(--text-muted)",
                }}>
                  {formatTime(sessionTimer)} / {formatTime(durationSeconds)}
                </span>
                {/* Mini progress */}
                <div style={{ width: 60, height: 4, background: "var(--bg-void)", borderRadius: 4, overflow: "hidden" }}>
                  <div style={{
                    width: `${progressPct}%`,
                    height: "100%",
                    background: progressPct >= 100 ? "#4ade80" : ACCENT,
                    borderRadius: 4,
                    transition: "width 1s linear",
                  }} />
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <div style={{ display: "flex", gap: 2, borderRadius: 8, overflow: "hidden", border: "1px solid var(--border)" }}>
                  {([["too_fast", "🐢"], ["just_right", "👍"], ["too_slow", "🚀"]] as const).map(([key, emoji]) => (
                    <button key={key} onClick={() => {
                      setPacingFeedback(key);
                      setLearnerProfile(prev => ({
                        ...prev,
                        complexity_ceiling: key === "too_fast" ? Math.max(1, prev.complexity_ceiling - 1) : key === "too_slow" ? Math.min(10, prev.complexity_ceiling + 1) : prev.complexity_ceiling,
                        repetition_comfort: key === "too_fast" ? Math.min(10, prev.repetition_comfort + 1) : key === "too_slow" ? Math.max(1, prev.repetition_comfort - 1) : prev.repetition_comfort,
                      }));
                      setTimeout(() => setPacingFeedback(null), 2000);
                    }} style={{
                      padding: "4px 8px", border: "none", cursor: "pointer", fontSize: 16,
                      background: pacingFeedback === key ? `${ACCENT}20` : "transparent",
                    }}>{emoji}</button>
                  ))}
                </div>
                <button
                  style={{ ...btnGhost, position: "relative" }}
                  onClick={requestHint}
                >
                  Hint {hintLevel > 0 && <span style={{
                    position: "absolute", top: -4, right: -4,
                    width: 16, height: 16, borderRadius: "50%",
                    background: ACCENT, color: "#060810",
                    fontSize: 14, fontWeight: 700,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>{hintLevel}</span>}
                </button>
                {sessionRunning ? (
                  <button style={btnSecondary} onClick={pauseSession}>
                    Pause
                  </button>
                ) : (
                  <button style={btnPrimary} onClick={resumeSession}>
                    Resume
                  </button>
                )}
              </div>
            </div>
            <div style={{ position: "fixed", right: 20, bottom: 24, zIndex: 40 }}>
              {comfortOpen && (
                <div style={{
                  width: 320,
                  marginBottom: 10,
                  background: "rgba(10, 14, 28, 0.94)",
                  border: `1px solid ${companion.color}33`,
                  boxShadow: `0 18px 42px ${companion.color}22`,
                  borderRadius: 18,
                  padding: 16,
                  backdropFilter: "blur(16px)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 14,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontFamily: "var(--font-display)", fontSize: 18, color: "var(--text-primary)" }}>Comfort</div>
                      <div style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--text-muted)" }}>Readable, calm, and always within reach.</div>
                    </div>
                    <button style={btnGhost} onClick={() => setComfortOpen(false)}>Close</button>
                  </div>
                  <div>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>Speed</div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button style={pillStyle(pacingFeedback === "too_fast")} onClick={() => setPacingFeedback("too_fast")}>Slow</button>
                      <button style={pillStyle(pacingFeedback === "too_slow")} onClick={() => setPacingFeedback("too_slow")}>Fast</button>
                    </div>
                  </div>
                  <div>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>Readability</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button onClick={() => setUseDyslexicFont(v => !v)} style={pillStyle(useDyslexicFont)}>Dyslexia font</button>
                      <button onClick={() => setWideLetterSpacing(v => !v)} style={pillStyle(wideLetterSpacing)}>Word spacing</button>
                    </div>
                  </div>
                  <div>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>Audio</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                      <button onClick={() => setSessionSettings(prev => prev ? { ...prev, narration_enabled: !prev.narration_enabled } : prev)} style={pillStyle(sessionSettings?.narration_enabled !== false)}>
                        {sessionSettings?.narration_enabled === false ? "Narration off" : "Narration on"}
                      </button>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="0.5"
                      step="0.01"
                      value={ambientVolume}
                      onChange={e => {
                        const v = parseFloat(e.target.value);
                        setAmbientVolume(v);
                        if (audioRef.current) audioRef.current.volume = v;
                      }}
                      style={{ width: "100%", accentColor: companion.color, height: 12, cursor: "pointer" }}
                      title="Narration volume"
                    />
                  </div>
                  <div>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>Support</div>
                    <button onClick={() => setComfortMode(v => !v)} style={pillStyle(comfortMode)}>Comfort mode</button>
                  </div>
                </div>
              )}
              <button
                onClick={() => setComfortOpen(v => !v)}
                style={{
                  background: companion.color,
                  color: "#160808",
                  border: "none",
                  borderRadius: 999,
                  padding: "14px 18px",
                  fontFamily: "var(--font-body)",
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: "pointer",
                  boxShadow: `0 12px 28px ${companion.color}44`,
                }}
              >
                Comfort
              </button>
            </div>
          </div>
        </div>

        {/* Mobile companion panel — inline style media query handled via className */}
        <style>{`
          @media (max-width: 768px) {
            .magister-companion-panel {
              display: none !important;
            }
          }
        `}</style>
      </div>
    );
  }

  // ── Render: The Map ───────────────────────────────────────────────────────

  function renderMap() {
    const mod = modules.find((m) => m.id === mapModuleId);

    return (
      <div style={{ padding: "20px 16px", maxWidth: 900, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1 style={{ fontFamily: "var(--font-display)", fontSize: "24px", fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>
              The Map
            </h1>
            {mod && (
              <p style={{ fontFamily: "var(--font-body)", fontSize: "14px", color: "var(--text-muted)", marginTop: 4 }}>
                {mod.campaign_world} — {mod.name}
              </p>
            )}
          </div>
          <button style={btnGhost} onClick={() => setScreen("hall")}>
            Back to Hall
          </button>
        </div>

        {/* Select module if none selected */}
        {!mapModuleId && (
          <div style={panelStyle}>
            <p style={{ fontFamily: "var(--font-body)", fontSize: "14px", color: "var(--text-muted)", marginBottom: 12 }}>
              Select a campaign to view its progress map:
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {(sessions ?? []).map((s) => (
                <button
                  key={s.id}
                  style={{ ...cardStyle, textAlign: "left" }}
                  onClick={() => {
                    setMapModuleId(s.module_id);
                    setMapCompanionId(s.companion_id);
                    fetchProgress(s.module_id);
                    fetchMemories(s.companion_id);
                  }}
                >
                  <div style={{ fontFamily: "var(--font-body)", fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>
                    {s.module_name}
                  </div>
                  <div style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--text-muted)" }}>
                    with {s.companion_name}
                  </div>
                </button>
              ))}
              {sessions.length === 0 && (
                <p style={{ fontFamily: "var(--font-body)", fontSize: "13px", color: "var(--text-muted)" }}>
                  No active sessions. Start a campaign first.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Concept Progress */}
        {mapModuleId && (
          <section>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: "18px", fontWeight: 700, color: "var(--text-primary)", marginBottom: 12 }}>
              Concept Mastery
            </h2>
            <div style={{ ...panelStyle, display: "flex", flexDirection: "column", gap: 8 }}>
              {moduleProgress && (moduleProgress.concepts ?? []).length > 0 ? (
                (moduleProgress.concepts ?? []).map((c, i) => (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "10px 14px",
                    background: "var(--bg-raised)",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--border)",
                  }}>
                    <span style={{ fontFamily: "var(--font-body)", fontSize: "14px", color: "var(--text-primary)" }}>
                      {c.concept}
                    </span>
                    <span style={{
                      fontFamily: "var(--font-mono)", fontSize: "11px",
                      color: MASTERY_COLORS[c.mastery],
                      background: `${MASTERY_COLORS[c.mastery]}18`,
                      padding: "3px 10px",
                      borderRadius: 10,
                      fontWeight: 600,
                    }}>
                      {MASTERY_LABELS[c.mastery]}
                    </span>
                  </div>
                ))
              ) : (
                <div style={{ padding: 20, textAlign: "center" }}>
                  <p style={{ fontFamily: "var(--font-body)", fontSize: "13px", color: "var(--text-muted)" }}>
                    No concepts tracked yet. Complete some sessions to see your progress.
                  </p>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Exam Readiness */}
        {moduleProgress && moduleProgress.exam_readiness !== null && (
          <section>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: "18px", fontWeight: 700, color: "var(--text-primary)", marginBottom: 12 }}>
              Exam Readiness
            </h2>
            <div style={panelStyle}>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <div style={{
                  width: 64, height: 64, borderRadius: "50%",
                  border: `3px solid ${moduleProgress.exam_readiness >= 80 ? "#4ade80" : moduleProgress.exam_readiness >= 50 ? "#fbbf24" : "#f87171"}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontFamily: "var(--font-display)", fontSize: "22px", fontWeight: 700,
                  color: moduleProgress.exam_readiness >= 80 ? "#4ade80" : moduleProgress.exam_readiness >= 50 ? "#fbbf24" : "#f87171",
                }}>
                  {Math.round(moduleProgress.exam_readiness)}%
                </div>
                <div>
                  <div style={{ fontFamily: "var(--font-body)", fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>
                    {moduleProgress.exam_readiness >= 80 ? "Ready for certification" : moduleProgress.exam_readiness >= 50 ? "Getting closer" : "Keep studying"}
                  </div>
                  <div style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--text-muted)" }}>
                    Based on concept mastery across all topics
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Companion's Journal */}
        {mapCompanionId && (
          <section>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: "18px", fontWeight: 700, color: "var(--text-primary)", marginBottom: 12 }}>
              Companion&apos;s Journal
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {companionMemories.length > 0 ? (
                (companionMemories ?? []).slice(0, 5).map((mem, i) => (
                  <div key={mem.id || i} style={{
                    ...panelStyle,
                    background: "var(--bg-raised)",
                    borderLeft: `3px solid ${ACCENT}`,
                    fontStyle: "italic",
                  }}>
                    <p style={{
                      fontFamily: "var(--font-body)", fontSize: "13px",
                      color: "var(--text-primary)", lineHeight: 1.6,
                      letterSpacing: "0.02em",
                    }}>
                      &ldquo;{mem.text}&rdquo;
                    </p>
                    <span style={{
                      fontFamily: "var(--font-mono)", fontSize: "10px",
                      color: "var(--text-muted)", marginTop: 6, display: "block",
                    }}>
                      {timeAgo(mem.created_at)}
                    </span>
                  </div>
                ))
              ) : (
                <div style={{ ...panelStyle, textAlign: "center", padding: 20 }}>
                  <p style={{ fontFamily: "var(--font-body)", fontSize: "13px", color: "var(--text-muted)" }}>
                    Your companion has not written any journal entries yet.
                  </p>
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    );
  }

  // ── Render: The Library ───────────────────────────────────────────────────

  function renderAdvancedStudies() {
    return (
      <div style={{ padding: "20px 16px", maxWidth: 1200, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: "24px", fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>
          Advanced Studies
        </h1>
        <p style={{ fontFamily: "var(--font-body)", fontSize: "14px", color: "var(--text-muted)", margin: 0, lineHeight: 1.6 }}>
          Lab-only campaigns for Jeff's professional development. CompTIA certifications, prompt engineering, and specialized technical training.
        </p>

        {/* Shelves — advanced modules only */}
        {(() => {
          const advShelves: typeof modules[] = [];
          for (let i = 0; i < advancedModules.length; i += 3) advShelves.push(advancedModules.slice(i, i + 3));
          return advShelves;
        })().length > 0 ? (
          (() => {
            const advShelves: typeof modules[] = [];
            for (let i = 0; i < advancedModules.length; i += 3) advShelves.push(advancedModules.slice(i, i + 3));
            return advShelves;
          })().map((shelf, si) => (
            <div key={si} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {/* Shelf visual */}
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
                            onClick={() => installModule(m.id)}
                          >
                            Install
                          </button>
                        )}
                        {m.installed && (
                          <button
                            style={{ ...btnPrimary, padding: "6px 14px", fontSize: "12px" }}
                            onClick={() => {
                              setSelectedModuleId(m.id);
                              setSelectedCompanionId((m.companions ?? []).length > 0 ? (m.companions ?? [])[0].id : null);
                              setShowNewCampaign(true);
                              setScreen("hall");
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

  // ── Render: The Inkwell ──────────────────────────────────────────────────

  // Fetch Inkwell drafts.
  // TODO(magister-standalone): Squidley sourced drafts from Archivum
  // (GET /archivum/entries filtered by topic). The standalone has
  // /magister/creative/<moduleId> as the closest analogue but it's
  // module-scoped, not topic-tagged. Returning an empty list keeps the
  // UI rendable while the standalone Archivum story is decided.
  async function fetchInkwellDrafts() {
    setInkwellDrafts([]);
  }

  async function shareWithMaren() {
    if (!inkwellText.trim() || inkwellFeedbackLoading) return;
    setInkwellFeedbackLoading(true);
    setInkwellFeedback("");
    try {
      // Maren's feedback used to call squidley's /chat. The standalone routes
      // companion turns through /magister/sessions/:id/chat, so we treat this as
      // a one-shot translate-style call: a fresh request to /magister/translate
      // with a feedback-style "target" prompt is overkill, so we go via a
      // dedicated /magister/inkwell/feedback endpoint when it lands. Until then,
      // tell the user clearly.
      const sysPrompt = "You are Maren, senior editor and writing guide. Read carefully and respond as a thoughtful editor: what works, what doesn't, what you want to know more about. Celebrate strong sentences specifically. Ask one focused question. Direct, honest, no false encouragement. One piece of feedback at a time.";
      // Use the magister chat endpoint with a temporary session-less wrapper:
      // fall back to a clear unavailable message if the standalone isn't yet
      // wired for session-less LLM calls (it isn't).
      // TODO(magister-standalone): wire POST /magister/inkwell/feedback that
      // calls llm.complete with the prompt above + inkwellText.
      void sysPrompt;
      setInkwellFeedback("Maren's feedback is being rewired for the standalone build. Until /magister/inkwell/feedback lands, please use the companion chat in a study session.");
    } catch {
      setInkwellFeedback("Failed to reach Maren.");
    }
    setInkwellFeedbackLoading(false);
  }

  async function saveInkwellDraft() {
    if (!inkwellText.trim()) return;
    const title = inkwellTitle.trim() || inkwellText.split("\n")[0]?.slice(0, 60) || "Untitled Draft";
    try {
      const fullContent = inkwellFeedback
        ? `${inkwellText}\n\n---\n\nMaren's feedback:\n${inkwellFeedback}`
        : inkwellText;
      // TODO(magister-standalone): Squidley persisted Inkwell drafts to Archivum
      // (POST /archivum/paste with a tag). The standalone equivalent is
      // /magister/creative/<moduleId> but Inkwell isn't bound to a single module.
      // Stubbing as a save-confirmation only until we add a generalized
      // /magister/drafts endpoint or pin Inkwell to a "writing" module.
      void fullContent;
      const res = { ok: true };
      if (res.ok) {
        setInkwellSaveMsg(`Saved: ${title} (note: persistence pending)`);
        setTimeout(() => setInkwellSaveMsg(null), 3000);
        await fetchInkwellDrafts();
      }
    } catch {
      setInkwellSaveMsg("Save failed");
      setTimeout(() => setInkwellSaveMsg(null), 3000);
    }
  }

  function renderInkwell() {
    // Fetch drafts on first render
    if (inkwellDrafts.length === 0 && screen === "inkwell") {
      void fetchInkwellDrafts();
    }

    const INKWELL_ACCENT = "#a78bfa";
    const mono: React.CSSProperties = { fontFamily: "var(--font-mono)", fontSize: 14 };

    return (
      <div style={{ display: "flex", height: "100%", minHeight: 0, overflow: "hidden" }}>
        {/* ── Left: Drafts ─────────────────────────────────────────────── */}
        <div style={{ width: 220, flexShrink: 0, borderRight: "1px solid var(--border)", overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ ...mono, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 4 }}>Drafts</div>
          <button
            onClick={() => { setInkwellText(""); setInkwellTitle(""); setInkwellFeedback(""); }}
            style={{ ...mono, padding: "6px 10px", borderRadius: 6, border: `1px solid ${INKWELL_ACCENT}30`, background: `${INKWELL_ACCENT}10`, color: INKWELL_ACCENT, cursor: "pointer", fontWeight: 700, textAlign: "left" }}
          >+ New Draft</button>
          {inkwellDrafts.map(d => (
            <button
              key={d.id}
              onClick={() => { setInkwellText(d.content); setInkwellTitle(d.title); setInkwellFeedback(d.feedback ?? ""); }}
              style={{ ...mono, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "rgba(17,21,40,0.5)", color: "var(--text-primary)", cursor: "pointer", textAlign: "left" }}
            >
              <div style={{ fontWeight: 600, marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.title}</div>
              <div style={{ color: "var(--text-muted)", fontSize: 14 }}>{d.createdAt ? new Date(d.createdAt).toLocaleDateString() : ""}</div>
            </button>
          ))}
          {inkwellDrafts.length === 0 && (
            <div style={{ ...mono, color: "var(--text-muted)", padding: 8 }}>No drafts yet. Start writing.</div>
          )}
        </div>

        {/* ── Center: Writing Area ─────────────────────────────────────── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, padding: "16px 20px" }}>
          <input
            value={inkwellTitle}
            onChange={e => setInkwellTitle(e.target.value)}
            placeholder="Title (optional — auto-generated from first line)"
            style={{ background: "none", border: "none", outline: "none", fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 700, color: "var(--text-primary)", marginBottom: 12, padding: "4px 0", borderBottom: "1px solid var(--border)" }}
          />
          <textarea
            value={inkwellText}
            onChange={e => setInkwellText(e.target.value)}
            placeholder="Write here. When you're ready for feedback, share with Maren."
            style={{
              flex: 1, background: "none", border: "none", outline: "none", resize: "none",
              fontFamily: "var(--font-body)", fontSize: 15, lineHeight: 1.8,
              color: "var(--text-primary)", padding: 0,
            }}
          />
          <div style={{ display: "flex", gap: 8, paddingTop: 12, borderTop: "1px solid var(--border)", flexShrink: 0 }}>
            <button
              onClick={() => void shareWithMaren()}
              disabled={!inkwellText.trim() || inkwellFeedbackLoading}
              style={{
                padding: "9px 16px", borderRadius: 8, border: "none",
                background: inkwellText.trim() ? `linear-gradient(135deg, ${INKWELL_ACCENT}, #f472b6)` : "var(--bg-raised)",
                color: inkwellText.trim() ? "#060810" : "var(--text-muted)",
                fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 700,
                cursor: inkwellText.trim() ? "pointer" : "default",
              }}
            >{inkwellFeedbackLoading ? "Maren is reading..." : "Share with Maren"}</button>
            <button
              onClick={() => void saveInkwellDraft()}
              disabled={!inkwellText.trim()}
              style={{
                padding: "9px 16px", borderRadius: 8,
                border: `1px solid ${INKWELL_ACCENT}30`,
                background: `${INKWELL_ACCENT}08`,
                color: inkwellText.trim() ? INKWELL_ACCENT : "var(--text-muted)",
                fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 700,
                cursor: inkwellText.trim() ? "pointer" : "default",
              }}
            >Save Draft</button>
            {inkwellSaveMsg && (
              <span style={{ ...mono, color: inkwellSaveMsg.startsWith("Saved") ? "#4ade80" : "#f87171", alignSelf: "center" }}>{inkwellSaveMsg}</span>
            )}
            <span style={{ ...mono, color: "var(--text-muted)", marginLeft: "auto", alignSelf: "center" }}>
              {inkwellText.length > 0 ? `${inkwellText.split(/\s+/).filter(Boolean).length} words` : ""}
            </span>
          </div>
        </div>

        {/* ── Right: Maren's Feedback ──────────────────────────────────── */}
        <div style={{ width: 320, flexShrink: 0, borderLeft: "1px solid var(--border)", overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: INKWELL_ACCENT, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 700, color: "#060810" }}>M</div>
            <div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 700, color: INKWELL_ACCENT }}>Maren</div>
              <div style={{ ...mono, color: "var(--text-muted)" }}>Senior Editor</div>
            </div>
          </div>
          {inkwellFeedbackLoading && (
            <div style={{ fontFamily: "var(--font-body)", fontSize: 14, color: "var(--text-muted)", fontStyle: "italic", lineHeight: 1.6 }}>
              Reading your draft carefully...
            </div>
          )}
          {!inkwellFeedbackLoading && inkwellFeedback && (
            <div style={{
              fontFamily: "var(--font-body)", fontSize: 14, color: "var(--text-secondary)",
              lineHeight: 1.8, whiteSpace: "pre-wrap",
              padding: "14px 16px", borderRadius: 10,
              background: `${INKWELL_ACCENT}08`, border: `1px solid ${INKWELL_ACCENT}15`,
            }}>
              {inkwellFeedback}
            </div>
          )}
          {!inkwellFeedbackLoading && !inkwellFeedback && (
            <div style={{ fontFamily: "var(--font-body)", fontSize: 14, color: "var(--text-muted)", lineHeight: 1.6, fontStyle: "italic" }}>
              Write something and share it with me. I'll read every word.
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Main Render ───────────────────────────────────────────────────────────

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      height: "100%",
      background: "var(--bg-void)",
      fontFamily: "var(--font-body)",
      fontSize: "14px",
    }}>
      {/* Tab bar */}
      <nav style={tabBarStyle}>
        {TABS.map((tab) => (
          <button
            key={tab.key}
            style={tabStyle(screen === tab.key)}
            onClick={() => setScreen(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Error banner */}
      {error && (
        <div style={{
          background: "rgba(248,113,113,0.1)",
          border: "1px solid rgba(248,113,113,0.3)",
          borderRadius: "var(--radius-sm)",
          padding: "10px 16px",
          margin: "8px 16px 0",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}>
          <span style={{ fontFamily: "var(--font-body)", fontSize: "13px", color: "#f87171" }}>
            {error}
          </span>
          <button
            style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: "16px", minHeight: 44, minWidth: 44, display: "flex", alignItems: "center", justifyContent: "center" }}
            onClick={() => setError(null)}
          >
            x
          </button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: 40, color: "var(--text-muted)", fontSize: "14px",
          fontFamily: "var(--font-body)",
        }}>
          Loading Magister...
        </div>
      )}

      {/* Screen content */}
      {!loading && (
        <div style={{ flex: 1, overflowY: "auto" }}>
          {screen === "hall" && renderHall()}
          {screen === "session" && renderSession()}
          {screen === "map" && renderMap()}
          {screen === "advanced" && renderAdvancedStudies()}
          {screen === "inkwell" && renderInkwell()}
        </div>
      )}
    </div>
  );
}
