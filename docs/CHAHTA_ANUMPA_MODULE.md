# Chahta Anumpa Module

> **Status:** Phase 1 scaffold (2026-05)
>
> Choctaw language practice with verified source attribution.
> Every word and phrase carries its source. Peh guides your practice,
> but verified Choctaw Nation language resources remain the source of truth.

## Purpose

Chahta Anumpa helps learners practice Choctaw language basics through a
source-disciplined companion interface. This is a learning companion,
not an authority.

## Source-of-Truth Rule

1. **Every word/phrase must have a `source` field** with `name`, `url` (optional), and `type`.
2. **Every word/phrase must have `verificationStatus`**: `verified`, `user_provided`, `draft`, or `unverified`.
3. The app **must never teach unverified content as confirmed**.
4. AI-generated explanations are **clearly separated** from verified dictionary/course material.
5. If source data is missing, **Peh must say he cannot verify it**.
6. **No invented Choctaw translations.** Ever.

## Verification Statuses

| Status | Meaning |
|--------|---------|
| `verified` | Confirmed against a known Choctaw language resource (dictionary, course, tribal publication) |
| `user_provided` | Submitted by a user; not yet confirmed against an authoritative source |
| `draft` | Added as a candidate entry; pending verification |
| `unverified` | Source unclear or unconfirmed; must not be presented as fact |

## Source Types

| Type | Meaning |
|------|---------|
| `tribe_resource` | Official Choctaw Nation language materials |
| `dictionary` | Published dictionary or word list |
| `course` | Structured language course |
| `user_note` | User-submitted note |
| `unknown` | Source not identified |

## Peh's Role

Peh is a practice guide, not an authority on the Choctaw language.
Peh may:
- Present verified vocabulary for practice
- Encourage repetition and recall
- Narrate practice sessions warmly
- Clearly label what is verified vs. what is not
- Say "I cannot verify that" when source data is missing

Peh must not:
- Invent Choctaw translations
- Claim fluency or cultural authority
- Present unverified content as confirmed
- Replace official Choctaw Nation language classes

## API Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/nusika/chahta-anumpa/lessons` | List lessons with expanded word/phrase data |
| GET | `/nusika/chahta-anumpa/words` | All words with source + verification metadata |
| GET | `/nusika/chahta-anumpa/phrases` | All phrases with source + verification metadata |

All responses include `verificationStatus` and `source` for every entry.

## Data Model (Phase 1)

Phase 1 serves read-only seed data from `curriculum/chahta-anumpa/seed-data.json`.
No database table — the model is intentionally simple to validate the approach.

### WordEntry
- `id`, `choctaw`, `english`, `partOfSpeech`, `pronunciationAudioUrl`
- `source: { name, url, type }`
- `verificationStatus`
- `notes`, `culturalNote`

### PhraseEntry
- `id`, `choctaw`, `english`
- `source: { name, url, type }`
- `verificationStatus`
- `notes`

### LessonEntry
- `id`, `title`, `description`
- `wordIds[]`, `phraseIds[]`
- `pehIntro` (Peh's lesson introduction)

## Seed Content (Phase 1)

- **halito** = hello (verified, tribe_resource)
- **yakoke** = thank you (verified, tribe_resource)
- One lesson: "Halito" (greetings and gratitude)

No additional vocabulary is included without source backing.

## What This Module Does NOT Do

- Does not scrape external websites
- Does not bulk import vocabulary
- Does not invent translations
- Does not add unsourced lessons
- Does not claim partnership with the Choctaw Nation
- Does not claim cultural authority
- Does not replace official courses/classes

## Future Plan

### Phase 2: Verified Dictionary Importer
Import vocabulary from verified, attributable sources. Each import
must carry source metadata. Bulk import requires source validation.

### Phase 3: Pronunciation / Audio Hooks
Connect `pronunciationAudioUrl` to audio playback. May integrate
with Kokoro TTS for English-side narration, but Choctaw pronunciation
must come from verified audio sources only.

### Phase 4: Quiz / Practice Mode
Interactive practice with Peh. Flashcard review, spaced repetition
for verified vocabulary. Peh narrates but does not generate Choctaw.

### Phase 5: Story Mode (Peh's Past Lives)
Peh tells stories that weave in verified Choctaw vocabulary.
AI narration in English only. Choctaw words are quoted verbatim
from verified sources — never generated.

### Phase 6: Outreach / Approval Workflow
Formal process for tribal review of content. Goal: ensure the module
respects the Choctaw Nation's language preservation goals. No content
decisions are made unilaterally.

## Respectful Use

This module exists to support language learning, not to appropriate
or commercialize. The Choctaw language belongs to the Choctaw people.
Any future partnership or endorsement must come from the Choctaw Nation
on their terms.
