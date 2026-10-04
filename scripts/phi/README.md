# PHI anonymizer

Replaces protected health information in outgoing messages with placeholders such as `<PERSON_1>` before the model sees them. Detection uses Microsoft Presidio, which runs as a local container next to LibreChat.

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

Redaction stays off until replies are restored (see **Current limits**). When that lands, set `enabled: true` under `phiAnonymizer` in `librechat.yaml`, then run `docker compose up -d`.

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

- Detection, placeholder assignment, and per-conversation placeholder reuse (`packages/api/src/phi/`).
- Outgoing-message redaction in the agents chat route (`packages/api/src/middleware/phiAnonymizer.ts`), which runs after the existing PII filter and before moderation.
- Config (`phiAnonymizer` in `packages/data-provider/src/config.ts`) with defaults that keep the feature off.
- Installer, compose file, and tests.

## Current limits

- **Replies are not restored yet.** The model's answer keeps placeholders, and the saved message stores what was sent. Until response restoration lands, do not enable the feature for real users.
- **Mappings are in memory.** They are lost on restart, so placeholders from before a restart cannot be restored afterward.
- **Only the current user message is covered.** Uploaded files, memories, system prompts and tool output are not redacted.
- **Not a compliance guarantee.** Presidio's name and place detection misses cases. Treat this as a risk reducer, and have a compliance review before relying on it for PHI.
- **Assistants endpoints** are not covered. Only the agents chat route is wired.

## Tests

```bash
cd packages/api && npx jest src/phi src/middleware/phiAnonymizer.spec.ts
```

The analyzer client is tested against a real local HTTP server. The middleware is tested against a stand-in for the Presidio HTTP service. The container itself is not exercised by these tests; `install.sh` runs the live smoke test.
