import type { PhiFinding } from './analyzer';
import { createPhiVault, redactText } from './vault';
import { createPhiReplyRestorer } from './reply';

function finding(entity_type: string, start: number, end: number, score = 0.9): PhiFinding {
  return { entity_type, start, end, score };
}

function vaultWithPerson(): ReturnType<typeof createPhiVault> {
  const vault = createPhiVault();
  redactText('Ana', [finding('PERSON', 0, 3)], vault);
  return vault;
}

describe('createPhiReplyRestorer', () => {
  it('restores a placeholder delivered in one message-delta chunk', () => {
    const restorer = createPhiReplyRestorer(vaultWithPerson());
    const content = [{ type: 'text', text: 'Hello <PERSON_1>, how can I help?' }];

    restorer.restoreMessageDelta('step-1', content);

    expect(content[0].text).toBe('Hello Ana, how can I help?');
  });

  it('restores a placeholder split across several message-delta chunks for the same step', () => {
    const restorer = createPhiReplyRestorer(vaultWithPerson());
    const chunks = [
      { type: 'text', text: 'Hi <PER' },
      { type: 'text', text: 'SON_1>!' },
    ];

    restorer.restoreMessageDelta('step-1', [chunks[0]]);
    restorer.restoreMessageDelta('step-1', [chunks[1]]);

    expect(chunks[0].text).toBe('Hi ');
    expect(chunks[1].text).toBe('Ana!');
  });

  it('releases a fragment that never closes as raw text, so nothing is silently dropped', () => {
    // The closing `>` never arrives (e.g. generation stopped mid-token), so the held
    // text cannot be confirmed as a placeholder and is released unrestored on flush.
    const restorer = createPhiReplyRestorer(vaultWithPerson());
    const chunk = { type: 'text', text: 'Hi <PERSON_1' };

    restorer.restoreMessageDelta('step-1', [chunk]);
    expect(chunk.text).toBe('Hi ');

    expect(restorer.flushStep('step-1')).toEqual({ text: '<PERSON_1', think: '' });
  });

  it('flushing a step twice only releases the buffered text once', () => {
    const restorer = createPhiReplyRestorer(vaultWithPerson());
    restorer.restoreMessageDelta('step-1', [{ type: 'text', text: '<PERSON_1' }]);

    expect(restorer.flushStep('step-1').text).toBe('<PERSON_1');
    expect(restorer.flushStep('step-1')).toEqual({ text: '', think: '' });
  });

  it('keeps separate steps independent, so one step cannot flush another', () => {
    const restorer = createPhiReplyRestorer(vaultWithPerson());
    restorer.restoreMessageDelta('step-1', [{ type: 'text', text: '<PERSON_1' }]);
    restorer.restoreMessageDelta('step-2', [{ type: 'text', text: 'unrelated text' }]);

    expect(restorer.flushStep('step-2')).toEqual({ text: '', think: '' });
    expect(restorer.flushStep('step-1').text).toBe('<PERSON_1');
  });

  it('needs no flush at all once the closing bracket has arrived via push alone', () => {
    const restorer = createPhiReplyRestorer(vaultWithPerson());
    const chunks = [
      { type: 'text', text: 'Hi <PER' },
      { type: 'text', text: 'SON_1> there' },
    ];

    restorer.restoreMessageDelta('step-1', [chunks[0]]);
    restorer.restoreMessageDelta('step-1', [chunks[1]]);

    expect(chunks[1].text).toBe('Ana there');
    expect(restorer.flushStep('step-1')).toEqual({ text: '', think: '' });
  });

  it('restores reasoning deltas the same way, independently of message text', () => {
    const restorer = createPhiReplyRestorer(vaultWithPerson());
    const think = { type: 'think', think: 'The patient <PERSON_1> ...' };

    restorer.restoreReasoningDelta('step-1', [think]);

    expect(think.think).toBe('The patient Ana ...');
  });

  it('leaves non-text, non-think parts untouched', () => {
    const restorer = createPhiReplyRestorer(vaultWithPerson());
    const part = { type: 'tool_call', text: undefined };

    restorer.restoreMessageDelta('step-1', [part]);

    expect(part).toEqual({ type: 'tool_call', text: undefined });
  });

  it('is a no-op when content is missing or not an array', () => {
    const restorer = createPhiReplyRestorer(vaultWithPerson());

    expect(() => restorer.restoreMessageDelta('step-1', undefined)).not.toThrow();
    expect(() => restorer.restoreReasoningDelta('step-1', undefined)).not.toThrow();
  });
});
