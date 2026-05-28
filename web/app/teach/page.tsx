"use client";

/**
 * Teach Me Anything (Peh) — orchestration shell.
 *
 * Lives outside the main Ittunaha/Session monolith. The original 764-line
 * file lives across:
 *   - teach/types.ts                       types + constants + styles
 *   - teach/hooks/useTeachApi.ts           lessons + chat + recap
 *   - teach/hooks/useTeachVoice.ts         voice picker + autoplay TTS
 *   - teach/components/LessonSidebar.tsx   left rail
 *   - teach/components/LessonHeader.tsx    title + depth pills + voice
 *   - teach/components/LessonChat.tsx      turn list + thinking + error
 *   - teach/components/LessonComposer.tsx  textarea + send + cache footer
 *
 * Lookups: when the model says "I'd want to look this up", we do nothing
 * automatic — the lookup hook is intentionally a placeholder server-side.
 */

import { LessonSidebar } from "./components/LessonSidebar";
import { LessonHeader } from "./components/LessonHeader";
import { LessonChat } from "./components/LessonChat";
import { LessonComposer } from "./components/LessonComposer";
import { useTeachApi } from "./hooks/useTeachApi";
import { useTeachVoice } from "./hooks/useTeachVoice";
import { main, shell } from "./types";

export default function TeachPage() {
  const api = useTeachApi();
  const voice = useTeachVoice();

  async function send(message: string) {
    const result = await api.send(message, voice.stopReplyAudio);
    // Slice 6H — fire-and-forget: text is already on screen. We never block
    // the chat send on TTS, never retry, and never elevate a TTS error to
    // a chat error.
    if (result.ok && voice.autoplayVoice && result.turns && result.turns.length > 0) {
      const last = result.turns[result.turns.length - 1];
      if (last && last.role === "assistant" && last.content) {
        void voice.playReplyTTS(last.content);
      }
    }
  }

  function playLatest() {
    for (let i = api.turns.length - 1; i >= 0; i -= 1) {
      const t = api.turns[i];
      if (t && t.role === "assistant" && t.content) {
        void voice.playReplyTTS(t.content);
        return;
      }
    }
    voice.setVoiceMsg("No assistant reply yet.");
  }

  return (
    <div style={shell}>
      <LessonSidebar
        lessons={api.lessons}
        activeId={api.activeId}
        setActiveId={api.setActiveId}
        onCreateLesson={api.createLesson}
        onDeleteLesson={api.deleteLesson}
      />

      <main style={main}>
        {!api.active && (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted, #888)", padding: 32, textAlign: "center" }}>
            Pick a lesson on the left, or start a new one. Peh will meet you here.
          </div>
        )}

        {api.active && (
          <>
            <LessonHeader
              active={api.active}
              turns={api.turns}
              recapBusy={api.recapBusy}
              onRecap={() => void api.recap()}
              onSetDepth={(d) => void api.setDepth(d)}
              voices={voice.voices}
              selectedVoiceId={voice.selectedVoiceId}
              selectedVoice={voice.selectedVoice}
              previewing={voice.previewing}
              voiceMsg={voice.voiceMsg}
              autoplayVoice={voice.autoplayVoice}
              playingReply={voice.playingReply}
              onSelectVoice={voice.onSelectVoice}
              onPreview={() => void voice.previewVoice()}
              onToggleAutoplay={voice.onToggleAutoplay}
              onPlayLatest={playLatest}
            />
            <LessonChat
              active={api.active}
              turns={api.turns}
              sending={api.sending}
              error={api.error}
            />
            <LessonComposer
              depth={api.active.depth}
              sending={api.sending}
              onSend={(msg) => void send(msg)}
              voiceCache={voice.voiceCache}
              onClearVoiceCache={() => void voice.clearVoiceCache()}
            />
          </>
        )}
      </main>
    </div>
  );
}
