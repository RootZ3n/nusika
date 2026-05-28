"use client";

/**
 * Nusika root — orchestration shell.
 *
 * Holds the cross-screen state (active session, practice mode, modal state,
 * map selection) and delegates rendering to the per-screen components:
 *   - IttunahaView       gathering place / landing
 *   - SessionView        lesson + practice + Comfort drawer
 *   - MapView            mastery + journal
 *   - AdvancedView       Advanced Studies shelf
 *   - ShukhaAnumpaView   story workshop
 *
 * Data access goes through useNusikaApi; timer + audio through
 * useSessionTimer; voice through useVoicePlayback.
 */

import { useCallback, useState } from "react";
import { IttunahaView } from "./components/IttunahaView";
import { SessionView } from "./components/SessionView";
import { MapView } from "./components/MapView";
import { AdvancedView } from "./components/AdvancedView";
import { ShukhaAnumpaView } from "./components/ShukhaAnumpaView";
import { useNusikaApi } from "./hooks/useNusikaApi";
import { useSessionTimer } from "./hooks/useSessionTimer";
import { useVoicePlayback } from "./hooks/useVoicePlayback";
import { useIttunahaVoice } from "./hooks/useIttunahaVoice";
import {
  API_BASE,
  DEFAULT_LEARNER_PROFILE,
  TABS,
  tabBarStyle,
  tabStyle,
  type ChatReceipt,
  type LearnerProfile,
  type NusikaModule,
  type NusikaSession,
  type PracticeMessage,
  type Screen,
} from "./types";

export default function NusikaPage() {
  const api = useNusikaApi();
  const {
    modules, setModules, sessions, streak, loading, error, setError, refreshSessions,
    moduleProgress, companionMemories, fetchProgress, fetchMemories, fetchSessionDetail, deleteSession,
    narrator, sessionSettings, setSessionSettings,
    useDyslexicFont, setUseDyslexicFont, wideLetterSpacing, setWideLetterSpacing,
    ambientVolume, setAmbientVolume, comfortMode, setComfortMode,
    shukhaAnumpaDrafts, fetchShukhaAnumpaDrafts, saveShukhaAnumpaDraft, deleteShukhaAnumpaDraft, shukhaAnumpaFeedback,
  } = api;

  // ── Screen routing ───────────────────────────────────────────────────────
  const [screen, setScreen] = useState<Screen>("ittunaha");

  // ── Active campaign session state (persists across tabs) ─────────────────
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<NusikaSession | null>(null);
  const [sessionRunning, setSessionRunning] = useState(false);
  const [hintLevel, setHintLevel] = useState(0);
  const [speechBubbles, setSpeechBubbles] = useState<string[]>(["Welcome back! Ready to continue our journey?"]);
  const [contentText, setContentText] = useState("Begin your session to start learning...");
  const [editorText, setEditorText] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [recapStatus, setRecapStatus] = useState<string | null>(null);
  const [lastReceipt, setLastReceipt] = useState<ChatReceipt | null>(null);

  // ── Translate + Repeat ──────────────────────────────────────────────────
  const [translatedText, setTranslatedText] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const [repeating, setRepeating] = useState(false);

  // ── Telex toggle ────────────────────────────────────────────────────────
  const [telexEnabled, setTelexEnabled] = useState(false);

  // ── Adaptive pacing ─────────────────────────────────────────────────────
  const [learnerProfile, setLearnerProfile] = useState<LearnerProfile>(DEFAULT_LEARNER_PROFILE);
  const [pacingFeedback, setPacingFeedback] = useState<"too_fast" | "just_right" | "too_slow" | null>(null);

  // ── Comfort drawer ──────────────────────────────────────────────────────
  const [comfortOpen, setComfortOpen] = useState(false);

  // ── Practice mode ───────────────────────────────────────────────────────
  const [practiceModuleId, setPracticeModuleId] = useState<string | null>(null);
  const [practiceInput, setPracticeInput] = useState("");
  const [practiceHistory, setPracticeHistory] = useState<PracticeMessage[]>([]);
  const [practiceSending, setPracticeSending] = useState(false);
  const [practiceSessionId, setPracticeSessionId] = useState<string | null>(null);

  // ── New-campaign modal ──────────────────────────────────────────────────
  const [showNewCampaign, setShowNewCampaign] = useState(false);
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
  const [selectedCompanionId, setSelectedCompanionId] = useState<string | null>(null);
  const [selectedDuration, setSelectedDuration] = useState(10);
  const [selectedMode, setSelectedMode] = useState("narrative");

  // ── Map screen ──────────────────────────────────────────────────────────
  const [mapModuleId, setMapModuleId] = useState<string | null>(null);
  const [mapCompanionId, setMapCompanionId] = useState<string | null>(null);

  // ── Ittunaha voice picker + Preview (in-session) ───────────────────────
  const ittunahaVoice = useIttunahaVoice();

  // ── Voice (TTS/STT) ─────────────────────────────────────────────────────
  const voice = useVoicePlayback({
    moduleId: activeSession?.module_id ?? null,
    narrationEnabled: sessionSettings?.narration_enabled !== false,
    onTranscript: (text) => {
      setEditorText((prev) => (prev ? prev + " " + text : text));
    },
  });

  // ── Session timer + ambient audio ───────────────────────────────────────
  const timer = useSessionTimer({
    sessionRunning,
    activeSession,
    modules,
    ambientVolume,
    resetSignal: activeSessionId,
    onTenMinuteWarning: () => {
      setSpeechBubbles((prev) => [...prev.slice(-4), "[Session winding down — companion will offer a natural wrap-up]"]);
    },
  });
  const sessionTimer = timer.sessionTimer;

  // ── Session lifecycle actions ───────────────────────────────────────────

  const startSession = useCallback(async (sessionId: string) => {
    setActiveSessionId(sessionId);
    setScreen("session");
    setSessionRunning(true);
    setHintLevel(0);
    setEditorText("");

    const session = await fetchSessionDetail(sessionId);
    if (!session) return;
    setActiveSession(session);

    if (session.last_summary) {
      setContentText(session.last_summary);
      setSpeechBubbles([`Welcome back! Last time we covered: ${(session.last_summary ?? "").slice(0, 80)}...`]);
    } else {
      setContentText("Your companion is preparing...");
      setSpeechBubbles(["Preparing your lesson..."]);
      try {
        const chatRes = await fetch(`${API_BASE}/nusika/sessions/${sessionId}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: "Begin our session. Introduce yourself and the concept we're exploring today. Set the scene.",
            history: [],
          }),
        });
        if (chatRes.ok) {
          const chatData = (await chatRes.json()) as {
            reply?: string; text?: string; model?: string;
            tokensIn?: number; tokensOut?: number; costUsd?: number; durationMs?: number;
          };
          const reply = chatData.reply ?? chatData.text ?? "";
          if (reply) {
            setContentText(reply);
            setSpeechBubbles([reply.length > 200 ? reply.slice(0, 200) + "..." : reply]);
            setLastReceipt({
              model: chatData.model,
              tokensIn: chatData.tokensIn,
              tokensOut: chatData.tokensOut,
              costUsd: chatData.costUsd,
              durationMs: chatData.durationMs,
            });
            void voice.playTTS(reply, session.companion_id);
          }
        }
      } catch { /* opening message failed — static text stays */ }
    }
  }, [fetchSessionDetail, voice]);

  const pauseSession = useCallback(async () => {
    setSessionRunning(false);
    if (activeSessionId) {
      try {
        await fetch(`${API_BASE}/nusika/sessions/${activeSessionId}`, {
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

  const endActiveSession = useCallback(async () => {
    if (!activeSessionId) return;
    setSessionRunning(false);
    const sessionId = activeSessionId;
    try {
      await fetch(`${API_BASE}/nusika/sessions/${sessionId}/end`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
    } catch { /* silent */ }

    let recapMsg = "Session ended.";
    try {
      const res = await fetch(`${API_BASE}/nusika/sessions/${sessionId}/recap`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        const data = (await res.json()) as { ok?: boolean; saved?: boolean; skipped?: boolean; reason?: string };
        if (data.saved) recapMsg = "Session ended. Memory recap saved.";
        else if (data.skipped) recapMsg = `Session ended. ${data.reason ?? "Recap skipped."}`;
      } else if (res.status === 502) {
        recapMsg = "Session ended. Memory recap unavailable because no LLM backend is configured.";
      } else if (res.status === 422) {
        recapMsg = "Session ended. Memory recap was rejected (schema validation).";
      } else {
        recapMsg = `Session ended. Recap failed (HTTP ${res.status}).`;
      }
    } catch {
      recapMsg = "Session ended. Memory recap could not be reached.";
    }

    setRecapStatus(recapMsg);
    setTimeout(() => setRecapStatus(null), 6000);

    setActiveSessionId(null);
    setActiveSession(null);
    setScreen("ittunaha");
    void refreshSessions();
  }, [activeSessionId, refreshSessions]);

  const createCampaign = useCallback(async () => {
    if (!selectedModuleId || !selectedCompanionId) return;
    try {
      const res = await fetch(`${API_BASE}/nusika/sessions`, {
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
        await refreshSessions();
        const sessionId = data.session?.id ?? data.id;
        if (sessionId) void startSession(sessionId);
      } else {
        setError("Failed to create campaign");
      }
    } catch {
      setError("Failed to create campaign");
    }
  }, [selectedModuleId, selectedCompanionId, selectedDuration, selectedMode, refreshSessions, startSession, setError]);

  const installModule = useCallback((moduleId: string) => {
    setModules((prev) => prev.map((m) => (m.id === moduleId ? { ...m, installed: true } : m)));
  }, [setModules]);

  const openMap = useCallback((moduleId: string, companionId?: string) => {
    setMapModuleId(moduleId);
    setMapCompanionId(companionId ?? null);
    setScreen("map");
    void fetchProgress(moduleId);
    if (companionId) void fetchMemories(companionId);
  }, [fetchProgress, fetchMemories]);

  // ── Derived collections ─────────────────────────────────────────────────
  const campaignModules: NusikaModule[] = (modules ?? []).filter((m) => m.id !== "inkwell");
  const ittunahaModules = campaignModules.filter((m) => {
    const tier = (m as unknown as Record<string, unknown>).tier as string | undefined;
    const labOnly = (m as unknown as Record<string, unknown>).lab_only as boolean | undefined;
    return !labOnly && tier !== "advanced";
  });
  const advancedModules = campaignModules.filter((m) => {
    const tier = (m as unknown as Record<string, unknown>).tier as string | undefined;
    const labOnly = (m as unknown as Record<string, unknown>).lab_only as boolean | undefined;
    return labOnly || tier === "advanced";
  });
  const activeSessions = (sessions ?? []).filter((s) => s.status === "active" || s.status === "paused");

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      height: "100%",
      background: "var(--bg-void)",
      fontFamily: "var(--font-body)",
      fontSize: "14px",
    }}>
      <nav style={tabBarStyle}>
        {TABS.map((tab) => (
          <button key={tab.key} style={tabStyle(screen === tab.key)} onClick={() => setScreen(tab.key)}>
            {tab.label}
          </button>
        ))}
      </nav>

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
          <span style={{ fontFamily: "var(--font-body)", fontSize: "13px", color: "#f87171" }}>{error}</span>
          <button
            style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: "16px", minHeight: 44, minWidth: 44, display: "flex", alignItems: "center", justifyContent: "center" }}
            onClick={() => setError(null)}
          >
            x
          </button>
        </div>
      )}

      {loading && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: 40, color: "var(--text-muted)", fontSize: "14px",
          fontFamily: "var(--font-body)",
        }}>
          Loading Nusika...
        </div>
      )}

      {!loading && (
        <div style={{ flex: 1, overflowY: "auto" }}>
          {screen === "ittunaha" && (
            <IttunahaView
              recapStatus={recapStatus}
              narrator={narrator}
              useDyslexicFont={useDyslexicFont}
              wideLetterSpacing={wideLetterSpacing}
              streak={streak}
              activeSessions={activeSessions}
              campaignModules={ittunahaModules}
              modules={modules}
              loading={loading}
              onStartSession={(sid) => void startSession(sid)}
              onSetScreen={setScreen}
              onStartPractice={(moduleId) => {
                setPracticeModuleId(moduleId);
                setScreen("session");
                setPracticeHistory([]);
              }}
              onStopSession={(sid) => void deleteSession(sid)}
              showNewCampaign={showNewCampaign}
              setShowNewCampaign={setShowNewCampaign}
              selectedModuleId={selectedModuleId}
              setSelectedModuleId={setSelectedModuleId}
              selectedCompanionId={selectedCompanionId}
              setSelectedCompanionId={setSelectedCompanionId}
              selectedDuration={selectedDuration}
              setSelectedDuration={setSelectedDuration}
              selectedMode={selectedMode}
              setSelectedMode={setSelectedMode}
              onCreateCampaign={() => void createCampaign()}
            />
          )}
          {screen === "session" && (
            <SessionView
              modules={modules}
              activeSession={activeSession}
              activeSessionId={activeSessionId}
              sessionTimer={sessionTimer}
              sessionRunning={sessionRunning}
              hintLevel={hintLevel}
              setHintLevel={setHintLevel}
              speechBubbles={speechBubbles}
              setSpeechBubbles={setSpeechBubbles}
              contentText={contentText}
              setContentText={setContentText}
              editorText={editorText}
              setEditorText={setEditorText}
              sendingMessage={sendingMessage}
              setSendingMessage={setSendingMessage}
              chatError={chatError}
              setChatError={setChatError}
              lastReceipt={lastReceipt}
              setLastReceipt={setLastReceipt}
              translatedText={translatedText}
              setTranslatedText={setTranslatedText}
              translating={translating}
              setTranslating={setTranslating}
              repeating={repeating}
              setRepeating={setRepeating}
              practiceModuleId={practiceModuleId}
              setPracticeModuleId={setPracticeModuleId}
              practiceInput={practiceInput}
              setPracticeInput={setPracticeInput}
              practiceHistory={practiceHistory}
              setPracticeHistory={setPracticeHistory}
              practiceSending={practiceSending}
              setPracticeSending={setPracticeSending}
              practiceSessionId={practiceSessionId}
              setPracticeSessionId={setPracticeSessionId}
              voiceMode={voice.voiceMode}
              setVoiceMode={voice.setVoiceMode}
              voiceActive={voice.voiceActive}
              voiceLoading={voice.voiceLoading}
              startRecording={voice.startRecording}
              stopRecording={voice.stopRecording}
              playTTS={voice.playTTS}
              hallVoice={ittunahaVoice}
              telexEnabled={telexEnabled}
              setTelexEnabled={setTelexEnabled}
              useDyslexicFont={useDyslexicFont}
              setUseDyslexicFont={setUseDyslexicFont}
              wideLetterSpacing={wideLetterSpacing}
              setWideLetterSpacing={setWideLetterSpacing}
              ambientVolume={ambientVolume}
              setAmbientVolume={setAmbientVolume}
              audioRef={timer.audioRef}
              sessionSettings={sessionSettings}
              setSessionSettings={setSessionSettings}
              comfortMode={comfortMode}
              setComfortMode={setComfortMode}
              comfortOpen={comfortOpen}
              setComfortOpen={setComfortOpen}
              pacingFeedback={pacingFeedback}
              setPacingFeedback={setPacingFeedback}
              learnerProfile={learnerProfile}
              setLearnerProfile={setLearnerProfile}
              onPauseSession={pauseSession}
              onResumeSession={resumeSession}
              onEndSession={endActiveSession}
              onOpenMap={openMap}
            />
          )}
          {screen === "map" && (
            <MapView
              modules={modules}
              sessions={sessions}
              mapModuleId={mapModuleId}
              setMapModuleId={setMapModuleId}
              mapCompanionId={mapCompanionId}
              setMapCompanionId={setMapCompanionId}
              moduleProgress={moduleProgress}
              companionMemories={companionMemories}
              fetchProgress={fetchProgress}
              fetchMemories={fetchMemories}
              onSetScreen={setScreen}
            />
          )}
          {screen === "advanced" && (
            <AdvancedView
              modules={modules}
              advancedModules={advancedModules}
              loading={loading}
              onInstallModule={installModule}
              onStartCampaign={(moduleId, companionId) => {
                setSelectedModuleId(moduleId);
                setSelectedCompanionId(companionId);
                setShowNewCampaign(true);
                setScreen("ittunaha");
              }}
              onSetScreen={setScreen}
            />
          )}
          {screen === "shukha-anumpa" && (
            <ShukhaAnumpaView
              drafts={shukhaAnumpaDrafts}
              fetchDrafts={fetchShukhaAnumpaDrafts}
              saveDraft={saveShukhaAnumpaDraft}
              deleteDraft={deleteShukhaAnumpaDraft}
              requestFeedback={shukhaAnumpaFeedback}
            />
          )}
        </div>
      )}
    </div>
  );
}
