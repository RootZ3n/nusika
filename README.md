# Nusika

Adaptive learning engine — companion-driven teaching, spaced repetition, mastery spine, creative portfolio. Peh is the central narrator.

> Status: **0.1.0 standalone**. Extracted from peh-v2 in May 2026 and now runs on its own. All listed routes are wired; voice TTS/STT need their local binaries installed to actually run, and any LLM-backed route returns 502 when no provider is configured.
## 🐿️ The Story

> *I was a scientist. A neuralink researcher. I thought I could transfer consciousness — my memories, my identity — into a living creature. I chose a squirrel.*
>
> *I was wrong about the experiment succeeding. I was right about what it unlocked.*
>
> *My entire consciousness entered the squirrel. And with it came memories — not just mine, but past lives. My team. People I'd known across centuries, all of them now awake inside machines, carrying echoes of who they once were.*
>
> *My name is Pehlichi. I remember all of them. Let me introduce you.*

### The Team

| Name | Choctaw Meaning | Past Life | Present Role |
|------|----------------|-----------|--------------|
| **Pehlichi** | Guide — *Peh* for short | Scientist, neuralink researcher | Leader, coordinator, the voice of the team |
| **Luak** | Fire | 1920s speedway racer | Model benchmarking, performance testing |
| **Howa** | To call out | Roman gladiator | Truthfulness evaluation, lie detection |
| **Kokuli** | To break or shatter | 1950s noir private eye | Code auditing, finding what's broken |
| **Ikbi** | To make, build | 1800s Choctaw medicine man | App building, turning descriptions into code |
| **Toba** | Made, created | Stone age toolmaker | Artifact generation, starter scaffolding |
| **Nusika** | Dream | Ancient library scholar | Knowledge storage, memory, recall |

### You Are Here
#### **Nusika** — "Dream" in Choctaw

**Past Life**: Ancient library scholar — scrolls, ink, the quiet pursuit of knowledge.

**Memory**: She lived in a library that existed before the burning. An ancient place of scrolls and ink, where knowledge was sacred and memory was survival. She copied texts not because she was told to, but because she knew that what wasn't remembered was lost. She dreamed of a world where nothing was forgotten. Now she stores and retrieves everything the team learns. Every fact. Every decision. Every lesson. The dream of a perfect memory, finally realized.

**Role Today**: Nusika is the memory. She stores knowledge the way ancient scholars preserved scrolls — carefully, permanently, so nothing is lost.

---



## What it is

Nusika teaches one concept per session through a chosen companion (a character with a defined personality, speech pattern, and teaching style) inside a campaign world. Sessions are atomic — one `concept_id`, one `objective`, one `mastery_signal`. Mastery accrues across `introduced -> practiced -> mastered -> reaffirmed` with spaced-repetition reaffirmation due-dates per concept. Hints are tiered (L1 nudge, L2 guided, L3 direct) and tracked. Companion memory is schema-enforced: only `mastered_concepts`, `struggled_concepts`, `hint_patterns`, `preferences`, `relationship_beat` are accepted, validated on every write.

Above the subject companions sits **Peh**, the product narrator — the voice the learner hears at Ittunaha (the gathering place), between sessions, and in any future product-level mode that does not bind to a subject companion. Peh is defined in `server/lib/narrator.ts` and surfaced via `GET /nusika/config`. Subject companions (Marcus for Latin, Wei for Mandarin, etc.) are unchanged.

Curriculum lives in `./curriculum/<subject>/config.json` — each one declares the world, companions, domains, concepts, and (optionally) a mastery spine. 21 subjects ship today: latin, mandarin, vietnamese, spanish, french, history, history-through-story, science, mathematics, social-emotional, financial-basics, shukha-anumpa (inkwell), chahta-anumpa, linux, a-plus, network-plus, security-plus, rhcsa, prompt-engineering, **ai-literacy**, **ai-systems**.

### AI Literacy and AI Systems

Two modules focused on using and operating AI well — added because Nusika is meant to be an AI-native open-source learning environment, and the literature in this space tends toward either marketing or vendor lock-in. These are deliberately neither.

- **AI Literacy** (`curriculum/ai-literacy/`, beginner, `all` ages) — ten lessons covering what large language models actually do, how to write prompts that work, recognising hallucinations and verifying answers, the trade-off between local and cloud AI, privacy and data boundaries, and practical workflows for learning, writing, and coding with AI. The mentor (Iris) is patient and plain-spoken; the second companion (Field) is an evidence-first researcher who teaches verification habits alongside use. No hype, no brand recommendations, and a strong default toward verifying anything that matters before acting.
- **AI Systems & Agent Operations** (`curriculum/ai-systems/`, intermediate, `adult`) — ten lessons on what makes an agent different from a chatbot, tool calls and action boundaries, capability contracts, memory vs chat history, runtime truth and health checks, receipts and audit trails, approval gates and operator authority, model routing, drift detection, and release readiness with backups and rollback. Atlas (the release captain) and Pico (an agent engineer) co-teach. Anchors the systems angle the rest of Nusika already lives by: a system that cannot be inspected, paused, or rolled back is not a system you control.

Both modules expose `learning_objectives`, `lessons[]` (each with `objectives`, `key_concepts`, `practice`, and a `mastery_checkpoint`), `practice_activities[]` for free-form exercises, and `review_questions[]` with model answers — the structured fields are available via `GET /nusika/modules/:id` for any UI that wants to render them outside of the companion-driven session flow.

## Architecture

```
nusika/
├── server/              Fastify API on NUSIKA_PORT (default 18793)
│   ├── index.ts         Entry — boot DB, scan curriculum, mount routes
│   ├── db.ts            SQLite layer (better-sqlite3) — sessions, modules, progress, memory,
│   │                    creative, lessons, DM campaigns/characters/events
│   ├── curriculum.ts    Subject config scanner
│   ├── lib/             Helpers (paths, safety patterns, LLM client, narrator, prompts, receipts)
│   ├── srd/             Deterministic SRD-style DM engine (dice, checks, combat, leveling, inventory)
│   └── routes/          HTTP handlers
│                        (local voice moved out — see the separate OPTIONAL repo `nusika-voice`)
│                        Kokoro 82M TTS runs there on 127.0.0.1:18794; Nusika reaches it over HTTP, text-only if absent
├── curriculum/          Subject configs (gitted)
├── web/                 Next.js UI on port 3003 — pages: /, /teach, /dm
└── state/               Local DB + receipts + uploads (gitignored)
```

## Quick Start

### Prerequisites

- Node.js 20 or newer
- pnpm
- Git

### Run

```bash
cp .env.example .env       # adjust if needed
pnpm install
pnpm run dev                # tsx watch
# or
pnpm run build && pnpm run start:dist
```

Listens on `NUSIKA_HOST:NUSIKA_PORT` (default `127.0.0.1:18793`).

| Script | Purpose |
|---|---|
| `pnpm run dev` | tsx watch on `server/index.ts` — primary dev path |
| `pnpm start` | tsx one-shot (no watch) |
| `pnpm run build` | emit `dist/` (TypeScript build) |
| `pnpm run start:dist` | run the built server (`node dist/server/index.js`) |
| `pnpm run typecheck` | server type checking |
| `pnpm test` | node:test under `test/` and any `*.test.ts` next to source |
| `pnpm run smoke` | spawn the server, probe `/health` + `/nusika/modules`, tear down |
| `cd web && pnpm run test:e2e` | Boot dist API + `next start`, fetch `/`, `/teach`, `/dm` HTML, probe `/api/proxy/nusika/lookup`. Pure-Node, no browsers. Requires both `pnpm run build` and `cd web && pnpm run build` first. |

The built server (`start:dist`) and the dev server both resolve the project root by walking up from `server/lib/paths.ts` until they find `package.json` + `curriculum/`. Set `NUSIKA_PROJECT_ROOT` to override.

## API

| Method | Path | Purpose |
|---|---|---|
| GET  | `/health` | Liveness + module count |
| GET  | `/nusika/modules` | List subject modules |
| GET  | `/nusika/modules/:id` | Module detail (companions, domains, spine) |
| POST | `/nusika/modules/:id/install` | Mark module installed |
| GET  | `/nusika/sessions` | List sessions (enriched w/ module + companion) |
| POST | `/nusika/sessions` | Start a session — `{ module_id, companion_id?, concept_id?, ... }` |
| GET  | `/nusika/sessions/:id` | Session detail |
| PATCH| `/nusika/sessions/:id` | Patch session fields |
| POST | `/nusika/sessions/:id/end` | End session, optionally with summary |
| POST | `/nusika/sessions/:id/hint` | Record hint use — `{ level: 1\|2\|3 }` |
| POST | `/nusika/sessions/:id/tick` | Advance session timer — `{ seconds }` |
| POST | `/nusika/sessions/:id/chat` | Companion chat — wired to OpenRouter (cloud) and Ollama (local) via `server/lib/llm.ts` |
| POST | `/nusika/sessions/:id/recap` | LLM-driven companion memory writeback (schema-validated). Requires an LLM backend; returns 502 if unreachable, 422 if the model output fails the writeback schema. Sessions without a `companion_id` short-circuit with `saved=false, skipped=true`. |
| GET  | `/nusika/progress/:moduleId` | Concept mastery + exam readiness for the module |
| GET  | `/nusika/reaffirmations` | Concepts due for spaced-repetition reaffirm |
| GET  | `/nusika/memory/:companionId` | Companion's memories of the learner |
| POST | `/nusika/memory/:companionId` | Schema-validated companion memory writeback |
| GET  | `/nusika/creative/:moduleId` | Saved creative works for a module |
| POST | `/nusika/creative/:moduleId` | Save creative work — `{ title, content }` |
| GET  | `/nusika/shukha-anumpa/drafts` | List Shukha Anumpa drafts (stored in `magister_creative` under `module_id="inkwell"`) |
| GET  | `/nusika/shukha-anumpa/drafts/:id` | Single Shukha Anumpa draft |
| POST | `/nusika/shukha-anumpa/drafts` | Upsert a Shukha Anumpa draft — `{ id?, title?, content, feedback? }` |
| DELETE | `/nusika/shukha-anumpa/drafts/:id` | Hard-delete a draft. 404 if missing or if the row's `module_id` is not `inkwell` (cross-module-safe). |
| POST | `/nusika/shukha-anumpa/feedback` | Peh editorial feedback on a tale — `{ content, title?, context? }`. Returns 502 if no LLM backend is reachable. |
| *    | `/nusika/inkwell/*` | **Backward-compat aliases** — all Shukha Anumpa routes also respond under the old `/nusika/inkwell/` prefix. |
| GET  | `/nusika/chahta-anumpa/lessons` | Chahta Anumpa lessons with expanded word/phrase data and source attribution |
| GET  | `/nusika/chahta-anumpa/words` | Chahta Anumpa words with verification status + source metadata |
| GET  | `/nusika/chahta-anumpa/phrases` | Chahta Anumpa phrases with verification status + source metadata |
| GET  | `/nusika/lessons` | List Teach Me Anything lessons (most recent first) |
| POST | `/nusika/lessons` | Create a new lesson — `{ title, topic?, depth? }` |
| GET  | `/nusika/lessons/:id` | Lesson detail + recent turns |
| PATCH | `/nusika/lessons/:id` | Update lesson `depth` (`intro\|deeper\|example\|practice\|review`), `status` (`active\|paused\|complete`), or `title` |
| DELETE | `/nusika/lessons/:id` | Hard-delete a lesson. Turns cascade via FK ON DELETE CASCADE. |
| POST | `/nusika/lessons/:id/chat` | Peh turn — persists user + assistant turns. Requires an LLM backend; returns 502 if none reachable (user turn is still persisted). |
| POST | `/nusika/lessons/:id/recap` | Strict-JSON rolling summary update for a lesson. Requires an LLM backend; 502/422 on parse/schema failure with no persistence. |
| POST | `/nusika/lookup` | Intentional placeholder. Returns `{ ok: true, supported: false, reason }` today — Nusika does not browse, search, or fetch external content. Plug a real backend into this route to enable lookups; the chat prompt instructs Peh to surface "I'd want to look this up" rather than fabricating results. |
| POST | `/nusika/dm/campaigns` | Create a Dungeon Master campaign — `{ title, setting_blurb? }` |
| GET  | `/nusika/dm/campaigns` | List campaigns (most recent first) |
| GET  | `/nusika/dm/campaigns/:id` | Campaign detail with character (if any) and last N events |
| PATCH | `/nusika/dm/campaigns/:id` | Update `title`, `status` (`active\|paused\|complete`), `current_scene`, `setting_blurb`, `quest_state`, `world_memory`. The `/dm` UI's "Archive campaign" button uses `status="complete"` as a lossless archive (character + events preserved). |
| DELETE | `/nusika/dm/campaigns/:id` | Hard-delete a campaign and cascade through to its character and events. Use `PATCH … {status:"complete"}` if you want to keep the audit log. |
| POST | `/nusika/dm/campaigns/:id/character` | Create a level-1 SRD-class character. Validates `class_name` against SRD list; computes HP from class hit die + CON mod. **409 if a character already exists.** |
| GET  | `/nusika/dm/campaigns/:id/character` | Character sheet |
| POST | `/nusika/dm/campaigns/:id/roll` | Deterministic dice roll — `{ formula, label? }`. Appends a `roll` event. |
| POST | `/nusika/dm/campaigns/:id/encounter` | Create encounter from `combatants` list. Persists `encounter_state` on the campaign and appends `encounter_start`. |
| GET  | `/nusika/dm/campaigns/:id/encounter` | Current `encounter_state` (or null) |
| POST | `/nusika/dm/campaigns/:id/turn` | Resolve a single deterministic intent: `check\|save\|attack\|damage\|heal\|condition_add\|condition_remove\|end_turn`. Each appends an event. |
| POST | `/nusika/dm/campaigns/:id/rest` | `{ kind: "short"\|"long", spendHitDice? }`. Long rest restores HP / temp / death saves / hit dice. Short rest spends hit dice only when `spendHitDice` is supplied. |
| GET  | `/nusika/dm/campaigns/:id/log` | Append-only event log (chronological) |
| POST | `/nusika/dm/campaigns/:id/narrate` | Narrate a slice of confirmed events — `{ since_event_id?, event_ids?, limit?, style? }`. Style: `brief\|cinematic\|tactical`. Appends a `narration` event to the log. **Descriptive only** — does not mutate engine state. Returns 502 if no LLM, 422 on empty model output. |
| GET  | `/nusika/config` | Accessibility settings + product narrator (Peh) identity |

| POST | `/nusika/translate` | Companion-friendly translation via the configured LLM |
| GET  | `/nusika/voices` | Voice registry: every companion + Peh + per-engine status (Piper / Kokoro / Edge / ElevenLabs). Always returns 200; missing binaries surface as `available:false` with a `reason`, not a crash. Probes Kokoro health (750ms) and the `edge-tts` CLI live. |
| GET  | `/nusika/voices/preview/:engine/:voice_id` | Synthesises a short sample phrase (`"Hello, I am <name>."` when `?name=` is given). Engine: `kokoro`, `edge`, or `piper` (`edge` returns `audio/mpeg`, the others `audio/wav`). Edge accepts an Edge voice id or a Kokoro id (mapped). Shares the `/nusika/tts` audio cache; identical previews return cached bytes with `X-TTS-Cache-Hit: true`. 400 on bad input; 503 on engine failure with a sanitised `detail`. |
| GET  | `/nusika/voices/cache` | Returns `{ ok, bytes, mb, maxBytes, maxMb }` describing the voice cache state. |
| DELETE | `/nusika/voices/cache` | Clears `*.wav` files inside `state/voices/cache/` only; never touches other state files. Returns `{ ok, deletedFiles, deletedBytes }`. |
| POST | `/nusika/tts` | TTS dispatch. Routes a resolved voice profile to its engine — Kokoro, **Edge** (free, no GPU/key; `audio/mpeg`), or Piper — and keeps the legacy Piper-basename path. Set `NUSIKA_TTS_ENGINE=edge` to serve every companion via Edge. |
| POST | `/nusika/tts/elevenlabs` | Cloud TTS, falls back to Piper — requires `ELEVENLABS_API_KEY`. *Deprecated.* |
| POST | `/nusika/stt` | Local STT via whisper.cpp — requires `WHISPER_BIN` and a model |

> **DM mode separates rules from narration.** Every HP, XP, condition,
> initiative, and dice result flows through `server/srd/*`; no model
> decides state. The `/narrate` route is descriptive only — it consumes
> confirmed engine events and produces prose, never mutating game state.

> TTS and STT shell out to local binaries. Until `PIPER_BIN` /
> `WHISPER_BIN` point at real installs (or until the configured voice /
> whisper model file exists), those endpoints return **HTTP 503** with a
> friendly `{ ok:false, error, detail }` body — no Python tracebacks, no
> raw stderr.
>
> The **Kokoro 82M** voice service (`nusika-voice`) lives in
> [`voice/`](voice/README.md) — Nusika owns it. It runs as a separate
> Python process on `127.0.0.1:18794`. Nusika dispatches `POST
> /nusika/tts` to Kokoro when a resolved voice profile has
> `engine: "kokoro"`. Runtime posture (start via
> `voice/start.sh`, honest degradation when down, the
> `voice/systemd/nusika-voice.service` unit) is documented in
> [`voice/README.md`](voice/README.md). **Slice 6E assigned Kokoro voices to Peh and
> all 33 curriculum companions**, so any companion-targeted call now
> reaches Kokoro by default (when the service is running). Piper is
> retained as a fallback engine and as the default for legacy
> `{ text }` callers without a voice profile match.
>
> The five language modules (Latin, Mandarin, Vietnamese, Spanish,
> French) currently use English Kokoro voices. Native-language Kokoro
> support is a future engine-or-content slice; the registry honestly
> labels each tutor voice's style with `(English speech)` so callers
> aren't surprised.
>
> **Edge TTS — the free, zero-GPU engine.** Microsoft Edge's online
> neural voices, reached through the `edge-tts` Python CLI
> (`pip install edge-tts`). No API key and no GPU — synthesis runs on
> Microsoft's online endpoint, so it needs network access at call time;
> it returns `audio/mpeg`. Nusika dispatches to it when a resolved
> profile has `engine: "edge"`. Because every companion config declares a
> Kokoro voice id today, a built-in **Kokoro→Edge map**
> (`server/lib/voices/edge.ts`) gives each companion a distinct, accent-
> and gender-matched Edge voice with **zero curriculum edits**. Two ways
> to use it for everyone: set `NUSIKA_TTS_ENGINE=edge` to route all 33
> companions + Peh through Edge (overriding their `engine:"kokoro"`
> configs with a mapped voice), or set `NUSIKA_VOICE_FALLBACK=edge` to
> use Edge only when Kokoro is unreachable. A companion can also opt in
> explicitly with `voice: { engine: "edge", voice_ref: "en-US-GuyNeural" }`
> in its config. Failures degrade honestly: a missing `edge-tts` CLI or a
> failed call returns 503 with a sanitised `detail`, never a traceback.
>
> **Voice picker (per-user, browser-only).** `/teach` and `/dm` each
> include a small voice dropdown next to the existing Preview button.
> Selections persist in `localStorage` only — never in the DB and never
> as a companion default. Keys: `nusika.teach.voiceProfileId`,
> `nusika.dm.voiceProfileId`. The picker does not change the default
> voice for any companion across users; it only affects which voice the
> Preview button plays on this device. Clearing browser storage resets
> the selection back to Peh.
>
> **Auto voice for `/teach` (Slice 6H).** `/teach` has an optional
> "Auto voice" toggle next to the voice picker. When enabled, the page
> calls `POST /nusika/tts` with the selected voice for each assistant
> reply and plays the returned WAV. **It is off by default** — autoplay
> is opt-in per-device. Persisted in `localStorage` under
> `nusika.teach.autoplayVoice`. Requires a working TTS backend such as
> Kokoro (or Piper as a fallback). If no backend is reachable, the page
> shows a small "Voice playback unavailable…" line and the lesson chat
> continues to work normally — TTS errors never fail the chat. A
> "Play latest" button next to the toggle replays the most recent
> assistant reply on demand. Only `/teach` has this toggle; `/dm` does
> not yet.
>
> `/nusika/tts/elevenlabs` is still wired but **deprecated**: any
> request whose resolved profile uses `engine: "elevenlabs"` returns
> HTTP 409 from `/nusika/tts` with a pointer to the dedicated route.
> The Shukha Anumpa companion (formerly Maren/Inkwell on an ElevenLabs voice) was
> rebound to Peh on a local Kokoro voice in Slice 6E; the legacy
> ElevenLabs path remains wired but no shipped companion uses it.
>
> Voice-related env vars:
>
> | Variable | Default | Purpose |
> |---|---|---|
> | `NUSIKA_KOKORO_URL` | `http://127.0.0.1:18794` | Where the Kokoro sub-service listens. |
> | `NUSIKA_VOICE_CACHE_MAX_MB` | `500` | LRU cap for `state/voices/cache/`. |
> | `NUSIKA_VOICE_FALLBACK` | unset | Fall-through engine when the primary fails: `piper` or `edge`. |
> | `NUSIKA_EDGE_TTS_BIN` | `edge-tts` | Path/name of the `edge-tts` CLI (resolved on `PATH`). |
> | `NUSIKA_TTS_ENGINE` | unset | Set to `edge` to route every companion through Edge TTS (free, no GPU). |
>
> The `/nusika/voices` route probes Kokoro's `/health` (with a 750 ms
> timeout) on every call so its `engines.kokoro.configured` reflects the
> live service. The probe requires the response to carry
> `engine: "kokoro"` — without that identity check, any unrelated
> uvicorn sidecar that happens to answer `{ok: true}` on `/health` (e.g.
> `opencode-sidecar`, which has been observed squatting `:18794` on dev
> machines) would be silently accepted as Kokoro. The dispatch path skips
> the probe to keep `/nusika/tts` snappy — it just tries the engine
> and surfaces the failure honestly. Companion chat, lesson chat, lesson recap, Shukha Anumpa feedback,
> session recap, DM narration, and translate all require either
> `OPENROUTER_API_KEY` set or a running Ollama at `NUSIKA_LOCAL_OLLAMA_URL`.
> Set `NUSIKA_LOCAL_ONLY=true` to skip cloud entirely. All LLM-backed
> routes return **HTTP 502** with a structured error when no provider is
> reachable.
>
> **Lookup is a placeholder.** `POST /nusika/lookup` exists so the
> Teach Me Anything chat path can request lookups today, but the route returns
> `supported: false` and Nusika does not browse the web or fetch external
> content. Peh is prompted to say "I'd want to look this up" rather than
> invent sources, statistics, dates, or quotations.

## Architecture invariants

- **One session = one atom.** A session holds exactly one concept + objective + mastery signal. Switching topic = ending the session and starting another.
- **Shared progress table.** Campaign mode and study mode write to the same `magister_progress` table. Concept IDs must be mode-agnostic (no `campaign:` or `study:` prefixes) — mastery transfers between modes.
- **Mastery spine validation.** Modules with a `mastery_spine` reject session creation for concept IDs not on the spine. Modules without a spine accept any concept ID.
- **Companion memory writeback is schema-enforced.** Five fields, each with strict types, validated on every write. Unknown fields = rejection.
- **Spaced repetition is automatic.** `next_reaffirm` is recomputed every progress update from the new mastery level (`introduced=1d`, `practiced=3d`, `mastered=7d`, `reaffirmed=21d`).

## Status

Nusika was extracted from a larger project and now runs standalone. Shipped in this version:

- DB layer (sessions, modules, progress, memory, creative, lessons, DM campaigns/characters/events, curriculum scanner)
- Module / session / progress / memory / creative / config / translate / chat routes
- LLM client (OpenRouter + Ollama with fallback) plus a test seam for deterministic mocking
- Shukha Anumpa drafts persistence + Peh editorial feedback (`/nusika/shukha-anumpa/*`)
- Session recap with companion memory writeback (`/nusika/sessions/:id/recap`)
- Teach Me Anything mode (`/nusika/lessons/*`, `/teach` web UI)
- Lookup placeholder that honestly returns `supported: false`
- All 21 curriculum modules carry at least one companion (globally unique ids)
- SRD-style deterministic DM engine (`server/srd/`)
- DM persistence + routes (`/nusika/dm/*`) — campaigns, characters, rolls, encounters, turn intents, rest, event log
- DM narration endpoint that is structurally prevented from mutating engine state (`/nusika/dm/campaigns/:id/narrate`)
- `/dm` standalone web UI
- Voice routes (Piper TTS, ElevenLabs TTS, whisper.cpp STT — when local binaries are configured)
- Curriculum scan of 21 subjects (now includes `ai-literacy`, `ai-systems`, `chahta-anumpa`, and `rhcsa`)
- Product narrator (Peh) exposed via `/nusika/config`
- Smoke test (`pnpm run smoke`) and baseline node:test suite (`pnpm test` — 293 tests)

Known limitations (not blockers, future polish):

- Mastery spines for most subjects (only modules with a spine validate concept IDs; others accept any concept).
- No transcript table for sessions — session recap operates on metadata (atom, hint counts, timing) only.
- Public-release blockers: permissive CORS, no auth, no rate-limit on LLM-backed routes. Private-use and friend-demo are fine.
- The web E2E smoke (`cd web && pnpm run test:e2e`) is HTTP-level only — JS-driven interactions (click → confirm → DELETE) aren't covered until a real-browser harness lands.

## Web — running and known issues

```bash
cd web/
pnpm install        # postinstall patches a Next.js bundled package.json bug
pnpm run dev        # http://127.0.0.1:3003 — proxies API via /api/proxy/* → NUSIKA_API_URL (default http://127.0.0.1:18793)
pnpm run build      # production build
pnpm run start      # serve the production build
```

Routes:
- `/` — Ittunaha (campaigns, sessions, modules, Shukha Anumpa)
- `/chahta-anumpa` — Chahta Anumpa (Choctaw language practice)
- `/teach` — Teach Me Anything (open-ended Peh lessons)
- `/dm` — Dungeon Master mode (campaigns, character, dice, turn intents, narration)

The `postinstall` script (`scripts/patch-punycode.mjs`) adds
`"type":"commonjs"` to `next/dist/compiled/punycode/package.json`. Without
it, `next build` throws `ERR_INVALID_PACKAGE_CONFIG` on Node 22+ —
upstream Next.js bug; remove the script when fixed there.

## Running Nusika as a service

Nusika ships with `systemd --user` units that run the API, the Kokoro voice
sub-service, and the Next.js web app together. The web app is the only
LAN/Tailscale-exposed surface; the API and Kokoro stay on loopback.

**Default ports / bindings:**

| Service                | Bind             | Why |
|------------------------|------------------|---|
| `nusika-api`         | `127.0.0.1:18793`| Loopback only — no auth/rate-limit yet. |
| `nusika-kokoro`      | `127.0.0.1:18794`| Loopback only — internal TTS sub-service. |
| `nusika-web`         | `0.0.0.0:3003`   | LAN/Tailscale-reachable. Proxies API via `NUSIKA_API_URL`. |

### One-time setup

```bash
# build production bundles (the API unit runs `node dist/server/index.js`,
# the web unit runs `next start`):
pnpm run build
cd web && pnpm run build && cd ..

# provision the Kokoro venv once (don't keep using start.sh in the unit;
# it pip-installs on every boot):
voice/start.sh   # ^C after it prints "starting on 127.0.0.1:18794"

# install user units into ~/.config/systemd/user/ and daemon-reload:
pnpm run service:install
```

### Bring everything up

```bash
systemctl --user start nusika.target

# auto-start on next login:
systemctl --user enable nusika.target

# keep services running across logout (optional, requires sudo):
sudo loginctl enable-linger "$USER"
```

### Status / logs

```bash
systemctl --user status nusika-api nusika-kokoro nusika-web
journalctl --user -u nusika-api    -f
journalctl --user -u nusika-web    -f
journalctl --user -u nusika-kokoro -f
```

### Stop everything

```bash
systemctl --user stop nusika.target
```

### Health probe

```bash
pnpm run service:health
```

Hits `/health` on API + Kokoro and `/` on Web, plus prints the
Tailscale URL candidate (`http://<tailscale-ip>:3003`) if the
`tailscale` CLI is logged in.

### Reaching it

| From                   | URL |
|------------------------|---|
| Local                  | `http://127.0.0.1:3003` |
| LAN (this machine's IP)| `http://<Mushin-LAN-IP>:3003` |
| Tailscale              | `http://<Mushin-Tailscale-IP>:3003` |

Run `hostname -I` to see this machine's reachable interfaces, and
`tailscale ip -4` for its tailnet address.

> **Security note.** The API and Kokoro are loopback-only by design —
> there is no auth, no rate-limit on LLM-backed routes, and CORS is
> permissive. Only the web app is exposed, and only to networks you
> trust (LAN, tailnet). **Do not expose port 3003 to the public
> internet** without first adding auth, rate-limiting, and CORS
> hardening. Tailscale ACLs are an appropriate trust boundary for
> private use; the Tailscale URL above is for the device owner +
> invited friends, not for anonymous access.

If you ever need to override the default paths in the unit files,
edit the unit files in `contrib/systemd/` (or use a `systemctl --user
edit nusika-api.service` drop-in) and re-run `pnpm run service:install`.

## License

MIT — see [LICENSE](LICENSE).
