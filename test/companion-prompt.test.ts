import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCompanionSystemPrompt, renderMemoryBlock } from "../server/lib/companion-prompt.js";
import type { MagisterMemory } from "../server/db.js";

test("buildCompanionSystemPrompt locks identity, includes world + atom + tone", () => {
  const prompt = buildCompanionSystemPrompt({
    companionName: "Marcus",
    companionId: "marcus",
    campaignWorld: "Roma Aeterna",
    companionPersonality: "stoic centurion",
    companionSpeechPattern: "clipped, formal",
    companionTeachingRules: "use Latin examples",
    teachingMode: "narrative",
    atomConcept: "noun-declension",
    atomObjective: "Decline first-declension nouns",
    memoryBlock: "",
    adultMode: true,
  });

  assert.match(prompt, /IDENTITY LOCK: You are Marcus/);
  assert.match(prompt, /WORLD: Roma Aeterna/);
  assert.match(prompt, /PERSONALITY: stoic centurion/);
  assert.match(prompt, /TEACHING RULES \(follow strictly\): use Latin examples/);
  assert.match(prompt, /SPEECH PATTERN: clipped, formal/);
  assert.match(prompt, /CURRENT SESSION: Concept: noun-declension/);
  assert.match(prompt, /Address the learner as a peer/);
  assert.match(prompt, /Teaching mode: narrative/);

  // Identity lock must precede personality/world content (defends against injection).
  const identityIdx = prompt.indexOf("IDENTITY LOCK");
  const worldIdx = prompt.indexOf("WORLD:");
  const personalityIdx = prompt.indexOf("PERSONALITY:");
  assert.ok(identityIdx >= 0 && identityIdx < worldIdx, "identity lock must come before world");
  assert.ok(worldIdx < personalityIdx, "world must come before personality");
});

test("buildCompanionSystemPrompt switches tone for young learners", () => {
  const prompt = buildCompanionSystemPrompt({
    companionName: "Ada",
    companionId: "ada",
    campaignWorld: "",
    companionPersonality: "",
    companionSpeechPattern: "",
    companionTeachingRules: "",
    teachingMode: "narrative",
    atomConcept: "addition",
    atomObjective: "Add two single-digit numbers",
    memoryBlock: "",
    adultMode: false,
  });
  assert.match(prompt, /Address the learner warmly and encouragingly/);
});

test("renderMemoryBlock returns empty string for no memories", () => {
  assert.equal(renderMemoryBlock([]), "");
});

test("renderMemoryBlock surfaces achievements and struggles", () => {
  const now = new Date().toISOString();
  const memories: MagisterMemory[] = [
    {
      id: "m1", user_id: "jeff", companion_id: "marcus",
      memory_type: "achievement",
      content: JSON.stringify({ mastered_concepts: ["nominative", "accusative"] }),
      session_id: null, archivum_id: null, created_at: now, expires_at: null,
    },
    {
      id: "m2", user_id: "jeff", companion_id: "marcus",
      memory_type: "struggle",
      content: JSON.stringify({ struggled_concepts: ["ablative"] }),
      session_id: null, archivum_id: null, created_at: now, expires_at: null,
    },
  ];
  const block = renderMemoryBlock(memories);
  assert.match(block, /COMPANION MEMORY/);
  assert.match(block, /Mastered: nominative, accusative/);
  assert.match(block, /Struggled with: ablative/);
});
