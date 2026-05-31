import { resolve, normalize } from "node:path";

/**
 * Path-traversal-safe file resolver. Joins `dir` and `filename`, normalizes,
 * then verifies the resolved absolute path is still inside `dir`. Throws
 * a descriptive Error if not — caller should map to a 403.
 *
 * Vendored from peh-v2/apps/api/src/lib/safe-serve-file.ts. Kept
 * minimal — no fs access, just path math.
 */
export function safeServeFile(dir: string, filename: string): string {
  if (!filename || filename.includes("\0")) {
    throw new Error("invalid filename");
  }
  const baseDir = resolve(dir);
  const candidate = resolve(baseDir, normalize(filename));
  // Must be inside baseDir AND not equal to baseDir itself.
  if (candidate !== baseDir && !candidate.startsWith(baseDir + "/")) {
    throw new Error("path escape detected");
  }
  return candidate;
}
