import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { NusikaDB, MasterySpine, AgeTrack } from "./db.js";
import type { Logger } from "./lib/log.js";

interface RawConfig {
  id?: string;
  name?: string;
  campaign_world?: string;
  subject?: string;
  description?: string;
  age_track?: string;
  companions?: unknown;
  mastery_spine?: MasterySpine;
  tier?: string;
  lab_only?: boolean;
}

/**
 * Scan the curriculum directory and register every module config.json
 * found into the magister_modules table. Idempotent (uses upsert).
 *
 * Returns the count of successfully registered modules.
 */
export async function scanCurriculum(
  db: NusikaDB,
  curriculumDir: string,
  log: Logger,
): Promise<number> {
  let registered = 0;
  let entries: Array<{ name: string; isDirectory: () => boolean }>;

  try {
    entries = await readdir(curriculumDir, { withFileTypes: true });
  } catch (err) {
    log.warn(`failed to read curriculum directory ${curriculumDir}: ${String(err)}`);
    return 0;
  }

  const dirs = entries.filter(e => e.isDirectory()).map(e => e.name);
  log.info(`scanning curriculum at ${curriculumDir} — ${dirs.length} subdirectories: [${dirs.join(", ")}]`);

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const configPath = resolve(curriculumDir, String(entry.name), "config.json");
    try {
      const raw = await readFile(configPath, "utf-8");
      const config = JSON.parse(raw) as RawConfig;

      if (!config.id || !config.name) {
        log.warn(`curriculum: ${configPath} missing id or name — skipped`);
        continue;
      }

      if (!config.mastery_spine) {
        log.warn(`curriculum: module ${config.id} has no mastery_spine in config — spine validation disabled for this module`);
      }

      // companions[] in configs is either a string[] of names or a richer object[]
      // The DB layer stores whatever we hand it as a JSON blob, so normalize to an array.
      const companions: string[] = Array.isArray(config.companions)
        ? (config.companions as Array<{ id?: string } | string>).map(c =>
            typeof c === "string" ? c : (c.id ?? "")
          ).filter(Boolean)
        : [];

      // Pass the full companions blob through via a side-write so the
      // route layer can read the rich shape from config.json directly.
      db.registerModule({
        id: config.id,
        name: config.name,
        ...(config.campaign_world ? { campaignWorld: config.campaign_world } : {}),
        ...(config.subject ? { subject: config.subject } : {}),
        ...(config.description ? { description: config.description } : {}),
        ageTrack: (config.age_track as AgeTrack) ?? "adult",
        companions,
        configPath,
        ...(config.mastery_spine ? { masterySpine: config.mastery_spine } : {}),
        ...(config.tier ? { tier: config.tier } : {}),
        ...(config.lab_only !== undefined ? { labOnly: config.lab_only } : {}),
      });

      registered++;
      log.info(`registered module ${config.id} from ${configPath}`);
    } catch (err) {
      log.warn(`curriculum: failed to register from ${configPath}: ${String(err)}`);
    }
  }

  return registered;
}
