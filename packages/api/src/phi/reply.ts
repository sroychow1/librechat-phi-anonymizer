import { ContentTypes } from 'librechat-data-provider';
import type { PhiVault } from './vault';
import { createStreamRestorer } from './vault';

interface TextContentPart {
  type?: string;
  text?: string;
}

interface ThinkContentPart {
  type?: string;
  think?: string;
}

export interface PhiFlushedStep {
  readonly text: string;
  readonly think: string;
}

export interface PhiReplyRestorer {
  /** Restores placeholders in a message-delta's text parts, mutating them in place. */
  restoreMessageDelta(stepId: string, content: readonly TextContentPart[] | undefined): void;
  /** Restores placeholders in a reasoning-delta's think parts, mutating them in place. */
  restoreReasoningDelta(stepId: string, content: readonly ThinkContentPart[] | undefined): void;
  /**
   * Releases whatever text or reasoning this step's restorers were still holding back
   * (an incomplete placeholder fragment). Call once, when the step receives its terminal
   * `on_run_step_closed` event — the SDK guarantees that event for every step, including
   * on error or abort, so nothing buffered here is ever lost.
   */
  flushStep(stepId: string): PhiFlushedStep;
}

/**
 * Restores PHI placeholders in an agent's streamed reply, so the live stream and the
 * persisted message show the original text instead of `<PERSON_1>`-style placeholders.
 * One restorer per run step, so providers that stream a placeholder split across several
 * chunks are handled correctly, and concurrent steps (parallel agents) don't share buffers.
 */
export function createPhiReplyRestorer(vault: PhiVault): PhiReplyRestorer {
  const messageRestorers = new Map<string, ReturnType<typeof createStreamRestorer>>();
  const reasoningRestorers = new Map<string, ReturnType<typeof createStreamRestorer>>();

  function restorerFor(
    restorers: Map<string, ReturnType<typeof createStreamRestorer>>,
    stepId: string,
  ): ReturnType<typeof createStreamRestorer> {
    const existing = restorers.get(stepId);
    if (existing != null) {
      return existing;
    }
    const created = createStreamRestorer(vault);
    restorers.set(stepId, created);
    return created;
  }

  return {
    restoreMessageDelta(stepId, content) {
      if (!Array.isArray(content)) {
        return;
      }
      const restorer = restorerFor(messageRestorers, stepId);
      for (const part of content) {
        if (part?.type === ContentTypes.TEXT && typeof part.text === 'string') {
          part.text = restorer.push(part.text);
        }
      }
    },
    restoreReasoningDelta(stepId, content) {
      if (!Array.isArray(content)) {
        return;
      }
      const restorer = restorerFor(reasoningRestorers, stepId);
      for (const part of content) {
        if (part?.type === ContentTypes.THINK && typeof part.think === 'string') {
          part.think = restorer.push(part.think);
        }
      }
    },
    flushStep(stepId) {
      const message = messageRestorers.get(stepId);
      const reasoning = reasoningRestorers.get(stepId);
      messageRestorers.delete(stepId);
      reasoningRestorers.delete(stepId);
      return {
        text: message != null ? message.flush() : '',
        think: reasoning != null ? reasoning.flush() : '',
      };
    },
  };
}
