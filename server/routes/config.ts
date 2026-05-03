import type { FastifyInstance } from "fastify";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { stateDir } from "../lib/paths.js";
import { complete } from "../lib/llm.js";
import { writeReceipt } from "../lib/receipts.js";

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

interface TranslateBody {
  text: string;
  source_lang?: string;
  target_lang: string;
  /** Override the configured model (e.g. a cheaper one for translation) */
  model?: string;
}

export async function registerConfigRoutes(app: FastifyInstance): Promise<void> {
  // GET /magister/config — accessibility settings
  app.get("/magister/config", async (_req, reply) => {
    const settings = await loadSettings();
    return reply.send({ ok: true, config: settings });
  });

  // POST /magister/settings/accessibility — partial update
  app.post<{ Body: Partial<MagisterAccessibilitySettings> }>(
    "/magister/settings/accessibility",
    async (req, reply) => {
      const next = await saveSettings(req.body ?? {});
      return reply.send({ ok: true, config: next });
    },
  );

  // POST /magister/translate — companion-friendly translation via LLM
  app.post<{ Body: TranslateBody }>("/magister/translate", async (req, reply) => {
    const { text, source_lang, target_lang, model: modelOverride } = req.body ?? ({} as TranslateBody);
    if (!text) return reply.status(400).send({ ok: false, error: "text required" });
    if (!target_lang) return reply.status(400).send({ ok: false, error: "target_lang required" });

    const sourceClause = source_lang ? ` from ${source_lang}` : "";
    const sysPrompt = `You are a translator. Translate the user's text${sourceClause} to ${target_lang}. Output ONLY the translated text — no explanation, no quoting, no language tags. Preserve meaning, tone, and formatting.`;

    try {
      const result = await complete({
        messages: [
          { role: "system", content: sysPrompt },
          { role: "user", content: text },
        ],
        ...(modelOverride ? { model: modelOverride } : {}),
        maxTokens: Math.max(256, Math.ceil(text.length * 2)),
        temperature: 0.2,
        reason: `magister:translate:${target_lang}`,
      });

      void writeReceipt({
        componentType: "model-call",
        componentName: "magister-translate",
        reason: `magister:translate:${target_lang}`,
        model: result.model,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        estimatedCostUsd: result.estimatedCostUsd,
        durationMs: result.durationMs,
        meta: {
          source_lang: source_lang ?? null,
          target_lang,
          inputLength: text.length,
          outputLength: result.text.length,
          provider: result.provider,
        },
      });

      return reply.send({
        ok: true,
        translated: result.text.trim(),
        model: result.model,
        provider: result.provider,
        durationMs: result.durationMs,
      });
    } catch (err) {
      const detail = (err instanceof Error ? err.message : String(err)).slice(0, 300);
      void writeReceipt({
        componentType: "model-call",
        componentName: "magister-translate",
        reason: `magister:translate:${target_lang}`,
        status: "failure",
        meta: { source_lang: source_lang ?? null, target_lang, error: detail },
      });
      return reply.status(500).send({ ok: false, error: detail });
    }
  });
}
