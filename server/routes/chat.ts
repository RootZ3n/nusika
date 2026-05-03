import type { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import type { MagisterDB } from "../db.js";
import { complete, type CompletionMessage } from "../lib/llm.js";
import { writeReceipt } from "../lib/receipts.js";
import { buildCompanionSystemPrompt, renderMemoryBlock } from "../lib/companion-prompt.js";

interface ChatBody {
  message: string;
  history?: Array<{ role: string; content: string }>;
  /** Override the configured model. Maps directly to the LLM client. */
  model?: string;
}

interface CompanionConfigEntry {
  id: string;
  name?: string;
  personality?: string;
  speech_pattern?: string;
  teaching_rules?: string;
  accent_color?: string;
  [key: string]: unknown;
}

interface ModuleConfig {
  campaign_world?: string;
  companions?: CompanionConfigEntry[];
}

/**
 * Companion chat — the core learning interaction. One turn:
 *   1. Load session, module config, companion personality, prior memories
 *   2. Build the system prompt (identity-locked, world + memory + personality + tone)
 *   3. Call the LLM (OpenRouter primary, Ollama fallback)
 *   4. Append a receipt
 *   5. Return the companion's reply
 *
 * Companion memory writeback is intentionally NOT performed here — the
 * strict schema enforced by saveCompanionMemory is mismatched with the
 * lightweight signals we'd extract per-turn. End-of-session writeback
 * is the canonical entry; it lives in the future /sessions/:id/end
 * recap endpoint (TODO once recap is wired).
 */
export async function registerChatRoutes(app: FastifyInstance, db: MagisterDB): Promise<void> {
  app.post<{ Params: { id: string }; Body: ChatBody }>(
    "/magister/sessions/:id/chat",
    async (req, reply) => {
      const { message, history = [], model: modelOverride } = req.body ?? ({} as ChatBody);
      if (!message) return reply.status(400).send({ ok: false, error: "message required" });

      const session = db.getSession(req.params.id);
      if (!session) return reply.status(404).send({ ok: false, error: "Session not found" });

      const moduleId = session.module_id;
      const companionId = session.companion_id ?? "";
      const teachingMode = session.teaching_mode;
      const adultMode = Boolean(session.adult_mode);
      const atomConcept = session.atom_concept_id ?? "";
      const atomObjective = session.atom_objective ?? "";

      // Load module config from disk for companion + campaign details
      const mod = db.getModule(moduleId);
      let companionName = companionId || "Companion";
      let companionPersonality = "";
      let companionSpeechPattern = "";
      let companionTeachingRules = "";
      let campaignWorld = "";

      if (mod?.config_path) {
        try {
          const raw = await readFile(mod.config_path, "utf-8");
          const cfg = JSON.parse(raw) as ModuleConfig;
          campaignWorld = cfg.campaign_world ?? "";
          const companion = (cfg.companions ?? []).find(c => c.id === companionId);
          if (companion) {
            companionName = companion.name ?? companionId;
            companionPersonality = companion.personality ?? "";
            companionSpeechPattern = companion.speech_pattern ?? "";
            companionTeachingRules = companion.teaching_rules ?? "";
          }
        } catch (err) {
          app.log.warn(`magister:chat: config load failed for module ${moduleId}: ${String(err)}`);
        }
      }

      // Companion's prior memories of this learner
      const memoryBlock = renderMemoryBlock(
        companionId ? db.getCompanionMemories(companionId, { limit: 20 }) : []
      );

      const systemPrompt = buildCompanionSystemPrompt({
        companionName,
        companionId,
        campaignWorld,
        companionPersonality,
        companionSpeechPattern,
        companionTeachingRules,
        teachingMode,
        atomConcept,
        atomObjective,
        memoryBlock,
        adultMode,
      });

      const messages: CompletionMessage[] = [
        { role: "system", content: systemPrompt },
        ...history.slice(-10).map(h => ({
          role: (h.role === "assistant" ? "assistant" : "user") as "user" | "assistant",
          content: h.content,
        })),
        { role: "user", content: message },
      ];

      try {
        const result = await complete({
          messages,
          ...(modelOverride ? { model: modelOverride } : {}),
          maxTokens: 800,
          temperature: 0.7,
          reason: `magister:companion:${companionId}:${req.params.id}`,
        });

        // Fire-and-forget receipt
        void writeReceipt({
          componentType: "model-call",
          componentName: "magister-companion",
          reason: `magister:companion:${companionId}`,
          status: "success",
          model: result.model,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
          estimatedCostUsd: result.estimatedCostUsd,
          durationMs: result.durationMs,
          meta: {
            sessionId: req.params.id,
            companionId,
            companionName,
            moduleId,
            teachingMode,
            provider: result.provider,
          },
        });

        return reply.send({
          ok: true,
          text: result.text,
          companion: companionName,
          model: result.model,
          provider: result.provider,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
          costUsd: result.estimatedCostUsd,
          durationMs: result.durationMs,
        });
      } catch (err) {
        const detail = (err instanceof Error ? err.message : String(err)).slice(0, 300);
        void writeReceipt({
          componentType: "model-call",
          componentName: "magister-companion",
          reason: `magister:companion:${companionId}`,
          status: "failure",
          meta: { sessionId: req.params.id, companionId, moduleId, error: detail },
        });
        return reply.status(500).send({ ok: false, error: detail });
      }
    },
  );
}
