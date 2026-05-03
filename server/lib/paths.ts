import { resolve } from "node:path";
import { mkdirSync } from "node:fs";

const ROOT = resolve(new URL("../..", import.meta.url).pathname);

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
