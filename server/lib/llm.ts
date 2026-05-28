/**
 * Nusika LLM client.
 *
 * Two backends:
 *   - OpenRouter (cloud, primary) — OpenAI-API-compatible HTTP, supports any
 *     model OpenRouter routes. Model picked from NUSIKA_LLM_MODEL env or
 *     per-call override. Cost estimated from OpenRouter's response when
 *     available, otherwise null.
 *   - Ollama (local fallback) — for local-only mode. Talks to NUSIKA_LOCAL_OLLAMA_URL.
 *     Cost is always 0.
 *
 * The chat endpoint picks a backend at request time based on
 *   - NUSIKA_LOCAL_ONLY=true                  → Ollama only
 *   - OPENROUTER_API_KEY present + not local-only → OpenRouter, fall back to Ollama on failure
 *   - neither configured                      → throws "no LLM backend available"
 *
 * No streaming yet — nusika UI doesn't depend on it.
 */

import { nenv } from "./env.js";

export interface CompletionMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompletionRequest {
  messages: CompletionMessage[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
  reason?: string;
}

export interface CompletionResult {
  text: string;
  model: string;
  provider: "openrouter" | "ollama";
  tokensIn: number;
  tokensOut: number;
  estimatedCostUsd: number;
  durationMs: number;
}

export interface LlmConfig {
  openrouterApiKey?: string;
  openrouterDefaultModel?: string;
  openrouterReferer?: string;
  openrouterAppName?: string;
  ollamaUrl?: string;
  ollamaDefaultModel?: string;
  localOnly: boolean;
}

export function loadLlmConfig(): LlmConfig {
  return {
    ...(process.env["OPENROUTER_API_KEY"] ? { openrouterApiKey: process.env["OPENROUTER_API_KEY"] } : {}),
    openrouterDefaultModel: nenv("LLM_MODEL", "anthropic/claude-haiku-4-5")!,
    ...(nenv("OPENROUTER_REFERER") ? { openrouterReferer: nenv("OPENROUTER_REFERER")! } : {}),
    openrouterAppName: nenv("OPENROUTER_APP_NAME", "Nusika")!,
    ollamaUrl: nenv("LOCAL_OLLAMA_URL", "http://127.0.0.1:11434")!,
    ollamaDefaultModel: nenv("LOCAL_OLLAMA_MODEL", "qwen2.5:7b")!,
    localOnly: (process.env["NUSIKA_LOCAL_ONLY"] ?? process.env["MAGISTER_LOCAL_ONLY"]) === "true",
  };
}

interface OpenRouterChoice {
  message?: { content?: string };
  finish_reason?: string;
}

interface OpenRouterResponse {
  choices?: OpenRouterChoice[];
  model?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

async function completeOpenRouter(req: CompletionRequest, cfg: LlmConfig): Promise<CompletionResult> {
  if (!cfg.openrouterApiKey) throw new Error("OPENROUTER_API_KEY not set");
  const model = req.model ?? cfg.openrouterDefaultModel ?? "anthropic/claude-haiku-4-5";
  const start = Date.now();

  const headers: Record<string, string> = {
    "Authorization": `Bearer ${cfg.openrouterApiKey}`,
    "Content-Type": "application/json",
    "X-Title": cfg.openrouterAppName ?? "Nusika",
  };
  if (cfg.openrouterReferer) headers["HTTP-Referer"] = cfg.openrouterReferer;

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: req.messages,
      max_tokens: req.maxTokens ?? 1024,
      temperature: req.temperature ?? 0.7,
      stream: false,
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`OpenRouter HTTP ${res.status}: ${detail.slice(0, 300)}`);
  }

  const data = await res.json() as OpenRouterResponse;
  const text = data.choices?.[0]?.message?.content ?? "";
  const tokensIn = data.usage?.prompt_tokens ?? 0;
  const tokensOut = data.usage?.completion_tokens ?? 0;

  // OpenRouter doesn't return per-call cost in the standard response — leave 0.
  // Real cost lives in the OpenRouter dashboard / generations API.
  return {
    text,
    model: data.model ?? model,
    provider: "openrouter",
    tokensIn,
    tokensOut,
    estimatedCostUsd: 0,
    durationMs: Date.now() - start,
  };
}

interface OllamaResponse {
  message?: { content?: string };
  model?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  done_reason?: string;
}

async function completeOllama(req: CompletionRequest, cfg: LlmConfig): Promise<CompletionResult> {
  const baseUrl = cfg.ollamaUrl ?? "http://127.0.0.1:11434";
  const model = req.model ?? cfg.ollamaDefaultModel ?? "qwen2.5:7b";
  const start = Date.now();

  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: req.messages,
      stream: false,
      options: {
        num_predict: req.maxTokens ?? 1024,
        temperature: req.temperature ?? 0.7,
      },
    }),
    signal: AbortSignal.timeout(180_000),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Ollama HTTP ${res.status}: ${detail.slice(0, 300)}`);
  }

  const data = await res.json() as OllamaResponse;
  return {
    text: data.message?.content ?? "",
    model: data.model ?? model,
    provider: "ollama",
    tokensIn: data.prompt_eval_count ?? 0,
    tokensOut: data.eval_count ?? 0,
    estimatedCostUsd: 0,
    durationMs: Date.now() - start,
  };
}

/**
 * Real completion implementation. Chooses backend and falls back on cloud
 * failure unless local-only is forced.
 */
async function defaultComplete(req: CompletionRequest): Promise<CompletionResult> {
  const cfg = loadLlmConfig();

  if (cfg.localOnly) {
    return completeOllama(req, cfg);
  }

  if (cfg.openrouterApiKey) {
    try {
      return await completeOpenRouter(req, cfg);
    } catch (err) {
      // Fall through to local fallback when Ollama is configured.
      if (!cfg.ollamaUrl) throw err;
      try {
        return await completeOllama(req, cfg);
      } catch (fallbackErr) {
        throw new Error(`OpenRouter failed (${String(err).slice(0, 150)}); Ollama fallback also failed (${String(fallbackErr).slice(0, 150)})`);
      }
    }
  }

  // No cloud key — try local.
  return completeOllama(req, cfg);
}

/**
 * Test seam: tests can replace the active completer to assert structured
 * error paths without making real network calls. Always reset in finally.
 */
let activeCompleter: (req: CompletionRequest) => Promise<CompletionResult> = defaultComplete;

export async function complete(req: CompletionRequest): Promise<CompletionResult> {
  return activeCompleter(req);
}

export function __setCompleteForTesting(
  fn: (req: CompletionRequest) => Promise<CompletionResult>,
): void {
  activeCompleter = fn;
}

export function __resetCompleteForTesting(): void {
  activeCompleter = defaultComplete;
}
