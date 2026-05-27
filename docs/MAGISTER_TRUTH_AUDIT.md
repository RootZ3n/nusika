# Magister — Full Truth Audit

> **Audit date:** 2026-05-26
> **Repo:** `/mnt/ai/magister`, branch `main`
> **Methodology:** read-only inspection of source + live probes against the
> running API (`127.0.0.1:18793`), Kokoro port (`127.0.0.1:18794`), curriculum
> configs, SQLite state, systemd units, and the documented contracts in
> `README.md`, `docs/AI-MODULES.md`, `docs/VOICEBOX-AUDIT.md`,
> `docs/CONTINUE_WITHOUT_CLAUDE.md`, and `MAGISTER-HERMES-AUDIT-2026-05-21.md`.

---

## Phase 1 status (added 2026-05-27)

The audit's Phase 1 (mechanical truth + baseline stability) is **complete**.
The hard blockers listed in §10 below have been closed:

- **#1 db migration drop of `tier` / `lab_only` — CLOSED**
  (`docs/MAGISTER_PHASE1_DB_FIX.md`, commit `c964233`).
- **#2 TS2352 production-build error — CLOSED**
  (`docs/MAGISTER_PHASE1_BUILD_FIX.md`, commit `d06ceda`).
- **#5 untracked systemd unit files in `contrib/systemd/`** — still
  uncommitted in the working tree at audit time; status unchanged by
  this verification pass.

Two related truth fixes landed in the same Phase 1 window:

- **Maren → Varros identity cleanup**
  (`docs/MAGISTER_PHASE2_VOICE_IDENTITY_CLEANUP.md`, commit `ef84fa3`)
  — closes the last stale assertion from the db-fix run and removes
  the stale Maren prompt + flavor-text mismatches the audit flagged in
  §3 and §6. (The "Phase 2" in that filename refers to its position
  inside the Phase 1 baseline batch, **not** the audit's Phase 2 voice-
  truth slice — see `docs/MAGISTER_PHASE1_VERIFICATION.md` for the
  mapping.)
- **opencode-sidecar parked + Kokoro health probe identity-checked**
  (`docs/MAGISTER_OPENCODE_SIDECAR_PARKING.md`, commit `b6bb029`) —
  closes the §4 "Kokoro misreported" finding and lands the first item
  of the audit's Phase 2 (voice truth) plan.

Validation snapshot at the close of Phase 1:

```
$ npm run typecheck   # clean
$ npm run build       # clean
$ npm test            # 252 / 252 passing
```

What is **still not done** at the close of Phase 1 (carried into Phase 2
and beyond, no claims being made here that they work):

- Voice TTS has **not been runtime-verified** end to end. The Kokoro
  health probe now rejects squatters honestly, but actual synthesis +
  playback against a running Kokoro process was not exercised. The
  audit's §4 findings about the Hall path sending `role` (server reads
  `voice`/`scope`) and about Piper having only one voice file remain
  open.
- **No real story / RPG campaigns exist.** The `/dm` surface is still
  a generic SRD combat engine with no curriculum tie-in; no campaign
  generator, no chapter system, no cross-session world state writer.
- **Curriculum depth is still skeletal** outside `ai-literacy` and
  `ai-systems`. The other 17 modules still ship companion personality
  + a domain concept list, not the full lesson structure those two
  modules carry.
- Auth, rate-limit, CORS hardening, README pluralization fixes, and
  the rest of the §10 "soft blockers" are open.

The Phase 1 work landed mechanical baseline only: green tests, green
build, honest voice detection, no identity drift. The product-quality
work begins in Phase 2.

---

## 1. Executive summary

Magister is a real, runnable Fastify + SQLite + Next.js system with a clear
architecture, an honest provider abstraction, and a curriculum scanner that
actually does load 19 module configs. The bones are good.

The product, as currently shipped, is **not coherent or shippable**. A handful
of small lies between docs, code, and runtime add up to a system that claims
features it does not deliver:

- **Tests are red.** `npm test` reports `pass 183 / fail 58 / total 241`. All
  58 failures trace back to a single SQLite migration bug in `server/db.ts`
  that silently drops the `tier` and `lab_only` columns when the
  `age_track` CHECK constraint is upgraded to include `kids`/`all`/`any` on
  first run.
- **Production build is broken.** `npm run build` fails with a TS2352 error
  in `server/routes/modules.ts:51`.
- **Voice is misreported.** Kokoro is **not running** on port 18794 (an
  `opencode-sidecar` uvicorn process is squatting it). The voice registry
  health probe only checks for `body.ok === true`, so it accepts the
  sidecar's response and reports Kokoro as "configured: true". Actual
  generation calls fail 503 with "HTTP 404: Not Found".
- **Main-screen TTS is wired wrong.** `web/app/hooks/useVoicePlayback.ts`
  posts `{ text, role }` to `/magister/tts`, but the server expects
  `{ text, voice, scope }`. `role` is silently ignored — so every chat reply
  on `/` plays the default Piper voice (`en_GB-alba-medium`) regardless of
  which companion "speaks". `/teach` and `/dm` do it correctly via separate
  hooks; only the original Hall path has the bug.
- **Curriculum content is mostly skeletal.** Of 19 modules, only
  `ai-literacy` and `ai-systems` have structured `lessons[]`,
  `practice_activities[]`, and `review_questions[]`. The other 17 are
  companion personality + a domain concept list. There is no module-by-
  module teaching arc yet for the language, history, mathematics, or IT
  cert subjects.
- **No story / RPG campaigns exist.** The `/dm` surface is a deterministic
  D&D-style combat engine. There is no narrative campaign generator and no
  cross-session story state beyond `current_scene` + `world_memory` JSON
  blobs that no code actually writes.
- **systemd units are partially installed.** `magister-kokoro.service`
  exists (inactive). `magister-api.service` and `magister-web.service` are
  **not registered** under `systemctl --user`. Two new system-level unit
  files exist as untracked working-tree files but are not committed.
- **README contradicts itself.** Counts the modules as 17 in one paragraph
  and 19 in another; the LICENSE line says "TBD" but a LICENSE (MIT) is
  already in the repo; the "241 tests" line is stated as if green.

The remediation effort is small in absolute terms (most blockers are one-
to-three-file fixes) but visible everywhere. The audit recommends a five-
phase staged repair plan in §10 below.

---

## 2. Current architecture map

```
magister/
├── server/                       Fastify on MAGISTER_PORT (default 18793, loopback only)
│   ├── index.ts                  Boot DB, scan curriculum, mount routes
│   ├── db.ts                     1,784-line SQLite layer (better-sqlite3); 10 tables
│   ├── curriculum.ts             Walks ./curriculum/<id>/config.json, upserts modules
│   ├── lib/
│   │   ├── llm.ts                OpenRouter (primary) + Ollama (fallback) client
│   │   ├── narrator.ts           Hardcoded Varros identity + Kokoro voice binding
│   │   ├── companion-prompt.ts   System prompt builder for subject companions
│   │   ├── varros-prompt.ts      System prompt builder for Teach Me Anything
│   │   ├── dm-narration-prompt.ts DM narration prompt (descriptive-only)
│   │   ├── voice-registry.ts     Per-companion voice profile resolver + engine probes
│   │   ├── voice-cache.ts        Content-addressed WAV cache at state/voices/cache/
│   │   ├── voices/kokoro.ts      Kokoro HTTP client + KOKORO_VOICE_IDS allowlist
│   │   ├── receipts.ts           JSONL receipt writer (state/receipts/<date>.jsonl)
│   │   ├── paths.ts              Project-root + state + curriculum resolution
│   │   └── log.ts                Console logger
│   ├── routes/
│   │   ├── health.ts             /health, /magister/health, /magister/health/services
│   │   ├── modules.ts            /magister/modules, /magister/modules/:id, .../install
│   │   ├── sessions.ts           CRUD + tick + hint + end + delete
│   │   ├── progress.ts           Concept mastery + spaced-repetition due dates
│   │   ├── memory.ts             Schema-enforced companion memory writeback
│   │   ├── creative.ts           Saved creative works per module
│   │   ├── config.ts             /magister/config, /magister/settings/accessibility, /magister/translate
│   │   ├── chat.ts               Companion turn — wires through LLM client
│   │   ├── voice.ts              /magister/tts (Piper/Kokoro/ElevenLabs dispatch) + /stt
│   │   ├── voices.ts             /magister/voices registry + /preview + /cache
│   │   ├── inkwell.ts            Drafts CRUD + Maren feedback (LLM-backed)
│   │   ├── recap.ts              LLM-driven companion memory writeback (strict JSON)
│   │   ├── lessons.ts            Teach Me Anything — open-ended Varros lessons
│   │   ├── dm.ts                 DM campaigns / characters / rolls / turn intents / rest
│   │   └── dm-narration.ts       Descriptive narration of confirmed engine events
│   └── srd/                      Deterministic SRD engine (dice, checks, combat, leveling, inventory)
├── voices/kokoro/                Optional local Kokoro 82M voice sub-service (Python uvicorn)
├── curriculum/                   19 subject modules; one config.json each
├── web/                          Next.js 14.2.35 on 3003 — proxies /api/proxy/* → MAGISTER_API_URL
│   └── app/
│       ├── page.tsx              Hall + Session + Map + Advanced + Inkwell orchestration
│       ├── components/           HallView, SessionView, MapView, AdvancedView, InkwellView, ...
│       ├── hooks/                useMagisterApi, useSessionTimer, useVoicePlayback
│       ├── dm/                   /dm — page + components + useDmApi + useDmVoice
│       └── teach/                /teach — page + components + useTeachApi + useTeachVoice
├── state/                        SQLite DB + receipts + uploads + voice cache
├── scripts/                      smoke.mjs, install-systemd.mjs, magister-health.mjs
├── contrib/systemd/              User units + system units; system units are untracked
└── test/                         tsx --test suite, 241 tests
```

**Service ports (live):**

| Service           | Bind                | Status as of audit                                       |
|-------------------|---------------------|----------------------------------------------------------|
| `magister-api`    | `127.0.0.1:18793`   | running, healthy (`/health` ok, 19 modules, 17 installed)|
| `magister-kokoro` | `127.0.0.1:18794`   | **NOT running** — port held by `opencode-sidecar` uvicorn|
| `magister-web`    | `0.0.0.0:3003`      | presumed up (not probed in this audit)                   |

---

## 3. Feature truth table

Status legend: **IMPLEMENTED** (works end-to-end), **PARTIAL** (works but with
caveats or missing surfaces), **STUBBED** (placeholder route/data),
**UNTESTED** (no automated verification or manual confirmation),
**BROKEN** (currently fails), **DOC-ONLY** (claimed in docs but not real).

| Feature                                          | Status        | Evidence / caveat |
|--------------------------------------------------|---------------|-------------------|
| Fastify API boot, CORS, multipart, loopback bind | IMPLEMENTED   | `server/index.ts`; smoke passes |
| SQLite layer (10 tables, indices, FKs)           | IMPLEMENTED   | `server/db.ts`; live DB inspected |
| Curriculum scanner (config.json → modules table) | IMPLEMENTED   | 19 modules registered in live DB |
| Health endpoints (`/health`, `/magister/health`, `/magister/health/services`) | IMPLEMENTED | Composite probe reports DB/LLM/Kokoro |
| Mastery spine validation                          | PARTIAL       | No curriculum module ships a `mastery_spine` JSON object today, so all modules accept any concept_id |
| OpenRouter LLM client + Ollama fallback           | IMPLEMENTED   | `.env` has live `OPENROUTER_API_KEY`; tested in unit tests |
| Companion chat (`/magister/sessions/:id/chat`)    | IMPLEMENTED   | Wired through LLM client; identity-locked system prompt |
| Companion memory schema + writeback (`/recap`)    | IMPLEMENTED   | Strict-JSON, schema-validated, 502/422 contracts honored |
| Spaced repetition reaffirmation                   | IMPLEMENTED   | `db.ts` recomputes `next_reaffirm` on every progress update |
| Teach Me Anything (`/teach` + `/magister/lessons/*`) | IMPLEMENTED | Varros prompt, depth-aware, lookup-contract honest |
| Lookup endpoint (`/magister/lookup`)              | STUBBED       | Returns `{ok: true, supported: false, reason: ...}` by design |
| Inkwell drafts (CRUD + Maren feedback)            | IMPLEMENTED   | Persisted via `magister_creative`; feedback returns 502 without LLM |
| DM mode — campaigns, characters, dice, encounters, turn intents, rest | IMPLEMENTED | Server-side SRD engine; `/dm` UI; 0 campaigns in live DB |
| DM narration (descriptive-only)                   | IMPLEMENTED   | `/magister/dm/campaigns/:id/narrate` |
| Translate (`/magister/translate`)                 | IMPLEMENTED   | LLM-backed; 502 contract honored |
| Voice registry (`/magister/voices`)               | PARTIAL       | Returns 31 voices, but **misreports Kokoro engine status** — see §4 |
| Voice preview (`/magister/voices/preview/...`)    | PARTIAL       | Works only for engines that are actually up |
| TTS dispatch (`/magister/tts`, Piper/Kokoro/EL)   | PARTIAL       | Piper installed; only `en_GB-alba-medium` voice file present. Kokoro not running. ElevenLabs deprecated. |
| Main `/` TTS plays correct companion voice        | BROKEN        | `useVoicePlayback.ts` sends `role` field; server expects `voice`/`scope` → falls through to default Piper voice |
| `/teach` and `/dm` voice pickers                  | IMPLEMENTED   | Persist to localStorage; correctly pass `scope` to server |
| Auto-voice toggle on `/teach`                     | IMPLEMENTED   | Off by default, persisted, errors don't fail chat |
| STT (`/magister/stt`, whisper.cpp)                | UNTESTED      | Whisper bin + model present locally; no end-to-end check in this audit |
| Curriculum: 19 modules registered                 | IMPLEMENTED   | All scan and serve; 17 marked `installed=1`, 2 are `installed=0` (`financial-basics`, `social-emotional`) |
| Curriculum: structured lessons / practice / review | PARTIAL      | **Only `ai-literacy` and `ai-systems`** have full lesson structures. Other 17 modules carry domain concept strings only. |
| Curriculum: story-campaign content                | DOC-ONLY      | README hints at "campaign worlds" but no procedural arc, no chapter system, no quest-tree |
| Varros narrator identity                          | IMPLEMENTED   | Hardcoded in `server/lib/narrator.ts`; surfaced via `/magister/config` |
| Accessibility settings (`/magister/config`, settings.json) | IMPLEMENTED | Loads/saves under `state/magister-product/session-settings.json` |
| Web Hall / Session / Map / Advanced / Inkwell     | PARTIAL       | All render; functional manually but no e2e coverage of click paths |
| Comfort drawer (narration toggle, dyslexic font, wide spacing, ambient volume, pacing) | UNTESTED | Wired in UI; no automated tests touch these |
| Telex Vietnamese input                            | IMPLEMENTED   | `applyTelex()` in `web/app/types.ts`; toggle in Session + Practice |
| Web proxy (`/api/proxy/*` → API)                  | IMPLEMENTED   | E2E smoke probes proxy path |
| systemd `--user` units (magister-api, web, kokoro, target) | PARTIAL | Files in `contrib/systemd/`; only `magister-kokoro.service` is registered live, and it's inactive. `magister-api` + `magister-web` are not installed. |
| systemd system-level units (`.system.service`)    | UNCOMMITTED   | Two files present in working tree, not in git |
| Receipts                                          | IMPLEMENTED   | JSONL per-day; 6 files written between 2026-05-03 and 2026-05-26 |
| Voice cache (LRU, content-addressed)              | IMPLEMENTED   | `state/voices/cache/` |
| Auth                                              | NONE          | README acknowledges. No middleware. Loopback bind is the only safety. |
| Rate-limit on LLM-backed routes                   | NONE          | README acknowledges. |
| CORS hardening                                    | NONE          | Permissive on every origin. README acknowledges. |
| LICENSE                                           | IMPLEMENTED   | MIT, repo root. README still says "TBD". |

---

## 4. Voice / TTS status

### What works

- **Piper binary** is installed at `/home/zen/.local/bin/piper`.
- **One voice file** is present: `en_GB-alba-medium.onnx` (+ `.json`).
- **Whisper.cpp** binary and `ggml-base.en.bin` model are present at the
  documented paths.
- **Voice registry endpoint** (`GET /magister/voices`) returns 31 voice
  profiles (1 narrator + 30 companion profiles drawn from curriculum
  configs) without crashing.
- **`/teach` and `/dm` voice pickers** correctly pass the chosen
  `voice_profile_id` as `scope` to `/magister/tts`, so they at least
  attempt the right engine and voice.
- **TTS audio cache** is content-addressed and works.

### What is broken or misleading

1. **Kokoro is not actually running.** Port 18794 is held by an
   `opencode-sidecar` uvicorn process (verified with `ss -tlnp` and a probe
   of `/health`, which returned `{"ok":true,"service":"opencode-sidecar",...}`).
   The `magister-kokoro.service` systemd unit exists and is **inactive
   (dead)**. The Kokoro virtualenv at `voices/kokoro/.venv/` is provisioned.

2. **The Kokoro health probe is too loose.** `server/lib/voices/kokoro.ts`
   accepts any response body where `body.ok === true`. The sidecar's
   response satisfies this, so `/magister/voices` reports
   `engines.kokoro.configured: true` and every Kokoro-bound voice profile
   reports `available: true`. **This is a false positive that propagates
   into the UI and the web smoke.**

3. **TTS calls fail at synthesis time.** When the dispatch route actually
   POSTs to `http://127.0.0.1:18794/generate`, the sidecar returns 404 and
   the server returns 503 `{"ok":false,"error":"Kokoro TTS unavailable.",
   "detail":"HTTP 404: Not Found"}`. Confirmed live:

   ```
   $ curl -X POST http://127.0.0.1:18793/magister/tts \
       -d '{"text":"hello","voice":"varros-default"}'
   HTTP/1.1 503 Service Unavailable
   {"ok":false,"error":"Kokoro TTS unavailable.","detail":"HTTP 404: Not Found"}
   ```

4. **`MAGISTER_VOICE_FALLBACK=piper` is not set in `.env`**, so the dispatch
   does not even try Piper as a fallback. Even if it did, only one Piper
   voice file is present, so any per-companion Piper voice request would
   also 503.

5. **Main `/` page sends the wrong field.** `web/app/hooks/useVoicePlayback.ts`
   posts `{ text, role: companionRole }`. The server's `/magister/tts` body
   schema is `{ text, voice?, scope? }`. The `role` field is silently
   dropped, the dispatch sees no voice query, and falls through to the
   default Piper voice `en_GB-alba-medium`. Every companion on the Hall
   path speaks in the same British female voice.

6. **The README claim** "Slice 6E assigned Kokoro voices to Varros and all
   26 curriculum companions, so any companion-targeted call now reaches
   Kokoro by default (when the service is running)" is technically true on
   the server side — but is **operationally false today** because (a) the
   service is not running, and (b) the Hall-path UI does not target
   companions correctly.

### Status by surface

| Surface     | TTS                                         | STT       |
|-------------|---------------------------------------------|-----------|
| `/` (Hall)  | BROKEN — Wrong field; always default Piper  | UNTESTED  |
| `/teach`    | DEGRADED — Correct routing, but Kokoro down → 503; Piper fallback not enabled | UNTESTED |
| `/dm`       | DEGRADED — Same as /teach                   | n/a       |
| Inkwell     | n/a — Inkwell is text-only feedback         | n/a       |

---

## 5. Campaign status

The README describes "campaign worlds" and Magister-as-RPG, but the actual
campaign system splits across two unrelated surfaces:

### "Campaign" in the Hall (`/`)
This is a misnomer in the UI: a "new campaign" button creates a
`magister_sessions` row, which is a **single-concept session atom**
(concept_id + objective + mastery_signal). There is no multi-session arc,
no chapter, no quest, no world-state. The columns that look like they
would carry one — `current_scene`, `current_story_beat`, `session_summary`
on `magister_sessions`, plus `current_scene`, `quest_state`, `world_memory`
on `magister_dm_campaigns` — are either always `null` or carry only the
most recent session summary string. **Live DB has 0 sessions and 0 DM
campaigns.**

### Dungeon Master mode (`/dm`)
A real, deterministic D&D-style engine: dice, checks, combat with
initiative + conditions, leveling, inventory, long/short rests, append-
only event log, narration-after-the-fact. This is the closest thing to
an "RPG" in Magister today. **It is not a learning campaign** — it is a
generic SRD playground. No subject-matter hook, no learning objectives,
no companion teaching arc.

### What's missing for "AI companion RPG learning environment"

- A campaign generator or hand-authored chapter system that produces a
  multi-session story arc tied to a curriculum module.
- Cross-session state: world memory, NPC relationships, character
  inventory persistence between sessions of the same module.
- Companion handoffs (e.g., Marcus → Livia for Latin grammar vs poetry),
  party-style chat with multiple companions in the same session.
- Story progression UI: a map of scenes, locked content gating, a sense
  that the world is changing because the learner showed up.

None of this exists. The DM mode could become the substrate, but it is
not wired into curriculum at all today.

---

## 6. UI / UX findings

### Strengths
- Recent decomposition (2026-05-22) split a 2,537-line `page.tsx` into
  view + hook + types files. Code is readable now.
- Five-screen tab bar (Hall / Session / Map / Advanced / Inkwell) is
  consistent.
- Inkwell is the most polished surface — three-pane layout, real save
  flow, real LLM feedback, real delete confirmation.
- `/teach` and `/dm` standalone pages have working sidebars, headers,
  event logs.
- Comfort drawer is genuinely useful (dyslexic font, wide spacing,
  narration toggle, ambient volume, pacing feedback). All toggles are
  wired through to settings + LLM prompt where applicable.

### Issues
1. **Voice picker is missing on the Hall path.** It only exists on
   `/teach` and `/dm`. Hall sessions can't pick a voice, can't preview a
   voice, and (because of the `role` bug) can't even play the companion's
   own configured voice.
2. **"Campaign" wording is misleading** — users will expect a multi-session
   arc and get a single-concept session.
3. **The Library / Module shelf** does not surface which modules actually
   have lesson structure. A learner picking "Mathematics" gets the same
   shape as "AI Literacy" but only the latter has real lesson scaffolding.
4. **No structured-lesson rendering UI** exists, even though
   `ai-literacy` and `ai-systems` ship 10 lessons each with objectives,
   key concepts, practice prompts, and mastery checkpoints. The data is
   served at `GET /magister/modules/:id` and consumed by nothing.
5. **Active-session "Resume" UX** has not been verified against the
   `last_summary` carry-over; live DB had no active sessions to inspect.
6. **`page.tsx` still owns a lot of cross-screen state**, which made the
   refactor a pass-through-props exercise; the SessionView in particular
   takes ~70 props.
7. **`web/test/e2e-smoke.mjs`** is HTTP-level only — it asserts a "Loading
   Magister..." SSR shell exists but does not exercise any post-hydration
   path. Any JS-driven regression (click → confirm → DELETE) will not be
   caught.
8. **Two new system-level systemd unit files** (`magister-api.system.service`,
   `magister-web.system.service`) are present in the working tree but
   uncommitted — they suggest a planned migration from `--user` to
   `--system` units that has not landed.

### Dead-ish code or fake toggles
- `web/app/hooks/useVoicePlayback.ts` `role` param: lives in the code,
  forwarded by the Hall path, never honored by the server. Misleading.
- `magister_sessions.current_story_beat` column: defined, never written.
- `magister_dm_campaigns.world_memory` + `quest_state` JSON columns:
  always `'{}'` / `'[]'` — nothing in `/dm` writes to them.
- The README mentions a Repeat button + Translate UI under the Session
  view — both are wired (`SessionView.tsx` lines 521 and 528 etc.) but
  Repeat depends on TTS working, so today it triggers the same 503.

---

## 7. Settings / configuration

| Variable                       | Default                         | Honored where                        |
|--------------------------------|---------------------------------|--------------------------------------|
| `MAGISTER_HOST`                | `127.0.0.1`                     | `server/index.ts`                    |
| `MAGISTER_PORT`                | `18793`                         | `server/index.ts`                    |
| `MAGISTER_ALLOW_PUBLIC_BIND`   | `false`                         | `server/index.ts`                    |
| `MAGISTER_STATE_DIR`           | `./state`                       | `server/lib/paths.ts`                |
| `MAGISTER_CURRICULUM_DIR`      | `./curriculum`                  | `server/lib/paths.ts`                |
| `OPENROUTER_API_KEY`           | unset                           | `server/lib/llm.ts` (present in `.env`) |
| `MAGISTER_LLM_MODEL`           | `anthropic/claude-haiku-4-5`    | `server/lib/llm.ts`                  |
| `MAGISTER_LOCAL_OLLAMA_URL`    | `http://127.0.0.1:11434`        | `server/lib/llm.ts`                  |
| `MAGISTER_LOCAL_OLLAMA_MODEL`  | `qwen2.5:7b`                    | `server/lib/llm.ts`                  |
| `MAGISTER_LOCAL_ONLY`          | `false`                         | `server/lib/llm.ts`                  |
| `MAGISTER_KOKORO_URL`          | `http://127.0.0.1:18794`        | `server/lib/voices/kokoro.ts`        |
| `MAGISTER_VOICE_CACHE_MAX_MB`  | `500`                           | `server/lib/voice-cache.ts`          |
| `MAGISTER_VOICE_FALLBACK`      | unset                           | `server/routes/voice.ts` — Piper fallback only if set to `piper` |
| `PIPER_BIN`, `PIPER_VOICES_DIR`| `/home/zen/.local/...`          | `server/routes/voice.ts`             |
| `WHISPER_BIN`, `WHISPER_MODEL` | `/mnt/ai/whisper.cpp/...`       | `server/routes/voice.ts`             |
| `ELEVENLABS_API_KEY`           | unset (deprecated path)         | `server/routes/voice.ts`             |

`.env` is gitignored. Accessibility settings persist to
`state/magister-product/session-settings.json`. Live config endpoint
(`GET /magister/config`) returns both blocks plus the Varros identity.

**Note:** `MAGISTER_LOCAL_ONLY=true` is hard-coded in the user-level
`contrib/systemd/magister-api.service`, while `.env` has it `false`. The
system-level unit (`magister-api.system.service`) instead reads from
`.env` directly. This means the units disagree on whether to allow cloud
calls — easy to forget if you switch unit flavors.

---

## 8. Persistence / storage

`state/magister.db` is a SQLite file (167 KB at audit time). Tables:

| Table                       | Rows  | Notes |
|-----------------------------|-------|-------|
| `magister_modules`          | 19    | 17 with `installed=1`; `financial-basics` and `social-emotional` are 0 |
| `magister_sessions`         | 0     | Empty |
| `magister_progress`         | 0(?)  | (not counted; empty in spot-check) |
| `magister_memory`           | 4     | A handful of companion memories |
| `magister_creative`         | 1     | One saved creative work |
| `magister_lessons`          | 2     | Two Teach Me Anything lessons |
| `magister_lesson_turns`     | ≥0    | (not counted) |
| `magister_dm_campaigns`     | 0     | Empty |
| `magister_dm_characters`    | 0     | Empty |
| `magister_dm_events`        | 0     | Empty |

The database itself is healthy; the product just hasn't been used much.

**Migration bug:** `server/db.ts` runs ALTER TABLE migrations to add `tier`
and `lab_only` columns to `magister_modules` (lines 594–595), then
separately checks whether the `age_track` CHECK constraint needs updating
and, if so, recreates the table (lines 615–641) **without copying `tier`
and `lab_only`** in the `INSERT … SELECT`. On a fresh DB the recreate
runs before the columns are ever populated and silently drops them. Every
later `registerModule()` call then throws `SQLITE_ERROR: table
magister_modules has no column named tier`. This is the root cause of 58
of 58 unit test failures. The currently-running production DB happened to
escape this because its column adds landed in the right order historically.

`state/receipts/` has 6 JSONL files (2026-05-03, -09, -10, -21, -22, -26).
Receipt writing works.

---

## 9. Testing gaps

### Server tests
- `npm test` → **183 pass / 58 fail / 241 total**.
- All 58 failures are downstream of the `tier`/`lab_only` migration bug.
- Smoke (`npm run smoke`) passes — it does not exercise the migration
  path because it boots against the real (already-migrated) `state/`
  directory.

### Server typecheck and build
- `npm run typecheck`: **FAIL** (1 error)
  ```
  server/routes/modules.ts(51,17): error TS2352:
    Conversion of type 'MagisterModuleRecord' to type 'Record<string, unknown>'
    may be a mistake because neither type sufficiently overlaps with the other.
  ```
- `npm run build`: same TS2352 error.

### Web typecheck and build
- `cd web && npm run typecheck`: PASS.
- `npm run build` (production build): not run in this audit; README states
  it requires a `postinstall` patch for a Node-22 Next.js bug.

### Web e2e smoke
- `cd web && npm run test:e2e` requires both `dist/` and `web/.next/`. It
  is pure HTTP — no browser, no hydration, no click coverage. It also
  hits `/magister/voices` and asserts shape only, not engine truth.

### Manual / runtime coverage we lack
- End-to-end companion chat → memory recap → reaffirmation cycle.
- TTS round-trip with each engine.
- STT (whisper) → transcript → chat → reply.
- DM `/dm` flow (create campaign → create character → roll → attack →
  long rest → narrate).
- `/teach` lesson with depth transitions and recap.
- Inkwell draft delete and Maren feedback parse.

---

## 10. Release blockers

Hard blockers — without these fixed, the product cannot be honestly
released:

1. **Fix the `tier`/`lab_only` migration bug in `server/db.ts`.** Either
   include those columns in the recreate path, or move the additive ALTER
   statements after the recreate. Without this, a fresh install fails and
   `npm test` is unrepresentative.
2. **Fix the TS2352 production-build error.** Until `npm run build`
   passes, `npm run start:dist` and both systemd unit flavors (which run
   `node dist/server/index.js`) cannot deploy a fresh checkout.
3. **Fix `useVoicePlayback.ts` to send `scope`/`voice`** instead of `role`.
   Or change the server to also accept `role` as an alias. Today's
   behavior — "every companion speaks the default Piper voice" — is a
   silent lie.
4. **Either bring Kokoro up or tighten the health probe so the registry
   stops lying about it.** A health check that accepts any service
   returning `{"ok":true}` is not a check. At minimum it should look at
   the service-identity field, or fall back to a `GET /voices` probe.
5. **Either commit or remove the system-level systemd unit files in
   `contrib/systemd/`.** Untracked files that look like they're part of
   the deploy story are a footgun.

Soft blockers (should be done before announcing) — see also README's own
acknowledgements:

6. Auth on at least the LLM-backed routes.
7. Rate limit on LLM-backed routes.
8. CORS hardening (currently any-origin).
9. License section in README updated (LICENSE already exists; the "TBD"
   sentence is wrong).
10. README module count corrected (`17` → `19` where appropriate).
11. README test count corrected (`241 tests` implies "and they pass").
12. Add a voice picker (and a Preview button) to the Hall's Session view,
    matching the `/teach` and `/dm` patterns.
13. Build a structured-lesson UI for at least `ai-literacy` and
    `ai-systems`. Today the structured data is invisible to learners.

---

## 11. Recommended staged repair plan

### Phase 1 — Truth (1 day, mostly mechanical)
Goal: tests green, build green, README honest.

- Fix `server/db.ts` migration to retain `tier` and `lab_only`. Add a
  regression test that creates a fresh DB at a `kids`-triggering age_track
  and asserts the columns exist.
- Fix the TS2352 in `server/routes/modules.ts:51` (the cast through
  `unknown`, or by widening `MagisterModuleRecord` with an index signature).
- README cleanup: pluralize "17 modules" to "19", remove the "TBD"
  license line, soften the "241 tests" line until tests are actually green.
- Either commit `contrib/systemd/*.system.service` or delete them.

### Phase 2 — Voice truth (1 day)
Goal: voice playback either works or fails honestly everywhere.

- In `server/lib/voices/kokoro.ts`, tighten the health probe so it
  cannot be satisfied by a non-Kokoro service. Verify against
  `service: "magister-kokoro"` or against `GET /voices`.
- Decide whether `magister-kokoro` should auto-start. If yes,
  register and enable the systemd unit; if no, drop the README claim and
  set `MAGISTER_VOICE_FALLBACK=piper` so callers degrade to Piper.
- Fix `web/app/hooks/useVoicePlayback.ts` to pass `scope: companionId`.
- Either ship more Piper voices in `/home/zen/.local/share/piper-voices/`
  or rebind every companion's default to a single confirmed-present voice
  for now; the registry already supports either path.

### Phase 3 — Coherent Hall UX (1 week)
Goal: the main `/` surface stops calling sessions "campaigns" and starts
feeling like a deliberate product.

- Rename the "Start Adventure" / new-campaign affordances to reflect
  what they actually create (a "Session" — until real campaigns ship).
- Add a voice picker + Preview button to `SessionView`, mirroring the
  `/teach` and `/dm` patterns.
- Lift the SessionView prop tree behind a `useSessionState` hook to
  reduce the 70-prop API.
- Add a structured-lesson view (a sibling of the chat view) that renders
  `lessons[]` for `ai-literacy` and `ai-systems` — they already ship the
  data. Other modules can fall back to the chat view as today.
- Manual end-to-end pass: pick a module, run a 10-minute session, hear
  the right voice, see the recap save, see the mastery update on the Map.

### Phase 4 — Content depth (week+)
Goal: pick three modules and make them feel real. Order suggested by
existing personality strength + audience breadth:

1. `latin` (Marcus + Livia, distinct teaching styles)
2. `mathematics` (Tessera, kid-friendly anchor)
3. `social-emotional` (Sol, the social-emotional kids module)

For each, write structured `lessons[]`, `practice_activities[]`,
`review_questions[]` matching the `ai-literacy` shape, and add tests
under `test/` that assert structural integrity per the existing
`test/ai-modules.test.ts` pattern.

### Phase 5 — Real campaigns and release readiness (week+)
Goal: bridge the DM engine to a learning arc, and get the security
posture to "private but shareable".

- Author the first real story campaign for one module — a hand-written
  multi-scene arc with persisted world state, NPC relationships, and
  cross-session continuity. Wire the DM engine to its outcomes.
- Add auth (Tailscale ACLs, or a simple shared-token middleware).
- Add rate limits on `/magister/sessions/:id/chat`, `/recap`,
  `/magister/translate`, `/magister/lessons/:id/chat`, `/inkwell/feedback`,
  `/dm/narrate`.
- Tighten CORS to the configured web origin.
- Replace the HTTP-only web smoke with a Playwright run that exercises
  one Hall flow, one Teach flow, and one DM flow.

---

## 12. Suggested order of operations

In one continuous pass, smallest-blast-radius first:

1. **Phase 1** in one sitting. Tests green, build green, README honest.
   These are pure no-feature changes that lower the noise floor for
   everything else.
2. **Phase 2** in the same week. Voice is the most user-visible lie
   today, and the fixes are surgical.
3. Then pause to **manually exercise** the Hall + /teach + /dm paths
   end-to-end against the live API, and write down every UX paper cut you
   hit. Most of Phase 3 should be informed by that walkthrough, not by
   this document.
4. **Phase 3** as a focused UI sprint. Aim for the Hall to "feel finished"
   — voice picker, Preview, structured-lesson view, renamed CTAs.
5. **Phase 4** is a content sprint, not a code sprint. Treat it as such —
   one or two modules at a time, with the lesson-shape tests as the
   guardrail.
6. **Phase 5** is the public-release sprint. Don't start it until 1–4
   are done; auth + rate-limit + real campaigns + e2e harness is a lot to
   carry together.

The clear shape: stop lying, then stop being silent, then start shipping
content. None of those phases is large; the audit's main finding is that
the gaps are small but visible, and visible gaps in an "AI tutor"
product erode trust faster than any single feature can build it.

---

## Appendix A — Verbatim command outputs

```
$ npm run typecheck
server/routes/modules.ts(51,17): error TS2352:
  Conversion of type 'MagisterModuleRecord' to type 'Record<string, unknown>'
  may be a mistake because neither type sufficiently overlaps with the other.
  Index signature for type 'string' is missing in type 'MagisterModuleRecord'.

$ npm run build
server/routes/modules.ts(51,17): error TS2352:
  Conversion of type 'MagisterModuleRecord' to type 'Record<string, unknown>'
  may be a mistake because neither type sufficiently overlaps with the other.
  Index signature for type 'string' is missing in type 'MagisterModuleRecord'.

$ npm test (tail)
# tests 241
# suites 0
# pass 183
# fail 58
# cancelled 0
# skipped 0
# todo 0
# duration_ms 710.16974

(58 failures, ~all of the form:)
  error: 'table magister_modules has no column named tier'
  code: 'SQLITE_ERROR'

$ npm run smoke
[smoke] OK /health
[smoke] OK /magister/modules
[smoke] PASS

$ curl -s http://127.0.0.1:18793/magister/health/services | jq .
ok: true, db: 17 installed / 19 modules, kokoro.ok: false (because the
audit's tightened probe reads identity), llm.ok: true (cloud + openrouter
configured), publicBindAllowed: false.

$ curl -s http://127.0.0.1:18794/health
{"ok":true,"service":"opencode-sidecar","version":"1.0.0"}

$ curl -X POST http://127.0.0.1:18793/magister/tts \
    -H 'Content-Type: application/json' \
    -d '{"text":"hello","voice":"varros-default"}'
HTTP/1.1 503 Service Unavailable
{"ok":false,"error":"Kokoro TTS unavailable.","detail":"HTTP 404: Not Found"}

$ systemctl --user status magister-api magister-kokoro magister-web
Unit magister-api.service could not be found.
Unit magister-web.service could not be found.
○ magister-kokoro.service - Magister Kokoro voice service (loopback)
     Active: inactive (dead)
```

— end of audit —
