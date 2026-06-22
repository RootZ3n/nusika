/**
 * Nusika LLM client.
 *
 * Multiple backends supported via LLM_PROVIDER env var:
 *   - openrouter  (default cloud) — OpenAI-API-compatible
 *   - openai      — api.openai.com
 *   - anthropic   — api.anthropic.com (messages API)
 *   - google      — generativelanguage.googleapis.com (generateContent)
 *   - deepseek    — api.deepseek.com (OpenAI-compatible)
 *   - mimo        — api.xiaomi.com (OpenAI-compatible)
 *   - groq        — api.groq.com (OpenAI-compatible)
 *   - mistral     — api.mistral.ai (OpenAI-compatible)
 *   - together    — api.together.xyz (OpenAI-compatible)
 *   - minimax     — api.minimax.io chatcompletion_v2 (companion roleplay: MiniMax-M3)
 *   - ollama      — local fallback
 *
 * When LLM_PROVIDER is not set, the legacy behavior applies:
 *   - NUSIKA_LOCAL_ONLY=true → Ollama only
 *   - OPENROUTER_API_KEY present → OpenRouter, fall back to Ollama
 *   - neither → Ollama
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
  provider: LlmProvider;
  tokensIn: number;
  tokensOut: number;
  estimatedCostUsd: number;
  durationMs: number;
}

export type LlmProvider =
  | "openrouter"
  | "openai"
  | "anthropic"
  | "google"
  | "deepseek"
  | "mimo"
  | "groq"
  | "mistral"
  | "together"
  | "minimax"
  | "ollama";

/** All providers that use the OpenAI-compatible /v1/chat/completions format. */
const OPENAI_COMPATIBLE_PROVIDERS: LlmProvider[] = [
  "openrouter", "openai", "deepseek", "mimo", "groq", "mistral", "together", "minimax",
];

interface ProviderEndpoint {
  baseUrl: string;
  defaultModel: string;
  apiKeyEnv: string;
  extraHeaders?: Record<string, string>;
}

/** Provider metadata: base URL, env var for API key, default model. */
const PROVIDER_ENDPOINTS: Record<string, ProviderEndpoint> = {
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1/chat/completions",
    defaultModel: "anthropic/claude-haiku-4-5",
    apiKeyEnv: "OPENROUTER_API_KEY",
  },
  openai: {
    baseUrl: "https://api.openai.com/v1/chat/completions",
    defaultModel: "gpt-4o-mini",
    apiKeyEnv: "OPENAI_API_KEY",
  },
  deepseek: {
    baseUrl: "https://api.deepseek.com/v1/chat/completions",
    defaultModel: "deepseek-chat",
    apiKeyEnv: "DEEPSEEK_API_KEY",
  },
  mimo: {
    baseUrl: "https://api.xiaomi.com/v1/chat/completions",
    defaultModel: "mimo-v2-pro",
    apiKeyEnv: "MIMO_API_KEY",
  },
  groq: {
    baseUrl: "https://api.groq.com/openai/v1/chat/completions",
    defaultModel: "llama-3.3-70b-versatile",
    apiKeyEnv: "GROQ_API_KEY",
  },
  mistral: {
    baseUrl: "https://api.mistral.ai/v1/chat/completions",
    defaultModel: "mistral-small-latest",
    apiKeyEnv: "MISTRAL_API_KEY",
  },
  together: {
    baseUrl: "https://api.together.xyz/v1/chat/completions",
    defaultModel: "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo",
    apiKeyEnv: "TOGETHER_API_KEY",
  },
  minimax: {
    // MiniMax international platform. chatcompletion_v2 is OpenAI-shape-compatible
    // (messages in, choices[].message.content out) but returns a base_resp status.
    // MiniMax-M3 is the current chat model — warm, conversational, good for
    // companion roleplay and returns content directly. (The M2/M2.7 "reasoning"
    // variants spend the token budget on hidden reasoning and return empty
    // content via this path; the registry's "MiniMax-M2.7-her" is a display
    // label, not a valid API model id.)
    baseUrl: "https://api.minimax.io/v1/text/chatcompletion_v2",
    defaultModel: "MiniMax-M3",
    apiKeyEnv: "MINIMAX_API_KEY",
  },
  anthropic: {
    baseUrl: "https://api.anthropic.com/v1/messages",
    defaultModel: "claude-sonnet-4-20250514",
    apiKeyEnv: "ANTHROPIC_API_KEY",
  },
  google: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/models",
    defaultModel: "gemini-2.0-flash",
    apiKeyEnv: "GOOGLE_API_KEY",
  },
};

export interface LlmConfig {
  /** Explicitly selected provider (from LLM_PROVIDER env). */
  provider?: LlmProvider;
  localOnly: boolean;

  // Legacy fields for backward compatibility
  openrouterApiKey?: string;
  openrouterDefaultModel?: string;
  openrouterReferer?: string;
  openrouterAppName?: string;
  ollamaUrl?: string;
  ollamaDefaultModel?: string;
}

export function loadLlmConfig(): LlmConfig {
  const provider = nenv("LLM_PROVIDER") as LlmProvider | undefined;
  return {
    ...(provider ? { provider } : {}),
    ...(process.env["OPENROUTER_API_KEY"] ? { openrouterApiKey: process.env["OPENROUTER_API_KEY"] } : {}),
    openrouterDefaultModel: nenv("LLM_MODEL", "anthropic/claude-haiku-4-5")!,
    ...(nenv("OPENROUTER_REFERER") ? { openrouterReferer: nenv("OPENROUTER_REFERER")! } : {}),
    openrouterAppName: nenv("OPENROUTER_APP_NAME", "Nusika")!,
    ollamaUrl: nenv("LOCAL_OLLAMA_URL", "http://127.0.0.1:11434")!,
    ollamaDefaultModel: nenv("LOCAL_OLLAMA_MODEL", "qwen2.5:7b")!,
    localOnly: (process.env["NUSIKA_LOCAL_ONLY"] ?? process.env["MAGISTER_LOCAL_ONLY"]) === "true",
  };
}

// ── Response shapes ──────────────────────────────────────────────────

interface OpenAICompatChoice {
  message?: { content?: string };
  finish_reason?: string;
}

interface OpenAICompatResponse {
  choices?: OpenAICompatChoice[];
  model?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  /** MiniMax returns HTTP 200 even on errors; the real status is here. */
  base_resp?: { status_code?: number; status_msg?: string };
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
}

interface AnthropicResponse {
  content?: AnthropicContentBlock[];
  model?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string; type?: string };
}

interface GooglePart {
  text?: string;
}

interface GoogleCandidate {
  content?: { parts?: GooglePart[] };
  finishReason?: string;
}

interface GoogleGenerateContentResponse {
  candidates?: GoogleCandidate[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
  error?: { message?: string; code?: number };
}

interface OllamaResponse {
  message?: { content?: string };
  model?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  done_reason?: string;
}

// ── OpenAI-compatible fetch (used by openrouter, openai, deepseek, mimo, groq, mistral, together) ──

async function completeOpenAICompat(
  provider: LlmProvider,
  req: CompletionRequest,
  apiKey: string,
  url: string,
  defaultModel: string,
  extraHeaders?: Record<string, string>,
): Promise<CompletionResult> {
  const model = req.model ?? defaultModel;
  const start = Date.now();

  const headers: Record<string, string> = {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    ...extraHeaders,
  };

  const res = await fetch(url, {
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
    throw new Error(`${provider} HTTP ${res.status}: ${detail.slice(0, 300)}`);
  }

  const data = await res.json() as OpenAICompatResponse;
  // MiniMax replies HTTP 200 with a non-zero base_resp.status_code on errors
  // (auth, quota, bad model). Other OpenAI-compatible providers omit base_resp.
  if (data.base_resp && typeof data.base_resp.status_code === "number" && data.base_resp.status_code !== 0) {
    throw new Error(`${provider} error ${data.base_resp.status_code}: ${data.base_resp.status_msg ?? "unknown"}`);
  }
  const text = data.choices?.[0]?.message?.content ?? "";
  const tokensIn = data.usage?.prompt_tokens ?? 0;
  const tokensOut = data.usage?.completion_tokens ?? 0;

  return {
    text,
    model: data.model ?? model,
    provider,
    tokensIn,
    tokensOut,
    estimatedCostUsd: 0,
    durationMs: Date.now() - start,
  };
}

// ── Anthropic Messages API ───────────────────────────────────────────

async function completeAnthropic(req: CompletionRequest, apiKey: string, defaultModel: string): Promise<CompletionResult> {
  const model = req.model ?? defaultModel;
  const start = Date.now();

  // Anthropic uses a separate system field, not a message with role "system".
  const systemMsg = req.messages.filter(m => m.role === "system").map(m => m.content).join("\n\n");
  const nonSystemMsgs = req.messages.filter(m => m.role !== "system");

  const body: Record<string, unknown> = {
    model,
    max_tokens: req.maxTokens ?? 1024,
    temperature: req.temperature ?? 0.7,
    messages: nonSystemMsgs.map(m => ({ role: m.role, content: m.content })),
  };
  if (systemMsg) body.system = systemMsg;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Anthropic HTTP ${res.status}: ${detail.slice(0, 300)}`);
  }

  const data = await res.json() as AnthropicResponse;
  if (data.error) throw new Error(`Anthropic error: ${data.error.message}`);

  const text = data.content?.map(b => b.text ?? "").join("") ?? "";
  const tokensIn = data.usage?.input_tokens ?? 0;
  const tokensOut = data.usage?.output_tokens ?? 0;

  return {
    text,
    model: data.model ?? model,
    provider: "anthropic",
    tokensIn,
    tokensOut,
    estimatedCostUsd: 0,
    durationMs: Date.now() - start,
  };
}

// ── Google Gemini generateContent ────────────────────────────────────

async function completeGoogle(req: CompletionRequest, apiKey: string, defaultModel: string): Promise<CompletionResult> {
  const model = req.model ?? defaultModel;
  const start = Date.now();

  // Gemini uses contents with parts; system instruction is separate.
  const systemMsg = req.messages.filter(m => m.role === "system").map(m => m.content).join("\n\n");
  const nonSystemMsgs = req.messages.filter(m => m.role !== "system");

  // Map roles: "assistant" → "model", "user" stays "user"
  const contents = nonSystemMsgs.map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      maxOutputTokens: req.maxTokens ?? 1024,
      temperature: req.temperature ?? 0.7,
    },
  };
  if (systemMsg) {
    body.systemInstruction = { parts: [{ text: systemMsg }] };
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Google Gemini HTTP ${res.status}: ${detail.slice(0, 300)}`);
  }

  const data = await res.json() as GoogleGenerateContentResponse;
  if (data.error) throw new Error(`Google Gemini error: ${data.error.message}`);

  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text ?? "").join("") ?? "";
  const tokensIn = data.usageMetadata?.promptTokenCount ?? 0;
  const tokensOut = data.usageMetadata?.candidatesTokenCount ?? 0;

  return {
    text,
    model,
    provider: "google",
    tokensIn,
    tokensOut,
    estimatedCostUsd: 0,
    durationMs: Date.now() - start,
  };
}

// ── Legacy OpenRouter (preserves referer/appname header behavior) ────

async function completeOpenRouterLegacy(req: CompletionRequest, cfg: LlmConfig): Promise<CompletionResult> {
  if (!cfg.openrouterApiKey) throw new Error("OPENROUTER_API_KEY not set");
  const extraHeaders: Record<string, string> = {
    "X-Title": cfg.openrouterAppName ?? "Nusika",
  };
  if (cfg.openrouterReferer) extraHeaders["HTTP-Referer"] = cfg.openrouterReferer;

  const ep = PROVIDER_ENDPOINTS.openrouter!;
  return completeOpenAICompat(
    "openrouter", req, cfg.openrouterApiKey, ep.baseUrl,
    req.model ?? cfg.openrouterDefaultModel ?? ep.defaultModel,
    extraHeaders,
  );
}

// ── Ollama ───────────────────────────────────────────────────────────

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

// ── Provider dispatch ────────────────────────────────────────────────

/**
 * Resolve the API key for a provider from environment variables.
 * Checks NUSIKA_<KEY> first (via nenv), then the raw env var.
 */
function resolveApiKey(envVar: string): string | undefined {
  return process.env[`NUSIKA_${envVar}`] ?? process.env[envVar];
}

/**
 * Dispatch to a specific provider given an LlmProvider name.
 */
async function completeWithProvider(
  provider: LlmProvider,
  req: CompletionRequest,
  cfg: LlmConfig,
): Promise<CompletionResult> {
  // Ollama uses its own protocol.
  if (provider === "ollama") return completeOllama(req, cfg);

  // Legacy OpenRouter path preserves referer/appname headers.
  if (provider === "openrouter") return completeOpenRouterLegacy(req, cfg);

  // Anthropic Messages API.
  if (provider === "anthropic") {
    const ep = PROVIDER_ENDPOINTS.anthropic!;
    const apiKey = resolveApiKey(ep.apiKeyEnv);
    if (!apiKey) throw new Error(`${ep.apiKeyEnv} not set`);
    return completeAnthropic(req, apiKey, req.model ?? ep.defaultModel);
  }

  // Google Gemini generateContent API.
  if (provider === "google") {
    const ep = PROVIDER_ENDPOINTS.google!;
    const apiKey = resolveApiKey(ep.apiKeyEnv);
    if (!apiKey) throw new Error(`${ep.apiKeyEnv} not set`);
    return completeGoogle(req, apiKey, req.model ?? ep.defaultModel);
  }

  // Everything else is OpenAI-compatible.
  const ep = PROVIDER_ENDPOINTS[provider];
  if (!ep) throw new Error(`Unknown provider: ${provider}`);
  const apiKey = resolveApiKey(ep.apiKeyEnv);
  if (!apiKey) throw new Error(`${ep.apiKeyEnv} not set`);
  return completeOpenAICompat(provider, req, apiKey, ep.baseUrl, req.model ?? ep.defaultModel);
}

/**
 * Real completion implementation.
 *
 * When LLM_PROVIDER is set, use that provider directly (no fallback).
 * When not set, legacy behavior: OpenRouter → Ollama fallback.
 */
async function defaultComplete(req: CompletionRequest): Promise<CompletionResult> {
  const cfg = loadLlmConfig();

  // Explicit provider selection via LLM_PROVIDER.
  if (cfg.provider) {
    return completeWithProvider(cfg.provider, req, cfg);
  }

  // Legacy fallback path.
  if (cfg.localOnly) {
    return completeOllama(req, cfg);
  }

  if (cfg.openrouterApiKey) {
    try {
      return await completeOpenRouterLegacy(req, cfg);
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
