/**
 * Regression tests for the `GET /nusika/modules` enrichment + the
 * post-parse shape of `NusikaModuleRecord.companions`.
 *
 * History: the route used to widen `mod` to `Record<string, unknown>` to
 * mutate `companions` in place, and the DB layer typed `companions` as
 * `string` (the raw JSON blob) while the runtime value was always
 * `string[]` after `parseModuleRow`. The cast then failed TS2352 with
 * `noUncheckedIndexedAccess` strict mode, and any reader that took the
 * static type at face value got a runtime mismatch.
 *
 * These tests lock in the new contract:
 *   - `db.getModule(...).companions` is `string[]` at the type level
 *     AND at runtime.
 *   - `GET /nusika/modules` returns each module with a
 *     `companions: CompanionRich[]` array. Unknown ids fall back to
 *     `{ id, name: id }`.
 *   - Missing or unreadable `config_path` does not throw — the route
 *     degrades to the id-as-name fallback for every companion.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { NusikaDB } from "../server/db.js";
import { registerAllRoutes } from "../server/routes/index.js";

interface Harness {
  dir: string;
  db: NusikaDB;
  app: Awaited<ReturnType<typeof Fastify>>;
  cleanup: () => Promise<void>;
}

async function boot(): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), "magister-modules-route-"));
  const db = new NusikaDB(join(dir, "test.db"));
  const app = Fastify({ logger: false });
  await registerAllRoutes(app, db);
  return {
    dir,
    db,
    app,
    cleanup: async () => {
      await app.close();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("NusikaModuleRecord.companions is string[] after registerModule round-trip", () => {
  const dir = mkdtempSync(join(tmpdir(), "magister-modules-type-"));
  const db = new NusikaDB(join(dir, "test.db"));
  try {
    db.registerModule({
      id: "linux",
      name: "Linux Fundamentals",
      companions: ["cronk", "wrrrakk"],
    });
    const mod = db.getModule("linux");
    assert.ok(mod);
    assert.ok(Array.isArray(mod!.companions), "companions must be an array, not a JSON string");
    assert.deepEqual(mod!.companions, ["cronk", "wrrrakk"]);
    // Each entry must be a string (the post-parse shape, not the raw row).
    for (const c of mod!.companions) {
      assert.equal(typeof c, "string");
    }
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("registerModule called with no companions returns an empty array, not a stringified blob", () => {
  const dir = mkdtempSync(join(tmpdir(), "magister-modules-empty-"));
  const db = new NusikaDB(join(dir, "test.db"));
  try {
    const rec = db.registerModule({ id: "barren", name: "Barren" });
    assert.deepEqual(rec.companions, []);
    const round = db.getModule("barren");
    assert.deepEqual(round!.companions, []);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("GET /nusika/modules enriches each companion id with its config name when config_path exists", async () => {
  const h = await boot();
  try {
    // Stage a fake on-disk curriculum config for "linux" with one rich
    // companion. The route should join mod.companions: string[] against
    // this list and emit { id, name, accent_color } in the response.
    const cfgDir = join(h.dir, "linux");
    mkdirSync(cfgDir);
    const cfgPath = join(cfgDir, "config.json");
    writeFileSync(
      cfgPath,
      JSON.stringify({
        id: "linux",
        name: "Linux Fundamentals",
        companions: [
          { id: "cronk", name: "C-RONK", accent_color: "#abcdef", personality: "stoic" },
        ],
      }),
    );
    h.db.registerModule({
      id: "linux",
      name: "Linux Fundamentals",
      companions: ["cronk", "ghost-id"],
      configPath: cfgPath,
    });

    const res = await h.app.inject({ method: "GET", url: "/nusika/modules" });
    assert.equal(res.statusCode, 200);
    const body = res.json() as {
      ok: boolean;
      modules: Array<{ id: string; companions: Array<{ id: string; name: string; accent_color?: string }> }>;
    };
    assert.equal(body.ok, true);
    const linux = body.modules.find(m => m.id === "linux");
    assert.ok(linux, "linux module must be present");
    assert.equal(linux!.companions.length, 2);

    const cronk = linux!.companions.find(c => c.id === "cronk");
    assert.ok(cronk);
    assert.equal(cronk!.name, "C-RONK", "rich config entry must be joined in");
    assert.equal(cronk!.accent_color, "#abcdef");

    const ghost = linux!.companions.find(c => c.id === "ghost-id");
    assert.ok(ghost, "id without config entry must fall back to { id, name: id }");
    assert.equal(ghost!.name, "ghost-id");
  } finally {
    await h.cleanup();
  }
});

test("GET /nusika/modules degrades to id-as-name when config_path is missing or unreadable", async () => {
  const h = await boot();
  try {
    // Point at a non-existent config file. The route must log + fall
    // back rather than throw.
    h.db.registerModule({
      id: "orphan",
      name: "Orphaned Module",
      companions: ["alpha", "beta"],
      configPath: join(h.dir, "does-not-exist.json"),
    });
    // And one with no config_path at all.
    h.db.registerModule({
      id: "naked",
      name: "Naked Module",
      companions: ["solo"],
    });

    const res = await h.app.inject({ method: "GET", url: "/nusika/modules" });
    assert.equal(res.statusCode, 200);
    const body = res.json() as {
      modules: Array<{ id: string; companions: Array<{ id: string; name: string }> }>;
    };
    const orphan = body.modules.find(m => m.id === "orphan");
    assert.ok(orphan);
    assert.deepEqual(
      orphan!.companions.map(c => ({ id: c.id, name: c.name })),
      [{ id: "alpha", name: "alpha" }, { id: "beta", name: "beta" }],
    );
    const naked = body.modules.find(m => m.id === "naked");
    assert.ok(naked);
    assert.deepEqual(
      naked!.companions.map(c => ({ id: c.id, name: c.name })),
      [{ id: "solo", name: "solo" }],
    );
  } finally {
    await h.cleanup();
  }
});

test("GET /nusika/modules skips non-rich companion entries in the on-disk config", async () => {
  const h = await boot();
  try {
    // Mixed config: one rich entry, one bare string, one malformed
    // (missing id). The bare string and the malformed entry must not be
    // surfaced as if they were rich objects — they fall through to the
    // id-as-name path keyed off the DB record.
    const cfgDir = join(h.dir, "mixed");
    mkdirSync(cfgDir);
    const cfgPath = join(cfgDir, "config.json");
    writeFileSync(
      cfgPath,
      JSON.stringify({
        id: "mixed",
        name: "Mixed",
        companions: [
          { id: "alpha", name: "Alpha Rich" },
          "beta",
          { name: "no-id-here" },
        ],
      }),
    );
    h.db.registerModule({
      id: "mixed",
      name: "Mixed",
      companions: ["alpha", "beta"],
      configPath: cfgPath,
    });

    const res = await h.app.inject({ method: "GET", url: "/nusika/modules" });
    const body = res.json() as {
      modules: Array<{ id: string; companions: Array<{ id: string; name: string }> }>;
    };
    const mixed = body.modules.find(m => m.id === "mixed");
    assert.ok(mixed);
    const alpha = mixed!.companions.find(c => c.id === "alpha");
    assert.equal(alpha!.name, "Alpha Rich");
    const beta = mixed!.companions.find(c => c.id === "beta");
    // Beta in config was a bare string, so the route should fall back
    // to id-as-name rather than misinterpret the string as a name.
    assert.equal(beta!.name, "beta");
  } finally {
    await h.cleanup();
  }
});
