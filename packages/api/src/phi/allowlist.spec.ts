import type { PhiFinding } from './analyzer';
import { filterAllowlisted, isAllowlisted } from './allowlist';

describe('isAllowlisted', () => {
  it.each([
    'Tuesday',
    'next Tuesday',
    'Friday morning',
    'today',
    'tomorrow',
    'last week',
    'Q3 2026',
    'FY26',
    '2026',
    '1990s',
    '6 weeks',
    '2 years ago',
    'q2wk',
    'daily',
    '3 pm',
    'October',
    'Thanksgiving',
    'California',
    'Portugal',
    'NYSE',
    'Wall Street',
    'ACR',
    'HIPAA',
    "Sjögren's",
    'anti-Smith',
    'anti-Ro',
    'Rinvoq',
    'DAS28',
    'HLA-B*58:01',
  ])('keeps %s on the allow-list', (term) => {
    expect(isAllowlisted(term)).toBe(true);
  });

  it.each(['Tuesday, March 3, 2026', '3/14/2026', 'March 3', 'Los Angeles', 'Smith', 'John Smith'])(
    'does not allow-list %s',
    (term) => {
      expect(isAllowlisted(term)).toBe(false);
    },
  );

  it('matches only the whole phrase, never a substring', () => {
    // "Smith" alone is caught even though "anti-Smith" is allow-listed — the flagged span here
    // is just "Smith", not "anti-Smith", so the allow-list entry does not apply to it.
    expect(isAllowlisted('anti-Smith')).toBe(true);
    expect(isAllowlisted('Smith')).toBe(false);
  });

  it('is case-insensitive and tolerates extra whitespace', () => {
    expect(isAllowlisted('  TUESDAY  ')).toBe(true);
    expect(isAllowlisted('q3  2026')).toBe(true);
  });
});

describe('filterAllowlisted', () => {
  function finding(text: string, start: number, score = 0.9): PhiFinding {
    return { entity_type: 'DATE_TIME', start, end: start + text.length, score };
  }

  it('drops allow-listed findings and keeps the rest', () => {
    const text = 'See you Tuesday, re: MRN: 884512';
    const findings = [
      finding('Tuesday', text.indexOf('Tuesday')),
      finding('MRN: 884512', text.indexOf('MRN: 884512')),
    ];

    expect(filterAllowlisted(text, findings)).toEqual([findings[1]]);
  });
});
