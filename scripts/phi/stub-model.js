/**
 * Test-only OpenAI-compatible model. Records every chat request it receives and streams a reply that
 * contains PHI placeholders, so you can see exactly what the model was sent without a real provider.
 *
 *   node scripts/phi/stub-model.js            # listens on 127.0.0.1:9999
 *   STUB_PORT=9999 STUB_LOG=./stub.jsonl node scripts/phi/stub-model.js
 *
 * Point a LibreChat custom endpoint at http://127.0.0.1:9999/v1 (see docs/phi-anonymizer-setup.md).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.STUB_PORT ?? 9999);
const LOG = process.env.STUB_LOG ?? path.join(process.cwd(), 'stub-model-requests.jsonl');
const CHUNKS = ['Noted. The patient ', '<PERSON_', '1> has MRN ', '<MEDICAL_RECORD_NUMBER_1>', '.'];

function completionChunk(model, delta, finishReason, usage) {
  const chunk = {
    id: 'chatcmpl-stub',
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
  return usage ? { ...chunk, usage } : chunk;
}

function streamReply(res, model) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  CHUNKS.forEach((piece, index) => {
    const delta = index === 0 ? { role: 'assistant', content: piece } : { content: piece };
    res.write(`data: ${JSON.stringify(completionChunk(model, delta, null))}\n\n`);
  });
  const usage = { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 };
  res.write(`data: ${JSON.stringify(completionChunk(model, {}, 'stop', usage))}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
  });
  req.on('end', () => {
    if (req.url.endsWith('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'stub-model', object: 'model' }] }));
      return;
    }
    if (req.url.endsWith('/chat/completions')) {
      fs.appendFileSync(LOG, `${raw}\n`);
      const body = JSON.parse(raw || '{}');
      streamReply(res, body.model ?? 'stub-model');
      return;
    }
    res.writeHead(404);
    res.end();
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`stub model on http://127.0.0.1:${PORT}/v1, logging requests to ${LOG}`);
});
