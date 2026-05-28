import { randomUUID } from "node:crypto";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { receiptsDir } from "./paths.js";
import { consoleLogger } from "./log.js";

export interface Receipt {
  componentType: "model-call" | "module-event";
  componentName: string;
  reason: string;
  status?: "success" | "warn" | "failure";
  surfacedToUser?: boolean;
  model?: string | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  estimatedCostUsd?: number | null;
  durationMs?: number | null;
  meta?: Record<string, unknown>;
}

/**
 * Append-only JSONL receipt writer. One file per UTC day under NUSIKA_RECEIPTS_DIR
 * (default <state>/receipts). Failures log but never throw — receipt writes
 * must not break the request path.
 *
 * Mirrors the squidley-v2 receipt shape so logs are interchangeable when
 * nusika calls are aggregated alongside squidley calls.
 */
export async function writeReceipt(input: Receipt): Promise<string | null> {
  const id = randomUUID();
  const timestamp = new Date().toISOString();
  const date = timestamp.slice(0, 10);
  const line = JSON.stringify({
    id,
    timestamp,
    moduleId: "magister",
    componentType: input.componentType,
    componentName: input.componentName,
    reason: input.reason,
    status: input.status ?? "success",
    surfacedToUser: input.surfacedToUser ?? true,
    model: input.model ?? null,
    tokensIn: input.tokensIn ?? null,
    tokensOut: input.tokensOut ?? null,
    estimatedCostUsd: input.estimatedCostUsd ?? null,
    durationMs: input.durationMs ?? null,
    meta: input.meta ?? {},
  });
  try {
    await appendFile(join(receiptsDir(), `${date}.jsonl`), line + "\n", "utf-8");
    return id;
  } catch (err) {
    consoleLogger.warn(`receipt write failed: ${String(err)}`);
    return null;
  }
}
