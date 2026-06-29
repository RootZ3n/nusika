# Security and Limitations

Nusika is a local-first adaptive learning engine. It stores knowledge,
companion memories, and curriculum progress. It is not a sandbox, DLP
product, or security certification.

## Lab-Use Local API

Nusika does not implement built-in HTTP authorization. The API and UI are
intended for lab use on a trusted local machine and do not require
`Authorization: Bearer` headers.

## Local API Binding

The API binds to `127.0.0.1` by default. If you set `NUSIKA_HOST=0.0.0.0`,
put Nusika behind your own authentication, authorization, and network access
controls before letting untrusted clients reach it.

## SQLite Database

Nusika stores curriculum data, companion memory, spaced repetition state,
and user progress in a local SQLite database. The database file contains
learning history and should be treated as sensitive personal data.

## Voice System

Nusika includes optional TTS/STT via local binaries (Piper, Whisper).
Voice data is processed locally and never sent to external services unless
you explicitly configure a cloud TTS provider. Binary paths are configured
via environment variables — do not hardcode absolute paths.

## Provider API Keys

Nusika calls LLM providers for companion dialogue and adaptive teaching.
API keys are loaded from environment variables. If `.env` is in
`.gitignore`, keys stay local. Never commit real API keys to version
control.

## Companion Memory

Nusika's companion system stores conversation history and learned preferences.
This data is personal and local-only. It is not shared across instances
unless you explicitly configure sync.
