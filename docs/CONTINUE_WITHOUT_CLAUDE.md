# Continue Without Claude — Magister

## What this repo does

Magister is the lab's AI curriculum + tutoring service. Modular learning
content (AI Literacy, AI Systems & Agent Operations, etc.) served from
`curriculum/`. Built as a Fastify + TypeScript service.

## Common commands

```bash
npm run dev              # tsx watch server/index.ts
npm run build            # rm -rf dist && tsc -p tsconfig.build.json
npm run typecheck        # tsc -p tsconfig.json --noEmit
npm test                 # tsx --test test/**/*.test.ts server/**/*.test.ts
npm run smoke            # scripts/smoke.mjs
npm run service:health   # scripts/magister-health.mjs
npm run service:install  # scripts/install-systemd.mjs
```

## Where to start

- `server/index.ts` — composition root
- `curriculum/` — all course modules (markdown + manifests)
- `docs/AI-MODULES.md` — module index
- `docs/VOICEBOX-AUDIT.md` — past audit notes
- `MAGISTER-HERMES-AUDIT-2026-05-21.md` — recent audit

## Safe edit zones

- `curriculum/` — content files; check the module's own README
- `docs/`, test files, `contrib/`
- `scripts/` — health, install, smoke

## Dangerous edit zones

- `server/index.ts` — composition root
- `server/auth.ts` (if present) — auth gating
- Curriculum *schemas* (manifest format) — affects all modules

## How to recover

```bash
git log --oneline -5
git revert HEAD
sudo systemctl restart magister
npm run service:health
```

## Prompts for smaller models

```
"Add a new lesson to curriculum/<module>/ matching the existing
lesson schema. Update the module's manifest.json index."

"Add a tsx --test test in test/ that loads the new lesson and
asserts the manifest validates."
```

## Top tasks

1. Verify auth posture on each curriculum route before any public release
2. Add rate-limit middleware before public release
3. Document curriculum-manifest schema in docs/CURRICULUM-SCHEMA.md
4. Wire into symposium-command's `lab-wide-check.sh`
