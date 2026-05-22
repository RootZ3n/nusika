#!/usr/bin/env node
/**
 * Magister systemd installer (Slice 7A).
 *
 * Copies the four unit files in contrib/systemd/ into
 * ~/.config/systemd/user/, runs `systemctl --user daemon-reload`, and
 * prints the enable/start commands the user should run next.
 *
 * User services on purpose: this is a single-user app on Jeff's box
 * (zen). User services don't need sudo and stop cleanly when the
 * session exits — pair with `loginctl enable-linger zen` if you want
 * them to persist across logouts.
 *
 * Idempotent: re-running just refreshes the unit files in place.
 *
 * Run with: `npm run service:install`  (or `node scripts/install-systemd.mjs`).
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const sourceDir = join(projectRoot, "contrib", "systemd");
const targetDir = join(homedir(), ".config", "systemd", "user");

function fail(msg) {
  console.error(`[install-systemd] FAIL: ${msg}`);
  process.exit(1);
}

if (!existsSync(sourceDir)) {
  fail(`source dir not found: ${sourceDir}`);
}

const entries = readdirSync(sourceDir).filter((f) =>
  f.endsWith(".service") || f.endsWith(".target"),
);
if (entries.length === 0) fail(`no .service/.target files found in ${sourceDir}`);

mkdirSync(targetDir, { recursive: true });

let copied = 0;
for (const name of entries) {
  const src = join(sourceDir, name);
  const dst = join(targetDir, name);
  copyFileSync(src, dst);
  console.log(`[install-systemd] installed ${name} → ${dst}`);
  copied += 1;
}

const reload = spawnSync("systemctl", ["--user", "daemon-reload"], { stdio: "inherit" });
if (reload.status !== 0) {
  console.warn("[install-systemd] WARNING: `systemctl --user daemon-reload` exited non-zero — run it manually.");
}

console.log("");
console.log(`[install-systemd] OK — installed ${copied} unit files.`);
console.log("");
console.log("Next steps:");
console.log("  # one-shot start:");
console.log("    systemctl --user start magister.target");
console.log("");
console.log("  # auto-start on login:");
console.log("    systemctl --user enable magister.target");
console.log("");
console.log("  # keep services running after logout (optional, requires sudo):");
console.log("    sudo loginctl enable-linger \"$USER\"");
console.log("");
console.log("  # status / logs:");
console.log("    systemctl --user status magister-api magister-kokoro magister-web");
console.log("    journalctl --user -u magister-api -f");
console.log("");
console.log("  # health probe:");
console.log("    npm run service:health");
