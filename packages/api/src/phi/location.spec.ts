import { createPhiVault, redactText, restoreText } from './vault';
import { findLocationSubstitutions } from './location';

/** Redacts with only the location-substitution findings, for readable end-to-end assertions. */
function substitute(text: string, strict = false): string {
  const vault = createPhiVault();
  return redactText(text, findLocationSubstitutions(text, { strict }), vault);
}

describe('findLocationSubstitutions', () => {
  it('leaves a major city alone in a general query', () => {
    expect(substitute('Is the LA stock exchange open Tuesday?')).toBe(
      'Is the LA stock exchange open Tuesday?',
    );
    expect(substitute("What's the weather in Los Angeles this weekend?")).toBe(
      "What's the weather in Los Angeles this weekend?",
    );
  });

  it('substitutes a minor city in patient context, keeping it reversible', () => {
    const text = 'Pt is a 54 yo woman from Pasadena with cocci exposure';

    const result = substitute(text);

    expect(result).toBe(
      'Pt is a 54 yo woman from <LOCATION_SOUTHERN_CALIFORNIA_CITY_1> with cocci exposure',
    );
  });

  it('substitutes a major city too once the text reads as patient context', () => {
    const text = 'She moved from Beverly Hills to San Francisco';

    const result = substitute(text);

    expect(result).toBe(
      'She moved from <LOCATION_SOUTHERN_CALIFORNIA_CITY_1> to <LOCATION_NORTHERN_CALIFORNIA_CITY_1>',
    );
  });

  it('substitutes a minor city flagged by a "lives in" clause', () => {
    const text = 'Anti-Ro and anti-La positive, lives in Torrance';

    const result = substitute(text);

    expect(result).toBe(
      'Anti-Ro and anti-La positive, lives in <LOCATION_SOUTHERN_CALIFORNIA_CITY_1>',
    );
  });

  it('restores exactly back to the original text', () => {
    const text = 'Pt is a 54 yo woman from Pasadena with cocci exposure';
    const vault = createPhiVault();
    const findings = findLocationSubstitutions(text, { strict: false });

    const redacted = redactText(text, findings, vault);

    expect(redacted).not.toBe(text);
    expect(restoreText(redacted, vault)).toBe(text);
  });

  it('collapses both regions to the state level in strict mode', () => {
    const text = 'She moved from Beverly Hills to San Francisco';

    const result = substitute(text, true);

    expect(result).toBe('She moved from <LOCATION_CALIFORNIA_1> to <LOCATION_CALIFORNIA_2>');
  });

  it('keeps a non-California major city untouched (not covered by this module)', () => {
    const text = 'She flew from New York to London';

    expect(findLocationSubstitutions(text, { strict: false })).toEqual([]);
  });
});
