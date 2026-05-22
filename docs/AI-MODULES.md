# AI Literacy + AI Systems modules

Two first-class Magister modules, added 2026-05-22, that teach AI as a tool
and as an operational system rather than as a brand. They are intended to
ship with the open-source release.

## Why these exist

Most current AI courses are either vendor marketing or shallow prompt
recipes. Magister already runs on the operator-first systems philosophy
(visible runtime truth, real receipts, working rollback). These two
modules teach the same posture, scoped for two different audiences:

- A **beginner literacy** track that gives anyone — including non-coders
  and kids — enough mental model to use AI well, recognise its failure
  modes, and protect their own data and judgment.
- An **operations and governance** track for builders and IT learners
  that explains what makes an AI system real: tool calls, capability
  contracts, runtime truth, receipts, approval gates, model routing,
  drift detection, and release/rollback discipline.

Neither module recommends a specific product. Neither claims AI is
magical, revolutionary, or universally helpful. Both teach verification,
privacy, and operator authority as defaults, not afterthoughts.

## Module summaries

### AI Literacy — `curriculum/ai-literacy/`

- **Campaign world:** The AI Atelier — a small studio where craftspeople
  learn to use tools without losing their judgment.
- **Companions:** Iris (patient, plain-spoken mentor) and Field (an
  evidence-first researcher who teaches verification habits).
- **Audience:** beginners, non-coders, everyday users — `age_track: all`,
  `difficulty: beginner`, ~8 hours.
- **Domains:** Foundations, Hallucinations & Verification, Local vs Cloud
  & Privacy, Practical AI Workflows, Building Good AI Habits.
- **Lesson flow:** 10 lessons from "What AI can and cannot do" to
  "Building good AI habits". Each lesson ships with objectives, key
  concepts, practice prompts, and a mastery checkpoint.
- **Recommended next:** `ai-systems`.

### AI Systems & Agent Operations — `curriculum/ai-systems/`

- **Campaign world:** The Control Plane — the room where operators run
  AI systems instead of being run by them.
- **Companions:** Atlas (a release captain who insists on receipts and
  rollback) and Pico (an agent engineer who explains tool calls and
  capability contracts).
- **Audience:** builders, IT learners, agent developers — `age_track:
  adult`, `difficulty: intermediate`, ~30 hours. Lives in the Advanced
  Studies shelf (`tier: "advanced"`).
- **Domains:** Agents, Tools, and Capability Contracts; Memory, History,
  and Context; Runtime Truth and Health Checks; Receipts, Evidence, and
  Audit Trails; Approvals, Drift, and Release Discipline.
- **Lesson flow:** 10 lessons from "What makes an agent different from a
  chatbot" to "Release readiness, backups, and rollback".

## Curriculum schema additions

Both configs use the existing `curriculum/<id>/config.json` shape (`id`,
`name`, `description`, `companions`, `domains`, etc.) but add four
structured fields that the existing modules do not yet use. None of them
are required by the scanner; they are passed through and re-served via
`GET /magister/modules/:id`:

| Field                 | Shape                                                | Purpose                                                                 |
|-----------------------|------------------------------------------------------|-------------------------------------------------------------------------|
| `learning_objectives` | `string[]`                                           | Module-level outcomes the learner should be able to do at the end.      |
| `lessons`             | `Array<{id, title, summary, objectives, key_concepts, practice, mastery_checkpoint}>` | Ordered lesson sequence with embedded practice.                         |
| `practice_activities` | `Array<{id, title, prompt}>`                         | Stand-alone exercises (rewrite a bad prompt, classify tool actions, etc.). |
| `review_questions`    | `Array<{q, a}>`                                      | Self-check questions with model answers.                                |
| `recommended_next`    | `string \| null`                                     | Module id to suggest after this one.                                    |

The companion-driven session flow uses `domains[]` and `concepts[]` as
its primary knowledge surface (unchanged). A future structured-lesson UI
could read `lessons[]` directly without re-architecting; for now those
fields are also useful as content QA and as the basis for the
`test/ai-modules.test.ts` guards.

## Tests and release safety

`test/ai-modules.test.ts` runs every time `npm test` runs. It guards:

- structural integrity (≥10 lessons each, ≥5 practice activities, ≥8
  review questions, ≥4 domains with concepts and mastery signals,
  companions with voice config);
- the AI Literacy → AI Systems handoff via `recommended_next`;
- **no private path leakage** — `/mnt/ai`, `/home/<user>`, `/Users/<user>`,
  Windows user paths;
- **no secret-looking tokens** — OpenAI, OpenRouter, Anthropic, Slack,
  GitHub PATs, AWS keys, PEM blocks;
- **no shallow hype language** — `revolutionary`, `game-changing`,
  `unleash`, `superpowers`, `magical`, `disruptive`, `next-generation`,
  `cutting-edge`, `world-class`, `mind-blowing`;
- **verification language is present** — both modules must mention
  verification/audit/citation cues somewhere, so model-as-oracle
  framing is structurally hard to ship by accident;
- **AI Literacy stays beginner-friendly** — must cover privacy,
  hallucinations, local vs cloud, prompts.
- **AI Systems covers the operations arc** — must touch agent, tool,
  capability, receipt, approval, rollback, drift, memory.

If a future change accidentally drops one of these, the test fails. That
is on purpose: this content is intended for public release, and the
tests are the contract.

## Adding more AI content

Use the same pattern: a new `curriculum/<id>/config.json` with the
fields above, a companion in `companions[]` with a globally unique id
(see `test/curriculum.test.ts`), and — if the content touches AI use
or operations — extend `test/ai-modules.test.ts` to cover it.
