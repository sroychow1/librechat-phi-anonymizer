import { logger } from '@librechat/data-schemas';
import { Constants } from 'librechat-data-provider';
import type {
  NextFunction,
  RequestHandler,
  Request as ServerRequest,
  Response as ServerResponse,
} from 'express';
import type { PhiAnonymizerConfig } from 'librechat-data-provider';
import type { PresidioAnalyzer } from '../phi/analyzer';
import type { PhiSessionStore } from '../phi/session';
import type { PhiVault } from '../phi/vault';
import { PHI_DEFAULT_ENTITIES } from '../phi/recognizers';
import { createPhiVault, redactText } from '../phi/vault';
import { PhiAnalyzerError } from '../phi/analyzer';

export interface PhiRequestState {
  readonly vault: PhiVault;
  readonly originalText: string;
}

const REQUEST_STATE = new WeakMap<ServerRequest, PhiRequestState>();

export function getPhiRequestState(req: ServerRequest): PhiRequestState | undefined {
  return REQUEST_STATE.get(req);
}

export interface CreatePhiAnonymizerOptions {
  getConfig: (req: ServerRequest) => PhiAnonymizerConfig | undefined;
  createAnalyzer: (baseUrl: string) => PresidioAnalyzer;
  sessions: PhiSessionStore;
}

function resolveSessionKey(conversationId: unknown): string | null {
  if (typeof conversationId !== 'string' || conversationId === Constants.NEW_CONVO) {
    return null;
  }
  return conversationId.length > 0 ? conversationId : null;
}

/**
 * Replaces PHI in the outgoing user message with placeholders before the model call.
 * Restoring placeholders in the response is handled by the streaming path via `getPhiRequestState`.
 */
export function createPhiAnonymizer(options: CreatePhiAnonymizerOptions): RequestHandler {
  const analyzers = new Map<string, PresidioAnalyzer>();

  function analyzerFor(baseUrl: string): PresidioAnalyzer {
    const cached = analyzers.get(baseUrl);
    if (cached != null) {
      return cached;
    }
    const analyzer = options.createAnalyzer(baseUrl);
    analyzers.set(baseUrl, analyzer);
    return analyzer;
  }

  function rejectUnavailable(res: ServerResponse): void {
    res.status(503).json({
      error: 'phi_anonymizer_unavailable',
      message: 'Privacy filtering is unavailable, so this message was not sent.',
    });
  }

  return async function phiAnonymizer(req: ServerRequest, res: ServerResponse, next: NextFunction) {
    const config = options.getConfig(req);
    const text: unknown = req.body?.text;
    if (config?.enabled !== true || typeof text !== 'string' || text.length === 0) {
      next();
      return;
    }

    const sessionKey = resolveSessionKey(req.body?.conversationId);
    const vault =
      sessionKey != null
        ? options.sessions.getOrCreate(sessionKey, config.sessionTtlMinutes * 60_000)
        : createPhiVault();

    try {
      const findings = await analyzerFor(config.analyzerUrl).analyze(text, {
        language: config.language,
        entities: config.entities ?? PHI_DEFAULT_ENTITIES,
        scoreThreshold: config.scoreThreshold,
      });
      req.body.text = redactText(text, findings, vault);
      REQUEST_STATE.set(req, { vault, originalText: text });
      logger.debug(`[phiAnonymizer] redacted ${findings.length} span(s)`);
      next();
    } catch (error) {
      const reason = error instanceof PhiAnalyzerError ? error.message : 'unexpected error';
      if (config.failMode === 'passthrough') {
        logger.warn(`[phiAnonymizer] passing message through unredacted: ${reason}`);
        next();
        return;
      }
      logger.error(`[phiAnonymizer] blocked message: ${reason}`);
      rejectUnavailable(res);
    }
  };
}
