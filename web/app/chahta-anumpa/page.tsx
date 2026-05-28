"use client";

/**
 * Chahta Anumpa — Choctaw language practice with verified source attribution.
 *
 * Phase 1 scaffold: displays seed vocabulary with verification badges,
 * source attribution, and a "Practice with Peh" placeholder. Every entry
 * must show its verification status and source. Unverified content gets
 * a warning banner.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

const API_BASE = "/api/proxy";
const ACCENT = "#f59e0b";

type VerificationStatus = "verified" | "user_provided" | "draft" | "unverified";

interface SourceAttribution {
  name: string;
  url: string | null;
  type: string;
}

interface WordEntry {
  id: string;
  choctaw: string;
  english: string;
  partOfSpeech: string | null;
  source: SourceAttribution;
  verificationStatus: VerificationStatus;
  notes: string | null;
  culturalNote: string | null;
}

interface PhraseEntry {
  id: string;
  choctaw: string;
  english: string;
  source: SourceAttribution;
  verificationStatus: VerificationStatus;
  notes: string | null;
}

interface LessonEntry {
  id: string;
  title: string;
  description: string;
  words: WordEntry[];
  phrases: PhraseEntry[];
  pehIntro: string;
}

// ── Verification badge ────────────────────────────────────────────────────────

function verificationColor(status: VerificationStatus): string {
  switch (status) {
    case "verified": return "#4ade80";
    case "user_provided": return "#60a5fa";
    case "draft": return "#fbbf24";
    case "unverified": return "#f87171";
  }
}

function verificationLabel(status: VerificationStatus): string {
  switch (status) {
    case "verified": return "Verified";
    case "user_provided": return "User Provided";
    case "draft": return "Draft";
    case "unverified": return "Unverified";
  }
}

function VerificationBadge({ status }: { status: VerificationStatus }) {
  const color = verificationColor(status);
  return (
    <span style={{
      fontSize: 11, fontFamily: "var(--font-mono)", fontWeight: 600,
      color, background: `${color}15`, border: `1px solid ${color}30`,
      borderRadius: 6, padding: "2px 8px",
    }}>
      {verificationLabel(status)}
    </span>
  );
}

function SourceTag({ source }: { source: SourceAttribution }) {
  return (
    <span style={{
      fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-muted)",
    }}>
      Source: {source.name}{source.url ? ` (${source.type})` : ` — ${source.type}`}
    </span>
  );
}

// ── Word/phrase card ──────────────────────────────────────────────────────────

function WordCard({ word }: { word: WordEntry }) {
  return (
    <div style={{
      background: "rgba(22,18,52,0.78)", border: "1px solid rgba(245,158,11,0.15)",
      borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 6,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 700, color: ACCENT }}>
          {word.choctaw}
        </span>
        <VerificationBadge status={word.verificationStatus} />
      </div>
      <div style={{ fontFamily: "var(--font-body)", fontSize: 14, color: "var(--text-primary)" }}>
        {word.english}
        {word.partOfSpeech && (
          <span style={{ color: "var(--text-muted)", marginLeft: 8, fontSize: 12, fontStyle: "italic" }}>
            ({word.partOfSpeech})
          </span>
        )}
      </div>
      {word.notes && (
        <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>{word.notes}</div>
      )}
      {word.culturalNote && (
        <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5, fontStyle: "italic" }}>
          Cultural note: {word.culturalNote}
        </div>
      )}
      <SourceTag source={word.source} />
    </div>
  );
}

function PhraseCard({ phrase }: { phrase: PhraseEntry }) {
  return (
    <div style={{
      background: "rgba(22,18,52,0.78)", border: "1px solid rgba(245,158,11,0.15)",
      borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 6,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 700, color: ACCENT }}>
          {phrase.choctaw}
        </span>
        <VerificationBadge status={phrase.verificationStatus} />
      </div>
      <div style={{ fontFamily: "var(--font-body)", fontSize: 14, color: "var(--text-primary)" }}>
        {phrase.english}
      </div>
      {phrase.notes && (
        <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>{phrase.notes}</div>
      )}
      <SourceTag source={phrase.source} />
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ChahtaAnumpaPage() {
  const [lessons, setLessons] = useState<LessonEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLessons = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/nusika/chahta-anumpa/lessons`);
      if (!res.ok) {
        setError(`Failed to load lessons (HTTP ${res.status})`);
        return;
      }
      const data = (await res.json()) as { ok?: boolean; lessons?: LessonEntry[] };
      setLessons(data.lessons ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchLessons();
  }, [fetchLessons]);

  const hasUnverified = lessons.some(
    (l) =>
      l.words.some((w) => w.verificationStatus !== "verified") ||
      l.phrases.some((p) => p.verificationStatus !== "verified"),
  );

  return (
    <div style={{
      padding: "20px 16px", maxWidth: 800, margin: "0 auto",
      display: "flex", flexDirection: "column", gap: 20,
      fontFamily: "var(--font-body)", fontSize: 14,
    }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>
            Chahta Anumpa
          </h1>
          <p style={{ color: "var(--text-muted)", margin: "4px 0 0", fontSize: 13 }}>
            Choctaw language practice with verified source attribution
          </p>
        </div>
        <Link href="/" style={{ fontSize: 12, color: ACCENT, textDecoration: "none" }}>
          Back to Ittunaha
        </Link>
      </div>

      {/* Unverified content warning */}
      {hasUnverified && (
        <div style={{
          padding: "10px 14px", borderRadius: 10,
          background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.25)",
          fontSize: 13, color: "#fca5a5", lineHeight: 1.5,
        }}>
          Some content below has not been fully verified against official Choctaw Nation language resources.
          Items marked as unverified, draft, or user-provided should not be treated as confirmed.
        </div>
      )}

      {loading && (
        <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
          Loading Chahta Anumpa...
        </div>
      )}

      {error && (
        <div style={{
          padding: "10px 14px", borderRadius: 10,
          background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.25)",
          fontSize: 13, color: "#f87171",
        }}>
          {error}
        </div>
      )}

      {/* Lessons */}
      {!loading && lessons.map((lesson) => (
        <section key={lesson.id} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 700, color: ACCENT, margin: 0 }}>
            {lesson.title}
          </h2>
          <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0 }}>{lesson.description}</p>

          {/* Peh intro */}
          <div style={{
            display: "flex", alignItems: "flex-start", gap: 10,
            padding: "12px 16px", borderRadius: 12,
            background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.15)",
          }}>
            <div style={{
              width: 32, height: 32, borderRadius: "50%", background: ACCENT, flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 700, color: "#060810",
            }}>
              P
            </div>
            <div style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.7 }}>
              {lesson.pehIntro}
            </div>
          </div>

          {/* Words */}
          {lesson.words.length > 0 && (
            <div>
              <h3 style={{ fontFamily: "var(--font-display)", fontSize: 15, fontWeight: 600, color: "var(--text-primary)", margin: "0 0 8px" }}>
                Words
              </h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
                {lesson.words.map((w) => <WordCard key={w.id} word={w} />)}
              </div>
            </div>
          )}

          {/* Phrases */}
          {lesson.phrases.length > 0 && (
            <div>
              <h3 style={{ fontFamily: "var(--font-display)", fontSize: 15, fontWeight: 600, color: "var(--text-primary)", margin: "0 0 8px" }}>
                Phrases
              </h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
                {lesson.phrases.map((p) => <PhraseCard key={p.id} phrase={p} />)}
              </div>
            </div>
          )}

          {/* Practice placeholder */}
          <button
            disabled
            style={{
              alignSelf: "flex-start",
              padding: "10px 22px", borderRadius: 999,
              background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)",
              color: ACCENT, fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 600,
              cursor: "not-allowed", opacity: 0.7,
            }}
          >
            Practice with Peh (coming soon)
          </button>
        </section>
      ))}

      {/* Source discipline notice */}
      {!loading && (
        <div style={{
          padding: "12px 16px", borderRadius: 10,
          background: "rgba(245,158,11,0.04)", border: "1px solid rgba(245,158,11,0.12)",
          fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6,
        }}>
          Chahta Anumpa is a learning companion, not an authority. Verified Choctaw Nation language
          resources remain the source of truth. Peh does not invent translations. If source data is
          missing, Peh will say he cannot verify it. For deeper study, seek official Choctaw Nation
          language classes and resources.
        </div>
      )}
    </div>
  );
}
