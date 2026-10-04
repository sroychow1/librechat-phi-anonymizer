import type { PhiVault } from './vault';
import { createPhiVault } from './vault';

export interface PhiSessionStore {
  get(conversationId: string): PhiVault | undefined;
  getOrCreate(conversationId: string, ttlMs: number): PhiVault;
}

interface SessionEntry {
  readonly vault: PhiVault;
  readonly ttlMs: number;
  expiresAt: number;
}

export interface PhiSessionStoreOptions {
  now?: () => number;
}

/**
 * Keeps each conversation's placeholder mapping so later turns reuse earlier placeholders.
 * An entry expires `ttlMs` after its last access. The map lives in process memory, so it is
 * lost on restart.
 */
export function createPhiSessionStore(options: PhiSessionStoreOptions = {}): PhiSessionStore {
  const now = options.now ?? Date.now;
  const entries = new Map<string, SessionEntry>();

  function sweep(current: number): void {
    for (const [id, entry] of entries) {
      if (entry.expiresAt <= current) {
        entries.delete(id);
      }
    }
  }

  function refresh(conversationId: string, entry: SessionEntry, current: number): PhiVault {
    entry.expiresAt = current + entry.ttlMs;
    entries.set(conversationId, entry);
    return entry.vault;
  }

  return {
    get(conversationId) {
      const current = now();
      const entry = entries.get(conversationId);
      if (entry == null || entry.expiresAt <= current) {
        entries.delete(conversationId);
        return undefined;
      }
      return refresh(conversationId, entry, current);
    },
    getOrCreate(conversationId, ttlMs) {
      const current = now();
      sweep(current);
      const existing = entries.get(conversationId);
      if (existing != null) {
        return refresh(conversationId, existing, current);
      }
      return refresh(
        conversationId,
        { vault: createPhiVault(), ttlMs, expiresAt: current },
        current,
      );
    },
  };
}
