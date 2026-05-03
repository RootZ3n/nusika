/**
 * Magister — Core Learning DB
 * ============================================================
 * Adaptive learning engine with companion-driven teaching,
 * spaced repetition, tiered hints, and creative portfolio.
 *
 * Teaching modes: narrative, direct, socratic
 * Mastery pipeline: introduced -> practiced -> mastered -> reaffirmed
 * Hint levels: L1 (nudge) -> L2 (guided) -> L3 (direct answer)
 *
 * Architecture invariants:
 *   - One session = one SessionAtom (concept_id + objective + mastery_signal)
 *   - Campaign mode and study mode share the SAME progress table —
 *     concept IDs are mode-agnostic so mastery transfers between modes
 *   - Companion memory writeback is schema-enforced to prevent drift
 *   - Mastery spine is optional per module but validated when present
 *   - Adult mode is a tone context flag, not separate session logic
 * ============================================================
 *
 * Originally part of squidley-v2 at modules/experiences/magister/index.ts.
 * Extracted to standalone in May 2026.
 */

import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

const require = createRequire(import.meta.url);

// ── Pipeline Constants ───────────────────────────────────────────────────────

export const TEACHING_MODES = ["narrative", "direct", "socratic"] as const;
export type TeachingMode = (typeof TEACHING_MODES)[number];

export const MASTERY_LEVELS = ["introduced", "practiced", "mastered", "reaffirmed"] as const;
export type MasteryLevel = (typeof MASTERY_LEVELS)[number];

export const HINT_LEVELS = [1, 2, 3] as const;
export type HintLevel = (typeof HINT_LEVELS)[number];

export const SESSION_DURATIONS = { short: 300, standard: 600, long: 1200 } as const;

export const AGE_TRACKS = ["young_writer", "adult", "kids", "all", "any"] as const;
export type AgeTrack = (typeof AGE_TRACKS)[number];

/**
 * Campaign mode and study mode share the same magister_progress table.
 * Concept IDs must be mode-agnostic (e.g. "subnet-basics", NOT "campaign:subnet-basics").
 * This ensures that mastery earned in a campaign transfers to study mode and vice versa.
 * No mode-specific progress tables exist or should be created.
 */
export const SHARED_PROGRESS_MODES = ["campaign", "study"] as const;

// ── Types ─────────────────────────────────────────────────────────────────────

/** One session = one atom. The atom defines the single concept this session teaches. */
export interface SessionAtom {
  concept_id: string;          // must reference a valid concept on the mastery spine
  objective: string;           // what the learner should achieve this session
  mastery_signal: string;      // the observable behavior that confirms mastery
  recap_artifact?: string;     // optional artifact name written on session end
}

export interface MagisterSession {
  id: string;
  user_id: string;
  module_id: string;
  companion_id: string | null;
  status: "active" | "paused" | "complete";
  teaching_mode: TeachingMode;
  duration_target: number;
  elapsed_seconds: number;
  current_concept: string | null;
  current_story_beat: string | null;
  hint_count_l1: number;
  hint_count_l2: number;
  hint_count_l3: number;
  session_summary: string | null;
  atom_concept_id: string;
  atom_objective: string;
  atom_mastery_signal: string;
  atom_recap_artifact: string | null;
  adult_mode: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface MagisterProgress {
  id: string;
  user_id: string;
  module_id: string;
  concept_id: string;
  mastery_level: MasteryLevel;
  mastery_score: number;
  last_practiced: string | null;
  next_reaffirm: string | null;
  practice_count: number;
  hint_usage: string;
  created_at: string;
  updated_at: string;
}

export interface MagisterMemory {
  id: string;
  user_id: string;
  companion_id: string;
  memory_type: "relationship" | "preference" | "achievement" | "struggle" | "creative";
  content: string;
  session_id: string | null;
  archivum_id: string | null;
  created_at: string;
  expires_at: string | null;
}

export interface MagisterCreative {
  id: string;
  user_id: string;
  module_id: string;
  title: string | null;
  content: string | null;
  companion_feedback: string | null;
  archivum_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface MagisterModuleRecord {
  id: string;
  name: string;
  campaign_world: string | null;
  subject: string | null;
  description: string | null;
  age_track: AgeTrack;
  companions: string;
  installed: number;
  config_path: string | null;
  mastery_spine: string | null;
  created_at: string;
}

// ── Mastery Spine ─────────────────────────────────────────────────────────────

export interface MasterySpineConcept {
  id: string;
  name: string;
  challenge_types: string[];
}

export interface MasterySpineSubdomain {
  id: string;
  name: string;
  concepts: MasterySpineConcept[];
}

export interface MasterySpineDomain {
  id: string;
  name: string;
  subdomains: MasterySpineSubdomain[];
}

export interface MasterySpine {
  domains: MasterySpineDomain[];
}

// ── Companion Memory Writeback Schema ─────────────────────────────────────────

export interface CompanionMemoryWriteback {
  mastered_concepts: string[];
  struggled_concepts: string[];
  hint_patterns: Record<string, number>;
  preferences: {
    session_length: "short" | "standard" | "long";
    pace: "slow" | "standard" | "fast";
    teaching_mode: TeachingMode;
  };
  relationship_beat?: string;
}

const COMPANION_WRITEBACK_FIELDS = new Set([
  "mastered_concepts",
  "struggled_concepts",
  "hint_patterns",
  "preferences",
  "relationship_beat",
]);

const VALID_SESSION_LENGTHS = new Set(["short", "standard", "long"]);
const VALID_PACES = new Set(["slow", "standard", "fast"]);
const VALID_TEACHING_MODES = new Set(TEACHING_MODES);

function validateCompanionWriteback(wb: unknown): wb is CompanionMemoryWriteback {
  if (typeof wb !== "object" || wb === null) return false;
  const obj = wb as Record<string, unknown>;

  for (const key of Object.keys(obj)) {
    if (!COMPANION_WRITEBACK_FIELDS.has(key)) return false;
  }

  if (!Array.isArray(obj.mastered_concepts)) return false;
  if (!obj.mastered_concepts.every((v: unknown) => typeof v === "string")) return false;

  if (!Array.isArray(obj.struggled_concepts)) return false;
  if (!obj.struggled_concepts.every((v: unknown) => typeof v === "string")) return false;

  if (typeof obj.hint_patterns !== "object" || obj.hint_patterns === null || Array.isArray(obj.hint_patterns)) return false;
  for (const val of Object.values(obj.hint_patterns as Record<string, unknown>)) {
    if (typeof val !== "number") return false;
  }

  if (typeof obj.preferences !== "object" || obj.preferences === null) return false;
  const prefs = obj.preferences as Record<string, unknown>;
  if (!VALID_SESSION_LENGTHS.has(prefs.session_length as string)) return false;
  if (!VALID_PACES.has(prefs.pace as string)) return false;
  if (!VALID_TEACHING_MODES.has(prefs.teaching_mode as TeachingMode)) return false;

  if (obj.relationship_beat !== undefined && typeof obj.relationship_beat !== "string") return false;

  return true;
}

// ── Spaced Repetition ─────────────────────────────────────────────────────────

const REAFFIRM_DAYS: Record<MasteryLevel, number> = {
  introduced: 1,
  practiced: 3,
  mastered: 7,
  reaffirmed: 21,
};

export function computeNextReaffirm(masteryLevel: MasteryLevel): string {
  const days = REAFFIRM_DAYS[masteryLevel];
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

// ── Companion Context Builder ─────────────────────────────────────────────────

export function buildCompanionContext(session: MagisterSession): string {
  if (session.adult_mode) {
    return "Address the learner as a peer. Use direct failure framing — when they're wrong, say so clearly. Hints should provide direction not hand-holding. Acknowledge real-world stakes and career implications.";
  }
  return "Address the learner warmly and encouragingly. Frame mistakes as normal parts of learning. Hints should be supportive and scaffolded. Celebrate progress genuinely.";
}

// ── Database ──────────────────────────────────────────────────────────────────

export class MagisterDB {
  private db: {
    pragma: (sql: string) => unknown;
    prepare: (sql: string) => any;
    exec: (sql: string) => unknown;
    transaction: <T extends (...args: any[]) => any>(fn: T) => T;
    close: () => void;
  };

  constructor(dbPath: string) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const BetterSqlite3 = require("better-sqlite3") as any;
    const DatabaseCtor = BetterSqlite3.default ?? BetterSqlite3;
    this.db = new DatabaseCtor(dbPath) as typeof this.db;
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS magister_sessions (
        id                TEXT PRIMARY KEY,
        user_id           TEXT DEFAULT 'jeff',
        module_id         TEXT NOT NULL,
        companion_id      TEXT,
        status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'complete')),
        teaching_mode     TEXT NOT NULL DEFAULT 'narrative' CHECK (teaching_mode IN ('narrative', 'direct', 'socratic')),
        duration_target   INTEGER NOT NULL DEFAULT 600,
        elapsed_seconds   INTEGER NOT NULL DEFAULT 0,
        current_concept   TEXT,
        current_story_beat TEXT,
        hint_count_l1     INTEGER NOT NULL DEFAULT 0,
        hint_count_l2     INTEGER NOT NULL DEFAULT 0,
        hint_count_l3     INTEGER NOT NULL DEFAULT 0,
        session_summary   TEXT,
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL,
        completed_at      TEXT
      );

      CREATE TABLE IF NOT EXISTS magister_progress (
        id              TEXT PRIMARY KEY,
        user_id         TEXT DEFAULT 'jeff',
        module_id       TEXT NOT NULL,
        concept_id      TEXT NOT NULL,
        mastery_level   TEXT NOT NULL DEFAULT 'introduced' CHECK (mastery_level IN ('introduced', 'practiced', 'mastered', 'reaffirmed')),
        mastery_score   REAL NOT NULL DEFAULT 0,
        last_practiced  TEXT,
        next_reaffirm   TEXT,
        practice_count  INTEGER NOT NULL DEFAULT 0,
        hint_usage      TEXT NOT NULL DEFAULT '{}',
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL,
        UNIQUE(user_id, module_id, concept_id)
      );

      CREATE TABLE IF NOT EXISTS magister_memory (
        id              TEXT PRIMARY KEY,
        user_id         TEXT DEFAULT 'jeff',
        companion_id    TEXT NOT NULL,
        memory_type     TEXT NOT NULL CHECK (memory_type IN ('relationship', 'preference', 'achievement', 'struggle', 'creative')),
        content         TEXT NOT NULL,
        session_id      TEXT,
        archivum_id     TEXT,
        created_at      TEXT NOT NULL,
        expires_at      TEXT
      );

      CREATE TABLE IF NOT EXISTS magister_creative (
        id                  TEXT PRIMARY KEY,
        user_id             TEXT DEFAULT 'jeff',
        module_id           TEXT NOT NULL,
        title               TEXT,
        content             TEXT,
        companion_feedback  TEXT,
        archivum_id         TEXT,
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS magister_modules (
        id              TEXT PRIMARY KEY,
        name            TEXT NOT NULL,
        campaign_world  TEXT,
        subject         TEXT,
        description     TEXT,
        age_track       TEXT NOT NULL DEFAULT 'adult' CHECK (age_track IN ('young_writer', 'adult')),
        companions      TEXT NOT NULL DEFAULT '[]',
        installed       INTEGER NOT NULL DEFAULT 0,
        config_path     TEXT,
        created_at      TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_progress_user_module ON magister_progress(user_id, module_id);
      CREATE INDEX IF NOT EXISTS idx_progress_reaffirm ON magister_progress(next_reaffirm);
      CREATE INDEX IF NOT EXISTS idx_memory_companion ON magister_memory(companion_id);
      CREATE INDEX IF NOT EXISTS idx_memory_expires ON magister_memory(expires_at);
      CREATE INDEX IF NOT EXISTS idx_sessions_module ON magister_sessions(module_id);
      CREATE INDEX IF NOT EXISTS idx_creative_module ON magister_creative(module_id);
    `);

    // Additive column migrations — safe on existing DBs (ALTER TABLE throws on duplicate, caught)
    for (const stmt of [
      "ALTER TABLE magister_sessions ADD COLUMN atom_concept_id TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE magister_sessions ADD COLUMN atom_objective TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE magister_sessions ADD COLUMN atom_mastery_signal TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE magister_sessions ADD COLUMN atom_recap_artifact TEXT",
      "ALTER TABLE magister_sessions ADD COLUMN adult_mode INTEGER NOT NULL DEFAULT 1",
      "ALTER TABLE magister_modules ADD COLUMN mastery_spine TEXT",
    ]) {
      try { this.db.exec(stmt); } catch { /* column already exists */ }
    }

    // Migrate age_track CHECK constraint when the allowed set has grown.
    // SQLite has no ALTER COLUMN, so recreate the table if any newly-allowed
    // value is rejected by the existing constraint. The probe value below
    // should be the most recently added member of AGE_TRACKS.
    const PROBE_VALUE = "kids";
    const needsMigration = (() => {
      try {
        this.db.exec(`INSERT INTO magister_modules (id, name, age_track, created_at) VALUES ('__check_probe', '__probe', '${PROBE_VALUE}', '2000-01-01T00:00:00Z')`);
        this.db.exec(`DELETE FROM magister_modules WHERE id = '__check_probe'`);
        return false;
      } catch {
        return true;
      }
    })();

    if (needsMigration) {
      this.db.exec(`BEGIN TRANSACTION`);
      try {
        this.db.exec(`ALTER TABLE magister_modules RENAME TO magister_modules_old`);
        this.db.exec(`
          CREATE TABLE magister_modules (
            id              TEXT PRIMARY KEY,
            name            TEXT NOT NULL,
            campaign_world  TEXT,
            subject         TEXT,
            description     TEXT,
            age_track       TEXT NOT NULL DEFAULT 'adult' CHECK (age_track IN ('young_writer', 'adult', 'kids', 'all', 'any')),
            companions      TEXT NOT NULL DEFAULT '[]',
            installed       INTEGER NOT NULL DEFAULT 0,
            config_path     TEXT,
            mastery_spine   TEXT,
            created_at      TEXT NOT NULL DEFAULT (datetime('now'))
          )
        `);
        this.db.exec(`INSERT INTO magister_modules SELECT id, name, campaign_world, subject, description, age_track, companions, installed, config_path, mastery_spine, COALESCE(created_at, '2000-01-01T00:00:00.000Z') FROM magister_modules_old`);
        this.db.exec(`DROP TABLE magister_modules_old`);
        this.db.exec(`COMMIT`);
      } catch (e) {
        this.db.exec(`ROLLBACK`);
        throw e;
      }
    }
  }

  // ── Mastery Spine Validation ─────────────────────────────────────────────

  /**
   * Module-with-no-spine accepts every concept ID (returns true).
   * Module-with-malformed-spine also returns true — don't block on bad data.
   * Returns false only when a well-formed spine exists and lacks the concept.
   */
  validateSpine(moduleId: string, conceptId: string): boolean {
    const mod = this.getModule(moduleId);
    if (!mod || !mod.mastery_spine) return true;

    let spine: MasterySpine;
    try {
      spine = JSON.parse(mod.mastery_spine) as MasterySpine;
    } catch {
      return true;
    }

    if (!spine.domains || !Array.isArray(spine.domains)) return true;

    for (const domain of spine.domains) {
      if (!domain.subdomains) continue;
      for (const sub of domain.subdomains) {
        if (!sub.concepts) continue;
        for (const concept of sub.concepts) {
          if (concept.id === conceptId) return true;
        }
      }
    }

    return false;
  }

  // ── Sessions ──────────────────────────────────────────────────────────────

  createSession(
    moduleId: string,
    opts: {
      atom: SessionAtom;
      companionId?: string | null;
      teachingMode?: TeachingMode;
      durationTarget?: number;
      userId?: string;
      adultMode?: boolean;
    },
  ): MagisterSession {
    if (!opts.atom.concept_id || opts.atom.concept_id.trim() === "") {
      throw new Error("Session atom requires a non-empty concept_id");
    }
    if (!opts.atom.objective || opts.atom.objective.trim() === "") {
      throw new Error("Session atom requires a non-empty objective");
    }
    if (!opts.atom.mastery_signal || opts.atom.mastery_signal.trim() === "") {
      throw new Error("Session atom requires a non-empty mastery_signal");
    }

    if (!this.validateSpine(moduleId, opts.atom.concept_id)) {
      throw new Error(`Concept "${opts.atom.concept_id}" is not on the mastery spine for module "${moduleId}"`);
    }

    const now = new Date().toISOString();
    const session: MagisterSession = {
      id: randomUUID(),
      user_id: opts.userId ?? "jeff",
      module_id: moduleId,
      companion_id: opts.companionId ?? null,
      status: "active",
      teaching_mode: opts.teachingMode ?? "narrative",
      duration_target: opts.durationTarget ?? SESSION_DURATIONS.standard,
      elapsed_seconds: 0,
      current_concept: opts.atom.concept_id,
      current_story_beat: null,
      hint_count_l1: 0,
      hint_count_l2: 0,
      hint_count_l3: 0,
      session_summary: null,
      atom_concept_id: opts.atom.concept_id,
      atom_objective: opts.atom.objective,
      atom_mastery_signal: opts.atom.mastery_signal,
      atom_recap_artifact: opts.atom.recap_artifact ?? null,
      adult_mode: opts.adultMode !== undefined ? (opts.adultMode ? 1 : 0) : 1,
      created_at: now,
      updated_at: now,
      completed_at: null,
    };

    this.db.prepare(`
      INSERT INTO magister_sessions
        (id, user_id, module_id, companion_id, status, teaching_mode, duration_target,
         elapsed_seconds, current_concept, current_story_beat, hint_count_l1, hint_count_l2,
         hint_count_l3, session_summary, atom_concept_id, atom_objective, atom_mastery_signal,
         atom_recap_artifact, adult_mode, created_at, updated_at, completed_at)
      VALUES
        (@id, @user_id, @module_id, @companion_id, @status, @teaching_mode, @duration_target,
         @elapsed_seconds, @current_concept, @current_story_beat, @hint_count_l1, @hint_count_l2,
         @hint_count_l3, @session_summary, @atom_concept_id, @atom_objective, @atom_mastery_signal,
         @atom_recap_artifact, @adult_mode, @created_at, @updated_at, @completed_at)
    `).run(session);

    return session;
  }

  getSession(id: string): MagisterSession | null {
    return (this.db.prepare("SELECT * FROM magister_sessions WHERE id = ?").get(id) as MagisterSession | undefined) ?? null;
  }

  listSessions(filters?: { moduleId?: string; status?: string; userId?: string }): MagisterSession[] {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (filters?.moduleId) { clauses.push("module_id = ?"); params.push(filters.moduleId); }
    if (filters?.status) { clauses.push("status = ?"); params.push(filters.status); }
    if (filters?.userId) { clauses.push("user_id = ?"); params.push(filters.userId); }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.db.prepare(`SELECT * FROM magister_sessions ${where} ORDER BY updated_at DESC`).all(...params) as MagisterSession[];
  }

  updateSession(
    id: string,
    patch: Partial<Pick<MagisterSession,
      "status" | "teaching_mode" | "current_concept" | "current_story_beat" |
      "session_summary" | "companion_id" | "elapsed_seconds"
    >>,
  ): boolean {
    const allowed = ["status", "teaching_mode", "current_concept", "current_story_beat", "session_summary", "companion_id", "elapsed_seconds"];
    const fields: string[] = [];
    const values: unknown[] = [];

    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined && allowed.includes(key)) {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    }

    if (fields.length === 0) return false;

    fields.push("updated_at = ?");
    values.push(new Date().toISOString());
    values.push(id);

    const result = this.db.prepare(`UPDATE magister_sessions SET ${fields.join(", ")} WHERE id = ?`).run(...values);
    return result.changes > 0;
  }

  endSession(id: string, summary?: string): boolean {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE magister_sessions
      SET status = 'complete', session_summary = COALESCE(?, session_summary),
          completed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(summary ?? null, now, now, id);
    const ended = this.getSession(id);
    return ended?.status === "complete";
  }

  setRecapArtifact(sessionId: string, recapArtifact: string): boolean {
    const now = new Date().toISOString();
    const result = this.db.prepare(
      "UPDATE magister_sessions SET atom_recap_artifact = ?, updated_at = ? WHERE id = ?",
    ).run(recapArtifact, now, sessionId);
    return result.changes > 0;
  }

  // ── Hint Tracking ─────────────────────────────────────────────────────────

  recordHint(sessionId: string, level: HintLevel): MagisterSession | null {
    const col = `hint_count_l${level}` as const;
    const now = new Date().toISOString();
    this.db.prepare(`UPDATE magister_sessions SET ${col} = ${col} + 1, updated_at = ? WHERE id = ?`).run(now, sessionId);
    return this.getSession(sessionId);
  }

  // ── Session Timer ─────────────────────────────────────────────────────────

  tickSession(sessionId: string, seconds: number): { elapsed: number; remaining: number; overtime: boolean } | null {
    const session = this.getSession(sessionId);
    if (!session) return null;

    const elapsed = session.elapsed_seconds + seconds;
    const now = new Date().toISOString();
    this.db.prepare("UPDATE magister_sessions SET elapsed_seconds = ?, updated_at = ? WHERE id = ?").run(elapsed, now, sessionId);

    const remaining = Math.max(0, session.duration_target - elapsed);
    return { elapsed, remaining, overtime: elapsed > session.duration_target };
  }

  // ── Progress ──────────────────────────────────────────────────────────────
  //
  // SHARED PROGRESS: Campaign mode and study mode both write to this single
  // magister_progress table. Concept IDs are mode-agnostic — mastery earned
  // in a campaign session counts identically in study mode. This is intentional:
  // knowledge doesn't forget which mode it was learned in.
  //
  // Do NOT create magister_progress_campaign, magister_progress_study, or any
  // other mode-specific tables. The SHARED_PROGRESS_MODES constant documents
  // which modes share this table.

  getProgress(userId: string, moduleId: string, conceptId: string): MagisterProgress | null {
    return (this.db.prepare(
      "SELECT * FROM magister_progress WHERE user_id = ? AND module_id = ? AND concept_id = ?",
    ).get(userId, moduleId, conceptId) as MagisterProgress | undefined) ?? null;
  }

  updateProgress(
    userId: string,
    moduleId: string,
    conceptId: string,
    patch: Partial<Pick<MagisterProgress, "mastery_level" | "mastery_score" | "hint_usage">>,
  ): MagisterProgress {
    if (conceptId.includes(":")) {
      throw new Error(
        `Concept ID "${conceptId}" contains a colon — concept IDs must be mode-agnostic ` +
        `(e.g. "subnet-basics" not "campaign:subnet-basics"). Campaign and study modes ` +
        `share the same progress table via SHARED_PROGRESS_MODES.`,
      );
    }

    const now = new Date().toISOString();
    const existing = this.getProgress(userId, moduleId, conceptId);

    if (!existing) {
      const row: MagisterProgress = {
        id: randomUUID(),
        user_id: userId,
        module_id: moduleId,
        concept_id: conceptId,
        mastery_level: patch.mastery_level ?? "introduced",
        mastery_score: patch.mastery_score ?? 0,
        last_practiced: now,
        next_reaffirm: computeNextReaffirm(patch.mastery_level ?? "introduced"),
        practice_count: 1,
        hint_usage: patch.hint_usage ?? "{}",
        created_at: now,
        updated_at: now,
      };

      this.db.prepare(`
        INSERT INTO magister_progress
          (id, user_id, module_id, concept_id, mastery_level, mastery_score,
           last_practiced, next_reaffirm, practice_count, hint_usage, created_at, updated_at)
        VALUES
          (@id, @user_id, @module_id, @concept_id, @mastery_level, @mastery_score,
           @last_practiced, @next_reaffirm, @practice_count, @hint_usage, @created_at, @updated_at)
      `).run(row);

      return row;
    }

    const level = patch.mastery_level ?? existing.mastery_level;
    const fields: string[] = [
      "mastery_level = ?",
      "mastery_score = ?",
      "last_practiced = ?",
      "next_reaffirm = ?",
      "practice_count = practice_count + 1",
      "updated_at = ?",
    ];
    const values: unknown[] = [
      level,
      patch.mastery_score ?? existing.mastery_score,
      now,
      computeNextReaffirm(level as MasteryLevel),
      now,
    ];

    if (patch.hint_usage !== undefined) {
      fields.push("hint_usage = ?");
      values.push(patch.hint_usage);
    }

    values.push(existing.id);

    this.db.prepare(`UPDATE magister_progress SET ${fields.join(", ")} WHERE id = ?`).run(...values);
    return this.getProgress(userId, moduleId, conceptId)!;
  }

  getModuleProgress(userId: string, moduleId: string): MagisterProgress[] {
    return this.db.prepare(
      "SELECT * FROM magister_progress WHERE user_id = ? AND module_id = ? ORDER BY mastery_score DESC",
    ).all(userId, moduleId) as MagisterProgress[];
  }

  getDueReaffirmations(userId: string = "jeff"): MagisterProgress[] {
    const now = new Date().toISOString();
    return this.db.prepare(
      "SELECT * FROM magister_progress WHERE user_id = ? AND next_reaffirm <= ? ORDER BY next_reaffirm ASC",
    ).all(userId, now) as MagisterProgress[];
  }

  computeExamReadiness(userId: string, moduleId: string): {
    totalConcepts: number;
    mastered: number;
    reaffirmed: number;
    readinessPercent: number;
    weakConcepts: string[];
  } {
    const progress = this.getModuleProgress(userId, moduleId);
    const totalConcepts = progress.length;
    const mastered = progress.filter(p => p.mastery_level === "mastered" || p.mastery_level === "reaffirmed").length;
    const reaffirmed = progress.filter(p => p.mastery_level === "reaffirmed").length;
    const weakConcepts = progress
      .filter(p => p.mastery_level === "introduced" || p.mastery_score < 0.5)
      .map(p => p.concept_id);

    const readinessPercent = totalConcepts > 0
      ? Math.round((mastered / totalConcepts) * 100)
      : 0;

    return { totalConcepts, mastered, reaffirmed, readinessPercent, weakConcepts };
  }

  // ── Memory ────────────────────────────────────────────────────────────────

  private saveMemory(
    companionId: string,
    memoryType: MagisterMemory["memory_type"],
    content: string,
    opts: { sessionId?: string; archivumId?: string; userId?: string; expiresAt?: string } = {},
  ): MagisterMemory {
    const now = new Date().toISOString();
    const memory: MagisterMemory = {
      id: randomUUID(),
      user_id: opts.userId ?? "jeff",
      companion_id: companionId,
      memory_type: memoryType,
      content,
      session_id: opts.sessionId ?? null,
      archivum_id: opts.archivumId ?? null,
      created_at: now,
      expires_at: opts.expiresAt ?? null,
    };

    this.db.prepare(`
      INSERT INTO magister_memory
        (id, user_id, companion_id, memory_type, content, session_id, archivum_id, created_at, expires_at)
      VALUES
        (@id, @user_id, @companion_id, @memory_type, @content, @session_id, @archivum_id, @created_at, @expires_at)
    `).run(memory);

    return memory;
  }

  /**
   * Schema-enforced companion memory writeback.
   * Validates every field against CompanionMemoryWriteback and stores
   * individual memory entries by type for efficient retrieval.
   */
  saveCompanionMemory(
    companionId: string,
    writeback: CompanionMemoryWriteback,
    opts: { sessionId?: string; userId?: string } = {},
  ): MagisterMemory[] {
    if (!validateCompanionWriteback(writeback)) {
      throw new Error(
        "Companion memory writeback failed validation. Must contain only: " +
        "mastered_concepts (string[]), struggled_concepts (string[]), " +
        "hint_patterns (Record<string, number>), preferences ({session_length, pace, teaching_mode}), " +
        "relationship_beat? (string).",
      );
    }

    const saved: MagisterMemory[] = [];
    const baseOpts = {
      ...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
      ...(opts.userId ? { userId: opts.userId } : {}),
    };

    if (writeback.mastered_concepts.length > 0) {
      saved.push(this.saveMemory(
        companionId,
        "achievement",
        JSON.stringify({ mastered_concepts: writeback.mastered_concepts }),
        baseOpts,
      ));
    }

    if (writeback.struggled_concepts.length > 0) {
      saved.push(this.saveMemory(
        companionId,
        "struggle",
        JSON.stringify({ struggled_concepts: writeback.struggled_concepts }),
        baseOpts,
      ));
    }

    if (Object.keys(writeback.hint_patterns).length > 0) {
      saved.push(this.saveMemory(
        companionId,
        "preference",
        JSON.stringify({ hint_patterns: writeback.hint_patterns }),
        baseOpts,
      ));
    }

    saved.push(this.saveMemory(
      companionId,
      "preference",
      JSON.stringify({ preferences: writeback.preferences }),
      baseOpts,
    ));

    if (writeback.relationship_beat) {
      saved.push(this.saveMemory(
        companionId,
        "relationship",
        writeback.relationship_beat,
        baseOpts,
      ));
    }

    return saved;
  }

  getCompanionMemories(
    companionId: string,
    opts?: { userId?: string; memoryType?: MagisterMemory["memory_type"]; limit?: number },
  ): MagisterMemory[] {
    const clauses: string[] = ["companion_id = ?"];
    const params: unknown[] = [companionId];

    const userId = opts?.userId ?? "jeff";
    clauses.push("user_id = ?");
    params.push(userId);

    if (opts?.memoryType) {
      clauses.push("memory_type = ?");
      params.push(opts.memoryType);
    }

    const limit = opts?.limit ?? 100;
    return this.db.prepare(
      `SELECT * FROM magister_memory WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC LIMIT ?`,
    ).all(...params, limit) as MagisterMemory[];
  }

  pruneExpiredMemories(): number {
    const now = new Date().toISOString();
    const result = this.db.prepare("DELETE FROM magister_memory WHERE expires_at IS NOT NULL AND expires_at <= ?").run(now);
    return result.changes;
  }

  // ── Creative ──────────────────────────────────────────────────────────────

  saveCreativeWork(
    moduleId: string,
    opts: { title?: string; content?: string; companionFeedback?: string; archivumId?: string; userId?: string } = {},
  ): MagisterCreative {
    const now = new Date().toISOString();
    const work: MagisterCreative = {
      id: randomUUID(),
      user_id: opts.userId ?? "jeff",
      module_id: moduleId,
      title: opts.title ?? null,
      content: opts.content ?? null,
      companion_feedback: opts.companionFeedback ?? null,
      archivum_id: opts.archivumId ?? null,
      created_at: now,
      updated_at: now,
    };

    this.db.prepare(`
      INSERT INTO magister_creative
        (id, user_id, module_id, title, content, companion_feedback, archivum_id, created_at, updated_at)
      VALUES
        (@id, @user_id, @module_id, @title, @content, @companion_feedback, @archivum_id, @created_at, @updated_at)
    `).run(work);

    return work;
  }

  getCreativeWorks(moduleId: string, userId: string = "jeff"): MagisterCreative[] {
    return this.db.prepare(
      "SELECT * FROM magister_creative WHERE module_id = ? AND user_id = ? ORDER BY updated_at DESC",
    ).all(moduleId, userId) as MagisterCreative[];
  }

  updateCreativeWork(
    id: string,
    patch: Partial<Pick<MagisterCreative, "title" | "content" | "companion_feedback" | "archivum_id">>,
  ): boolean {
    const allowed = ["title", "content", "companion_feedback", "archivum_id"];
    const fields: string[] = [];
    const values: unknown[] = [];

    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined && allowed.includes(key)) {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    }

    if (fields.length === 0) return false;

    fields.push("updated_at = ?");
    values.push(new Date().toISOString());
    values.push(id);

    const result = this.db.prepare(`UPDATE magister_creative SET ${fields.join(", ")} WHERE id = ?`).run(...values);
    return result.changes > 0;
  }

  // ── Modules ───────────────────────────────────────────────────────────────

  registerModule(mod: {
    id: string;
    name: string;
    campaignWorld?: string;
    subject?: string;
    description?: string;
    ageTrack?: AgeTrack;
    companions?: string[];
    configPath?: string;
    masterySpine?: MasterySpine;
  }): MagisterModuleRecord {
    const now = new Date().toISOString();
    const spineJson = mod.masterySpine ? JSON.stringify(mod.masterySpine) : null;

    const existing = this.getModule(mod.id);
    if (existing) {
      this.db.prepare(`
        UPDATE magister_modules
        SET name = ?, campaign_world = ?, subject = ?, description = ?,
            age_track = ?, companions = ?, config_path = ?, mastery_spine = ?
        WHERE id = ?
      `).run(
        mod.name,
        mod.campaignWorld ?? null,
        mod.subject ?? null,
        mod.description ?? null,
        mod.ageTrack ?? "adult",
        JSON.stringify(mod.companions ?? []),
        mod.configPath ?? null,
        spineJson,
        mod.id,
      );
      return this.getModule(mod.id)!;
    }

    const record: MagisterModuleRecord = {
      id: mod.id,
      name: mod.name,
      campaign_world: mod.campaignWorld ?? null,
      subject: mod.subject ?? null,
      description: mod.description ?? null,
      age_track: mod.ageTrack ?? "adult",
      companions: JSON.stringify(mod.companions ?? []),
      installed: 0,
      config_path: mod.configPath ?? null,
      mastery_spine: spineJson,
      created_at: now,
    };

    this.db.prepare(`
      INSERT INTO magister_modules
        (id, name, campaign_world, subject, description, age_track, companions, installed, config_path, mastery_spine, created_at)
      VALUES
        (@id, @name, @campaign_world, @subject, @description, @age_track, @companions, @installed, @config_path, @mastery_spine, @created_at)
    `).run(record);

    return record;
  }

  private parseModuleRow(row: MagisterModuleRecord): MagisterModuleRecord {
    if (typeof row.companions === "string") {
      try { (row as any).companions = JSON.parse(row.companions); } catch { (row as any).companions = []; }
    }
    return row;
  }

  listModules(installedOnly: boolean = false): MagisterModuleRecord[] {
    const where = installedOnly ? "WHERE installed = 1" : "";
    const rows = this.db.prepare(`SELECT * FROM magister_modules ${where} ORDER BY name`).all() as MagisterModuleRecord[];
    return rows.map(r => this.parseModuleRow(r));
  }

  getModule(id: string): MagisterModuleRecord | null {
    const row = (this.db.prepare("SELECT * FROM magister_modules WHERE id = ?").get(id) as MagisterModuleRecord | undefined) ?? null;
    return row ? this.parseModuleRow(row) : null;
  }

  installModule(id: string): boolean {
    const result = this.db.prepare("UPDATE magister_modules SET installed = 1 WHERE id = ?").run(id);
    return result.changes > 0;
  }

  installedCount(): number {
    const row = this.db.prepare("SELECT COUNT(*) as cnt FROM magister_modules WHERE installed = 1").get() as { cnt: number };
    return row.cnt;
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  close(): void {
    this.db.close();
  }
}
