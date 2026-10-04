import http from 'http';
import type { AddressInfo } from 'net';
import { createPresidioAnalyzer, PhiAnalyzerError } from './analyzer';

interface Captured {
  method?: string;
  path?: string;
  body?: Record<string, unknown>;
}

function startAnalyzerStub(
  respond: (captured: Captured) => { status: number; body: unknown },
): Promise<{ baseUrl: string; captured: Captured; close: () => Promise<void> }> {
  const captured: Captured = {};
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString();
    });
    req.on('end', () => {
      captured.method = req.method;
      captured.path = req.url;
      captured.body = raw.length > 0 ? (JSON.parse(raw) as Record<string, unknown>) : undefined;
      const { status, body } = respond(captured);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${port}/`,
        captured,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

describe('createPresidioAnalyzer', () => {
  it('posts text, language, threshold and the PHI recognizers to /analyze', async () => {
    const findings = [{ entity_type: 'PERSON', start: 0, end: 3, score: 0.95 }];
    const stub = await startAnalyzerStub(() => ({ status: 200, body: findings }));
    try {
      const analyzer = createPresidioAnalyzer({ baseUrl: stub.baseUrl });

      const result = await analyzer.analyze('Ana called', {
        language: 'en',
        entities: ['PERSON', 'PATIENT_ID'],
        scoreThreshold: 0.5,
      });

      expect(result).toEqual(findings);
      expect(stub.captured.method).toBe('POST');
      expect(stub.captured.path).toBe('/analyze');
      expect(stub.captured.body).toMatchObject({
        text: 'Ana called',
        language: 'en',
        entities: ['PERSON', 'PATIENT_ID'],
        score_threshold: 0.5,
      });
      expect(Array.isArray(stub.captured.body?.ad_hoc_recognizers)).toBe(true);
    } finally {
      await stub.close();
    }
  });

  it('throws PhiAnalyzerError on a non-2xx response', async () => {
    const stub = await startAnalyzerStub(() => ({ status: 500, body: { error: 'boom' } }));
    try {
      const analyzer = createPresidioAnalyzer({ baseUrl: stub.baseUrl });

      await expect(analyzer.analyze('x', { language: 'en', scoreThreshold: 0.5 })).rejects.toThrow(
        PhiAnalyzerError,
      );
    } finally {
      await stub.close();
    }
  });

  it('throws PhiAnalyzerError when the payload is not a findings array', async () => {
    const stub = await startAnalyzerStub(() => ({ status: 200, body: { unexpected: true } }));
    try {
      const analyzer = createPresidioAnalyzer({ baseUrl: stub.baseUrl });

      await expect(analyzer.analyze('x', { language: 'en', scoreThreshold: 0.5 })).rejects.toThrow(
        'unexpected payload',
      );
    } finally {
      await stub.close();
    }
  });

  it('throws PhiAnalyzerError when the service is unreachable', async () => {
    const stub = await startAnalyzerStub(() => ({ status: 200, body: [] }));
    const baseUrl = stub.baseUrl;
    await stub.close();
    const analyzer = createPresidioAnalyzer({ baseUrl, timeoutMs: 1000 });

    await expect(analyzer.analyze('x', { language: 'en', scoreThreshold: 0.5 })).rejects.toThrow(
      PhiAnalyzerError,
    );
  });
});
