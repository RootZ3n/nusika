import { resolve, dirname } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Resolve the magister repo root.
 *
 * 1. MAGISTER_PROJECT_ROOT override always wins (useful for tests + ops).
 * 2. Otherwise walk upward from this file until we find a directory that
 *    contains both package.json and the curriculum/ directory. This works
 *    in tsx dev mode (file lives in server/lib/) and in built mode (file
 *    lives in dist/server/lib/), where naïve "../.." would point inside
 *    dist/ rather than the real project root.
 */
function resolveProjectRoot(): string {
  const override = process.env["MAGISTER_PROJECT_ROOT"];
  if (override) return resolve(override);

  let current = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    if (
      existsSync(resolve(current, "package.json")) &&
      existsSync(resolve(current, "curriculum"))
    ) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  // Fall back to the legacy resolution so we never silently throw at boot.
  // Callers that need state/curriculum will still fail loudly downstream.
  return resolve(fileURLToPath(new URL("../..", import.meta.url)));
}

const ROOT = resolveProjectRoot();

export function projectRoot(): string {
  return ROOT;
}

export function stateDir(): string {
  const dir = process.env["MAGISTER_STATE_DIR"]
    ? resolve(process.env["MAGISTER_STATE_DIR"])
    : resolve(ROOT, "state");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function curriculumDir(): string {
  return process.env["MAGISTER_CURRICULUM_DIR"]
    ? resolve(process.env["MAGISTER_CURRICULUM_DIR"])
    : resolve(ROOT, "curriculum");
}

export function receiptsDir(): string {
  const dir = process.env["MAGISTER_RECEIPTS_DIR"]
    ? resolve(process.env["MAGISTER_RECEIPTS_DIR"])
    : resolve(stateDir(), "receipts");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function dbPath(): string {
  return resolve(stateDir(), "magister.db");
}
