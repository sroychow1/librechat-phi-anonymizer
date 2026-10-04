import type { AdHocRecognizer } from './recognizers';
import { PHI_AD_HOC_RECOGNIZERS } from './recognizers';

export interface PhiFinding {
  entity_type: string;
  start: number;
  end: number;
  score: number;
}

export interface AnalyzeOptions {
  language: string;
  entities?: readonly string[];
  scoreThreshold: number;
}

export interface PresidioAnalyzer {
  analyze(text: string, options: AnalyzeOptions): Promise<PhiFinding[]>;
}

export interface PresidioAnalyzerOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  recognizers?: readonly AdHocRecognizer[];
}

export class PhiAnalyzerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PhiAnalyzerError';
  }
}

const DEFAULT_TIMEOUT_MS = 5000;

function isFinding(value: unknown): value is PhiFinding {
  if (value == null || typeof value !== 'object') {
    return false;
  }
  const finding = value as Partial<Record<keyof PhiFinding, unknown>>;
  return (
    typeof finding.entity_type === 'string' &&
    typeof finding.start === 'number' &&
    typeof finding.end === 'number' &&
    typeof finding.score === 'number'
  );
}

export function createPresidioAnalyzer(options: PresidioAnalyzerOptions): PresidioAnalyzer {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const recognizers = options.recognizers ?? PHI_AD_HOC_RECOGNIZERS;
  const endpoint = `${options.baseUrl.replace(/\/+$/, '')}/analyze`;

  return {
    async analyze(text, analyzeOptions) {
      let response: Response;
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            language: analyzeOptions.language,
            entities: analyzeOptions.entities,
            score_threshold: analyzeOptions.scoreThreshold,
            ad_hoc_recognizers: recognizers,
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new PhiAnalyzerError(`Presidio analyzer unreachable: ${reason}`);
      }
      if (!response.ok) {
        throw new PhiAnalyzerError(`Presidio analyzer returned HTTP ${response.status}`);
      }
      const body: unknown = await response.json();
      if (!Array.isArray(body) || !body.every(isFinding)) {
        throw new PhiAnalyzerError('Presidio analyzer returned an unexpected payload');
      }
      return body;
    },
  };
}
