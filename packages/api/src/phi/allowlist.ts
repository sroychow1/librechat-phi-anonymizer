import type { PhiFinding } from './analyzer';

/**
 * Tier 3 of the balanced PHI list: terms that are never identifiers and must stay readable so a
 * clinical query is still usable. A term here only protects a finding whose matched span equals
 * it exactly (after trimming and case-folding) — see `isAllowlisted`. A span that merely contains
 * an allow-listed word, such as a `PERSON` finding of just "Smith" inside "anti-Smith", is not
 * exempted; that is a deliberate trade-off (see docs/phi-anonymizer-setup.md), not a bug.
 */

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

const RELATIVE_TIME = [
  'today',
  'tonight',
  'tomorrow',
  'yesterday',
  'last week',
  'next month',
  'end of quarter',
  'ytd',
];

const SEASONS_AND_HOLIDAYS = [
  'winter',
  'spring',
  'summer',
  'fall',
  'autumn',
  'thanksgiving',
  'christmas',
  'diwali',
  'labor day',
];

const US_STATES = [
  'alabama',
  'alaska',
  'arizona',
  'arkansas',
  'california',
  'colorado',
  'connecticut',
  'delaware',
  'florida',
  'georgia',
  'hawaii',
  'idaho',
  'illinois',
  'indiana',
  'iowa',
  'kansas',
  'kentucky',
  'louisiana',
  'maine',
  'maryland',
  'massachusetts',
  'michigan',
  'minnesota',
  'mississippi',
  'missouri',
  'montana',
  'nebraska',
  'nevada',
  'new hampshire',
  'new jersey',
  'new mexico',
  'new york',
  'north carolina',
  'north dakota',
  'ohio',
  'oklahoma',
  'oregon',
  'pennsylvania',
  'rhode island',
  'south carolina',
  'south dakota',
  'tennessee',
  'texas',
  'utah',
  'vermont',
  'virginia',
  'washington',
  'west virginia',
  'wisconsin',
  'wyoming',
];

const COUNTRIES_AND_REGIONS = [
  'united states',
  'usa',
  'u.s.',
  'u.s.a.',
  'canada',
  'mexico',
  'portugal',
  'europe',
  'england',
  'united kingdom',
  'france',
  'germany',
  'spain',
  'italy',
  'india',
  'china',
  'japan',
];

/**
 * Major cities kept as written outside the California-specific location substitution in
 * `location.ts` (which already keeps Los Angeles, San Francisco, and San Diego unless the
 * message reads as patient context). These two have no California region to assign, so they are
 * always kept rather than context-gated — a known deviation from the CA cities' behavior.
 */
const GENERAL_MAJOR_CITIES = ['new york', 'london'];

const MARKETS_AND_FINANCE = [
  'nyse',
  'nasdaq',
  'dow',
  's&p 500',
  'fed',
  'fomc',
  'sec',
  'wall street',
];

const ORGS_AND_TOOLS = [
  'acr',
  'eular',
  'fda',
  'cdc',
  'nih',
  'cms',
  'hipaa',
  'aws',
  'bedrock',
  'claude',
  'librechat',
  'pubmed',
];

const MEDICAL_EPONYMS = [
  "sjögren's",
  "sjogren's",
  "behçet's",
  "behcet's",
  "still's",
  "raynaud's",
  'takayasu',
  'kawasaki',
  'churg-strauss',
  'libman-sacks',
  "gottron's",
  "schirmer's",
  "schober's",
  'anti-smith',
  'anti-ro',
  'anti-la',
  'anti-jo-1',
];

const DRUGS = ['rinvoq', 'saphnelo', 'benlysta', 'actemra', 'krystexxa', 'plaquenil'];

const SCORES_AND_LABS = [
  'das28',
  'cdai',
  'sledai-2k',
  'basdai',
  'essdai',
  'ana',
  'dsdna',
  'ccp',
  'anca',
  'hla-b27',
  'hla-b*58:01',
];

export const PHI_ALLOWLIST_TERMS: ReadonlySet<string> = new Set(
  [
    ...WEEKDAYS,
    ...MONTHS,
    ...RELATIVE_TIME,
    ...SEASONS_AND_HOLIDAYS,
    ...US_STATES,
    ...COUNTRIES_AND_REGIONS,
    ...GENERAL_MAJOR_CITIES,
    ...MARKETS_AND_FINANCE,
    ...ORGS_AND_TOOLS,
    ...MEDICAL_EPONYMS,
    ...DRUGS,
    ...SCORES_AND_LABS,
  ].map((term) => term.toLowerCase()),
);

/** Variable-length terms a fixed set can't express. Each must match the whole normalized span. */
const PHI_ALLOWLIST_PATTERNS: readonly RegExp[] = [
  // Tuesday, next Tuesday, Friday morning
  /^(?:next |last )?(?:sun|mon|tues?|wednes|thurs?|fri|satur)day(?: morning| afternoon| evening| night)?$/,
  // Q3 2026, Q3 26
  /^q[1-4]\s?(?:20)?\d{2}$/,
  // FY26, FY2026
  /^fy\d{2,4}$/,
  // 2026, 1990s
  /^(?:19|20)\d{2}s?$/,
  // 6 weeks, 3-6 months, 3–6 months, 2 years ago
  /^\d+(?:[–-]\d+)?\s*(?:weeks?|months?|years?)(?:\s+ago)?$/,
  // q2wk, q6mo
  /^q\d+(?:wk|mo)$/,
  /^(?:daily|weekly|monthly|yearly)$/,
  // 3 pm
  /^\d{1,2}\s?(?:am|pm)$/,
];

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** True only when the whole, normalized span is an allow-listed term — a partial match never counts. */
export function isAllowlisted(text: string): boolean {
  const normalized = normalize(text);
  if (normalized.length === 0) {
    return false;
  }
  if (PHI_ALLOWLIST_TERMS.has(normalized)) {
    return true;
  }
  return PHI_ALLOWLIST_PATTERNS.some((pattern) => pattern.test(normalized));
}

/** Drops findings whose exact matched text is allow-listed, keeping everything else. */
export function filterAllowlisted(text: string, findings: readonly PhiFinding[]): PhiFinding[] {
  return findings.filter((finding) => !isAllowlisted(text.slice(finding.start, finding.end)));
}
