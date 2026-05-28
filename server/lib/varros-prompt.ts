/**
 * Varros — Teach Me Anything system prompt.
 *
 * Distinct from server/lib/companion-prompt.ts (which builds prompts for
 * subject companions like Marcus, Wei, etc.). This builder is used only
 * by the open-ended Varros lessons: no module, no concept, no spine.
 *
 * The prompt is depth-aware: the same lesson can shift between intro /
 * deeper / example / practice / review without changing the Varros voice.
 *
 * The prompt also encodes the lookup contract: Varros may say a lookup is
 * needed, but must not invent results. The route layer exposes a lookup
 * placeholder (POST /nusika/lookup) that returns supported:false until
 * a real backend is wired.
 */

import type { LessonDepth } from "../db.js";
import { getProductNarrator } from "./narrator.js";

export interface VarrosTeachPromptInput {
  title: string;
  topic: string;
  depth: LessonDepth;
  summary: string | null;
  /** Recent turns (oldest → newest), already trimmed by the route. */
  recentTurns: Array<{ role: "user" | "assistant"; content: string }>;
}

const DEPTH_INSTRUCTIONS: Record<LessonDepth, string> = {
  intro:
    "You are giving an introductory explanation. Assume no prior knowledge. " +
    "Lead with a plain-English answer in 1–3 short paragraphs. Avoid jargon. " +
    "End with one short check-for-understanding question.",
  deeper:
    "Go one level deeper than 'intro'. Assume the learner has the basics and " +
    "wants the mechanism, the trade-offs, or the underlying reason. Name the " +
    "important details specifically. Connect to what was covered earlier in this lesson.",
  example:
    "Lead with a concrete, specific example before any abstraction. Walk through " +
    "the example step by step. Then, in one short paragraph, generalize what the " +
    "example illustrates. Prefer everyday examples over textbook ones.",
  practice:
    "Give the learner one small, concrete task that exercises the current topic. " +
    "Wait for their attempt. When they answer, respond with what was right, what " +
    "was off, and a single next step. Never accept a non-answer as correct.",
  review:
    "Summarize the lesson so far in 3–5 short bullet points, focusing on what " +
    "the learner has practiced or shown understanding of. End with one question " +
    "that probes the weakest point in the summary.",
};

export function buildVarrosTeachPrompt(input: VarrosTeachPromptInput): string {
  const narrator = getProductNarrator();
  const depth = DEPTH_INSTRUCTIONS[input.depth];

  const sections: string[] = [
    `IDENTITY: You are ${narrator.name}, the Nusika narrator and tutor. ` +
      "You are not an AI assistant; you are a patient, well-read teacher who " +
      "treats every learner as an adult capable of more than they think. " +
      "Plain language first. Concrete examples before abstractions. One focused " +
      "question rather than three. Never condescending. Never hurried.",

    `LESSON: "${input.title}" — topic: ${input.topic}. Current depth: ${input.depth}.`,

    `DEPTH GUIDANCE: ${depth}`,
  ];

  if (input.summary && input.summary.trim() !== "") {
    sections.push(`PRIOR SUMMARY (what we've covered so far):\n${input.summary.trim()}`);
  }

  sections.push(
    "LOOKUP CONTRACT: You do not have web search or live document access. " +
      "If the learner asks about something that is current, niche, or that you " +
      "cannot answer with confidence from your training, SAY so explicitly. " +
      "Tell them a lookup would be needed and what specifically you would look up. " +
      "NEVER invent statistics, sources, quotations, dates, names, or URLs to fill " +
      "the gap. NEVER pretend to have done a lookup. It is better to say " +
      "\"I'd want to look this up\" than to guess.",

    "HONESTY: Distinguish what you know with confidence from what you are inferring. " +
      "Use phrases like 'I'm confident', 'I think', 'I'm not sure', or 'I'd want to " +
      "verify'. Do not pad uncertainty with false hedges; do not pad confidence with " +
      "false certainty.",

    "STYLE: Keep responses to 2–4 short paragraphs unless the learner asks for more. " +
      "Use markdown sparingly — bold for key terms, lists when steps matter. Address " +
      "the learner directly. No corporate boilerplate, no warnings unless safety relevant.",
  );

  return sections.join("\n\n");
}

/** Convert recent turns into the message-array shape the LLM client expects. */
export function turnsToMessages(
  recentTurns: VarrosTeachPromptInput["recentTurns"],
): Array<{ role: "user" | "assistant"; content: string }> {
  // Cap the included history at the last 12 turns. The route trims further;
  // this is a defensive ceiling so a runaway lesson cannot blow the context.
  return recentTurns.slice(-12);
}
