/**
 * Tests for the AI Literacy + AI Systems & Agent Operations modules.
 *
 * These modules are intended for open-source release, so the tests guard
 * structural integrity (lessons, practice, review questions exist) and
 * release safety (no private path leakage, no secret-looking tokens).
 *
 * Don't relax these without considering what a public reader of this repo
 * would see. They're the contract for "beginner-safe, lab-leak-free".
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const AI_LITERACY = resolve(REPO_ROOT, "curriculum/ai-literacy/config.json");
const AI_SYSTEMS = resolve(REPO_ROOT, "curriculum/ai-systems/config.json");

interface AiModuleConfig {
  id: string;
  name: string;
  subject: string;
  description: string;
  age_track: string;
  difficulty?: string;
  companions: Array<{
    id: string;
    name: string;
    personality?: string;
    speech_pattern?: string;
    accent_color?: string;
    voice?: { engine?: string; voice_ref?: string };
  }>;
  domains: Array<{ id: string; name: string; concepts: string[]; mastery_signal: string }>;
  learning_objectives: string[];
  lessons: Array<{
    id: string;
    title: string;
    summary: string;
    objectives: string[];
    key_concepts: string[];
    practice: string[];
    mastery_checkpoint: string;
  }>;
  practice_activities: Array<{ id: string; title: string; prompt: string }>;
  review_questions: Array<{ q: string; a: string }>;
  recommended_next: string | null;
  tier?: string;
}

function loadConfig(path: string): AiModuleConfig {
  return JSON.parse(readFileSync(path, "utf-8")) as AiModuleConfig;
}

// ── Structural checks ────────────────────────────────────────────────────────

test("ai-literacy: required top-level fields present", () => {
  const c = loadConfig(AI_LITERACY);
  assert.equal(c.id, "ai-literacy");
  assert.equal(c.subject, "AI Literacy");
  assert.ok(c.name.length > 0, "name required");
  assert.ok(c.description.length > 0, "description required");
  assert.ok(["all", "kids", "teen", "adult"].includes(c.age_track), `unexpected age_track: ${c.age_track}`);
});

test("ai-systems: required top-level fields present", () => {
  const c = loadConfig(AI_SYSTEMS);
  assert.equal(c.id, "ai-systems");
  assert.equal(c.subject, "AI Systems & Agent Operations");
  assert.ok(c.name.length > 0, "name required");
  assert.ok(c.description.length > 0, "description required");
  assert.ok(["all", "kids", "teen", "adult"].includes(c.age_track), `unexpected age_track: ${c.age_track}`);
});

test("both AI modules declare at least one companion with id + voice", () => {
  for (const path of [AI_LITERACY, AI_SYSTEMS]) {
    const c = loadConfig(path);
    assert.ok(c.companions.length >= 1, `${c.id}: needs at least one companion`);
    for (const comp of c.companions) {
      assert.ok(comp.id && typeof comp.id === "string", `${c.id}: companion missing id`);
      assert.ok(comp.name && typeof comp.name === "string", `${c.id}: companion missing name`);
      assert.ok(comp.voice?.engine, `${c.id}: ${comp.id} missing voice.engine`);
      assert.ok(comp.voice?.voice_ref, `${c.id}: ${comp.id} missing voice.voice_ref`);
    }
  }
});

test("both AI modules declare ≥4 domains, each with concepts + mastery signal", () => {
  for (const path of [AI_LITERACY, AI_SYSTEMS]) {
    const c = loadConfig(path);
    assert.ok(c.domains.length >= 4, `${c.id}: needs ≥4 domains (got ${c.domains.length})`);
    for (const d of c.domains) {
      assert.ok(d.concepts.length >= 3, `${c.id}/${d.id}: needs ≥3 concepts`);
      assert.ok(d.mastery_signal.length > 30, `${c.id}/${d.id}: mastery_signal too thin`);
    }
  }
});

test("both AI modules expose learning_objectives", () => {
  for (const path of [AI_LITERACY, AI_SYSTEMS]) {
    const c = loadConfig(path);
    assert.ok(Array.isArray(c.learning_objectives), `${c.id}: learning_objectives must be an array`);
    assert.ok(c.learning_objectives.length >= 5, `${c.id}: needs ≥5 learning objectives`);
    for (const obj of c.learning_objectives) {
      assert.ok(obj.length > 20, `${c.id}: objective too thin: ${obj}`);
    }
  }
});

test("both AI modules ship ≥10 structured lessons with all required fields", () => {
  for (const path of [AI_LITERACY, AI_SYSTEMS]) {
    const c = loadConfig(path);
    assert.ok(c.lessons.length >= 10, `${c.id}: needs ≥10 lessons (got ${c.lessons.length})`);
    const seen = new Set<string>();
    for (const lesson of c.lessons) {
      assert.ok(lesson.id, `${c.id}: lesson missing id`);
      assert.ok(!seen.has(lesson.id), `${c.id}: duplicate lesson id ${lesson.id}`);
      seen.add(lesson.id);
      assert.ok(lesson.title.length > 0, `${c.id}/${lesson.id}: missing title`);
      assert.ok(lesson.summary.length > 30, `${c.id}/${lesson.id}: summary too thin`);
      assert.ok(lesson.objectives.length >= 2, `${c.id}/${lesson.id}: needs ≥2 objectives`);
      assert.ok(lesson.key_concepts.length >= 3, `${c.id}/${lesson.id}: needs ≥3 key concepts`);
      assert.ok(lesson.practice.length >= 1, `${c.id}/${lesson.id}: needs ≥1 practice prompt`);
      assert.ok(lesson.mastery_checkpoint.length > 20, `${c.id}/${lesson.id}: mastery_checkpoint too thin`);
    }
  }
});

test("both AI modules expose stand-alone practice_activities", () => {
  for (const path of [AI_LITERACY, AI_SYSTEMS]) {
    const c = loadConfig(path);
    assert.ok(Array.isArray(c.practice_activities), `${c.id}: practice_activities must be an array`);
    assert.ok(c.practice_activities.length >= 5, `${c.id}: needs ≥5 practice activities`);
    for (const a of c.practice_activities) {
      assert.ok(a.id, `${c.id}: practice activity missing id`);
      assert.ok(a.title.length > 0, `${c.id}/${a.id}: missing title`);
      assert.ok(a.prompt.length > 30, `${c.id}/${a.id}: prompt too thin`);
    }
  }
});

test("both AI modules expose ≥8 review_questions with answers", () => {
  for (const path of [AI_LITERACY, AI_SYSTEMS]) {
    const c = loadConfig(path);
    assert.ok(c.review_questions.length >= 8, `${c.id}: needs ≥8 review questions (got ${c.review_questions.length})`);
    for (const r of c.review_questions) {
      assert.ok(r.q && r.q.length > 10, `${c.id}: review q too thin: ${r.q}`);
      assert.ok(r.a && r.a.length > 20, `${c.id}: review a too thin: ${r.a}`);
    }
  }
});

test("ai-literacy recommends ai-systems as the next module", () => {
  const c = loadConfig(AI_LITERACY);
  assert.equal(c.recommended_next, "ai-systems", "AI Literacy should hand off to AI Systems");
});

// ── Release-safety checks ────────────────────────────────────────────────────

test("AI modules do not leak private lab paths", () => {
  // Anything in the AI module content that references the host filesystem
  // would leak operator setup. The audit explicitly called these out.
  const forbiddenPatterns = [
    /\/mnt\/ai\b/,
    /\/home\/[a-z]+\b/i,
    /C:\\Users\\/i,
    /\/Users\/[a-z]+\b/i,
  ];
  for (const path of [AI_LITERACY, AI_SYSTEMS]) {
    const raw = readFileSync(path, "utf-8");
    for (const pat of forbiddenPatterns) {
      const m = raw.match(pat);
      assert.ok(!m, `${path}: leaked path pattern ${pat} → '${m?.[0] ?? ""}'`);
    }
  }
});

test("AI modules do not embed secret-looking tokens", () => {
  // Loose heuristics for things a public reader should never see in seed
  // content. Tightened over time as needed.
  const tokenPatterns: { pat: RegExp; label: string }[] = [
    { pat: /sk-[a-zA-Z0-9]{20,}/, label: "OpenAI-style sk- token" },
    { pat: /sk-or-[a-zA-Z0-9]{20,}/, label: "OpenRouter-style sk-or- token" },
    { pat: /sk-ant-[a-zA-Z0-9]{20,}/, label: "Anthropic-style sk-ant- token" },
    { pat: /xoxb-[a-zA-Z0-9-]{20,}/, label: "Slack bot token" },
    { pat: /ghp_[a-zA-Z0-9]{20,}/, label: "GitHub PAT" },
    { pat: /AKIA[0-9A-Z]{16}/, label: "AWS access key" },
    { pat: /-----BEGIN [A-Z ]+PRIVATE KEY-----/, label: "PEM private key" },
  ];
  for (const path of [AI_LITERACY, AI_SYSTEMS]) {
    const raw = readFileSync(path, "utf-8");
    for (const { pat, label } of tokenPatterns) {
      assert.ok(!pat.test(raw), `${path}: leaked ${label}`);
    }
  }
});

test("AI modules avoid shallow hype language", () => {
  // Marketing words that signal hype rather than substance. We don't
  // ban them outright (a reasonable use is possible), but we cap how
  // many can appear so beginner content stays grounded.
  const hypeTerms = [
    /\brevolutionary\b/gi,
    /\bgame[- ]changing\b/gi,
    /\bunleash\b/gi,
    /\bsuperpowers?\b/gi,
    /\bmagical\b/gi,
    /\bdisrupt(?:ive|ion)\b/gi,
    /\bnext[- ]generation\b/gi,
    /\bcutting[- ]edge\b/gi,
    /\bworld[- ]class\b/gi,
    /\bmind[- ]blowing\b/gi,
  ];
  for (const path of [AI_LITERACY, AI_SYSTEMS]) {
    const raw = readFileSync(path, "utf-8");
    let total = 0;
    for (const t of hypeTerms) {
      const m = raw.match(t);
      if (m) total += m.length;
    }
    assert.ok(total === 0, `${path}: hype-term count ${total}; rephrase grounded`);
  }
});

test("AI modules name a verification habit (no model-as-oracle framing)", () => {
  // Critical for AI literacy in particular — content must teach
  // verification, not blind trust.
  const verificationCues = [
    /verif/i, /cross[- ]check/i, /hallucinat/i, /citation/i, /receipt/i,
    /probe/i, /audit/i, /confirm/i, /\bevidence\b/i,
  ];
  for (const path of [AI_LITERACY, AI_SYSTEMS]) {
    const raw = readFileSync(path, "utf-8");
    const hit = verificationCues.some((c) => c.test(raw));
    assert.ok(hit, `${path}: needs verification/audit language somewhere`);
  }
});

test("ai-literacy stays beginner-friendly (covers privacy + verification + workflows)", () => {
  const c = loadConfig(AI_LITERACY);
  const text = JSON.stringify(c).toLowerCase();
  assert.ok(text.includes("privacy"), "ai-literacy must teach privacy");
  assert.ok(text.includes("hallucinat"), "ai-literacy must teach hallucinations");
  assert.ok(text.includes("local") && text.includes("cloud"), "ai-literacy must contrast local vs cloud");
  assert.ok(text.includes("prompt"), "ai-literacy must cover prompts");
});

test("ai-systems covers the operations / governance arc", () => {
  const c = loadConfig(AI_SYSTEMS);
  const text = JSON.stringify(c).toLowerCase();
  for (const cue of ["agent", "tool", "capability", "receipt", "approval", "rollback", "drift", "memory"]) {
    assert.ok(text.includes(cue), `ai-systems missing systems concept: ${cue}`);
  }
});
