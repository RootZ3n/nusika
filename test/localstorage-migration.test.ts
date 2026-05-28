/**
 * localStorage migration tests — proves that old magister.* keys are read
 * as fallback, and new nusika.* keys are written on migration.
 *
 * Since these are browser APIs, we mock localStorage with a simple Map.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

// ── Mock localStorage ────────────────────────────────────────────────────────

class MockStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null { return this.store.get(key) ?? null; }
  setItem(key: string, value: string): void { this.store.set(key, value); }
  removeItem(key: string): void { this.store.delete(key); }
  clear(): void { this.store.clear(); }
  get length(): number { return this.store.size; }
  key(_: number): string | null { return null; }
  keys(): string[] { return [...this.store.keys()]; }
}

// Install the mock before importing the module under test.
const mockStorage = new MockStorage();
(globalThis as unknown as { window: { localStorage: MockStorage } }).window = {
  localStorage: mockStorage,
};

// Now import — the module checks `typeof window` so the mock must exist first.
// We use dynamic import to ensure the mock is in place.
const {
  TEACH_VOICE_KEY,
  DM_VOICE_KEY,
  HALL_VOICE_KEY,
  readStoredVoiceId,
  writeStoredVoiceId,
} = await import("../web/app/lib/voice-picker.js");

// ── Tests ────────────────────────────────────────────────────────────────────

test("new nusika.* keys are the canonical keys", () => {
  assert.equal(TEACH_VOICE_KEY, "nusika.teach.voiceProfileId");
  assert.equal(DM_VOICE_KEY, "nusika.dm.voiceProfileId");
  assert.equal(HALL_VOICE_KEY, "nusika.hall.voiceProfileId");
});

test("readStoredVoiceId reads from new nusika.* key when set", () => {
  mockStorage.clear();
  mockStorage.setItem("nusika.teach.voiceProfileId", "am_michael");
  const val = readStoredVoiceId(TEACH_VOICE_KEY);
  assert.equal(val, "am_michael");
});

test("readStoredVoiceId falls back to legacy magister.* key", () => {
  mockStorage.clear();
  mockStorage.setItem("magister.teach.voiceProfileId", "af_heart");
  const val = readStoredVoiceId(TEACH_VOICE_KEY);
  assert.equal(val, "af_heart");
});

test("readStoredVoiceId migrates legacy key to new key on read", () => {
  mockStorage.clear();
  mockStorage.setItem("magister.dm.voiceProfileId", "bm_george");
  // Read triggers migration
  const val = readStoredVoiceId(DM_VOICE_KEY);
  assert.equal(val, "bm_george");
  // Now the new key should be set
  assert.equal(mockStorage.getItem("nusika.dm.voiceProfileId"), "bm_george");
});

test("new key takes precedence over legacy key", () => {
  mockStorage.clear();
  mockStorage.setItem("magister.hall.voiceProfileId", "old_voice");
  mockStorage.setItem("nusika.hall.voiceProfileId", "new_voice");
  const val = readStoredVoiceId(HALL_VOICE_KEY);
  assert.equal(val, "new_voice");
});

test("writeStoredVoiceId writes to new nusika.* key", () => {
  mockStorage.clear();
  writeStoredVoiceId(TEACH_VOICE_KEY, "af_nova");
  assert.equal(mockStorage.getItem("nusika.teach.voiceProfileId"), "af_nova");
  // Should NOT write to the legacy key
  assert.equal(mockStorage.getItem("magister.teach.voiceProfileId"), null);
});

test("readStoredVoiceId returns null when neither key exists", () => {
  mockStorage.clear();
  const val = readStoredVoiceId(TEACH_VOICE_KEY);
  assert.equal(val, null);
});
