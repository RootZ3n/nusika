/**
 * Slice 6D — Kokoro client unit tests. fetch is stubbed via the test seam.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  kokoroBaseUrl,
  kokoroHealth,
  kokoroGenerate,
  __setKokoroFetchForTesting,
  __resetKokoroFetchForTesting,
  type KokoroGenerateError,
} from "../server/lib/voices/kokoro.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function bytesResponse(status: number, bytes: Uint8Array, contentType = "audio/wav"): Response {
  return new Response(bytes, { status, headers: { "Content-Type": contentType } });
}

// ── kokoroBaseUrl ────────────────────────────────────────────────────────────

test("kokoroBaseUrl reads NUSIKA_KOKORO_URL with default fallback", () => {
  const prev = process.env["NUSIKA_KOKORO_URL"];
  try {
    delete process.env["NUSIKA_KOKORO_URL"];
    assert.equal(kokoroBaseUrl(), "http://127.0.0.1:18794");
    process.env["NUSIKA_KOKORO_URL"] = "http://kokoro.example:9000/";
    assert.equal(kokoroBaseUrl(), "http://kokoro.example:9000", "trailing slash trimmed");
  } finally {
    if (prev === undefined) delete process.env["NUSIKA_KOKORO_URL"];
    else process.env["NUSIKA_KOKORO_URL"] = prev;
  }
});

// ── health ───────────────────────────────────────────────────────────────────

test("kokoroHealth returns reachable:true on healthy ok response", async () => {
  __setKokoroFetchForTesting(async (url) => {
    assert.match(String(url), /\/health$/);
    return jsonResponse(200, { ok: true, engine: "kokoro", status: "ready", model_loaded: true });
  });
  try {
    const h = await kokoroHealth();
    assert.equal(h.reachable, true);
    assert.equal(h.ok, true);
    assert.equal(h.status, "ready");
    assert.equal(h.model_loaded, true);
  } finally {
    __resetKokoroFetchForTesting();
  }
});

test("kokoroHealth returns reachable:false on network error", async () => {
  __setKokoroFetchForTesting(async () => { throw new Error("ECONNREFUSED"); });
  try {
    const h = await kokoroHealth();
    assert.equal(h.reachable, false);
    assert.match(h.detail ?? "", /not reachable/i);
    assert.match(h.detail ?? "", /ECONNREFUSED/);
  } finally {
    __resetKokoroFetchForTesting();
  }
});

test("kokoroHealth returns reachable:false on non-200", async () => {
  __setKokoroFetchForTesting(async () => jsonResponse(503, { ok: false, error: "down" }));
  try {
    const h = await kokoroHealth();
    assert.equal(h.reachable, false);
    assert.match(h.detail ?? "", /HTTP 503/);
  } finally {
    __resetKokoroFetchForTesting();
  }
});

test("kokoroHealth returns reachable:false on ok:false body", async () => {
  __setKokoroFetchForTesting(async () => jsonResponse(200, { ok: false }));
  try {
    const h = await kokoroHealth();
    assert.equal(h.reachable, false);
    assert.match(h.detail ?? "", /unhealthy/i);
  } finally {
    __resetKokoroFetchForTesting();
  }
});

test("kokoroHealth rejects an ok:true response that is not Kokoro (opencode-sidecar squatter)", async () => {
  // opencode-sidecar shape — observed in the wild squatting :18794.
  __setKokoroFetchForTesting(async () =>
    jsonResponse(200, { ok: true, service: "opencode-sidecar", version: "1.0.0" }),
  );
  try {
    const h = await kokoroHealth();
    assert.equal(h.reachable, false, "must not accept a non-Kokoro service as Kokoro");
    assert.match(h.detail ?? "", /not Kokoro/i);
    assert.match(h.detail ?? "", /opencode-sidecar/);
    assert.match(h.detail ?? "", /NUSIKA_KOKORO_URL/);
  } finally {
    __resetKokoroFetchForTesting();
  }
});

test("kokoroHealth rejects a generic ok:true with no engine field", async () => {
  __setKokoroFetchForTesting(async () => jsonResponse(200, { ok: true }));
  try {
    const h = await kokoroHealth();
    assert.equal(h.reachable, false, "ok:true alone must not satisfy the Kokoro probe");
    assert.match(h.detail ?? "", /not Kokoro/i);
  } finally {
    __resetKokoroFetchForTesting();
  }
});

test("kokoroHealth accepts Kokoro in cold and error states (engine:'kokoro' is sufficient)", async () => {
  // Cold start — pipeline not loaded yet.
  __setKokoroFetchForTesting(async () =>
    jsonResponse(200, { ok: true, engine: "kokoro", status: "cold", model_loaded: false }),
  );
  try {
    const cold = await kokoroHealth();
    assert.equal(cold.reachable, true);
    assert.equal(cold.status, "cold");
  } finally {
    __resetKokoroFetchForTesting();
  }

  // Load failure — server is up but the model couldn't load; still
  // identifiably Kokoro, so the probe reports reachable. The registry
  // is responsible for surfacing the status to the operator.
  __setKokoroFetchForTesting(async () =>
    jsonResponse(200, {
      ok: true, engine: "kokoro", status: "error", model_loaded: false,
      detail: "espeak-ng missing",
    }),
  );
  try {
    const err = await kokoroHealth();
    assert.equal(err.reachable, true);
    assert.equal(err.status, "error");
    assert.match(err.detail ?? "", /espeak-ng/);
  } finally {
    __resetKokoroFetchForTesting();
  }
});

// ── generate ─────────────────────────────────────────────────────────────────

test("kokoroGenerate returns the response body bytes on 200", async () => {
  const wav = Buffer.from("RIFF\x00\x00\x00\x00WAVE-fake-but-recognizable");
  __setKokoroFetchForTesting(async (url, init) => {
    assert.match(String(url), /\/generate$/);
    assert.equal((init as RequestInit).method, "POST");
    const body = JSON.parse(String((init as RequestInit).body));
    assert.equal(body.voice, "af_heart");
    assert.equal(body.text, "Hello.");
    assert.equal(body.format, "wav");
    return bytesResponse(200, wav);
  });
  try {
    const out = await kokoroGenerate({ voice: "af_heart", text: "Hello." });
    assert.ok(Buffer.isBuffer(out));
    assert.equal(out.equals(wav), true);
  } finally {
    __resetKokoroFetchForTesting();
  }
});

test("kokoroGenerate throws structured error on 503 with safe detail", async () => {
  __setKokoroFetchForTesting(async () =>
    jsonResponse(503, { ok: false, error: "Kokoro generation failed.", detail: "espeak-ng missing" }),
  );
  try {
    await assert.rejects(
      () => kokoroGenerate({ voice: "af_heart", text: "x" }),
      (err: unknown) => {
        const e = err as KokoroGenerateError;
        assert.equal(e.message, "Kokoro generation failed.");
        assert.equal(e.status, 503);
        assert.equal(e.reachable, true);
        assert.match(e.detail ?? "", /Kokoro generation failed.*espeak-ng missing/);
        return true;
      },
    );
  } finally {
    __resetKokoroFetchForTesting();
  }
});

test("kokoroGenerate throws reachable:false on network failure", async () => {
  __setKokoroFetchForTesting(async () => { throw new Error("ECONNREFUSED 127.0.0.1:18794"); });
  try {
    await assert.rejects(
      () => kokoroGenerate({ voice: "af_heart", text: "x" }),
      (err: unknown) => {
        const e = err as KokoroGenerateError;
        assert.equal(e.message, "Kokoro service not reachable.");
        assert.equal(e.reachable, false);
        assert.match(e.detail ?? "", /ECONNREFUSED/);
        // Status is unset on a network failure (we never reached the upstream).
        assert.equal(e.status, undefined);
        return true;
      },
    );
  } finally {
    __resetKokoroFetchForTesting();
  }
});

test("kokoroGenerate caps detail length to avoid leaking long upstream errors", async () => {
  // Build a very long detail to verify truncation works.
  const longDetail = "x".repeat(2000);
  __setKokoroFetchForTesting(async () =>
    jsonResponse(503, { ok: false, error: "Kokoro generation failed.", detail: longDetail }),
  );
  try {
    await assert.rejects(
      () => kokoroGenerate({ voice: "af_heart", text: "x" }),
      (err: unknown) => {
        const e = err as KokoroGenerateError;
        assert.ok((e.detail ?? "").length <= 240, `detail length ${e.detail!.length} should be <= 240`);
        return true;
      },
    );
  } finally {
    __resetKokoroFetchForTesting();
  }
});
