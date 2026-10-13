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
```

`entities` is optional. Omit it to use the built-in PHI set, which is defined in `packages/api/src/phi/recognizers.ts`.

## Uninstall

```bash
docker compose stop presidio-analyzer && docker compose rm -f presidio-analyzer
```

Then remove `:docker-compose.phi.yml` from `COMPOSE_FILE` in `.env` and set `enabled: false` or delete the `phiAnonymizer` block.

## What is in place

- Detection, placeholder assignment, and per-conversation placeholder reuse (`packages/api/src/phi/vault.ts`, `recognizers.ts`, `session.ts`).
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

## Tests

```bash
cd packages/api && npx jest src/phi src/middleware/phiAnonymizer.spec.ts
cd api && npx jest server/controllers/agents/client.test.js -t "PHI reply restoration"
```

The analyzer client is tested against a real local HTTP server. The middleware is tested against a stand-in for the Presidio HTTP service. The reply restorer is tested in isolation (`packages/api/src/phi/reply.spec.ts`) and through the real `getDefaultHandlers` handler map. The container itself is not exercised by these tests; `install.sh` runs the live smoke test.
