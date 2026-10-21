import type { AdHocPattern } from './recognizers';
import { PHI_AD_HOC_RECOGNIZERS } from './recognizers';

/**
 * These patterns are sent to Presidio's `ad_hoc_recognizers` and evaluated there, in Python, not
 * in this process. This file is a sanity check, not a guarantee of identical behavior: it rebuilds
 * each pattern as a JS `RegExp` (translating the one Python-only `(?i)` inline flag this file uses)
 * and checks it against the labeled examples from docs/phi-anonymizer-requirements.md. The
 * patterns use only `\b`, character classes, and standard quantifiers, which both engines treat
 * the same way.
 */
function toJsRegex(pattern: AdHocPattern): RegExp {
  const inlineIgnoreCase = pattern.regex.startsWith('(?i)');
  const source = inlineIgnoreCase ? pattern.regex.slice(4) : pattern.regex;
  return new RegExp(source, inlineIgnoreCase ? 'i' : '');
}

function patternsFor(entity: string): readonly AdHocPattern[] {
  const recognizer = PHI_AD_HOC_RECOGNIZERS.find((r) => r.supported_entity === entity);
  if (recognizer == null) {
    throw new Error(`No recognizer registered for entity ${entity}`);
  }
  return recognizer.patterns;
}

function matchesAny(patterns: readonly AdHocPattern[], text: string): boolean {
  return patterns.some((pattern) => toJsRegex(pattern).test(text));
}

describe('mrn recognizer', () => {
  const patterns = patternsFor('MEDICAL_RECORD_NUMBER');

  it.each(['MRN: 884512', 'Medical Record Number 884512', 'Chart Number: 884512', 'Chart: 884512'])(
    'matches %s',
    (text) => {
      expect(matchesAny(patterns, text)).toBe(true);
    },
  );

  it('does not match an unlabeled number', () => {
    expect(matchesAny(patterns, 'platelets 884512')).toBe(false);
  });
});

describe('health_plan_id recognizer', () => {
  const patterns = patternsFor('HEALTH_PLAN_ID');

  it.each([
    'Member ID W12345',
    'Subscriber ID W12345',
    'Policy Number: PN-99281',
    'Group Number: GRP-4471',
    'Claim Number: CLM00281',
    'Encounter Number: ENC-5521',
    'FIN Number: 448821',
  ])('matches %s', (text) => {
    expect(matchesAny(patterns, text)).toBe(true);
  });

  it('does not match an unlabeled alphanumeric string', () => {
    expect(matchesAny(patterns, 'DAS28 5.1, IgG 1450')).toBe(false);
  });
});

describe('device_vehicle_id recognizer', () => {
  const patterns = patternsFor('DEVICE_VEHICLE_ID');

  it.each([
    'Serial Number: SN-00421',
    'Serial #: SN00421',
    'Device ID: DEV-9981',
    'Implant ID: IMP-2231',
    'License Plate: 7ABC123',
    'Plate Number: 7ABC123',
  ])('matches a labeled %s', (text) => {
    expect(matchesAny(patterns, text)).toBe(true);
  });

  it('matches a bare VIN (17 characters, no I/O/Q)', () => {
    expect(matchesAny(patterns, 'VIN 1HGCM82633A004352')).toBe(true);
    expect(matchesAny(patterns, 'driving a 1HGCM82633A004352 again')).toBe(true);
  });

  it('does not match a run of letters/digits that is not 17 characters', () => {
    expect(matchesAny(patterns, 'reference code AB12CD34')).toBe(false);
  });
});
