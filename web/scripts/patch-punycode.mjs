#!/usr/bin/env node
// Patches next/dist/compiled/punycode/package.json so it includes
// "type": "commonjs". Without this, `next build` throws
// `ERR_INVALID_PACKAGE_CONFIG` on Node 22+ when the strict ESM-aware
// loader walks into the bundled CJS module.
//
// Tracking upstream Next.js bug; remove this script when fixed there.

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const target = resolve("node_modules/next/dist/compiled/punycode/package.json");

try {
  const raw = await readFile(target, "utf-8");
  const pkg = JSON.parse(raw);
  if (pkg.type === "commonjs") {
    process.exit(0); // already patched
  }
  pkg.type = "commonjs";
  await writeFile(target, JSON.stringify(pkg) + "\n", "utf-8");
  console.log("[nusika-web] patched next/punycode package.json with type=commonjs");
} catch (err) {
  // Not fatal — only matters when `next build` is going to run.
  console.warn(`[nusika-web] could not patch next/punycode: ${err.message}`);
}
