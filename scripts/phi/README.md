# PHI anonymizer

Replaces protected health information in outgoing messages with placeholders such as `<PERSON_1>` before the model sees them, using Microsoft Presidio in a local container next to LibreChat. The assistant's reply is restored back to the original text before the user sees it, live in the stream and in the saved message. The user's own message is still saved with placeholders — see **Current limits**.

## Install

From the repo root, on a machine that runs LibreChat with Docker:

```bash
./scripts/phi/install.sh
```

The script is idempotent. It:

1. Adds `docker-compose.phi.yml` to `COMPOSE_FILE` in `.env`, keeping any files already listed.
2. Adds a `phiAnonymizer` block to `librechat.yaml`, creating the file from the example if needed. The block is installed with `enabled: false`.
3. Starts `presidio-analyzer` on `127.0.0.1:5002`, waits for `/health`, and checks that a sample string yields a `PERSON` entity.
4. Runs `docker compose up -d` to apply the change.

Requirements: Docker with Compose v2, `curl`, and internet access the first time the analyzer image is pulled.

## Enable

The installer leaves the feature off. Read **Current limits** before turning it on for real users — in particular, the user's own saved message still shows placeholders, and placeholder mappings are in-memory only. Set `enabled: true` under `phiAnonymizer` in `librechat.yaml`, then run `docker compose up -d`.

```yaml
phiAnonymizer:
  enabled: true
  analyzerUrl: http://presidio-analyzer:3000
  language: en
  scoreThreshold: 0.35
  failMode: block        # block: refuse the message if the analyzer is down; passthrough: send unredacted
  sessionTtlMinutes: 240
  redactCalendarDates: true   # off: real dates (3/14/2026, March 3, ...) pass through unredacted
  redactAges: true            # off: no age is ever redacted
  ageRedactionThreshold: 89   # Safe Harbor's own cutoff: ages over 89 are redacted, 89 and under are kept
  locationSubstitution: true  # off: California place names are left to Presidio's own LOCATION entity
  locationStrict: false       # true: collapses both CA regions to state-level <LOCATION_CALIFORNIA_N>
```

`entities` is optional. Omit it to use the built-in PHI set, which is defined in `packages/api/src/phi/recognizers.ts`. The detection rules — what always gets redacted, what only gets redacted when it's really an identifier, and what never gets redacted — follow [`docs/phi-anonymizer-requirements.md`](../../docs/phi-anonymizer-requirements.md); see `docs/phi-anonymizer-setup.md` for how that maps onto the code.

## Uninstall

```bash
docker compose stop presidio-analyzer && docker compose rm -f presidio-analyzer
```

Then remove `:docker-compose.phi.yml` from `COMPOSE_FILE` in `.env` and set `enabled: false` or delete the `phiAnonymizer` block.

## What is in place

- Detection, placeholder assignment, and per-conversation placeholder reuse (`packages/api/src/phi/vault.ts`, `recognizers.ts`, `session.ts`).
- A balanced-list pipeline on top of Presidio (`packages/api/src/phi/pipeline.ts`): real calendar dates and ages over a threshold detected locally (`localRecognizers.ts`), California place names substituted with a reversible, region-coded placeholder (`location.ts`), and a Tier 3 allow-list that protects weekdays, lab scores, drug names, and similar non-identifiers from being redacted (`allowlist.ts`).
- Outgoing-message redaction in the agents chat route (`packages/api/src/middleware/phiAnonymizer.ts`), which runs after the existing PII filter and before moderation.
- Reply restoration (`packages/api/src/phi/reply.ts`), wired into the single handler all providers share for streamed text (`getDefaultHandlers` in `api/server/controllers/agents/callbacks.js`). Covers the live stream and the saved message.
- Config (`phiAnonymizer` in `packages/data-provider/src/config.ts`) with defaults that keep the feature off.
- Installer, compose file, and tests.

## Current limits

- **The user's own message still shows placeholders.** The reply is restored, but the user's sent message is saved by a separate path (`getPreliminaryUserMessage`) that isn't wired to the original text yet.
- **Mappings are in memory.** They are lost on restart, so placeholders from before a restart cannot be restored afterward, for either the user's message or a resumed reply.
- **A fragment that never closes can't be restored, only preserved.** Rare (an aborted or truncated generation stopping mid-placeholder), but when it happens the raw fragment is still emitted and saved rather than dropped.
- **Only the current user message is covered on the way in.** Uploaded files, memories, system prompts and tool output are not redacted.
- **Not a compliance guarantee.** Presidio's name and place detection misses cases. Treat this as a risk reducer, and have a compliance review before relying on it for PHI.
- **Assistants endpoints** are not covered. Only the agents chat route is wired, for both redaction and restoration.
- **Location substitution only knows California.** Other regions need entries added to `location.ts`; elsewhere, an unlisted city is still redacted by Presidio's generic `LOCATION` entity, just without a region hint.
- **The allow-list matches the exact flagged span.** A name that happens to equal an allow-listed abbreviation (e.g. a `PERSON` finding of "Ana" vs. the lab score "ANA") is shielded the same way a real non-identifier would be. See `docs/phi-anonymizer-setup.md` for the full list of gotchas.

## Tests

```bash
cd packages/api && npx jest src/phi src/middleware/phiAnonymizer.spec.ts
cd api && npx jest server/controllers/agents/client.test.js -t "PHI reply restoration"
```

The analyzer client is tested against a real local HTTP server. The middleware is tested against a stand-in for the Presidio HTTP service. The reply restorer is tested in isolation (`packages/api/src/phi/reply.spec.ts`) and through the real `getDefaultHandlers` handler map. The container itself is not exercised by these tests; `install.sh` runs the live smoke test.
