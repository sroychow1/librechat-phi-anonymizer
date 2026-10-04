#!/usr/bin/env bash
# Enables the PHI anonymizer: starts the Presidio analyzer, turns the feature on in librechat.yaml,
# and runs a smoke test. Safe to re-run; each step skips work that is already done.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

ANALYZER_PORT="${PHI_ANALYZER_PORT:-5002}"
PHI_COMPOSE="docker-compose.phi.yml"
HEALTH_TIMEOUT_SECONDS=120

log() { printf '[phi] %s\n' "$*"; }
fail() { printf '[phi] ERROR: %s\n' "$*" >&2; exit 1; }

require() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required but not installed"
}

ensure_env_file() {
  if [ ! -f .env ]; then
    cp .env.example .env
    log "created .env from .env.example"
  fi
}

# Adds the PHI compose file to COMPOSE_FILE so plain `docker compose` commands include it.
# When COMPOSE_FILE is unset, the default files are listed explicitly, because setting the
# variable replaces Compose's default discovery.
ensure_compose_file() {
  local current
  current="$(grep -E '^COMPOSE_FILE=' .env | tail -n1 | cut -d= -f2- || true)"
  if [ -z "$current" ]; then
    local defaults="docker-compose.yml"
    [ -f docker-compose.override.yml ] && defaults="$defaults:docker-compose.override.yml"
    printf '\nCOMPOSE_FILE=%s:%s\n' "$defaults" "$PHI_COMPOSE" >> .env
    log "set COMPOSE_FILE in .env"
  elif [[ ":$current:" != *":$PHI_COMPOSE:"* ]]; then
    local tmp
    tmp="$(mktemp)"
    sed -E "s#^COMPOSE_FILE=(.*)#COMPOSE_FILE=\1:${PHI_COMPOSE}#" .env > "$tmp"
    cat "$tmp" > .env
    rm -f "$tmp"
    log "added $PHI_COMPOSE to COMPOSE_FILE"
  else
    log "COMPOSE_FILE already includes $PHI_COMPOSE"
  fi
}

ensure_librechat_yaml() {
  if [ ! -f librechat.yaml ]; then
    cp librechat.example.yaml librechat.yaml
    log "created librechat.yaml from librechat.example.yaml"
  fi
  if grep -qE '^phiAnonymizer:' librechat.yaml; then
    log "librechat.yaml already has a phiAnonymizer block; leaving it unchanged"
    return
  fi
  cat >> librechat.yaml <<EOF

phiAnonymizer:
  enabled: false
  analyzerUrl: http://presidio-analyzer:3000
  failMode: block
EOF
  log "added phiAnonymizer block to librechat.yaml (enabled: false)"
}

wait_for_analyzer() {
  local deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS))
  until curl -fsS "http://127.0.0.1:${ANALYZER_PORT}/health" >/dev/null 2>&1; do
    if [ "$SECONDS" -ge "$deadline" ]; then
      fail "analyzer did not become healthy within ${HEALTH_TIMEOUT_SECONDS}s; run: docker compose logs presidio-analyzer"
    fi
    sleep 2
  done
  log "analyzer is healthy"
}

smoke_test() {
  local body
  body="$(curl -fsS -X POST "http://127.0.0.1:${ANALYZER_PORT}/analyze" \
    -H 'Content-Type: application/json' \
    -d '{"text":"Patient Jane Doe, MRN: 884512, lives at 14 Oak Street.","language":"en"}')"
  if [[ "$body" != *PERSON* ]]; then
    fail "smoke test found no PERSON entity; response: $body"
  fi
  log "smoke test passed (PERSON detected)"
}

main() {
  require docker
  require curl
  ensure_env_file
  ensure_compose_file
  ensure_librechat_yaml
  docker compose up -d presidio-analyzer
  wait_for_analyzer
  smoke_test
  docker compose up -d
  log "installed. The analyzer is running, but phiAnonymizer.enabled is still false."
  log "Redaction stays off until replies are restored; see scripts/phi/README.md."
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
