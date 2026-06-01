# samples/

Scratch directory for generated audio from manual probes, `smoke.sh`, and
the test phrases in the README.

**Generated `*.wav` files here are gitignored** (see `../.gitignore`) —
they are runtime artifacts, not source. The dispatch cache lives
separately at `state/voices/cache/<sha256>.wav`.

If a tiny intentional fixture is ever needed for a test, add it explicitly
with `git add -f <file>` and document why here.
