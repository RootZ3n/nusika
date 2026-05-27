"use client";

/**
 * SessionView — the "in-session" screen plus the Practice-mode branch and
 * the floating Comfort drawer. Extracted verbatim from page.tsx during the
 * 2026-05-22 refactor. The original was a single 600+-line render
 * function; here it stays as one component because every branch shares
 * the editor/voice/translate/repeat plumbing.
 *
 * State is owned by the page (so it survives tab switches) and passed in
 * as props. Practice-mode chat send + session-message send live here as
 * local async helpers since their bodies were already self-contained.
 */

import { MarkdownMessage } from "./MarkdownMessage";
import {
  ACCENT,
  ACCENT_DIM,
  API_BASE,
  applyTelex,
  btnGhost,
  btnPrimary,
  btnSecondary,
  companionColor,
  companionInitial,
  formatTime,
  panelStyle,
  pillStyle,
  type AccessibilitySettings,
  type ChatReceipt,
  type LearnerProfile,
  type MagisterModule,
  type MagisterSession,
  type PracticeMessage,
} from "../types";

export interface SessionViewProps {
  // Module catalogue (needed for Practice mode + companion lookup).
  modules: MagisterModule[];

  // Active session (campaign) state.
  activeSession: MagisterSession | null;
  activeSessionId: string | null;
  sessionTimer: number;
  sessionRunning: boolean;
  hintLevel: number;
  setHintLevel: React.Dispatch<React.SetStateAction<number>>;

  speechBubbles: string[];
  setSpeechBubbles: React.Dispatch<React.SetStateAction<string[]>>;
  contentText: string;
  setContentText: React.Dispatch<React.SetStateAction<string>>;
  editorText: string;
  setEditorText: React.Dispatch<React.SetStateAction<string>>;
  sendingMessage: boolean;
  setSendingMessage: React.Dispatch<React.SetStateAction<boolean>>;
  chatError: string | null;
  setChatError: React.Dispatch<React.SetStateAction<string | null>>;
  lastReceipt: ChatReceipt | null;
  setLastReceipt: React.Dispatch<React.SetStateAction<ChatReceipt | null>>;
  translatedText: string | null;
  setTranslatedText: React.Dispatch<React.SetStateAction<string | null>>;
  translating: boolean;
  setTranslating: React.Dispatch<React.SetStateAction<boolean>>;
  repeating: boolean;
  setRepeating: React.Dispatch<React.SetStateAction<boolean>>;

  // Practice mode (alternative branch).
  practiceModuleId: string | null;
  setPracticeModuleId: React.Dispatch<React.SetStateAction<string | null>>;
  practiceInput: string;
  setPracticeInput: React.Dispatch<React.SetStateAction<string>>;
  practiceHistory: PracticeMessage[];
  setPracticeHistory: React.Dispatch<React.SetStateAction<PracticeMessage[]>>;
  practiceSending: boolean;
  setPracticeSending: React.Dispatch<React.SetStateAction<boolean>>;
  practiceSessionId: string | null;
  setPracticeSessionId: React.Dispatch<React.SetStateAction<string | null>>;

  // Voice + Telex + accessibility.
  voiceMode: "push" | "toggle";
  setVoiceMode: React.Dispatch<React.SetStateAction<"push" | "toggle">>;
  voiceActive: boolean;
  voiceLoading: boolean;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  playTTS: (text: string, companionId?: string | null) => Promise<void>;
  telexEnabled: boolean;
  setTelexEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  useDyslexicFont: boolean;
  setUseDyslexicFont: React.Dispatch<React.SetStateAction<boolean>>;
  wideLetterSpacing: boolean;
  setWideLetterSpacing: React.Dispatch<React.SetStateAction<boolean>>;
  ambientVolume: number;
  setAmbientVolume: React.Dispatch<React.SetStateAction<number>>;
  audioRef: React.MutableRefObject<HTMLAudioElement | null>;
  sessionSettings: AccessibilitySettings | null;
  setSessionSettings: React.Dispatch<React.SetStateAction<AccessibilitySettings | null>>;
  comfortMode: boolean;
  setComfortMode: React.Dispatch<React.SetStateAction<boolean>>;
  comfortOpen: boolean;
  setComfortOpen: React.Dispatch<React.SetStateAction<boolean>>;
  pacingFeedback: "too_fast" | "just_right" | "too_slow" | null;
  setPacingFeedback: React.Dispatch<React.SetStateAction<"too_fast" | "just_right" | "too_slow" | null>>;
  learnerProfile: LearnerProfile;
  setLearnerProfile: React.Dispatch<React.SetStateAction<LearnerProfile>>;

  // Actions (orchestrated by the page).
  onPauseSession: () => Promise<void>;
  onResumeSession: () => void;
  onEndSession: () => Promise<void>;
  onOpenMap: (moduleId: string, companionId?: string) => void;
}

export function SessionView(props: SessionViewProps) {
  // ── Practice-mode send ───────────────────────────────────────────────────
  // Pulled out unchanged. Wires through /magister/sessions for personality +
  // memory, so practice still benefits from the companion's full context.
  async function sendPractice() {
    const {
      practiceInput, practiceSending, practiceModuleId, practiceHistory,
      practiceSessionId, modules,
      setPracticeInput, setPracticeHistory, setPracticeSending, setPracticeSessionId,
    } = props;
    if (!practiceInput.trim() || practiceSending || !practiceModuleId) return;
    const msg = practiceInput.trim();
    setPracticeInput("");
    setPracticeHistory((prev) => [...prev, { role: "user", content: msg }]);
    setPracticeSending(true);
    try {
      const mod = modules.find((m) => m.id === practiceModuleId);
      const companion = (mod?.companions ?? [])[0];
      const companionId = companion?.id;
      let res: Response | null = null;

      if (companionId) {
        let sessionId = practiceSessionId;
        if (!sessionId) {
          try {
            const sessRes = await fetch(`${API_BASE}/magister/sessions`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ module_id: practiceModuleId, companion_id: companionId, teaching_mode: "narrative" }),
            });
            if (sessRes.ok) {
              const sessData = (await sessRes.json()) as { session?: { id?: string } };
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
        setPracticeHistory((prev) => [...prev, {
          role: "assistant",
          content: "Practice is temporarily unavailable because Magister could not start a protected session. No unsafe fallback was used.",
        }]);
      } else if (res.ok) {
        const data = (await res.json()) as {
          text?: string; model?: string; tokensIn?: number; tokensOut?: number;
          costUsd?: number; durationMs?: number;
        };
        if (data.text) {
          setPracticeHistory((prev) => [...prev, {
            role: "assistant",
            content: data.text!,
            model: data.model,
            tokensIn: data.tokensIn,
            tokensOut: data.tokensOut,
            costUsd: data.costUsd,
            durationMs: data.durationMs,
          }]);
        }
      }
    } catch { /* silent */ }
    setPracticeSending(false);
  }

  // ── Companion-chat send (main session mode) ──────────────────────────────
  async function sendUserMessage() {
    const {
      editorText, activeSessionId, sendingMessage,
      setSendingMessage, setChatError, setContentText, setSpeechBubbles,
      setLastReceipt, setEditorText,
    } = props;
    if (!editorText.trim() || !activeSessionId || sendingMessage) return;
    setSendingMessage(true);
    setChatError(null);
    try {
      const res = await fetch(`${API_BASE}/magister/sessions/${activeSessionId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: editorText.trim(), history: [] }),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          reply?: string; text?: string; model?: string; provider?: string;
          tokensIn?: number; tokensOut?: number; costUsd?: number; durationMs?: number;
        };
        const reply = data.reply ?? data.text ?? "";
        if (reply) {
          setContentText(reply);
          setSpeechBubbles((prev) => [...prev.slice(-4), reply.length > 200 ? reply.slice(0, 200) + "..." : reply]);
        }
        setLastReceipt({ model: data.model, tokensIn: data.tokensIn, tokensOut: data.tokensOut, costUsd: data.costUsd, durationMs: data.durationMs });
        setEditorText("");
      } else {
        const data = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
        if (res.status === 502) {
          setChatError(data.error ?? "Chat unavailable because no LLM backend is configured.");
        } else {
          setChatError(data.error ?? `Chat failed (HTTP ${res.status}).`);
        }
      }
    } catch (err) {
      setChatError(`Chat request failed. Check whether the Magister API is running. ${err instanceof Error ? err.message : ""}`.trim());
    }
    props.setSendingMessage(false);
  }

  function requestHint() {
    const { setHintLevel, setSpeechBubbles } = props;
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
  }

  // ── Practice-mode branch ────────────────────────────────────────────────
  if (props.practiceModuleId) {
    const mod = props.modules.find((m) => m.id === props.practiceModuleId);
    const companion = (mod?.companions ?? [])[0];
    const cName = companion?.name ?? "Companion";
    const cColor = companion?.accent_color ?? ACCENT;

    return (
      <div style={{ display: "flex", height: "calc(100vh - 110px)", minHeight: 0, overflow: "hidden" }}>
        {/* Left: Practice history */}
        <div style={{ width: 220, flexShrink: 0, borderRight: "1px solid var(--border)", overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 700, color: cColor, letterSpacing: "0.08em", textTransform: "uppercase" }}>Practice Mode</div>
          <div style={{ fontFamily: "var(--font-body)", fontSize: 14, color: "var(--text-muted)" }}>{mod?.name ?? props.practiceModuleId}</div>
          <button onClick={() => {
            // TODO(magister-standalone): Practice transcripts used to be saved to
            // squidley's Archivum (POST /archivum/paste) on session end. The
            // standalone has /magister/creative for module-scoped works but no
            // generalized Archivum yet. For now the transcript is dropped on exit
            // — wire to /magister/creative/<moduleId> once we agree on schema.
            props.setPracticeModuleId(null);
            props.setPracticeHistory([]);
            props.setPracticeSessionId(null);
          }} style={{ ...btnGhost, fontSize: 14 }}>Finish Practice</button>
        </div>

        {/* Center: Chat */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ flex: 1, overflowY: "auto", padding: "14px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
            {props.practiceHistory.length === 0 && (
              <div style={{ fontFamily: "var(--font-body)", fontSize: 16, color: "var(--text-muted)", fontStyle: "italic", lineHeight: 1.8, padding: "20px 0" }}>
                Practice with {cName}. Just talk and learn together.
              </div>
            )}
            {props.practiceHistory.map((msg, i) => (
              <div key={i} style={{ display: "flex", gap: 8, alignItems: msg.role === "user" ? "flex-end" : "flex-start", flexDirection: msg.role === "user" ? "row-reverse" : "row" }}>
                {msg.role === "assistant" && <div style={{ width: 28, height: 28, borderRadius: "50%", background: cColor, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 700, color: "#060810", flexShrink: 0 }}>{cName[0]}</div>}
                <div style={{
                  maxWidth: "75%", padding: "10px 14px", borderRadius: 14,
                  background: msg.role === "user" ? `${ACCENT}15` : `${cColor}10`,
                  border: `1px solid ${msg.role === "user" ? ACCENT + "30" : cColor + "20"}`,
                  fontFamily: props.useDyslexicFont ? "'OpenDyslexic', var(--font-body)" : "var(--font-body)",
                  fontSize: 15, color: "var(--text-primary)", lineHeight: 1.8,
                  letterSpacing: props.wideLetterSpacing ? "0.08em" : undefined,
                }}>
                  {msg.role === "assistant" ? <MarkdownMessage content={msg.content} /> : <span style={{ whiteSpace: "pre-wrap" }}>{msg.content}</span>}
                  {msg.role === "assistant" && (
                    <div style={{ display: "flex", gap: 6, marginTop: 6, paddingTop: 4, borderTop: `1px solid ${cColor}15` }}>
                      <button onClick={() => void props.playTTS(msg.content, companion?.id)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "var(--text-muted)", padding: "2px 4px" }} title="Repeat">🔊</button>
                      <button onClick={async (e) => {
                        const btn = e.currentTarget;
                        const existing = btn.parentElement?.querySelector(".practice-translation");
                        if (existing) { existing.remove(); return; }
                        try {
                          const res = await fetch(`${API_BASE}/magister/translate`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ text: msg.content.slice(0, 1000), module_id: props.practiceModuleId }),
                          });
                          if (res.ok) {
                            const data = (await res.json()) as { text?: string };
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
            {props.practiceSending && <div style={{ fontFamily: "var(--font-body)", fontSize: 15, color: cColor, fontStyle: "italic" }}>{cName} is thinking...</div>}
          </div>
          <div style={{ flexShrink: 0, padding: "10px 14px", borderTop: "1px solid var(--border)" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <textarea
                value={props.practiceInput}
                onChange={(e) => props.setPracticeInput(props.telexEnabled ? applyTelex(e.target.value) : e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendPractice(); } }}
                placeholder={`Practice with ${cName}...`}
                rows={2}
                style={{
                  flex: 1, background: "rgba(11,14,28,0.8)", border: `1px solid ${cColor}30`,
                  borderRadius: 10, padding: "8px 14px", color: "var(--text-primary)",
                  fontFamily: props.useDyslexicFont ? "'OpenDyslexic', var(--font-body)" : "var(--font-body)",
                  fontSize: 16, outline: "none", resize: "none", lineHeight: 1.6,
                }}
              />
              <button
                onClick={() => void sendPractice()}
                disabled={!props.practiceInput.trim() || props.practiceSending}
                style={{
                  ...btnPrimary, width: 40, height: 40, borderRadius: 10, padding: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  opacity: props.practiceInput.trim() ? 1 : 0.4,
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
              const userMsgs = props.practiceHistory.filter((h) => h.role === "user");
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

  // ── Main session branch ─────────────────────────────────────────────────
  const companion = props.activeSession
    ? { name: props.activeSession.companion_name, color: companionColor(props.activeSession.companion_name) }
    : { name: "Companion", color: ACCENT };

  const durationSeconds = (props.activeSession?.duration_target ?? 10) * 60;
  const progressPct = Math.min(100, (props.sessionTimer / durationSeconds) * 100);

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
            {props.activeSession?.teaching_mode ?? "narrative"}
          </span>
          {props.activeSession && (
            <span style={{ fontFamily: "var(--font-body)", fontSize: "13px", color: "var(--text-muted)" }}>
              {props.activeSession.module_name}
            </span>
          )}
        </div>
        <button
          style={{ ...btnGhost, fontSize: "12px", padding: "6px 12px" }}
          onClick={() => {
            if (props.activeSession) props.onOpenMap(props.activeSession.module_id, props.activeSession.companion_id);
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
            {props.voiceActive
              ? `${companion.name} is listening...`
              : props.sendingMessage
                ? `${companion.name} is shaping the next step...`
                : `${companion.name} is guiding this lesson.`}
          </div>

          {/* Speech bubbles */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
            {(props.speechBubbles ?? []).map((bubble, i) => (
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
        </div>

        {/* Content Area */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
            <div style={{
              ...panelStyle,
              minHeight: 200,
              fontFamily: props.useDyslexicFont ? "'OpenDyslexic', var(--font-body)" : "var(--font-body)",
              fontSize: "16px",
              color: "var(--text-primary)",
              lineHeight: 2.0,
              letterSpacing: props.wideLetterSpacing ? "0.08em" : undefined,
            }}>
              <MarkdownMessage content={props.contentText} />

              {props.chatError && (
                <div role="alert" style={{
                  marginTop: 12, padding: "8px 12px", borderRadius: 8,
                  background: "rgba(248,113,113,0.08)",
                  border: "1px solid rgba(248,113,113,0.3)",
                  color: "#fca5a5", fontSize: 13, lineHeight: 1.6,
                  display: "flex", alignItems: "flex-start", gap: 8,
                }}>
                  <span style={{ flex: 1 }}>{props.chatError}</span>
                  <button
                    onClick={() => props.setChatError(null)}
                    style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", fontSize: 13, padding: 0 }}
                    aria-label="Dismiss error"
                  >✕</button>
                </div>
              )}

              {/* Translate + Repeat buttons */}
              {props.contentText && props.contentText !== "Begin your session to start learning..." && props.contentText !== "Your companion is preparing..." && (
                <div style={{ display: "flex", gap: 8, marginTop: 14, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
                  <button
                    onClick={async () => {
                      if (props.repeating) return;
                      props.setRepeating(true);
                      await props.playTTS(props.contentText, props.activeSession?.companion_id);
                      props.setRepeating(false);
                    }}
                    style={{ ...btnGhost, display: "flex", alignItems: "center", gap: 4 }}
                  >
                    {props.repeating ? "..." : "🔊"} Repeat
                  </button>

                  <button
                    onClick={async () => {
                      if (props.translating) return;
                      props.setTranslating(true);
                      props.setTranslatedText(null);
                      try {
                        const res = await fetch(`${API_BASE}/magister/translate`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ text: props.contentText.slice(0, 1000), module_id: props.activeSession?.module_id }),
                        });
                        if (res.ok) {
                          const data = (await res.json()) as { text?: string };
                          props.setTranslatedText(data.text ?? null);
                        }
                      } catch { /* translate failed */ }
                      props.setTranslating(false);
                    }}
                    style={{ ...btnGhost, display: "flex", alignItems: "center", gap: 4 }}
                  >
                    {props.translating ? "..." : "🌐"} Translate
                  </button>
                </div>
              )}

              {props.translatedText && (
                <div style={{
                  marginTop: 10, padding: "10px 14px", borderRadius: 8,
                  background: "rgba(96,165,250,0.06)", border: "1px solid rgba(96,165,250,0.15)",
                  fontFamily: "var(--font-body)", fontSize: "15px", color: "var(--text-secondary)",
                  lineHeight: 1.8, whiteSpace: "pre-wrap",
                }}>
                  {props.translatedText}
                </div>
              )}

              {props.lastReceipt?.model && (
                <div style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--text-muted)", marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ color: companion.color, fontWeight: 600 }}>{props.lastReceipt.model.split("/").pop()}</span>
                  {props.lastReceipt.tokensIn != null && <><span style={{ opacity: 0.5 }}>·</span><span>{props.lastReceipt.tokensIn}↑ {props.lastReceipt.tokensOut}↓</span></>}
                  {props.lastReceipt.costUsd != null && <><span style={{ opacity: 0.5 }}>·</span><span style={{ color: "#4ade80" }}>${props.lastReceipt.costUsd.toFixed(6)}</span></>}
                  {props.lastReceipt.durationMs != null && <><span style={{ opacity: 0.5 }}>·</span><span>{props.lastReceipt.durationMs}ms</span></>}
                </div>
              )}
            </div>

            {/* Editor area */}
            <div style={{ marginTop: 16 }}>
              <textarea
                value={props.editorText}
                onChange={(e) => {
                  const val = props.telexEnabled ? applyTelex(e.target.value) : e.target.value;
                  props.setEditorText(val);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void sendUserMessage();
                  }
                }}
                placeholder={props.sendingMessage ? "Your companion is thinking..." : "Speak your answer or type it here. Press Enter to send."}
                disabled={props.sendingMessage}
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
              <button
                style={{ ...btnPrimary, opacity: (!props.editorText.trim() || props.sendingMessage) ? 0.4 : 1 }}
                disabled={!props.editorText.trim() || props.sendingMessage}
                onClick={() => void sendUserMessage()}
              >
                {props.sendingMessage ? "..." : "Send"}
              </button>

              <button
                onMouseDown={props.voiceMode === "push" ? () => void props.startRecording() : undefined}
                onMouseUp={props.voiceMode === "push" ? props.stopRecording : undefined}
                onMouseLeave={props.voiceMode === "push" && props.voiceActive ? props.stopRecording : undefined}
                onTouchStart={props.voiceMode === "push" ? (e) => { e.preventDefault(); void props.startRecording(); } : undefined}
                onTouchEnd={props.voiceMode === "push" ? (e) => { e.preventDefault(); props.stopRecording(); } : undefined}
                onClick={props.voiceMode === "toggle" ? () => {
                  if (props.voiceActive) props.stopRecording();
                  else void props.startRecording();
                } : undefined}
                style={{
                  ...btnGhost,
                  background: props.voiceActive ? `${ACCENT}20` : props.voiceLoading ? "rgba(167,139,250,0.12)" : undefined,
                  borderColor: props.voiceActive ? ACCENT : props.voiceLoading ? "#a78bfa" : undefined,
                  color: props.voiceActive ? ACCENT : props.voiceLoading ? "#a78bfa" : undefined,
                  animation: props.voiceActive ? "breathe 1s ease-in-out infinite" : undefined,
                }}
                title={props.voiceMode === "push" ? "Hold to talk" : props.voiceActive ? "Click to stop" : "Click to record"}
              >
                {props.voiceLoading ? "..." : props.voiceActive ? "Listening..." : "Speak your answer"}
              </button>
              <button
                style={{ ...btnGhost, fontSize: "10px", padding: "4px 6px", minHeight: 0 }}
                onClick={() => props.setVoiceMode((v) => v === "push" ? "toggle" : "push")}
                title={props.voiceMode === "push" ? "Push-to-talk mode" : "Toggle mode"}
              >
                {props.voiceMode === "push" ? "PTT" : "ON"}
              </button>

              {(props.activeSession?.module_id === "vietnamese" || props.activeSession?.module_id === "mandarin") && (
                <button
                  style={props.telexEnabled
                    ? { ...btnPrimary, fontSize: "11px", padding: "4px 8px", minHeight: 0 }
                    : { ...btnGhost, fontSize: "11px", padding: "4px 8px", minHeight: 0 }}
                  onClick={() => props.setTelexEnabled((v) => !v)}
                  title="Telex Vietnamese input"
                >
                  VI
                </button>
              )}

              <span style={{
                fontFamily: "var(--font-mono)", fontSize: "13px",
                color: progressPct >= 100 ? "#4ade80" : "var(--text-muted)",
              }}>
                {formatTime(props.sessionTimer)} / {formatTime(durationSeconds)}
              </span>
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
                    props.setPacingFeedback(key);
                    props.setLearnerProfile((prev) => ({
                      ...prev,
                      complexity_ceiling: key === "too_fast" ? Math.max(1, prev.complexity_ceiling - 1) : key === "too_slow" ? Math.min(10, prev.complexity_ceiling + 1) : prev.complexity_ceiling,
                      repetition_comfort: key === "too_fast" ? Math.min(10, prev.repetition_comfort + 1) : key === "too_slow" ? Math.max(1, prev.repetition_comfort - 1) : prev.repetition_comfort,
                    }));
                    setTimeout(() => props.setPacingFeedback(null), 2000);
                  }} style={{
                    padding: "4px 8px", border: "none", cursor: "pointer", fontSize: 16,
                    background: props.pacingFeedback === key ? `${ACCENT}20` : "transparent",
                  }}>{emoji}</button>
                ))}
              </div>
              <button
                style={{ ...btnGhost, position: "relative" }}
                onClick={requestHint}
              >
                Hint {props.hintLevel > 0 && <span style={{
                  position: "absolute", top: -4, right: -4,
                  width: 16, height: 16, borderRadius: "50%",
                  background: ACCENT, color: "#060810",
                  fontSize: 14, fontWeight: 700,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>{props.hintLevel}</span>}
              </button>
              {props.sessionRunning ? (
                <button style={btnSecondary} onClick={() => void props.onPauseSession()}>
                  Pause
                </button>
              ) : (
                <button style={btnPrimary} onClick={props.onResumeSession}>
                  Resume
                </button>
              )}
              <button style={btnGhost} onClick={() => void props.onEndSession()}>
                End Session
              </button>
            </div>
          </div>
          <div style={{ position: "fixed", right: 20, bottom: 24, zIndex: 40 }}>
            {props.comfortOpen && (
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
                  <button style={btnGhost} onClick={() => props.setComfortOpen(false)}>Close</button>
                </div>
                <div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>Speed</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button style={pillStyle(props.pacingFeedback === "too_fast")} onClick={() => props.setPacingFeedback("too_fast")}>Slow</button>
                    <button style={pillStyle(props.pacingFeedback === "too_slow")} onClick={() => props.setPacingFeedback("too_slow")}>Fast</button>
                  </div>
                </div>
                <div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>Readability</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button onClick={() => props.setUseDyslexicFont((v) => !v)} style={pillStyle(props.useDyslexicFont)}>Dyslexia font</button>
                    <button onClick={() => props.setWideLetterSpacing((v) => !v)} style={pillStyle(props.wideLetterSpacing)}>Word spacing</button>
                  </div>
                </div>
                <div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>Audio</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                    <button
                      onClick={() => props.setSessionSettings((prev) => prev ? { ...prev, narration_enabled: !prev.narration_enabled } : prev)}
                      style={pillStyle(props.sessionSettings?.narration_enabled !== false)}
                    >
                      {props.sessionSettings?.narration_enabled === false ? "Narration off" : "Narration on"}
                    </button>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="0.5"
                    step="0.01"
                    value={props.ambientVolume}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      props.setAmbientVolume(v);
                      if (props.audioRef.current) props.audioRef.current.volume = v;
                    }}
                    style={{ width: "100%", accentColor: companion.color, height: 12, cursor: "pointer" }}
                    title="Narration volume"
                  />
                </div>
                <div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>Support</div>
                  <button onClick={() => props.setComfortMode((v) => !v)} style={pillStyle(props.comfortMode)}>Comfort mode</button>
                </div>
              </div>
            )}
            <button
              onClick={() => props.setComfortOpen((v) => !v)}
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
