/**
 * Slice 5A — error-contract alignment + voice graceful degrade.
 *
 * Asserts that every LLM-backed route returns the same structured 502
 * shape when the upstream provider is unreachable, and that voice routes
 * return a 503 instead of leaking spawn errors when binaries/models are
 * missing.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { NusikaDB } from "../server/db.js";
import { registerAllRoutes } from "../server/routes/index.js";
import { __setCompleteForTesting, __resetCompleteForTesting } from "../server/lib/llm.js";

async function bootApp() {
  const dir = mkdtempSync(join(tmpdir(), "magister-5a-"));
  const db = new NusikaDB(join(dir, "test.db"));
  db.registerModule({ id: "linux", name: "Linux Fundamentals" });

  const app = Fastify({ logger: false });
  // STT route uses multipart parsing — register the plugin so /stt body parses.
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024, files: 1 } });
  await registerAllRoutes(app, db);
  return {
    app, db,
    cleanup: async () => {
      await app.close();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

// ── Session chat error contract ─────────────────────────────────────────────

test("POST /sessions/:id/chat returns 502 with friendly error when LLM fails", async () => {
  const harness = await bootApp();
  __setCompleteForTesting(async () => { throw new Error("simulated fetch failed"); });
  try {
    const create = await harness.app.inject({
      method: "POST", url: "/nusika/sessions",
      payload: {
        module_id: "linux",
        teaching_mode: "narrative",
        concept_id: "x", objective: "y", mastery_signal: "z",
        companion_id: "cronk",
      },
    });
    const sessionId = create.json().session.id as string;

    const res = await harness.app.inject({
      method: "POST", url: `/nusika/sessions/${sessionId}/chat`,
      payload: { message: "hi" },
    });
    assert.equal(res.statusCode, 502);
    const body = res.json();
    assert.equal(body.ok, false);
    assert.match(body.error, /Session chat is unavailable/i);
    assert.equal(typeof body.detail, "string");
    assert.match(body.detail, /simulated fetch failed/);
  } finally {
    __resetCompleteForTesting();
    await harness.cleanup();
  }
});

// ── Translate error contract ────────────────────────────────────────────────

test("POST /nusika/translate returns 502 with friendly error when LLM fails", async () => {
  const harness = await bootApp();
  __setCompleteForTesting(async () => { throw new Error("simulated upstream failure"); });
  try {
    const res = await harness.app.inject({
      method: "POST", url: "/nusika/translate",
      payload: { text: "hello", target_lang: "french" },
    });
    assert.equal(res.statusCode, 502);
    const body = res.json();
    assert.equal(body.ok, false);
    assert.match(body.error, /Translation is unavailable/i);
    assert.equal(typeof body.detail, "string");
  } finally {
    __resetCompleteForTesting();
    await harness.cleanup();
  }
});

test("POST /nusika/translate still validates required fields with 400", async () => {
  const harness = await bootApp();
  try {
    const noText = await harness.app.inject({
      method: "POST", url: "/nusika/translate",
      payload: { target_lang: "french" },
    });
    assert.equal(noText.statusCode, 400);
    const noLang = await harness.app.inject({
      method: "POST", url: "/nusika/translate",
      payload: { text: "hello" },
    });
    assert.equal(noLang.statusCode, 400);
  } finally {
    await harness.cleanup();
  }
});

test("POST /nusika/translate succeeds with mocked completer", async () => {
  const harness = await bootApp();
  __setCompleteForTesting(async () => ({
    text: "Bonjour", model: "test-model", provider: "openrouter",
    tokensIn: 1, tokensOut: 1, estimatedCostUsd: 0, durationMs: 1,
  }));
  try {
    const res = await harness.app.inject({
      method: "POST", url: "/nusika/translate",
      payload: { text: "hello", target_lang: "french" },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.ok, true);
    assert.equal(body.translated, "Bonjour");
  } finally {
    __resetCompleteForTesting();
    await harness.cleanup();
  }
});

// ── Voice graceful degrade ──────────────────────────────────────────────────

test("POST /nusika/tts returns 503 when PIPER_BIN is missing", async () => {
  const harness = await bootApp();
  const prevBin = process.env["PIPER_BIN"];
  const prevDir = process.env["PIPER_VOICES_DIR"];
  process.env["PIPER_BIN"] = "/tmp/this-binary-does-not-exist-magister-test";
  process.env["PIPER_VOICES_DIR"] = "/tmp/voices-do-not-exist";
  try {
    const res = await harness.app.inject({
      method: "POST", url: "/nusika/tts",
      payload: { text: "hello", voice: "test" },
    });
    assert.equal(res.statusCode, 503);
    const body = res.json();
    assert.equal(body.ok, false);
    assert.match(body.error, /TTS not configured/i);
    assert.match(body.detail, /PIPER_BIN/);
    assert.match(body.detail, /not found at/);
    // No raw stderr / Python traceback in the body.
    assert.equal(/Traceback/.test(body.detail), false);
  } finally {
    if (prevBin === undefined) delete process.env["PIPER_BIN"];
    else process.env["PIPER_BIN"] = prevBin;
    if (prevDir === undefined) delete process.env["PIPER_VOICES_DIR"];
    else process.env["PIPER_VOICES_DIR"] = prevDir;
    await harness.cleanup();
  }
});

test("POST /nusika/tts returns 503 when voice file is missing", async () => {
  const harness = await bootApp();
  const prevBin = process.env["PIPER_BIN"];
  const prevDir = process.env["PIPER_VOICES_DIR"];
  // Point binary at something that exists; voices dir at something that doesn't.
  process.env["PIPER_BIN"] = "/usr/bin/true";
  process.env["PIPER_VOICES_DIR"] = "/tmp/magister-test-voices-missing";
  try {
    const res = await harness.app.inject({
      method: "POST", url: "/nusika/tts",
      payload: { text: "hello", voice: "nonexistent-voice" },
    });
    assert.equal(res.statusCode, 503);
    const body = res.json();
    assert.equal(body.ok, false);
    assert.match(body.error, /TTS voice not configured/i);
    assert.match(body.detail, /Voice model not found at/);
    assert.match(body.detail, /nonexistent-voice/);
    assert.equal(/Traceback/.test(body.detail), false);
  } finally {
    if (prevBin === undefined) delete process.env["PIPER_BIN"];
    else process.env["PIPER_BIN"] = prevBin;
    if (prevDir === undefined) delete process.env["PIPER_VOICES_DIR"];
    else process.env["PIPER_VOICES_DIR"] = prevDir;
    await harness.cleanup();
  }
});

test("POST /nusika/tts validates `text` required with 400", async () => {
  const harness = await bootApp();
  try {
    const res = await harness.app.inject({
      method: "POST", url: "/nusika/tts",
      payload: {},
    });
    assert.equal(res.statusCode, 400);
  } finally {
    await harness.cleanup();
  }
});

test("POST /nusika/stt returns 503 when WHISPER_BIN is missing", async () => {
  const harness = await bootApp();
  const prevBin = process.env["WHISPER_BIN"];
  process.env["WHISPER_BIN"] = "/tmp/this-binary-does-not-exist-magister-test";
  try {
    // Multipart upload with a tiny audio blob — body shape doesn't matter,
    // since the route should pre-flight the binary first.
    const boundary = "----magister-test-boundary";
    const body =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="audio"; filename="x.wav"\r\n` +
      `Content-Type: audio/wav\r\n\r\n` +
      `RIFFXXXXWAVEfmt placeholder\r\n` +
      `--${boundary}--\r\n`;
    const res = await harness.app.inject({
      method: "POST", url: "/nusika/stt",
      payload: body,
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    });
    assert.equal(res.statusCode, 503);
    const data = res.json();
    assert.equal(data.ok, false);
    assert.match(data.error, /STT not configured/i);
    assert.match(data.detail, /WHISPER_BIN/);
    assert.match(data.detail, /not found at/);
    assert.equal(/Traceback/.test(data.detail), false);
  } finally {
    if (prevBin === undefined) delete process.env["WHISPER_BIN"];
    else process.env["WHISPER_BIN"] = prevBin;
    await harness.cleanup();
  }
});

test("POST /nusika/stt returns 503 when whisper model is missing (binary present)", async () => {
  const harness = await bootApp();
  const prevBin = process.env["WHISPER_BIN"];
  const prevModel = process.env["WHISPER_MODEL"];
  process.env["WHISPER_BIN"] = "/usr/bin/true";
  process.env["WHISPER_MODEL"] = "/tmp/magister-test-whisper-model-missing.bin";
  try {
    const boundary = "----magister-test-boundary-2";
    const body =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="audio"; filename="x.wav"\r\n` +
      `Content-Type: audio/wav\r\n\r\n` +
      `RIFFXXXXWAVE\r\n` +
      `--${boundary}--\r\n`;
    const res = await harness.app.inject({
      method: "POST", url: "/nusika/stt",
      payload: body,
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    });
    assert.equal(res.statusCode, 503);
    const data = res.json();
    assert.equal(data.ok, false);
    assert.match(data.error, /STT model not configured/i);
    assert.match(data.detail, /Whisper model not found at/);
  } finally {
    if (prevBin === undefined) delete process.env["WHISPER_BIN"];
    else process.env["WHISPER_BIN"] = prevBin;
    if (prevModel === undefined) delete process.env["WHISPER_MODEL"];
    else process.env["WHISPER_MODEL"] = prevModel;
    await harness.cleanup();
  }
});
