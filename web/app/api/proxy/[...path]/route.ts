/**
 * Nusika Web — API Proxy
 *
 * Server-side proxy so the browser never directly hits the Nusika API
 * (cleaner CORS story, plus consistent with how the original peh
 * webapp shipped). All non-hop-by-hop headers are forwarded; binary +
 * multipart bodies pass through unmodified.
 *
 * Forwards to NUSIKA_API_URL (default http://127.0.0.1:18793).
 */

import { NextRequest } from "next/server";

const API_BASE = process.env.NUSIKA_API_URL ?? process.env.MAGISTER_API_URL ?? `http://127.0.0.1:${process.env.NUSIKA_PORT ?? process.env.MAGISTER_PORT ?? "18793"}`;

const HOP_BY_HOP = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailers", "transfer-encoding", "upgrade", "host",
]);

async function handler(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  const { path } = await context.params;
  const pathStr = path.join("/");
  const search = request.nextUrl.search;
  const url = `${API_BASE}/${pathStr}${search}`;

  const hasBody = ["POST", "PUT", "PATCH"].includes(request.method);

  const forwardHeaders: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) {
      forwardHeaders[key] = value;
    }
  });

  let body: ArrayBuffer | undefined;
  if (hasBody) {
    body = await request.arrayBuffer();
  }

  // Long-running endpoints (TTS/STT can take a while) get no wall-clock cap.
  const isLongRunning = pathStr.includes("/tts") || pathStr.includes("/stt") || pathStr.includes("/chat");
  const timeoutMs = isLongRunning ? undefined : 60_000;

  let res: globalThis.Response;
  try {
    res = await fetch(url, {
      method: request.method,
      headers: forwardHeaders,
      body: body ? body : undefined,
      ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
      // @ts-ignore — Node fetch needs duplex: "half" to stream request bodies
      duplex: "half",
    });
  } catch (err) {
    const isTimeout = err instanceof DOMException && err.name === "TimeoutError";
    const detail = isTimeout
      ? `Nusika API timed out after ${(timeoutMs ?? 0) / 1000}s — ${pathStr}`
      : String(err);
    console.error(`[nusika-proxy] upstream fetch failed — ${url}:`, detail);
    return new Response(JSON.stringify({ error: isTimeout ? "API timeout" : "Nusika API unreachable", detail, url }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  const contentType = res.headers.get("Content-Type") ?? "application/json";

  return new Response(res.body, {
    status: res.status,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  });
}

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const PUT = handler;
export const DELETE = handler;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 1800;
