import type { PhiFinding } from './analyzer';
import { createPhiVault, createStreamRestorer, redactText, restoreText } from './vault';

function finding(entity_type: string, start: number, end: number, score = 0.9): PhiFinding {
  return { entity_type, start, end, score };
}

function findingFor(text: string, needle: string, entity_type: string, score = 0.9): PhiFinding {
  const start = text.indexOf(needle);
  if (start === -1) {
    throw new Error(`"${needle}" not found in test text`);
  }
  return finding(entity_type, start, start + needle.length, score);
}

describe('redactText', () => {
  it('replaces each span with an indexed placeholder', () => {
    const text = 'Ana saw Ben, then Ana left.';
    const findings = [
      findingFor(text, 'Ana', 'PERSON'),
      findingFor(text, 'Ben', 'PERSON'),
      finding('PERSON', 18, 21),
    ];
    const vault = createPhiVault();

    expect(redactText(text, findings, vault)).toBe(
      '<PERSON_1> saw <PERSON_2>, then <PERSON_1> left.',
    );
  });

  it('reuses the placeholder for a repeated value across calls sharing a vault', () => {
    const vault = createPhiVault();
    const first = redactText('Ana called', [finding('PERSON', 0, 3)], vault);
    const second = redactText('Ana again', [finding('PERSON', 0, 3)], vault);

    expect(first).toBe('<PERSON_1> called');
    expect(second).toBe('<PERSON_1> again');
  });

  it('numbers placeholders per entity type', () => {
    const vault = createPhiVault();
    const out = redactText(
      'PT-1234 and 02139',
      [finding('PATIENT_ID', 0, 7), finding('US_ZIP_CODE', 12, 17)],
      vault,
    );

    expect(out).toBe('<PATIENT_ID_1> and <US_ZIP_CODE_1>');
  });

  it('replaces an overlapping span once, keeping the higher score', () => {
    const text = 'Dr Jane Smith';
    const vault = createPhiVault();
    const out = redactText(
      text,
      [findingFor(text, 'Jane Smith', 'PERSON', 0.6), findingFor(text, 'Jane', 'LOCATION', 0.9)],
      vault,
    );

    expect(out).toBe('Dr <LOCATION_1> Smith');
  });

  it('returns the text unchanged when there are no findings', () => {
    const vault = createPhiVault();

    expect(redactText('nothing here', [], vault)).toBe('nothing here');
    expect(vault.valueByPlaceholder.size).toBe(0);
  });
});

describe('restoreText', () => {
  it('round-trips redacted text back to the original', () => {
    const original = 'Ana (MRN: 884512) lives at 14 Oak Street.';
    const vault = createPhiVault();
    const redacted = redactText(
      original,
      [
        findingFor(original, 'Ana', 'PERSON'),
        findingFor(original, 'MRN: 884512', 'MEDICAL_RECORD_NUMBER'),
        findingFor(original, '14 Oak Street', 'STREET_ADDRESS'),
      ],
      vault,
    );

    expect(redacted).not.toContain('Ana');
    expect(restoreText(redacted, vault)).toBe(original);
  });

  it('leaves unknown placeholders in place', () => {
    const vault = createPhiVault();

    expect(restoreText('see <PERSON_7>', vault)).toBe('see <PERSON_7>');
  });
});

describe('createStreamRestorer', () => {
  it('restores a placeholder split across chunks', () => {
    const vault = createPhiVault();
    redactText('Ana', [finding('PERSON', 0, 3)], vault);
    const restorer = createStreamRestorer(vault);

    const out =
      ['Hi <PER', 'SON_', '1>, bye'].map((chunk) => restorer.push(chunk)).join('') +
      restorer.flush();

    expect(out).toBe('Hi Ana, bye');
  });

  it('releases a held fragment on flush when it never completes', () => {
    const vault = createPhiVault();
    const restorer = createStreamRestorer(vault);

    const streamed = restorer.push('value <unfinished');

    expect(streamed).toBe('value ');
    expect(restorer.flush()).toBe('<unfinished');
  });

  it('does not hold back a long run of text that starts with a bracket', () => {
    const vault = createPhiVault();
    const restorer = createStreamRestorer(vault);
    const long = `<${'x'.repeat(80)}`;

    expect(restorer.push(long)).toBe(long);
  });
});
