# PHI anonymizer: setup and runbook

How to install, verify, and troubleshoot the optional PHI anonymizer on a new machine. Written from a working end-to-end run; each gotcha below was hit once.

The feature replaces PHI in the outgoing user message with placeholders (`<PERSON_1>`, `<MEDICAL_RECORD_NUMBER_1>`) before the model call, using a Microsoft Presidio analyzer container. The assistant's reply is restored back to the original text, live in the stream and in the saved message. The installer still ships the feature with `enabled: false` — real-user readiness also depends on the remaining items in [Current limits](#current-limits), in particular that the user's own message stays saved with placeholders and that placeholder mappings are in memory only.

## 1. Requirements

- Node 24 (`.nvmrc` pins 24.16.0). Node 20 breaks the `tsdown` build with `process.getBuiltinModule is not a function`.
- Docker with Compose v2, running. `docker info` must succeed.
- `curl`.
- MongoDB reachable at the `MONGO_URI` in `.env`. The compose `mongodb` service has no host port, so a host run needs a `mongod` on the host or a published port.

## 2. Install

From the repo root:

```bash
./scripts/phi/install.sh
```

What it does, all idempotent:

| Step | Effect |
|---|---|
| Adds `docker-compose.phi.yml` to `COMPOSE_FILE` in `.env` | Keeps existing entries, including `docker-compose.override.yml` if present. Setting `COMPOSE_FILE` replaces Compose's default discovery, so the defaults are listed explicitly. |
| Adds a `phiAnonymizer` block to `librechat.yaml` | Creates the file from `librechat.example.yaml` if missing. The block is written with `enabled: false`. |
| `docker compose up -d presidio-analyzer` | Binds the analyzer to `127.0.0.1:5002`. |
| Waits for `/health`, then smoke-tests `/analyze` | Expects a `PERSON` entity for a sample name. |
| `docker compose up -d` | Applies changes to the stack. |

Requires a Docker host with internet access the first time the analyzer image is pulled.

## 3. Enable

Redaction stays off until replies are restored. For testing only:

```yaml
# librechat.yaml
phiAnonymizer:
  enabled: true
  analyzerUrl: http://presidio-analyzer:3000   # api running in compose
  # analyzerUrl: http://127.0.0.1:5002         # backend run from source on the host
  failMode: block        # block (default, fail closed) | passthrough
```

Omitted fields take schema defaults: `language: en`, `scoreThreshold: 0.35`, `sessionTtlMinutes: 240`. The defaults are applied by `loadPhiAnonymizerConfig` in `packages/data-schemas/src/app/service.ts`. Before that fix, omitted fields reached the analyzer as `undefined`.

Restart after any `librechat.yaml` change.

## 4. Verify the analyzer alone

```bash
curl -fsS http://127.0.0.1:5002/health
curl -s -X POST http://127.0.0.1:5002/analyze -H 'Content-Type: application/json' \
  -d '{"text":"Patient Jane Doe, MRN: 884512. Call 617-555-0142.","language":"en"}'
```

Expect `PERSON`, `MEDICAL_RECORD_NUMBER` and `PHONE_NUMBER` findings. Phone numbers score about 0.4, which is why the default threshold is 0.35.

## 5. Verify end to end with a stub model

A real provider isn't needed. `scripts/phi/stub-model.js` is an OpenAI-compatible server that logs every request it receives, so you can see exactly what the model got.

1. Start the stub: `node scripts/phi/stub-model.js` (port 9999, log to `stub-model-requests.jsonl`).
2. Add a custom endpoint to `librechat.yaml`:
   ```yaml
   endpoints:
     custom:
       - name: 'StubModel'
         apiKey: 'stub-key'
         baseURL: 'http://127.0.0.1:9999/v1'
         models:
           default: ['stub-model']
           fetch: false
         titleConvo: false
         modelDisplayLabel: 'Stub'
   ```
3. Run the backend from source with the host analyzer URL (`analyzerUrl: http://127.0.0.1:5002`):
   ```bash
   docker compose up -d mongodb meilisearch vectordb rag_api
   npm run frontend          # builds client/dist
   LOG_LEVEL=debug npm run backend
   ```
   Use `BAN_VIOLATIONS=false` for local testing only (see gotchas).
4. Register and log in through the API, then send a message. Requests need a browser-like `User-Agent`:
   ```bash
   UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
   curl -s -X POST http://localhost:3080/api/auth/login -H "User-Agent: $UA" -H 'Content-Type: application/json' \
     -d '{"email":"you@example.com","password":"..."}'          # returns { token }
   curl -s -N --max-time 30 -X POST http://localhost:3080/api/agents/chat/StubModel \
     -H "User-Agent: $UA" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
     -d '{"text":"Patient Jane Doe, MRN: 884512, lives at 14 Oak Street. Call her at 617-555-0142. Summarize the visit.","conversationId":"new","parentMessageId":"00000000-0000-0000-0000-000000000000","endpoint":"StubModel","endpointType":"custom","model":"stub-model","promptPrefix":null}'
   ```
5. Check `stub-model-requests.jsonl`. The last request's `content` must read `Patient <PERSON_1>, <MEDICAL_RECORD_NUMBER_1>, lives at <LOCATION_1>. Call her at <PHONE_NUMBER_1>. Summarize the visit.`

Expected results:

| Scenario | Model receives | Client sees |
|---|---|---|
| Analyzer up, `block` | Placeholders | Reply with placeholders restored to the original text |
| Analyzer stopped, `block` | Nothing new | 503 `phi_anonymizer_unavailable` |
| Analyzer stopped, `passthrough` | Original text | Reply; log warning `passing message through unredacted` |
| No PHI in message | Unchanged | Reply |

Read the reply from the saved message's `content` array. The top-level `text` is empty for agent messages, which is normal. The saved **user** message still holds placeholders — that restoration is a separate, not-yet-done path (see [Current limits](#current-limits)).

## 6. Gotchas

Each of these cost time once.

- **Config reached runtime with no fields.** `librechat.yaml` loads, but `AppConfig` is built from named keys in `packages/data-schemas/src/app/service.ts`. Any new config key must be added to the `AppConfig` type, to the `defaultConfig` object, and parsed with its schema. Otherwise the feature sees `undefined`. The pattern is `loadPhiAnonymizerConfig` next to `loadLangfuseConfig`.
- **`Illegal request` on every agents call.** `api/server/middleware/uaParser.js` rejects user agents it can't identify as a browser. Send a browser-like `User-Agent`.
- **Account banned after one bad request.** Non-browser requests count as violations, and violations ban the IP for 120 minutes. The ban is stored in the log store and survives restarts, so clearing it takes either waiting or `BAN_VIOLATIONS=false` for local tests. Don't use `BAN_VIOLATIONS=false` anywhere real.
- **`invalid signature` after restart.** Temporary credentials regenerate on restart when permanent `CREDS_KEY`, `CREDS_IV`, `JWT_SECRET` and `JWT_REFRESH_SECRET` aren't set. Log in again. Set permanent values before real use.
- **Users missing after restart.** Some test accounts disappeared after a backend restart, returning `Email does not exist`. I didn't find the cause. Check which `mongod` the backend uses (`lsof -nP -iTCP:27017`), and re-register if needed.
- **`@rolldown/binding-darwin-arm64` missing on macOS.** `npm ci` can leave the arm64 rolldown binding out, and `build:data-provider` fails with `Cannot find native binding`. Install it without touching the lockfile: `npm install --no-save @rolldown/binding-darwin-arm64@1.2.6` (use the version in `package-lock.json`).
- **Pre-commit hook fails with `sort-imports` syntax errors.** The hook runs under the shell's default Node. Put Node 24 first on `PATH` before committing. A failed hook also leaves a `lint-staged` backup stash; check `git stash list` afterwards.
- **Presidio misses phone numbers at 0.5.** Phone numbers score about 0.4. The default is 0.35. Lower values catch more and may over-redact.
- **`14 Oak Street` is labeled `LOCATION`, not `STREET_ADDRESS`.** Overlapping detections keep the higher score. The text is still redacted, so this is cosmetic.
- **Missing model key looks like a PHI bug.** Test with `StubModel` first, so a provider error doesn't hide whether redaction ran.

## 7. Tests

```bash
cd packages/api && npx jest src/phi src/middleware/phiAnonymizer.spec.ts
cd packages/data-schemas && npx jest src/app/service.spec.ts
cd packages/data-provider && npx jest
```

Typecheck each changed workspace with `npx tsc --noEmit`. The `concurrency.cache_integration.spec.ts` suite in `packages/api` needs a running Redis and fails without one.

## 8. Current limits

- **The user's own message still shows placeholders.** The assistant's reply is restored (`packages/api/src/phi/reply.ts`, wired into `getDefaultHandlers` in `api/server/controllers/agents/callbacks.js`), but the user's own sent message is saved and echoed by a separate path (`getPreliminaryUserMessage` in `api/server/controllers/agents/request.js`) that still uses the redacted `req.body.text`. The original is available via `getPhiRequestState(req).originalText`; this just isn't wired in yet.
- **Mappings are in memory.** Restarts lose them. A placeholder created before a restart can't be restored afterward, in either the user's message or a resumed reply.
- **A fragment that never closes can't be restored, only preserved.** If a run step closes while a placeholder is still mid-token (no closing `>` ever arrives — rare, but possible on an aborted or truncated generation), the raw fragment (e.g. `<PERSON_1`) is still emitted and saved, just un-restored. See `flushStep` in `packages/api/src/phi/reply.ts`.
- **Only the current user message is covered on the way in.** Files, memories, system prompts and tool output aren't redacted before the model call.
- **Assistants endpoints aren't covered.** Only the agents chat route (all providers go through it) is wired, for both redaction and restoration.
- **Not a compliance guarantee.** Presidio misses names and free-text identifiers. Get a compliance review before relying on it.
- **Image not pinned.** `docker-compose.phi.yml` uses `mcr.microsoft.com/presidio-analyzer:latest`. Pin a tag before handing this to anyone else.

## 9. Uninstall

```bash
docker compose stop presidio-analyzer && docker compose rm -f presidio-analyzer
```

Remove `:docker-compose.phi.yml` from `COMPOSE_FILE` in `.env`, and delete the `phiAnonymizer` block or set `enabled: false`.
