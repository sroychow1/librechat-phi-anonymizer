import type { PhiFinding } from './analyzer';

export interface PhiVault {
  readonly placeholderByValue: Map<string, string>;
  readonly valueByPlaceholder: Map<string, string>;
  readonly counters: Map<string, number>;
}

const PLACEHOLDER_PATTERN = /<[A-Z][A-Z_]*_\d+>/g;
const MAX_PLACEHOLDER_LENGTH = 64;

export function createPhiVault(): PhiVault {
  return {
    placeholderByValue: new Map(),
    valueByPlaceholder: new Map(),
    counters: new Map(),
  };
}

function valueKey(entityType: string, value: string): string {
  return `${entityType}\u0000${value}`;
}

function placeholderFor(vault: PhiVault, entityType: string, value: string): string {
  const key = valueKey(entityType, value);
  const existing = vault.placeholderByValue.get(key);
  if (existing != null) {
    return existing;
  }
  const next = (vault.counters.get(entityType) ?? 0) + 1;
  vault.counters.set(entityType, next);
  const placeholder = `<${entityType}_${next}>`;
  vault.placeholderByValue.set(key, placeholder);
  vault.valueByPlaceholder.set(placeholder, value);
  return placeholder;
}

/**
 * Keeps the highest-scoring finding when detections overlap, so a span is replaced once.
 */
function dropOverlaps(findings: readonly PhiFinding[]): PhiFinding[] {
  const ranked = [...findings].sort(
    (a, b) => b.score - a.score || b.end - b.start - (a.end - a.start),
  );
  const accepted: PhiFinding[] = [];
  for (const finding of ranked) {
    const overlaps = accepted.some((kept) => finding.start < kept.end && kept.start < finding.end);
    if (!overlaps) {
      accepted.push(finding);
    }
  }
  return accepted.sort((a, b) => a.start - b.start);
}

/**
 * Replaces each detected span with a stable placeholder. The same value keeps the same
 * placeholder across calls that share a vault, so a conversation stays coherent.
 */
export function redactText(text: string, findings: readonly PhiFinding[], vault: PhiVault): string {
  const spans = dropOverlaps(findings);
  let cursor = 0;
  let output = '';
  for (const span of spans) {
    output += text.slice(cursor, span.start);
    output += placeholderFor(vault, span.entity_type, text.slice(span.start, span.end));
    cursor = span.end;
  }
  return output + text.slice(cursor);
}

export function restoreText(text: string, vault: PhiVault): string {
  if (vault.valueByPlaceholder.size === 0) {
    return text;
  }
  return text.replace(PLACEHOLDER_PATTERN, (match) => vault.valueByPlaceholder.get(match) ?? match);
}

export interface StreamRestorer {
  push(chunk: string): string;
  flush(): string;
}

/**
 * Restores placeholders in streamed text. A trailing `<...` fragment that could still become
 * a placeholder is held back until the next chunk completes it.
 */
export function createStreamRestorer(vault: PhiVault): StreamRestorer {
  let pending = '';
  return {
    push(chunk) {
      pending += chunk;
      const open = pending.lastIndexOf('<');
      const incomplete =
        open !== -1 &&
        pending.indexOf('>', open) === -1 &&
        pending.length - open <= MAX_PLACEHOLDER_LENGTH;
      const cut = incomplete ? open : pending.length;
      const ready = pending.slice(0, cut);
      pending = pending.slice(cut);
      return restoreText(ready, vault);
    },
    flush() {
      const rest = restoreText(pending, vault);
      pending = '';
      return rest;
    },
  };
}
