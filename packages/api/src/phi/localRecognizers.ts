import type { PhiFinding } from './analyzer';

/**
 * Tier 2 detections from the balanced PHI list that need logic Presidio's ad-hoc regex
 * recognizers can't express: a numeric age comparison, and a date pattern narrow enough to skip
 * weekdays, relative time, and durations (see `PHI_DEFAULT_ENTITIES` in `recognizers.ts` for why
 * Presidio's own `DATE_TIME` isn't used). These run entirely in-process; findings merge with
 * Presidio's via `collectLocalFindings` in `pipeline.ts`.
 */

const MONTH = String.raw`(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?`;

/**
 * Sources for calendar-date patterns. Built fresh into `RegExp` objects on every call so
 * concurrent requests never share a `lastIndex`.
 */
const CALENDAR_DATE_SOURCES: readonly string[] = [
  // 3/14/2026, 3/14 — not 120/80 (word boundary can't start mid-number) or 15/2.5 (lookahead).
  String.raw`\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b(?!\.\d)`,
  // 2026-03-14
  String.raw`\b\d{4}-\d{2}-\d{2}\b`,
  // March 14, 2026 / March 3 (year optional, so a day+month pair is still caught)
  String.raw`\b${MONTH}\s+\d{1,2}(?:st|nd|rd|th)?(?:,\s*\d{4})?\b`,
  // 14 March 2026 / 14 March
  String.raw`\b\d{1,2}(?:st|nd|rd|th)?\s+${MONTH}(?:\s+\d{4})?\b`,
];

export function findCalendarDates(text: string): PhiFinding[] {
  const findings: PhiFinding[] = [];
  for (const source of CALENDAR_DATE_SOURCES) {
    const pattern = new RegExp(source, 'gi');
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) != null) {
      findings.push({
        entity_type: 'CALENDAR_DATE',
        start: match.index,
        end: match.index + match[0].length,
        score: 0.9,
      });
    }
  }
  return findings;
}

/** Sources with one capture group: the age number to compare against the threshold. */
const AGE_SOURCES: readonly string[] = [
  String.raw`\b(\d{1,3})\s*(?:yo|y\.o\.|years?[\s-]old|yrs?[\s-]old)\b`,
  String.raw`\baged?\s+(\d{1,3})\b`,
];

/**
 * Flags only the age number itself (not the surrounding "yo"/"aged"), and only when it is over
 * `threshold` — Safe Harbor requires redacting ages over 89, not ages in general.
 */
export function findAges(text: string, threshold: number): PhiFinding[] {
  const findings: PhiFinding[] = [];
  for (const source of AGE_SOURCES) {
    const pattern = new RegExp(source, 'gi');
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) != null) {
      const raw = match[1];
      const value = Number(raw);
      if (!Number.isFinite(value) || value <= threshold) {
        continue;
      }
      const start = match.index + match[0].indexOf(raw);
      findings.push({ entity_type: 'AGE', start, end: start + raw.length, score: 0.95 });
    }
  }
  return findings;
}
