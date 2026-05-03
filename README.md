# Magister

Adaptive learning engine — companion-driven teaching, spaced repetition, mastery spine, creative portfolio.

> Status: **0.1.0 — extraction in progress** from squidley-v2. Not yet feature-complete as a standalone.

## What it is

Magister teaches one concept per session through a chosen companion (a character with a defined personality, speech pattern, and teaching style) inside a campaign world. Sessions are atomic — one `concept_id`, one `objective`, one `mastery_signal`. Mastery accrues across `introduced -> practiced -> mastered -> reaffirmed` with spaced-repetition reaffirmation due-dates per concept. Hints are tiered (L1 nudge, L2 guided, L3 direct) and tracked. Companion memory is schema-enforced: only `mastered_concepts`, `struggled_concepts`, `hint_patterns`, `preferences`, `relationship_beat` are accepted, validated on every write.

Curriculum lives in `./curriculum/<subject>/config.json` — each one declares the world, companions, domains, concepts, and (optionally) a mastery spine. 17 subjects ship today: latin, mandarin, vietnamese, spanish, french, history, history-through-story, science, mathematics, social-emotional, financial-basics, inkwell, linux, a-plus, network-plus, security-plus, prompt-engineering.

## Architecture

```
magister/
├── server/              Fastify API on MAGISTER_PORT (default 18793)
│   ├── index.ts         Entry — boot DB, scan curriculum, mount routes
│   ├── db.ts            SQLite layer (better-sqlite3) — sessions, modules, progress, memory, creative
│   ├── curriculum.ts    Subject config scanner
│   ├── lib/             Helpers (paths, safety patterns)
│   └── routes/          HTTP handlers
├── curriculum/          Subject configs (gitted)
├── web/                 Next.js UI on port 3003 (extraction pending)
├── state/               Local DB + receipts + uploads (gitignored)
└── docs/
```

## Run

```bash
cp .env.example .env       # adjust if needed
npm install
npm run dev                # tsx watch
# or
npm run build && npm start
```

Listens on `MAGISTER_HOST:MAGISTER_PORT` (default `127.0.0.1:18793`).

## API

| Method | Path | Purpose |
|---|---|---|
| GET  | `/health` | Liveness + module count |
| GET  | `/magister/modules` | List subject modules |
| GET  | `/magister/modules/:id` | Module detail (companions, domains, spine) |
| POST | `/magister/modules/:id/install` | Mark module installed |
| GET  | `/magister/sessions` | List sessions (enriched w/ module + companion) |
| POST | `/magister/sessions` | Start a session — `{ module_id, companion_id?, concept_id?, ... }` |
| GET  | `/magister/sessions/:id` | Session detail |
| PATCH| `/magister/sessions/:id` | Patch session fields |
| POST | `/magister/sessions/:id/end` | End session, optionally with summary |
| POST | `/magister/sessions/:id/hint` | Record hint use — `{ level: 1\|2\|3 }` |
| POST | `/magister/sessions/:id/tick` | Advance session timer — `{ seconds }` |
| POST | `/magister/sessions/:id/chat` | Companion chat (LLM-backed) — *pending standalone LLM client* |
| GET  | `/magister/progress/:moduleId` | Concept mastery + exam readiness for the module |
| GET  | `/magister/reaffirmations` | Concepts due for spaced-repetition reaffirm |
| GET  | `/magister/memory/:companionId` | Companion's memories of the learner |
| POST | `/magister/memory/:companionId` | Schema-validated companion memory writeback |
| GET  | `/magister/creative/:moduleId` | Saved creative works for a module |
| POST | `/magister/creative/:moduleId` | Save creative work — `{ title, content }` |
| POST | `/magister/tts` | Local TTS via Piper — *pending standalone port* |
| POST | `/magister/tts/elevenlabs` | Cloud TTS w/ Piper fallback — *pending standalone port* |
| POST | `/magister/stt` | Local STT via whisper.cpp — *pending standalone port* |

## Architecture invariants

- **One session = one atom.** A session holds exactly one concept + objective + mastery signal. Switching topic = ending the session and starting another.
- **Shared progress table.** Campaign mode and study mode write to the same `magister_progress` table. Concept IDs must be mode-agnostic (no `campaign:` or `study:` prefixes) — mastery transfers between modes.
- **Mastery spine validation.** Modules with a `mastery_spine` reject session creation for concept IDs not on the spine. Modules without a spine accept any concept ID.
- **Companion memory writeback is schema-enforced.** Five fields, each with strict types, validated on every write. Unknown fields = rejection.
- **Spaced repetition is automatic.** `next_reaffirm` is recomputed every progress update from the new mastery level (`introduced=1d`, `practiced=3d`, `mastered=7d`, `reaffirmed=21d`).

## Status of the extraction

Migrated from `/mnt/ai/squidley-v2/modules/experiences/magister/` and the inline `/magister/*` routes in `apps/api/src/routes/chat.ts`. What's currently working in this standalone:

- DB layer ported (sessions, modules, progress, memory, creative, curriculum scanner).
- Modules / sessions / progress / memory / creative routes ported.
- Curriculum (17 subjects) moved.
- State DB migrated.

Pending:
- Companion chat endpoint — needs standalone LLM client (OpenRouter primary, Ollama fallback).
- Voice (Piper TTS, Whisper STT, ElevenLabs cloud TTS) — direct copy pending.
- Web UI — `apps/web/app/magister/page.tsx` (2,450 lines) → `web/` as standalone Next.js on port 3003.
- Squidley-side cutover — replace in-process service calls with HTTP to `MAGISTER_URL`.

## License

TBD — see `LICENSE` once added.
