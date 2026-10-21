import { findAges, findCalendarDates } from './localRecognizers';

function spans(text: string, findings: ReturnType<typeof findCalendarDates>): string[] {
  return findings.map((f) => text.slice(f.start, f.end));
}

describe('findCalendarDates', () => {
  it('matches numeric, ISO, and month-name dates', () => {
    const text = 'Seen on 3/14/2026, or 2026-03-14, or March 14, 2026, or 14 March 2026.';

    expect(spans(text, findCalendarDates(text))).toEqual(
      expect.arrayContaining(['3/14/2026', '2026-03-14', 'March 14, 2026', '14 March 2026']),
    );
  });

  it('matches a day and month pair with no year, since Safe Harbor still requires removing it', () => {
    const text = 'Admitted March 3, discharged the following week.';

    expect(spans(text, findCalendarDates(text))).toContain('March 3');
  });

  it('does not match a bare vitals or dosing ratio', () => {
    const text = 'BP 120/80 mmHg, dose 15/2.5 mg.';

    expect(findCalendarDates(text)).toEqual([]);
  });

  it('does not match a month alone, a weekday, or a duration', () => {
    const text = 'ACR in October. Follow up next Tuesday in about 6 weeks.';

    expect(findCalendarDates(text)).toEqual([]);
  });
});

describe('findAges', () => {
  it('flags only the number, and only when over the threshold', () => {
    const text = 'Patient is 92 yo; her mother, aged 94, lives nearby.';
    const findings = findAges(text, 89);

    expect(findings.map((f) => text.slice(f.start, f.end))).toEqual(['92', '94']);
  });

  it('keeps an age at or under the threshold', () => {
    expect(findAges('a 65 yo man, aged 89', 89)).toEqual([]);
  });

  it('respects a custom threshold', () => {
    expect(findAges('a 70 yo man', 65)).toHaveLength(1);
    expect(findAges('a 60 yo man', 65)).toEqual([]);
  });
});
