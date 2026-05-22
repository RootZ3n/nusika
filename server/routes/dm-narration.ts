/**
 * DM narration route — descriptive only.
 *
 * Slice 4C-a: a single endpoint that turns a slice of confirmed engine
 * events into narration prose. The route NEVER mutates engine state from
 * narration content; the only persistence is the optional `narration`
 * event we append for the log. The deterministic engine routes in
 * server/routes/dm.ts remain the sole authority for HP, XP, conditions,
 * inventory, initiative, and dice.
 */

import type { FastifyInstance } from "fastify";
import type { MagisterDB, DmEvent } from "../db.js";
import { complete } from "../lib/llm.js";
import { writeReceipt } from "../lib/receipts.js";
import { buildDmNarrationPrompt, type NarrationStyle } from "../lib/dm-narration-prompt.js";

const ALLOWED_STYLES = new Set<NarrationStyle>(["brief", "cinematic", "tactical"]);
const DEFAULT_STYLE: NarrationStyle = "cinematic";
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 30;

interface NarrateBody {
  since_event_id?: string;
  event_ids?: string[];
  limit?: number;
  style?: string;
  model?: string;
}

export async function registerDmNarrationRoutes(app: FastifyInstance, db: MagisterDB): Promise<void> {
  app.post<{ Params: { id: string }; Body: NarrateBody }>(
    "/magister/dm/campaigns/:id/narrate",
    async (req, reply) => {
      const campaignId = req.params.id;
      const campaign = db.getDmCampaign(campaignId);
      if (!campaign) return reply.status(404).send({ ok: false, error: "Campaign not found" });
      const character = db.getDmCharacter(campaignId);

      const body = req.body ?? {};
      const styleStr = body.style ?? DEFAULT_STYLE;
      if (!ALLOWED_STYLES.has(styleStr as NarrationStyle)) {
        return reply.status(400).send({
          ok: false,
          error: `style must be one of: ${[...ALLOWED_STYLES].join(", ")}`,
        });
      }
      const style = styleStr as NarrationStyle;

      const requestedLimit = typeof body.limit === "number" ? Math.floor(body.limit) : DEFAULT_LIMIT;
      const limit = Math.min(MAX_LIMIT, Math.max(1, requestedLimit || DEFAULT_LIMIT));

      // Resolve the events slice. Priority: explicit event_ids > since_event_id > recent N.
      let events: DmEvent[] = [];
      if (Array.isArray(body.event_ids) && body.event_ids.length > 0) {
        const collected: DmEvent[] = [];
        for (const id of body.event_ids) {
          if (typeof id !== "string") continue;
          const e = db.getDmEventById(id);
          if (e && e.campaign_id === campaignId) collected.push(e);
        }
        collected.sort((a, b) => a.created_at.localeCompare(b.created_at));
        events = collected;
      } else if (typeof body.since_event_id === "string" && body.since_event_id.length > 0) {
        const boundary = db.getDmEventById(body.since_event_id);
        if (!boundary || boundary.campaign_id !== campaignId) {
          return reply.status(400).send({
            ok: false,
            error: "since_event_id not found in this campaign",
          });
        }
        events = db.listDmEventsAfter(campaignId, boundary.created_at, limit);
      } else {
        events = db.listDmEvents(campaignId, { limit });
      }

      if (events.length === 0) {
        return reply.status(400).send({
          ok: false,
          error: "No events available to narrate.",
        });
      }

      const systemPrompt = buildDmNarrationPrompt({ campaign, character, events, style });

      let result;
      try {
        result = await complete({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: "Narrate the events above." },
          ],
          ...(body.model ? { model: body.model } : {}),
          maxTokens: 600,
          temperature: 0.7,
          reason: `magister:dm:narrate:${campaignId}`,
        });
      } catch (err) {
        const detail = (err instanceof Error ? err.message : String(err)).slice(0, 300);
        void writeReceipt({
          componentType: "model-call",
          componentName: "magister-dm-narrate",
          reason: "magister:dm:narrate",
          status: "failure",
          meta: { campaignId, stage: "llm", error: detail },
        });
        return reply.status(502).send({
          ok: false,
          error: "DM narration is unavailable: no LLM backend reachable.",
          detail,
        });
      }

      const narration = (result.text ?? "").trim();
      if (narration === "") {
        void writeReceipt({
          componentType: "model-call",
          componentName: "magister-dm-narrate",
          reason: "magister:dm:narrate",
          status: "failure",
          model: result.model,
          meta: { campaignId, stage: "empty-output" },
        });
        return reply.status(422).send({
          ok: false,
          error: "Narration LLM returned an empty response.",
        });
      }

      const eventIdsUsed = events.map(e => e.id);

      // Persist the narration as an append-only event so it shows up in
      // the campaign log alongside engine events. The payload records which
      // event ids the model was given as authoritative input.
      const narrationEvent = db.appendDmEvent({
        campaignId,
        kind: "narration",
        payload: { text: narration, events_used: eventIdsUsed, style },
      });

      void writeReceipt({
        componentType: "model-call",
        componentName: "magister-dm-narrate",
        reason: "magister:dm:narrate",
        status: "success",
        model: result.model,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        estimatedCostUsd: result.estimatedCostUsd,
        durationMs: result.durationMs,
        meta: {
          campaignId,
          eventCount: events.length,
          style,
          provider: result.provider,
          narrationEventId: narrationEvent.id,
        },
      });

      return reply.send({
        ok: true,
        narration,
        events_used: eventIdsUsed,
        narration_event_id: narrationEvent.id,
        model: result.model,
        provider: result.provider,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        durationMs: result.durationMs,
      });
    },
  );
}
