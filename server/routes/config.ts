import type { FastifyInstance } from "fastify";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { stateDir } from "../lib/paths.js";

export interface MagisterAccessibilitySettings {
  dyslexic_font: boolean;
  wide_spacing: boolean;
  narration_enabled: boolean;
  narration_volume: number;
  speed: "slow" | "standard" | "fast";
  comfort_mode: boolean;
}

const DEFAULT_SETTINGS: MagisterAccessibilitySettings = {
  dyslexic_font: false,
  wide_spacing: false,
  narration_enabled: true,
  narration_volume: 0.7,
  speed: "standard",
  comfort_mode: false,
};

const productDir = () => join(stateDir(), "magister-product");
const settingsPath = () => join(productDir(), "session-settings.json");

async function loadSettings(): Promise<MagisterAccessibilitySettings> {
  await mkdir(productDir(), { recursive: true });
  try {
    const raw = await readFile(settingsPath(), "utf-8");
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<MagisterAccessibilitySettings>) };
  } catch {
    await writeFile(settingsPath(), JSON.stringify(DEFAULT_SETTINGS, null, 2) + "\n", "utf-8");
    return DEFAULT_SETTINGS;
  }
}

async function saveSettings(patch: Partial<MagisterAccessibilitySettings>): Promise<MagisterAccessibilitySettings> {
  const current = await loadSettings();
  const merged = { ...current, ...patch };
  await writeFile(settingsPath(), JSON.stringify(merged, null, 2) + "\n", "utf-8");
  return merged;
}

/**
 * Three small endpoints that the magister web UI calls. In squidley-v2
 * these were 501 stubs (apps/api/src/routes/magister-stubs.ts). Settings
 * are now real (file-backed). Translate is still pending the LLM client.
 */
export async function registerConfigRoutes(app: FastifyInstance): Promise<void> {
  app.get("/magister/config", async (_req, reply) => {
    const settings = await loadSettings();
    return reply.send({ ok: true, config: settings });
  });

  app.post<{ Body: Partial<MagisterAccessibilitySettings> }>(
    "/magister/settings/accessibility",
    async (req, reply) => {
      const next = await saveSettings(req.body ?? {});
      return reply.send({ ok: true, config: next });
    },
  );

  app.post("/magister/translate", async (_req, reply) => {
    return reply.status(501).send({
      ok: false,
      error: "not_implemented",
      message: "Translation pending the standalone LLM client. See server/routes/config.ts.",
    });
  });
}
