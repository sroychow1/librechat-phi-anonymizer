import http from 'http';
import express from 'express';
import request from 'supertest';
import type { Request as ServerRequest, Response as ServerResponse } from 'express';
import type { PhiAnonymizerConfig } from 'librechat-data-provider';
import type { AddressInfo } from 'net';
import { createPhiAnonymizer, getPhiRequestState } from './phiAnonymizer';
import { createPhiSessionStore, createPresidioAnalyzer } from '../phi';

/** Stands in for the Presidio analyzer HTTP service: finds every "Ana" and "MRN: <digits>". */
function startFakePresidio(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString();
    });
    req.on('end', () => {
      const { text } = JSON.parse(raw) as { text: string };
      const findings = [...text.matchAll(/Ana/g)]
        .map((m) => ({ entity_type: 'PERSON', start: m.index, end: m.index + 3, score: 0.9 }))
        .concat(
          [...text.matchAll(/MRN: \d+/g)].map((m) => ({
            entity_type: 'MEDICAL_RECORD_NUMBER',
            start: m.index,
            end: m.index + m[0].length,
            score: 0.9,
          })),
        );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(findings));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

function buildApp(config: PhiAnonymizerConfig | undefined, analyzerUrl: string) {
  const seen: { text?: string; original?: string; vaultSize?: number }[] = [];
  const app = express();
  app.use(express.json());
  app.use(
    createPhiAnonymizer({
      getConfig: () => config,
      createAnalyzer: () => createPresidioAnalyzer({ baseUrl: analyzerUrl, timeoutMs: 2000 }),
      sessions: createPhiSessionStore(),
    }),
  );
  app.post('/chat', (req: ServerRequest, res: ServerResponse) => {
    const state = getPhiRequestState(req);
    seen.push({
      text: req.body?.text,
      original: state?.originalText,
      vaultSize: state?.vault.valueByPlaceholder.size,
    });
    res.json({ text: req.body?.text });
  });
  return { app, seen };
}

const enabled = (overrides: Partial<PhiAnonymizerConfig> = {}): PhiAnonymizerConfig => ({
  enabled: true,
  analyzerUrl: 'http://unused',
  language: 'en',
  scoreThreshold: 0.5,
  failMode: 'block',
  sessionTtlMinutes: 240,
  ...overrides,
});

describe('createPhiAnonymizer', () => {
  let presidio: { baseUrl: string; close: () => Promise<void> };

  beforeAll(async () => {
    presidio = await startFakePresidio();
  });

  afterAll(async () => {
    await presidio.close();
  });

  it('leaves the body untouched when the feature is disabled', async () => {
    const { app, seen } = buildApp({ ...enabled(), enabled: false }, presidio.baseUrl);

    await request(app).post('/chat').send({ text: 'Ana called' });

    expect(seen[0]).toEqual({ text: 'Ana called', original: undefined, vaultSize: undefined });
  });

  it('replaces PHI in the outgoing text and records the original for the request', async () => {
    const { app, seen } = buildApp(enabled(), presidio.baseUrl);

    await request(app).post('/chat').send({ text: 'Ana has MRN: 884512' });

    expect(seen[0].text).toBe('<PERSON_1> has <MEDICAL_RECORD_NUMBER_1>');
    expect(seen[0].original).toBe('Ana has MRN: 884512');
    expect(seen[0].vaultSize).toBe(2);
  });

  it('reuses placeholders across turns of the same conversation', async () => {
    const { app, seen } = buildApp(enabled(), presidio.baseUrl);

    await request(app).post('/chat').send({ text: 'Ana here', conversationId: 'convo-1' });
    await request(app).post('/chat').send({ text: 'Ana again', conversationId: 'convo-1' });

    expect(seen[0].text).toBe('<PERSON_1> here');
    expect(seen[1].text).toBe('<PERSON_1> again');
  });

  it('does not share placeholders between new conversations', async () => {
    const { app, seen } = buildApp(enabled(), presidio.baseUrl);

    await request(app).post('/chat').send({ text: 'Ana here', conversationId: 'new' });
    await request(app).post('/chat').send({ text: 'Ana there', conversationId: 'new' });

    expect(seen[0].text).toBe('<PERSON_1> here');
    expect(seen[1].text).toBe('<PERSON_1> there');
  });

  it('blocks the message with 503 when the analyzer is unreachable and failMode is block', async () => {
    const { app, seen } = buildApp(enabled(), 'http://127.0.0.1:1');

    const res = await request(app).post('/chat').send({ text: 'Ana called' });

    expect(res.status).toBe(503);
    expect(res.body.error).toBe('phi_anonymizer_unavailable');
    expect(seen).toHaveLength(0);
  });

  it('forwards the original text when the analyzer is unreachable and failMode is passthrough', async () => {
    const { app, seen } = buildApp(enabled({ failMode: 'passthrough' }), 'http://127.0.0.1:1');

    const res = await request(app).post('/chat').send({ text: 'Ana called' });

    expect(res.status).toBe(200);
    expect(seen[0].text).toBe('Ana called');
  });
});
