# Nusika

Nusika is the **teaching engine** of the Pehverse lab — Jeffrey Miller's multi-agent
AI development ecosystem. It is an adaptive, companion-driven learning engine: each
session teaches one concept through a character companion (with a defined personality,
speech pattern, and teaching style) inside a campaign world, tracking mastery via
spaced repetition. Above the subject companions sits **Peh**, the product narrator.
It ships 21+ curriculum modules (Latin, Mandarin, Linux, RHCSA, AI literacy, etc.),
a Teach Me Anything open-lesson mode, a deterministic SRD-style Dungeon Master engine,
quizzes/review questions per module, and optional local voice (TTS/STT). It was
extracted from `peh-v2` to standalone in May 2026 and is consumed by Peh over HTTP.

The engine is a Fastify API (TypeScript, ESM, Node >=20) backed by SQLite. A separate
Next.js web UI lives in `web/`. Local voice (Python Kokoro TTS) is an **optional,
separate repo** (`nusika-voice`, sibling of this one) that runs on 127.0.0.1:18794;
Nusika reaches it over HTTP and degrades to text-only when it is absent.

## Build / Test / Dev commands

Use **pnpm**. Scripts (from `package.json`):

| Command | Purpose |
|---|---|
| `pnpm run dev` | `tsx watch` on `server/index.ts` — primary dev path |
| `pnpm start` | `tsx` one-shot run (no watch) |
| `pnpm run build` | `rm -rf dist && tsc -p tsconfig.build.json` — emit `dist/` |
| `pnpm run start:dist` | run built server (`node dist/server/index.js`) |
| `pnpm run typecheck` | `tsc -p tsconfig.json --noEmit` |
| `pnpm test` | `tsx --test test/**/*.test.ts server/**/*.test.ts` (node:test) |
| `pnpm run smoke` | spawn server, probe `/health` + `/nusika/modules`, tear down |
| `pnpm run service:install` | install `systemd --user` units |
| `pnpm run service:health` | health-probe API + Kokoro + Web |

Server listens on `NUSIKA_HOST:NUSIKA_PORT` (default `127.0.0.1:18793`). It refuses
to bind a non-loopback host unless `NUSIKA_ALLOW_PUBLIC_BIND=true` (no auth/rate-limit yet).

**Web UI** (separate package, runs on port 3003):
```
cd web && pnpm install && pnpm run dev   # proxies API via /api/proxy/* → NUSIKA_API_URL
```
Web has its own `pnpm run test:e2e` (HTTP-level; requires both `pnpm run build` and `cd web && pnpm run build`).

## Key conventions

- **TypeScript, ESM, strict.** `tsconfig.json` enables `strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`,
  `isolatedModules`. Module mode is `NodeNext`/ES2022.
- **Relative imports use the `.js` extension** (NodeNext ESM), e.g. `import { NusikaDB } from "./db.js"`.
- **Tests use `node:test` + `node:assert/strict`**, run through `tsx --test`. No Jest/Vitest.
  Files are `*.test.ts` under `test/` (and may live next to source under `server/`).
  Tests resolve paths relative to `import.meta.url`. ~293 tests baseline.
- **Env reads go through `server/lib/env.ts` (`nenv`)**, which honors a `NUSIKA_*` prefix
  with `MAGISTER_*` legacy fallbacks. Do not read `process.env` directly elsewhere.
- **No model decides game/engine state.** DM rules flow only through `server/srd/*`;
  the `/narrate` route is descriptive-only and never mutates state.
- **Companion memory writeback is schema-enforced** — only five fields accepted
  (`mastered_concepts`, `struggled_concepts`, `hint_patterns`, `preferences`,
  `relationship_beat`), validated on every write; unknown fields rejected.
- **LLM-backed routes degrade honestly** — return HTTP 502 (structured error) when no
  provider is reachable; voice routes return 503 when local binaries are missing.
  Never leak tracebacks/raw stderr.
- **Source code is not modified for docs.** Curriculum lives as data in
  `curriculum/<subject>/config.json`, not code.

## Architecture notes

```
server/                Fastify API (entry: server/index.ts — boots DB, scans curriculum, mounts routes)
  db.ts                SQLite layer (better-sqlite3): sessions, modules, progress, memory,
                       creative, lessons, DM campaigns/characters/events
  curriculum.ts        Scans curriculum/<subject>/config.json into registered modules
  lib/                 Helpers: paths, env (nenv), log, llm (OpenRouter + Ollama client),
                       narrator (Peh identity), *-prompt builders, receipts, voice-registry,
                       voice-cache, safe-serve-file
  srd/                 Deterministic SRD DM engine: dice, checks, combat, leveling, inventory, types
  routes/              HTTP handlers (registered via routes/index.ts): health, modules, sessions,
                       chat, recap, progress, memory, creative, lessons, config, voices/voice,
                       dm, dm-narration, chahta-anumpa, inkwell
curriculum/            Subject configs (data, gitted) — 21+ modules incl. rhcsa, linux, ai-literacy
web/                   Next.js 3003 UI — routes: / (Ittunaha), /teach, /dm, /chahta-anumpa
(voice)                Local Kokoro 82M TTS is the separate optional `nusika-voice` repo (127.0.0.1:18794; not required)
scripts/               smoke.mjs, install-systemd.mjs, nusika-health.mjs
contrib/systemd/       systemd --user unit files
state/                 Local DB + receipts + uploads + voice cache (gitignored)
test/                  node:test suite
```

**Core domain model / invariants:**
- **One session = one atom**: exactly one `concept_id` + `objective` + `mastery_signal`.
  Switching topic means ending and starting a new session.
- **Mastery progression**: `introduced → practiced → mastered → reaffirmed`, with
  spaced-repetition `next_reaffirm` recomputed on every progress update
  (introduced=1d, practiced=3d, mastered=7d, reaffirmed=21d).
- **Shared progress table** (`magister_progress`): campaign and study modes share it;
  concept IDs must be mode-agnostic so mastery transfers between modes.
- **Mastery spine**: modules declaring a `mastery_spine` reject session creation for
  off-spine concept IDs; modules without a spine accept any concept.
- **Tiered hints**: L1 nudge / L2 guided / L3 direct, tracked per session.
- **Modules** expose `learning_objectives`, `lessons[]` (each with `objectives`,
  `key_concepts`, `practice`, `mastery_checkpoint`), `practice_activities[]`, and
  `review_questions[]` (quizzes with model answers) via `GET /nusika/modules/:id`.

**LLM / voice backends** (optional; routes return 502/503 if unconfigured):
- LLM: OpenRouter (cloud, `OPENROUTER_API_KEY`) or Ollama (local,
  `NUSIKA_LOCAL_OLLAMA_URL`); `NUSIKA_LOCAL_ONLY=true` skips cloud.
- TTS/STT: Piper / Kokoro / ElevenLabs (deprecated) for TTS; whisper.cpp for STT —
  all require local binaries / model files configured via env.

See `README.md` for the full route table, env-var reference, and systemd service setup.
