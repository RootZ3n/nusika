/**
 * Chahta Anumpa — Choctaw language practice with verified source attribution.
 *
 * Phase 1: serves seed data from the on-disk JSON file. No DB table yet —
 * the data model is intentionally simple and read-only for this scaffold.
 * Every word/phrase carries source attribution and verification status.
 *
 * Core rule: never return content without a verificationStatus field.
 * If content cannot be verified, it must be flagged as such.
 */

import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";

// ── Types ─────────────────────────────────────────────────────────────────────

export type VerificationStatus = "verified" | "user_provided" | "draft" | "unverified";
export type SourceType = "dictionary" | "course" | "tribe_resource" | "user_note" | "unknown";

export interface SourceAttribution {
  name: string;
  url: string | null;
  type: SourceType;
}

export interface WordEntry {
  id: string;
  choctaw: string;
  english: string;
  partOfSpeech: string | null;
  pronunciationAudioUrl?: string | null;
  source: SourceAttribution;
  verificationStatus: VerificationStatus;
  notes: string | null;
  culturalNote: string | null;
}

export interface PhraseEntry {
  id: string;
  choctaw: string;
  english: string;
  source: SourceAttribution;
  verificationStatus: VerificationStatus;
  notes: string | null;
}

export interface LessonEntry {
  id: string;
  title: string;
  description: string;
  wordIds: string[];
  phraseIds: string[];
  pehIntro: string;
}

interface SeedData {
  words: WordEntry[];
  phrases: PhraseEntry[];
  lessons: LessonEntry[];
}

// ── Seed data loader ──────────────────────────────────────────────────────────

let seedCache: SeedData | null = null;

async function loadSeedData(): Promise<SeedData> {
  if (seedCache) return seedCache;
  const seedPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../curriculum/chahta-anumpa/seed-data.json",
  );
  const raw = await readFile(seedPath, "utf-8");
  seedCache = JSON.parse(raw) as SeedData;
  return seedCache;
}

/** Validate that every entry has a verificationStatus. */
function validateEntries(data: SeedData): void {
  for (const w of data.words) {
    if (!w.verificationStatus) throw new Error(`Word ${w.id} missing verificationStatus`);
    if (!w.source) throw new Error(`Word ${w.id} missing source`);
  }
  for (const p of data.phrases) {
    if (!p.verificationStatus) throw new Error(`Phrase ${p.id} missing verificationStatus`);
    if (!p.source) throw new Error(`Phrase ${p.id} missing source`);
  }
}

// ── Route registration ────────────────────────────────────────────────────────

export async function registerChahtaAnumpaRoutes(app: FastifyInstance): Promise<void> {
  // GET /nusika/chahta-anumpa/lessons — list all lessons with expanded word/phrase data
  app.get("/nusika/chahta-anumpa/lessons", async (_req, reply) => {
    const data = await loadSeedData();
    validateEntries(data);
    const lessons = data.lessons.map((lesson) => ({
      ...lesson,
      words: lesson.wordIds.map((wid) => data.words.find((w) => w.id === wid)).filter(Boolean),
      phrases: lesson.phraseIds.map((pid) => data.phrases.find((p) => p.id === pid)).filter(Boolean),
    }));
    return reply.send({ ok: true, lessons });
  });

  // GET /nusika/chahta-anumpa/words — all words with source + verification
  app.get("/nusika/chahta-anumpa/words", async (_req, reply) => {
    const data = await loadSeedData();
    validateEntries(data);
    return reply.send({ ok: true, words: data.words });
  });

  // GET /nusika/chahta-anumpa/phrases — all phrases with source + verification
  app.get("/nusika/chahta-anumpa/phrases", async (_req, reply) => {
    const data = await loadSeedData();
    validateEntries(data);
    return reply.send({ ok: true, phrases: data.phrases });
  });
}
