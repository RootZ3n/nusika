# Magister Voice — Voicebox Audit & MVP Plan (Slice 6A)

> **Status:** Audit only. No code in this slice. Recommends an ordered
> implementation plan with an explicit next-prompt hand-off. Author: 2026-05-10.

---

## Executive summary

Magister currently has working but minimal voice plumbing: `POST /magister/tts`
shells out to Piper, `POST /magister/stt` shells out to whisper.cpp, both behind
friendly 503s when the binaries are missing. Only **one** of the 19 companions
(Maren) carries a voice id, and that id is an ElevenLabs string — a cloud
service we're explicitly trying to leave behind. Every other companion, plus
Varros, falls through to a single hardcoded Piper voice (`en_GB-alba-medium`).

Voicebox is a 25k-star MIT-licensed local-first voice studio that bundles
seven TTS engines, Whisper STT, voice cloning, an HTTP API, and an MCP
server. **It is too heavy to embed wholesale into Magister** — it is a
desktop-app-shaped product (Tauri shell, Bun frontend, FastAPI Python
backend, ~1 GB of model weights, GPU-friendly defaults) that targets a
different user (a creator using a voice studio) than Magister
(a learner having a quiet conversation with a tutor).

**Recommendation: build a small Magister-native voice service inspired by
Voicebox, sharing the same shape (`POST /generate`, voice profiles in a
JSON registry, audio cache by content hash) but using the smallest
possible engine — Kokoro 82M — as the first backend.** Keep Piper in
place as a graceful fallback for environments without Python/Kokoro,
retire ElevenLabs from the curriculum config, and introduce voice
profiles per companion in the existing curriculum config files (no new
DB schema). Cloning is deferred; preset voices first.

This gives Varros and every companion a stable local voice, no monthly
subscription, a clean rollback path, and a recognisable architecture
that can grow into Voicebox-like capability slice by slice.

---

## Voicebox findings

### What it is

- **Repo:** [`jamiepine/voicebox`](https://github.com/jamiepine/voicebox), MIT, 25k stars, active (last push Apr 2026).
- **Self-description:** *"local-first AI voice studio — a free and open-source alternative to ElevenLabs and WisprFlow in one app."*
- **Shape:** Tauri (Rust) desktop shell + Bun-bundled React/TypeScript frontend + FastAPI (Python) backend + a bundled `voicebox-mcp` stdio binary. Docker compose available for headless server use.
- **Model footprint:** Six bundled TTS engines + Whisper STT + a Qwen3 LLM (0.6B / 1.7B / 4B) for refinement and personality rewrites. **Whole stack is several GB of weights** when fully populated.

### Backend layout (relevant excerpt)

```
backend/
├── app.py                 FastAPI entry
├── config.py
├── models.py              Pydantic shapes
├── routes/                generations.py, profiles.py, speak.py, transcription.py, captures.py, …
├── backends/              kokoro_backend.py, qwen_custom_voice_backend.py, chatterbox_*, hume_*, luxtts_*, mlx_backend.py, pytorch_backend.py
├── services/              channels, profiles, export_import, personality, …
├── mcp_server/            FastMCP at `/mcp`
└── pyi_*                  PyInstaller hooks for the bundled binary
```

The HTTP API is centred on:

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/generate` | TTS — async, returns `{ id, status: "generating" }`, poll status, then fetch audio |
| `POST` | `/speak` | One-shot speak (convenience over `/generate` + `/play`) |
| `POST` | `/transcribe` | STT (multipart audio) |
| `GET` | `/profiles` | List voice profiles |
| `POST` | `/profiles` | Create profile (preset id or cloning sample) |
| `POST` | `/profiles/import` | Import a profile ZIP (samples + metadata) |
| `GET` | `/profiles/presets/{engine}` | List engine-specific preset voices (Kokoro, Qwen CustomVoice) |
| `GET` | `/health`, `/models`, `/captures`, … | Operational surfaces |

It also speaks **MCP** so any agent (Claude Code, Cursor) can call `voicebox.speak`.

### TTS engines bundled

| Engine | Size | Languages | Cloning | License | Notes |
|---|---|---|---|---|---|
| **Kokoro** | 82M | 8 | Preset only (50 voices) | Apache-2.0 | Fast CPU inference, the smallest viable engine |
| Qwen3-TTS | 0.6B / 1.7B | 10 | Yes | Apache-2.0 (model) | High quality, multilingual, delivery instructions |
| Qwen CustomVoice | — | 10 | Preset only (9 voices) | Apache-2.0 | Natural-language delivery control |
| LuxTTS | ~1 GB VRAM | English | Cloning | (mixed deps) | 48 kHz, 150x realtime on CPU |
| Chatterbox Multi | — | 23 | Cloning | MIT | Broad language coverage |
| Chatterbox Turbo | 350M | English | Cloning | MIT | Paralinguistic tags `[laugh]`, `[sigh]` |
| HumeAI TADA | 1B / 3B | 10 | Cloning | (vendor) | Long-form coherence |

`backend/requirements.txt` shows the cost honestly: torch, torchaudio, librosa,
numba pinned <0.61, conformer, diffusers, omegaconf, pykakasi, resemble-perth,
spacy + en_core_web_sm download, fugashi, MeCab dictionary, pedalboard, plus
git-only deps `linacodec` and `Zipvoice` from forks. Magister currently has
zero Python dependencies and a 0.1 GB `node_modules`. Pulling Voicebox
wholesale into Magister would multiply our install footprint by ~20×.

### STT support

Whisper / Whisper Turbo via PyTorch (CUDA / ROCm / DirectML / CPU) or MLX
(Apple Silicon). Plays the same role our existing whisper.cpp shell-out plays;
no architectural reason to migrate STT in this slice.

### Voice-profile model

A `VoiceProfile` is a SQLite row with:
- name + description + language tag
- multiple audio samples (cloning sources)
- engine binding (which TTS engine this profile prefers)
- per-profile post-processing effects (Spotify Pedalboard chain)
- optional personality blurb (free-form, used by the bundled LLM for rewrites)
- export/import as ZIP

Preset voices (Kokoro, Qwen CustomVoice) are *not* in the DB by default —
they're enumerated by the engine backend itself.

### Local on Linux?

**Yes, but with caveats:**
- Pre-built Linux binaries are *not* shipped (download page says "build from source").
- Docker compose works, but the published image is CPU-only.
- CUDA, ROCm, DirectML, Intel XPU all supported via PyTorch when present.
- Apple Silicon goes through MLX/Metal for ~4–5× speedup.

### GPU/CUDA assumptions

- CUDA *strongly* preferred for the larger engines (Qwen3-TTS, Chatterbox Multi, TADA).
- **Kokoro is the only engine that runs comfortably on plain CPU** in seconds.
- LuxTTS claims 150× realtime on CPU but is single-language English.
- Voicebox auto-downloads CUDA-flavored PyTorch from inside the app on Windows/Linux NVIDIA, which is friendly for desktop users but a lot of heuristic infrastructure for our use case.

### Installation pain points

- Python 3.11 specifically (3.12+ has chatterbox-tts pin conflicts; the Voicebox Dockerfile installs `chatterbox-tts` with `--no-deps` to dodge this).
- `linacodec` is a git-only fork; no PyPI release.
- spacy `en_core_web_sm` and MeCab `unidic-lite` dictionaries must be pre-installed; `python -m unidic download` (~526 MB) breaks frozen builds.
- `numpy` pinned to `<2.0`, `numba` pinned `<0.61.0` — these are old/conflicting with modern Python ML stacks.
- Bun + Tauri toolchains for the desktop app.
- HuggingFace cache volume (~several GB) is a separate concern.

### Storage

- App data dir on macOS: `~/Library/Application Support/Voicebox/`.
- Generations: `data/generations/` (raw WAV / MP3 per generation).
- Profiles: SQLite DB + per-profile sample audio.
- Models: `~/.cache/huggingface/` by default; overridable via `VOICEBOX_MODELS_DIR`.
- A single profile with 3 cloning samples + 2 generated takes is ~30–50 MB on disk.

### Licensing

- Voicebox itself: **MIT**.
- Bundled engines: a mix — Kokoro Apache-2.0, Chatterbox MIT, LuxTTS / Zipvoice (custom), HumeAI TADA (vendor), Qwen3 (Apache-2.0 weights), Whisper (MIT).
- All are commercially-permissible for our learner-tool context, but cloning a person's voice without consent is a separate ethical/legal concern that Magister should *not* even tempt yet.

### What's directly reusable for Magister

- The **shape of `/generate`** (async create → status poll → fetch audio) is sensible.
- The **profile-as-JSON** model (name, language, engine, samples, effects, personality).
- The **preset-voices-from-engine** pattern — Kokoro's 50 voices come *from the model file*, not user setup.
- The **audio cache** approach (content-hashed generation files).
- The **per-engine backend module** pattern in `backend/backends/*.py` is clean and worth mirroring in Node.

### What's too heavy / unnecessary

- The Tauri desktop shell, MCP server, global hotkey, OS-level paste injection, on-screen pill — all desktop-app concerns, not Magister concerns.
- Six TTS engines. We need **one** that's good enough.
- Pedalboard effects — overkill for "Varros narrates a lesson".
- The bundled local LLM for personality rewrites — Magister already has its own LLM client, no need for a second runtime.
- Tauri for native paste — not relevant.
- Stories editor, dictation captures, MCP shim — not relevant.
- Voice cloning — defer; introduce only after preset voices ship.

---

## Recommended Magister voice architecture

### Decision: build a small Magister-native voice service, not embed Voicebox

| Reason | Detail |
|---|---|
| **Footprint** | Voicebox pulls ~2 GB of Python ML deps + ~1 GB of model weights *minimum*. Magister's whole repo is 0.1 GB. |
| **Surface area** | Voicebox's API is shaped for a creator studio (effects chains, takes, stories, captures). Magister needs `text → audio` and almost nothing else. |
| **Failure modes** | Embedding Voicebox means inheriting its install failure modes (linacodec git fork, MeCab dict download, CUDA detection). Bad fit for "friend clones the repo and runs it". |
| **Maintenance** | A 200-LOC Node-flavored TTS service we own beats a 5k-LOC Python service we orchestrate as a subprocess. |
| **Identity** | Voicebox is a **studio**. Magister is a **tutor**. Different vibes; merging them confuses both. |

### The recommendation: "Voicebox-shaped, Magister-sized"

```
┌────────────────────────────────────────────────────────────────────────┐
│  Magister server (existing Fastify)                                    │
│                                                                        │
│   server/routes/voice.ts ─── POST /magister/tts (existing, 200 OK)    │
│           │                                                            │
│           ├─ try preferred backend (e.g. kokoro-server) ───────► 200   │
│           │       └─ on failure (no python, no model, etc.) ─►  503   │
│           │                                                            │
│           └─ optional fallback: Piper local binary ──────────► 200     │
│                                                                        │
│   server/lib/voices.ts ─── voice registry loaded from curriculum       │
│                            (per companion: { engine, voice_id, … })    │
│                                                                        │
│   state/voices/cache/<sha256(text+voice)>.wav ─── audio cache          │
└────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼  HTTP, localhost only
┌────────────────────────────────────────────────────────────────────────┐
│  voices/ — sibling project, NOT inside server/                         │
│                                                                        │
│  voices/kokoro/server.py ─── tiny FastAPI on 127.0.0.1:18794           │
│      POST /generate { text, voice } → { wav: bytes }                   │
│      GET  /voices                  → list of preset voice ids          │
│      GET  /health                  → 200 if model loaded               │
│                                                                        │
│  voices/kokoro/requirements.txt ─── kokoro, soundfile, fastapi, uvicorn│
│  voices/kokoro/start.sh ─── starts the python server                   │
│                                                                        │
│  Optional later: voices/chatterbox/, voices/qwen3-tts/                 │
└────────────────────────────────────────────────────────────────────────┘
```

The Python sub-service is **optional**. Magister itself stays a TypeScript-only
project; the voices service is a sibling that can be installed (or not) without
breaking the rest of the app. The existing Piper fallback stays intact for
machines without Python.

### Recommended first TTS engine: **Kokoro**

| Property | Why it fits |
|---|---|
| 82 M parameters | Small enough to load on CPU in seconds. No GPU required. |
| 50 preset voices baked into the model | Zero setup beyond `pip install kokoro`. Each voice is a stable identity for a companion or for Varros. |
| Apache-2.0 license | Permissive; we can ship recipes that name specific voice ids. |
| Fast CPU inference | Real-time-ish on a typical laptop. No subscription, no GPU dance. |
| Single-file Python install | One `pip install kokoro` + the model auto-downloads (~330 MB) on first call. |
| Well-supported by Voicebox | The recipe is battle-tested. |

The only meaningful weakness vs. cloud TTS: it's not a celebrity-impression
machine. It produces clean, neutral, listenable voices — which is *exactly*
what a tutor and a Dungeon Master should sound like. No ethically loaded
cloning required.

Cloning (Chatterbox or Qwen3-TTS) can land later when Magister has a real
need to give a *specific* learner-recorded voice to a companion. Until then,
preset is honest, fast, and shippable.

### Voice profile file format

Embed in each curriculum module's `config.json` (no new files, no new
schema migration). Existing companion fields already include `voice_id`
for one entry — extend to a small object:

```jsonc
{
  "id": "marcus",
  "name": "Marcus",
  "personality": "stoic centurion",
  "speech_pattern": "clipped, formal",
  "accent_color": "#c1543a",
  "teaching_style": "narrative",
  "voice": {
    "engine": "kokoro",        // "kokoro" | "piper" | "elevenlabs" (legacy)
    "voice_id": "am_michael",  // engine-specific preset id
    "speed": 1.0,              // optional, engine-specific
    "language": "en"           // optional
  }
}
```

The product narrator (Varros) gets the same shape, defined alongside the
narrator constant in `server/lib/narrator.ts`:

```ts
export const VARROS = {
  // …existing fields…
  voice: { engine: "kokoro", voice_id: "am_michael", language: "en" },
};
```

`server/lib/voices.ts` (new) exposes:

```ts
resolveVoice(scope: { companionId?: string; moduleId?: string; narrator?: boolean }): VoiceConfig | null
```

— priority: companion-level → narrator → module-default → legacy `MAGISTER_TTS_DEFAULT_VOICE` Piper voice.

### Storage layout

Under the existing `state/` directory (already gitignored):

```
state/
├── magister.db         (existing)
├── receipts/           (existing)
├── tmp/                (existing)
└── voices/                                       ← new
    ├── cache/
    │   └── <sha256(engine|voice_id|text)>.wav   (audio cache, content-addressed)
    └── samples/                                  (future: cloning sources, deferred)
```

**Cache rule:** any deterministic engine (Kokoro at temperature 0, Piper) is
cacheable. Stochastic engines (cloning) skip the cache or include a seed in
the hash. The cache is best-effort; corrupt entries are deleted on read
failure. Cap to N MB total (configurable, default 500 MB), LRU eviction.

### API routes

The public Magister surface stays *almost* the same:

| Method | Path | Status | Change |
|---|---|---|---|
| `POST` | `/magister/tts` | Existing | Body extended to optional `{ text, voice?, scope? }`. `scope` resolves to a companion / narrator / default. |
| `POST` | `/magister/tts/elevenlabs` | Existing | **Mark deprecated**, leave wired. No new code paths. |
| `POST` | `/magister/stt` | Existing | Unchanged in this slice. |
| `GET` | `/magister/voices` | New | Lists known voices (engine + voice_id + display name + companion bindings). |
| `GET` | `/magister/voices/preview/:engine/:voice_id` | New | One-shot WAV (cached) saying a stock 6-word phrase like "I'm Varros, the Magister narrator." Useful for a future voice picker. |

Internal router additions: a small Kokoro client in `server/lib/voices/kokoro.ts`
that POSTs to the local Python server and streams the WAV back. Existing
Piper code becomes the fallback path.

### Changes to existing `server/routes/voice.ts`

1. **`POST /magister/tts`** — branch on the resolved voice's `engine`:
   - `kokoro` → `kokoroClient.generate(...)`, return WAV.
   - `piper` (or unset) → existing `piperSynth(...)`, return WAV.
   - `elevenlabs` → log a deprecation warning, fall through to whichever local engine is configured. Do *not* call ElevenLabs unless an explicit env override exists.
2. **`POST /magister/tts/elevenlabs`** — keep, mark `@deprecated` in JSDoc.
3. **No change to STT** in this slice.
4. **New** receipt fields: `engine: "kokoro" | "piper" | "elevenlabs"`, `voice_id: string`, `cache_hit: boolean`, `voice_dur_ms: number`.

### Companion config changes

Pure JSON edits in `curriculum/*/config.json`. No code changes needed
to ingest them — the existing curriculum scanner already preserves the
full JSON of each companion as opaque blob. **Only the TTS routes need
to learn how to read the new `voice` field.**

Concretely:

- Drop `voice_id: "fTtv3eikoepIosk8dTZ5"` (ElevenLabs) from `curriculum/inkwell/config.json`. Replace with `voice: { engine: "kokoro", voice_id: "af_heart" }` (or whatever Kokoro voice fits Maren's stated personality).
- Add `voice` to every other companion across all 17 curriculum configs. Pick voices that match the companion's existing personality blurbs (warm, terse, curious, etc.). Keep this as a content PR, separate from the wiring slice.

### UI changes

Minimal. Phase 1:

- Hall + /teach + /dm already call `playTTS(text, role)` on demand. The route URL doesn't change. Once the server resolves the right voice from companion id, the UI gets the right voice for free. **Zero web changes for the MVP.**
- Add to `/api/proxy/[...]` only if it doesn't already pass through audio body unchanged (it does).

Phase 2 (deferred): a small voice picker on the comfort/settings panel to
preview voices via `/magister/voices/preview/...`.

### Test plan

Unit:
- `voices.ts` — companion voice resolution falls through scope correctly.
- `kokoro.ts` client — error path returns structured error when service is
  unreachable; happy path streams WAV bytes.
- Audio cache — same `(engine, voice_id, text)` hash returns cached file;
  cache corruption is silently dropped and regenerated.

Route:
- `POST /magister/tts` with no Kokoro running and no PIPER_BIN → existing 503 contract.
- `POST /magister/tts` with Kokoro running → returns WAV with `X-TTS-Provider: kokoro` header.
- `POST /magister/tts` with Kokoro down but Piper present → returns WAV with `X-TTS-Provider: piper-fallback`.
- `GET /magister/voices` → JSON list.

E2E:
- Current `web/test/e2e-smoke.mjs` already proves the routes exist; extend to assert `GET /magister/voices` returns 200.

### Rollback plan

Each piece is additive. Rollback paths:

- The Kokoro Python service runs as a separate process. Killing it reverts to Piper fallback automatically.
- The new `voice` field on companions is additive JSON. If we revert the route changes, the new field is just unread.
- Audio cache files are pure derived data. `rm -rf state/voices/cache/` is always safe.
- The deprecated ElevenLabs route stays wired during rollout — if Kokoro is broken on day 1, Maren's existing ElevenLabs voice still works.

### Risks / blockers

| Risk | Likelihood | Mitigation |
|---|---|---|
| **Python install fails** for some users (no Python 3.11+, no pip, no working venv) | Medium | Keep Piper fallback. Document Kokoro as *optional*. The MVP must run useful even if Kokoro never installs. |
| **Kokoro model download** is ~330 MB on first call; users on slow connections see a long pause | Medium | Document the first-call cost. The Python service can pre-warm at boot. Cache subsequent calls. |
| **Kokoro voice ids are stable upstream?** | Low | Voice ids are baked into the model; they don't change without a new model release. Pin a model version in the Python service. |
| **Per-companion voice mapping is opinionated** | Low | Wrong voice = bad UX but easy to fix in JSON. Don't ship voice ids no one has heard. |
| **Audio cache grows unbounded** | Low | LRU + a cap, both in the route layer. |
| **Future cloning ethics** | Medium-high (later) | Don't ship cloning until we have a clear consent flow. This audit defers cloning intentionally. |
| **License confusion** | Low | Kokoro is Apache-2.0; we attribute and move on. Don't ship cloned celebrity voices. |
| **Users want ElevenLabs back** | Low | The route still exists. Document how to set `ELEVENLABS_API_KEY` if a user really wants it. |
| **Kokoro language coverage is 8 languages** | Low | Magister has 5 explicitly-language modules (Latin, Mandarin, Vietnamese, Spanish, French) — Kokoro covers EN, JA, ZH, FR, IT, ES, PT, HI. Latin and Vietnamese aren't supported. Acceptable: Latin and Vietnamese fall back to a neutral en-US voice with the existing Piper path until we add another engine. |

### Ordered implementation slices

**Slice 6B — Voice registry, no engine swap.**
- Add `voice` field schema and `server/lib/voices.ts`.
- Add `GET /magister/voices` (returns whatever is configured today, mostly Piper defaults).
- Existing `POST /magister/tts` continues to use Piper. Companion-level `voice.engine === "piper"` lookups go to the existing Piper path. Anything else returns 503 "engine not configured" gracefully.
- **No Python service yet.** This is wiring + tests + doc only.
- Update one or two companions' config to use distinct Piper voices for variety. Backfill the rest in Slice 6E.
- Add tests + `/magister/voices` to `e2e-smoke.mjs`.
- ~250 LOC, all TypeScript, no new dependencies.

**Slice 6C — Kokoro server skeleton (separate folder).**
- Add `voices/kokoro/` sibling project: `server.py`, `requirements.txt`, `start.sh`, `README.md`.
- One endpoint: `POST /generate { voice, text }` → WAV.
- Configurable port (default `127.0.0.1:18794`); binds loopback only.
- Document Python 3.11 requirement, model download size, expected RAM/CPU.
- Magister itself does *not* call this yet. Just stand it up and verify `curl` works.
- ~150 LOC of Python.

**Slice 6D — Magister ↔ Kokoro client + `kokoro` engine path.**
- Add `server/lib/voices/kokoro.ts` HTTP client.
- Wire `POST /magister/tts` to dispatch on `voice.engine`:
  - `"kokoro"` → call kokoro server, cache WAV, return.
  - `"piper"` or unset → existing Piper path.
  - kokoro unreachable → 503 with friendly "Kokoro voice service is not running" message.
- Add `state/voices/cache/` with content-hash caching.
- Tests: stub fetch to assert dispatch, cache hit/miss, friendly 503.
- ~300 LOC.

**Slice 6E — Companion voice content pass.**
- Pure-JSON content slice. Edit all 17 `curriculum/*/config.json` to add a
  `voice` object per companion plus the narrator (in `narrator.ts`).
- Pick voices from Kokoro's 50 presets per companion's stated personality.
- Update `test/curriculum.test.ts` coverage assertion to require a `voice` object on every companion.
- Drop the ElevenLabs `voice_id` on Maren in favor of a Kokoro voice.
- ~30 LOC of code + JSON edits.

**Slice 6F — Voice picker and cache cap (polish).**
- `GET /magister/voices/preview/:engine/:voice_id` returning a cached "Hello, I'm <voice>" sample.
- Cache size cap + LRU eviction.
- Tiny voice-picker chip in the comfort panel of `/teach` (and maybe `/dm`).
- Optional, can wait.

**Cloning slice (deferred — Slice 7+).** Adds Chatterbox or Qwen3-TTS as a
second backend; introduces user-uploaded voice samples; gates behind a clear
consent UI. Not part of this audit's MVP.

---

## Exact next implementation prompt (Slice 6B)

> You are working in the Magister standalone repo.
>
> Goal: Implement Slice 6B — voice registry foundation, no engine swap.
>
> Context: Slice 6A audit (`docs/VOICEBOX-AUDIT.md`) is complete. Magister
> currently has a single Piper voice for everything; only Maren has a stale
> ElevenLabs `voice_id`. We want to introduce a per-companion / per-narrator
> voice config that the existing routes can resolve, **without** changing
> the actual TTS engine yet. Kokoro arrives in 6C; this slice is wiring +
> tests + a `GET /magister/voices` route.
>
> Required:
> 1. Add `server/lib/voices.ts`:
>    - `VoiceConfig` interface: `{ engine: "kokoro" | "piper" | "elevenlabs", voice_id: string, language?: string, speed?: number }`.
>    - `resolveVoice(opts)` — fall through scopes: companion → narrator → module → default Piper voice.
>    - `loadCompanionVoices(db)` — pulls voice config from companion JSON via the existing curriculum scan.
> 2. Add `GET /magister/voices` route returning `{ engines: ["piper"], voices: [{ engine, voice_id, scope, display_name }] }`.
> 3. Extend `POST /magister/tts` body to accept optional `{ scope: { companion_id?, narrator?, module_id? } }`.
>    Resolution: if `voice` field is given, use it; else `resolveVoice(scope)`; else current default.
> 4. For now, **only `engine: "piper"` is implemented**. `engine: "kokoro"` returns 503 with `error: "Kokoro voice engine is not configured."` This is the friendly-503 contract the project already uses for missing voice infrastructure.
> 5. Update one companion's curriculum config (e.g. Cronk in linux) to use a distinct Piper voice (e.g. `en_US-lessac-medium`) so resolution can be observed end-to-end.
> 6. Tests:
>    - `voices.ts` resolution unit tests (companion overrides narrator overrides default).
>    - Route test: `POST /magister/tts` with `scope: { companion_id: "cronk" }` produces a WAV with `X-TTS-Voice` header equal to the configured voice.
>    - Route test: scope resolving to `engine: "kokoro"` returns 503 with the friendly error.
>    - `GET /magister/voices` returns a list including both companion-bound and default entries.
> 7. Update `web/test/e2e-smoke.mjs` to verify `GET /magister/voices` returns 200.
> 8. README API table: add the new route, add a one-line note that the voice registry layer landed and Kokoro is queued for Slice 6C.
>
> Rules:
> - Do not stand up Kokoro yet.
> - Do not delete `/magister/tts/elevenlabs`. Mark it `@deprecated` only.
> - Do not break the existing Piper voice file expectation; on missing voice file the existing 503 path still applies.
> - Keep the `state/voices/cache/` directory unused for now (Slice 6D wires it).
> - Keep changes small and reviewable. ~250 LOC total.

---

## Sources

- [jamiepine/voicebox README](https://github.com/jamiepine/voicebox/blob/main/README.md)
- [jamiepine/voicebox `backend/requirements.txt`](https://github.com/jamiepine/voicebox/blob/main/backend/requirements.txt)
- [jamiepine/voicebox `backend/routes/speak.py`](https://github.com/jamiepine/voicebox/blob/main/backend/routes/speak.py)
- [jamiepine/voicebox `backend/routes/profiles.py`](https://github.com/jamiepine/voicebox/blob/main/backend/routes/profiles.py)
- [hexgrad/Kokoro-82M](https://github.com/hexgrad/kokoro)
- [rhasspy/piper](https://github.com/rhasspy/piper)
- [resemble-ai/chatterbox](https://github.com/resemble-ai/chatterbox)
- Magister `server/routes/voice.ts`, `curriculum/*/config.json`, `server/lib/narrator.ts` (this repo)
