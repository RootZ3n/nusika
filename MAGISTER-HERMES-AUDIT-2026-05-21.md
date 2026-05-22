# Magister Hermes Audit — 2026-05-21

## Scope

Repo audited: `/mnt/ai/magister`

Integration surfaces checked:

- Standalone Magister API: `127.0.0.1:18793`
- Kokoro voice service: `127.0.0.1:18794`
- Magister web: `0.0.0.0:3003`
- Squidley proxy bridge: `/mnt/ai/squidley-v2/apps/api/src/routes/magister.ts`
- Systemd user units under `/home/zen/.config/systemd/user/`

This audit did not intentionally mutate production Magister state. Runtime smoke used `MAGISTER_DB_PATH=/tmp/magister-audit-smoke.db`.

---

## Executive verdict

Magister is much healthier than Cursus was at audit time. The codebase has real tests, real routes, a real SQLite persistence layer, a real standalone web UI, and a local-first voice direction that mostly matches your broader lab philosophy.

But operationally, it is currently broken in the most user-visible way: the web frontend and Kokoro voice service are running, but the Magister API is dead. The web app loads; the brain behind it is unreachable. Squidley’s bridge also fails because it points to the dead API.

So the honest state is:

- **Codebase readiness:** strong prototype / early polish-ready.
- **Runtime readiness:** not currently operational because API service is down.
- **Product readiness:** promising but not ready for real daily use until API service reliability, auth boundary, UI decomposition, and curriculum mastery depth are addressed.

---

## Evidence collected

### Repo / package

- `/mnt/ai/magister/package.json`
  - Server package: `magister@0.1.0`
  - Fastify + better-sqlite3
  - Scripts: `typecheck`, `test`, `build`, `smoke`, `service:install`, `service:health`
- `/mnt/ai/magister/web/package.json`
  - Next.js 14.2.35 app on port `3003`
  - Scripts: `typecheck`, `build`, `test:e2e`

### Key source files

- API entry: `/mnt/ai/magister/server/index.ts`
- Route registry: `/mnt/ai/magister/server/routes/index.ts`
- DB/schema: `/mnt/ai/magister/server/db.ts`
- LLM client: `/mnt/ai/magister/server/lib/llm.ts`
- Voice route: `/mnt/ai/magister/server/routes/voice.ts`
- Voice registry route: `/mnt/ai/magister/server/routes/voices.ts`
- Teach mode: `/mnt/ai/magister/server/routes/lessons.ts`
- DM mode: `/mnt/ai/magister/server/routes/dm.ts`
- DM narration: `/mnt/ai/magister/server/routes/dm-narration.ts`
- Web hall/session/map/Inkwell monolith: `/mnt/ai/magister/web/app/page.tsx`
- Web Teach page: `/mnt/ai/magister/web/app/teach/page.tsx`
- Web DM page: `/mnt/ai/magister/web/app/dm/page.tsx`
- Web proxy: `/mnt/ai/magister/web/app/api/proxy/[...path]/route.ts`
- Squidley proxy: `/mnt/ai/squidley-v2/apps/api/src/routes/magister.ts`

### Tests / builds

Commands run:

```bash
cd /mnt/ai/magister
npm run typecheck
npm test
npm run build

cd /mnt/ai/magister/web
npm run typecheck
npm run build
```

Results:

- Server typecheck: pass
- Server tests: pass, **225 tests**
- Server build: pass
- Web typecheck: pass
- Web production build: pass

Smoke test with isolated DB:

```bash
MAGISTER_DB_PATH=/tmp/magister-audit-smoke.db npm run smoke
```

Result:

- `/health`: OK
- `/magister/modules`: OK
- smoke pass

### Runtime state

Ports checked:

- `127.0.0.1:18794`: Kokoro running via uvicorn
- `0.0.0.0:3003`: Next web running
- `0.0.0.0:18791`: Squidley API running
- `127.0.0.1:18793`: **not listening**

Systemd user status:

- `magister.target`: active but disabled
- `magister-api.service`: **inactive/dead** since 2026-05-10
- `magister-kokoro.service`: active/running
- `magister-web.service`: active/running

Health script result:

```text
[health] FAIL API     http://127.0.0.1:18793/health — fetch failed
[health] PASS Web     http://127.0.0.1:3003/
[health] PASS Kokoro  http://127.0.0.1:18794/health (optional)
[health] PASS TS-Web http://100.118.60.13:3003/ — HTTP 200 (informational)
[health] 1 required check(s) failed
```

Web proxy result:

```json
{"error":"Magister API unreachable","detail":"TypeError: fetch failed","url":"http://127.0.0.1:18793/magister/health"}
```

Squidley bridge result:

```json
{
  "error": "magister_unavailable",
  "reason": "unknown",
  "magisterUrl": "http://127.0.0.1:18793",
  "message": "Magister service is not reachable. Start it with: cd /mnt/ai/magister && pnpm start",
  "ok": false
}
```

### DB state, read-only

DB path:

```text
/mnt/ai/magister/state/magister.db
```

Read-only table counts:

- `magister_creative`: 1
- `magister_dm_campaigns`: 4
- `magister_dm_characters`: 3
- `magister_dm_events`: 16
- `magister_lesson_turns`: 2
- `magister_lessons`: 2
- `magister_memory`: 0
- `magister_modules`: 17
- `magister_progress`: 0
- `magister_sessions`: 5

Module registration exists. User learning progress basically does not.

---

## What Magister is

Magister is a standalone adaptive learning product with several modes:

1. **Curriculum modules**
   - 17 subject configs under `/curriculum/*/config.json`
   - Includes A+, Network+, Security+, Linux, languages, math, science, history, financial basics, social-emotional, prompt engineering, Inkwell.

2. **Session-based companion tutoring**
   - One session = one concept/objective/mastery signal.
   - Companion-driven prompt construction.
   - Hints and elapsed time tracking.
   - Progress table exists, though real DB progress count is currently zero.

3. **Teach Me Anything**
   - `/magister/lessons/*`
   - Varros-led open-ended lesson mode.
   - Persists user and assistant turns.
   - Has strict-JSON recap path.

4. **Inkwell**
   - Creative writing/draft persistence and feedback route.

5. **Dungeon Master mode**
   - Deterministic SRD-style rules engine.
   - Dice/checks/combat/rest/conditions flow through server-side rules code, not LLM state.
   - Narration is separate and descriptive only.

6. **Voice system**
   - Piper legacy local TTS route.
   - Kokoro local sub-service on 18794.
   - Voice registry and preview/caching routes.
   - ElevenLabs route is still present but deprecated.

This is not just a sketch. There is real implementation.

---

## What is strong

### 1. Tests are unusually good for a back-burner lab project

225 passing server tests is meaningful. The test suite covers:

- curriculum scan
- session lifecycle
- memory validation
- delete behavior
- DM rules
- DM narration failure modes
- lesson routes
- Inkwell
- voice registry/cache/preview behavior
- Kokoro client behavior
- systemd unit expectations

Compared to many lab projects, Magister has actual guardrails.

### 2. The DM architecture makes the right core decision

The deterministic DM engine is the strongest architectural piece.

Good boundary:

- rules/state: `server/srd/*`
- narration/prose: LLM route
- audit trail: `magister_dm_events`

That is exactly the right split. The model should not decide HP, conditions, dice outcomes, initiative, or inventory. Magister mostly enforces that.

### 3. Local-first voice direction is correct

The Voicebox audit made the right call: do not embed a heavy voice studio. Keep Magister-native voice small, local, and service-shaped.

Current implementation:

- Kokoro as sibling Python service
- Fastify TTS route dispatches to Kokoro
- Piper fallback retained
- cache by generated WAV
- registry rather than hardcoding everything in UI

That is the correct product direction.

### 4. Lookup placeholder is honest

`POST /magister/lookup` returns supported false instead of pretending to browse. That matters. It avoids fake research behavior.

### 5. The service boundary is conceptually clean

API loopback-only, Kokoro loopback-only, web exposed to LAN/Tailscale. That is the right deployment shape for private use.

---

## What is broken right now

### 1. The API service is dead

This is the top operational blocker.

Evidence:

- `magister-api.service`: inactive/dead
- port `18793`: not listening
- `/health`: connection refused
- web proxy: API unreachable
- Squidley proxy: `magister_unavailable`
- `npm run service:health`: fails required API check

This means Magister currently presents a working-looking web page while its backend is offline.

That is dangerous because it creates false confidence. The UI being live does not mean Magister is live.

### 2. `magister.target` being active is misleading

`magister.target` reports active even though one of its intended components, `magister-api.service`, is dead.

The target has:

```ini
Wants=magister-api.service magister-kokoro.service magister-web.service
```

`Wants=` does not enforce health. It starts dependencies but does not fail the target if one later exits successfully. So the umbrella target can look green while the core API is gone.

This is an operational deception risk.

### 3. The web service is exposed while the API is dead

Port `3003` is listening on `0.0.0.0` and Tailscale probe passed. But API calls fail.

For a user, that means:

- page loads
- product appears alive
- actions fail or silently degrade

This is the classic “frontend shell, backend corpse” failure mode.

### 4. Squidley bridge is not useful until API reliability is fixed

Squidley proxy code exists and returns structured failure, which is good. But operationally it is dead because Magister API is dead.

Also the Squidley proxy message says:

```text
Start it with: cd /mnt/ai/magister && pnpm start
```

But Magister’s package uses `npm`, not pnpm. That message is stale/wrong.

---

## Codebase risks

### 1. Main web page is too large

Largest source files:

- `web/app/page.tsx`: 2,537 lines
- `server/db.ts`: 1,768 lines
- `web/app/dm/page.tsx`: 1,206 lines
- `web/app/teach/page.tsx`: 764 lines
- `server/routes/dm.ts`: 753 lines
- `server/routes/voice.ts`: 547 lines

`web/app/page.tsx` is the biggest concern. It contains Hall, Session, Map, Advanced Studies, Inkwell, session controls, voice, translation, accessibility, timers, practice mode, and UI state all in one client component.

That is not polish-ready architecture. It is prototype architecture that survived long enough to become important.

Refactor target:

```text
web/app/page.tsx
  -> web/app/components/HallView.tsx
  -> web/app/components/SessionView.tsx
  -> web/app/components/MapView.tsx
  -> web/app/components/InkwellView.tsx
  -> web/app/hooks/useMagisterApi.ts
  -> web/app/hooks/useSessionTimer.ts
  -> web/app/hooks/useVoicePlayback.ts
```

Do not add more features to `page.tsx` until it is decomposed.

### 2. DB layer is too large but less urgent

`server/db.ts` is also large, but it is at least centralized and tested. It is not the first thing I would split unless new DB complexity is coming.

If split later:

```text
server/db/core.ts
server/db/sessions.ts
server/db/progress.ts
server/db/lessons.ts
server/db/dm.ts
server/db/modules.ts
server/db/memory.ts
```

But do the web split first.

### 3. Hard deletes exist in a learner product

Routes support hard delete for:

- lessons
- Inkwell drafts
- DM campaigns

The README documents lossless archive alternatives for campaigns, but product polish should lean toward archive/soft-delete by default. A learning system should not casually destroy the learner’s history.

Recommended:

- UI default = archive/complete
- destructive delete hidden behind explicit “danger zone” language
- receipts for deletes

### 4. Progress model exists but product usage is not proven

The real DB has:

- sessions: 5
- progress: 0
- memory: 0

That means the core premise — persistent adaptive learning/memory/mastery — exists in schema and tests, but has not been materially exercised in real use.

This is a major polish gap. The product claims adaptive learning, but the current state does not demonstrate real adaptation yet.

### 5. Mastery spines are incomplete by design

README says most subjects lack mastery spines. Modules without a spine accept arbitrary concept IDs.

That is okay for prototype mode, but not okay for the stated product identity of an adaptive learning engine.

Without mastery spines, Magister is partly:

- real curriculum engine for some modules
- generic themed chat wrapper for others

The polish stage needs to decide which modules are first-class and finish those first.

---

## Security / exposure risks

### Current intended posture

- API: loopback only
- Kokoro: loopback only
- Web: exposed on `0.0.0.0:3003` for LAN/Tailscale

That is reasonable for private trusted access.

### Actual risk

The web has no app-level auth. README explicitly acknowledges:

- permissive CORS
- no auth
- no rate limit on LLM-backed routes
- no public exposure without hardening

Because the web proxy forwards API actions, exposing web equals exposing Magister actions to anyone who can reach port `3003`.

This is acceptable only if Tailscale/LAN trust is real. It is not safe for public internet.

Recommended before friend-demo beyond your own devices:

1. Add simple auth gate to web.
2. Add rate limits on LLM/TTS routes.
3. Add visible local/cloud mode indicator.
4. Make service health obvious on the landing page.

---

## LLM / cost / privacy posture

`server/lib/llm.ts` supports:

- OpenRouter cloud if `OPENROUTER_API_KEY` exists
- Ollama local fallback
- `MAGISTER_LOCAL_ONLY=true` to force local

The installed systemd API unit sets:

```ini
Environment=MAGISTER_LOCAL_ONLY=true
```

That is good for privacy/cost. But if Ollama is not running, all LLM-backed routes will fail with 502. That is honest, but the UI needs to present that clearly.

Risk:

- Cloud path exists in code.
- Local-only service config exists.
- UI likely does not make backend mode obvious enough.

Polish requirement:

- `/magister/config` or `/health` should expose LLM mode: local-only/cloud-capable/unconfigured.
- UI should show “LLM unavailable” before the user writes a long prompt and hits send.

---

## Voice subsystem audit

Voice is one of the best-developed parts, but also operationally split.

### Good

- Kokoro service is actually running on `18794`.
- `/health` for Kokoro returns OK.
- Voice registry route is designed to degrade gracefully.
- TTS failures produce friendly structured errors, not stack traces.
- Cache exists.
- ElevenLabs is deprecated.

### Weak

- API is dead, so Magister cannot currently dispatch to Kokoro through its own normal route.
- Kokoro lives in-repo with a large Python `.venv`; this is practical locally but bad repo hygiene if it is ever pushed/shared.
- Language modules use English Kokoro voices; README admits this. That is honest, but pedagogically limited.
- STT exists but depends on local whisper.cpp paths and is likely not product-polished.

### Recommendation

Keep Kokoro. Do not expand to heavier TTS engines yet.

Finish:

1. API service reliability.
2. Voice health display in UI.
3. “Preview voice” works from web after API restart.
4. Then consider native-language voices for language modules.

---

## Curriculum audit

17 modules exist:

- a-plus
- financial-basics
- french
- history
- history-through-story
- inkwell
- latin
- linux
- mandarin
- mathematics
- network-plus
- prompt-engineering
- science
- security-plus
- social-emotional
- spanish
- vietnamese

Real DB shows 14 installed, 3 not installed:

- not installed: financial-basics, social-emotional, likely one other depending DB state sample

Most important strategic point:

Magister has too many curricula to polish all at once.

Polish only three tracks first:

1. **CompTIA / job-change track**
   - A+
   - Network+
   - Security+
   - Linux

2. **Language track**
   - Vietnamese first, because it aligns with your DLI background
   - Then Spanish/French/Mandarin/Latin later

3. **Inkwell / writing track**
   - Distinct product mode, likely emotionally sticky

Do not try to make all 17 equally deep right now. That will kill the project.

---

## UI / UX audit

### What works conceptually

- `/`: Hall, sessions, map, Inkwell
- `/teach`: focused Teach Me Anything page
- `/dm`: focused DM mode

Breaking Teach and DM into standalone pages was the right move.

### What does not work yet

The root page is trying to be everything.

High-risk symptoms:

- 2,537-line client component
- many unrelated state systems in one file
- voice, timers, translation, accessibility, practice, sessions, maps, Inkwell all cohabiting
- likely hard to debug UI regressions
- HTTP-level E2E only; no real browser interaction test yet

Polish standard should include:

- split components
- API hook abstraction
- visible service health banner
- no silent catch blocks for critical load failures
- Playwright or equivalent real browser smoke for create lesson, send message failure path, DM create campaign, preview voice failure path

---

## Repo hygiene / release posture

`git status --short` shows a large uncommitted working tree:

- many modified curriculum configs
- modified package/server/web files
- many untracked directories/files: `contrib/`, `docs/`, `scripts/`, `server/srd/`, tests, voices, web pages, etc.

This matters.

Before doing major polish work, checkpoint this repo:

1. Review diff.
2. Remove generated junk from version control candidates.
3. Ensure `voices/kokoro/.venv` is ignored and not staged.
4. Commit known-good current state.
5. Then do service fixes/refactors in smaller commits.

Also package.json includes `LICENSE` in `files`, and README says license is TBD. There is no verified `LICENSE` file from the file list. If this ever leaves private lab use, add one.

---

## Priority fixes

### P0 — Make runtime truthful and usable

1. Fix `magister-api.service` so port `18793` is actually listening.
2. Run:

```bash
cd /mnt/ai/magister
npm run service:health
```

Required result:

```text
PASS API
PASS Web
PASS Kokoro
```

3. Add a visible web health banner when API is unreachable.
4. Fix stale Squidley bridge startup message from `pnpm start` to `npm start` or better: `systemctl --user start magister-api`.

### P1 — Checkpoint repo state

1. Audit `git diff`.
2. Ensure generated/binary/local state is ignored.
3. Commit current known-good code after API fix.

Do not refactor before checkpointing. The working tree is too broad.

### P1 — Split web root page

Break `/web/app/page.tsx` apart. This is the biggest maintainability risk.

Suggested target:

```text
web/app/components/HallView.tsx
web/app/components/SessionView.tsx
web/app/components/MapView.tsx
web/app/components/InkwellView.tsx
web/app/components/ServiceHealthBanner.tsx
web/app/hooks/useMagisterApi.ts
web/app/hooks/useSessionTimer.ts
web/app/hooks/useVoicePlayback.ts
```

### P1 — Product health/config endpoint

Add a route or expand `/magister/config` / `/magister/health` to expose:

- DB reachable
- module count
- LLM mode: local-only/cloud/unconfigured
- Ollama reachable yes/no
- Kokoro reachable yes/no
- Piper configured yes/no
- public bind allowed yes/no

Then show it in UI.

### P2 — Finish one curriculum lane deeply

Do not polish all 17 modules.

Recommended first lane:

- A+
- Network+
- Security+
- Linux

Why: directly supports your career transition and CompTIA path.

For each first-class module:

- complete mastery spine
- define concept sequence
- add session objectives
- add practice questions
- add spaced repetition checkpoints
- verify progress writes in real usage

### P2 — Real browser E2E

Current web E2E is HTTP-level. Add real browser tests for:

- root loads and shows API-down state
- Teach lesson create
- Teach chat LLM unavailable path
- DM campaign create
- DM roll/check action
- voice preview unavailable path

### P2 — Soft delete / archive defaults

Move UI toward archive-first. Keep hard delete available only as a deliberate destructive action.

### P3 — Better learning analytics

After progress is actually being written:

- dashboard for mastery by module
- due reaffirmations
- weak concepts
- “what to study next” recommendation
- session history replay

Do not build analytics before real progress data exists.

---

## What is left to do

### Must do before calling it operational again

- Restart/fix API service.
- Confirm `npm run service:health` passes.
- Confirm web proxy can hit `/magister/health`.
- Confirm Squidley bridge can hit `/magister/modules`.
- Add UI-visible API failure state.

### Must do before daily use

- Root page decomposition.
- LLM/voice availability shown before user interaction.
- Verify at least one full learning loop writes progress:
  - create session
  - chat/practice
  - end session
  - progress update
  - reaffirmation due date
  - map display

### Must do before friend demo

- Basic web auth or Tailscale-only locked access.
- Rate limit LLM/TTS routes.
- Browser E2E smoke.
- Clean repo commit.
- Service install docs verified from scratch.

### Must do before public release

- LICENSE.
- Auth.
- CORS hardening.
- Rate limits.
- Public/privacy policy around cloud LLM use.
- No checked-in local venv/state/db/WAL artifacts.
- Packaging story.

---

## Final assessment

Magister is not dead. It is not vapor. It is a real, test-backed standalone product prototype with a good architecture in several places.

But it is currently operationally misleading: the visible web shell is up, the core API is down, and the umbrella target still looks active. That has to be fixed before any polishing work matters.

The right next move is not more features. It is:

1. make the runtime truthful,
2. checkpoint the repo,
3. split the UI monolith,
4. finish one curriculum lane deeply,
5. prove the learning loop writes real progress.

If you do that, Magister can become one of the stronger projects in the lab. If you keep adding modes/curricula before those fixes, it will become another impressive-looking cockpit with no reliable engine behind it.
