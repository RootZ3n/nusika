import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MagisterDB } from "../server/db.js";
import { scanCurriculum } from "../server/curriculum.js";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const CURRICULUM_DIR = resolve(REPO_ROOT, "curriculum");

function silentLogger() {
  return { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
}

function withFixture(): { dir: string; db: MagisterDB; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "magister-curr-"));
  const db = new MagisterDB(join(root, "test.db"));
  return {
    dir: root,
    db,
    cleanup: () => {
      db.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test("scanCurriculum registers a valid module and skips an invalid one", async () => {
  const { dir, db, cleanup } = withFixture();
  try {
    // Valid
    const goodDir = join(dir, "good");
    mkdirSync(goodDir);
    writeFileSync(
      join(goodDir, "config.json"),
      JSON.stringify({
        id: "good-subject",
        name: "Good Subject",
        subject: "test",
        age_track: "adult",
        companions: [{ id: "ada", name: "Ada" }],
        domains: ["intro"],
      }),
    );

    // Missing required fields (no id, no name)
    const badDir = join(dir, "bad");
    mkdirSync(badDir);
    writeFileSync(join(badDir, "config.json"), JSON.stringify({ subject: "broken" }));

    // No config.json at all
    mkdirSync(join(dir, "empty"));

    const count = await scanCurriculum(db, dir, silentLogger());
    assert.equal(count, 1, "only the valid module should register");

    const mod = db.getModule("good-subject");
    assert.ok(mod, "valid module must be persisted");
    assert.equal(mod!.name, "Good Subject");
    assert.equal(mod!.age_track, "adult");
  } finally {
    cleanup();
  }
});

test("scanCurriculum returns 0 when directory missing", async () => {
  const { dir, db, cleanup } = withFixture();
  try {
    const missing = join(dir, "does-not-exist");
    const count = await scanCurriculum(db, missing, silentLogger());
    assert.equal(count, 0);
  } finally {
    cleanup();
  }
});

test("every shipped curriculum module has at least one companion with an id", () => {
  const dirs = readdirSync(CURRICULUM_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
  assert.ok(dirs.length > 0, "curriculum directory must contain at least one module");

  const offenders: string[] = [];
  for (const subdir of dirs) {
    const cfg = JSON.parse(readFileSync(join(CURRICULUM_DIR, subdir, "config.json"), "utf-8"));
    const comps = Array.isArray(cfg.companions) ? cfg.companions : [];
    if (comps.length === 0) { offenders.push(`${subdir}: 0 companions`); continue; }
    const firstWithoutId = comps.find((c: unknown) =>
      typeof c !== "object" || c === null || typeof (c as { id?: unknown }).id !== "string",
    );
    if (firstWithoutId) offenders.push(`${subdir}: companion missing id`);
  }
  assert.deepEqual(offenders, [], `modules must declare at least one companion with an id`);
});

test("companion ids are globally unique across the curriculum", () => {
  const dirs = readdirSync(CURRICULUM_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  const seen = new Map<string, string>();
  const conflicts: string[] = [];
  for (const subdir of dirs) {
    const cfg = JSON.parse(readFileSync(join(CURRICULUM_DIR, subdir, "config.json"), "utf-8"));
    for (const c of (cfg.companions ?? [])) {
      const cid = typeof c?.id === "string" ? c.id : null;
      if (!cid) continue;
      if (seen.has(cid)) {
        conflicts.push(`${cid} appears in both ${seen.get(cid)} and ${subdir}`);
      } else {
        seen.set(cid, subdir);
      }
    }
  }
  // Companion memory is keyed by companion_id alone (no module column),
  // so duplicate IDs across modules would cross-pollinate memories.
  assert.deepEqual(conflicts, [], `companion ids must be unique across modules`);
});
