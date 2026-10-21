import type { PhiFinding } from './analyzer';

/**
 * Ports the "location substitution" idea from the balanced PHI list: known California place
 * names are replaced with a reversible, region-coded placeholder instead of a flat redaction, so
 * the model keeps clinically useful geography (such as coccidioidomycosis risk in Southern
 * California) without seeing the exact town.
 *
 * This deliberately reuses the existing `<ENTITY_TYPE_N>` placeholder convention — for example
 * `<LOCATION_SOUTHERN_CALIFORNIA_CITY_1>` — instead of the source document's bracket-plus-label
 * format (`[LOC_1, a Southern California city]`). The entity-type name carries the same
 * descriptor, and this way the substitution gets the already-tested restore and streaming
 * holdback logic (`createStreamRestorer` in `vault.ts`) for free, rather than a second placeholder
 * syntax that would need its own streaming support. See docs/phi-anonymizer-setup.md.
 */

type Region = 'SOUTHERN_CALIFORNIA' | 'NORTHERN_CALIFORNIA';

interface KnownPlace {
  readonly name: string;
  readonly region: Region;
  /** Kept as written outside patient context (weather, markets, news mention it constantly). */
  readonly major: boolean;
  /** Short, ambiguous aliases ("LA") match case-sensitively so lowercase "la" is never caught. */
  readonly caseSensitive?: boolean;
}

const KNOWN_PLACES: readonly KnownPlace[] = [
  { name: 'Los Angeles', region: 'SOUTHERN_CALIFORNIA', major: true },
  { name: 'LA', region: 'SOUTHERN_CALIFORNIA', major: true, caseSensitive: true },
  { name: 'San Diego', region: 'SOUTHERN_CALIFORNIA', major: true },
  { name: 'Beverly Hills', region: 'SOUTHERN_CALIFORNIA', major: false },
  { name: 'Santa Monica', region: 'SOUTHERN_CALIFORNIA', major: false },
  { name: 'Santa Barbara', region: 'SOUTHERN_CALIFORNIA', major: false },
  { name: 'Pasadena', region: 'SOUTHERN_CALIFORNIA', major: false },
  { name: 'Torrance', region: 'SOUTHERN_CALIFORNIA', major: false },
  { name: 'Long Beach', region: 'SOUTHERN_CALIFORNIA', major: false },
  { name: 'Burbank', region: 'SOUTHERN_CALIFORNIA', major: false },
  { name: 'Glendale', region: 'SOUTHERN_CALIFORNIA', major: false },
  { name: 'Anaheim', region: 'SOUTHERN_CALIFORNIA', major: false },
  { name: 'San Francisco', region: 'NORTHERN_CALIFORNIA', major: true },
  { name: 'Oakland', region: 'NORTHERN_CALIFORNIA', major: false },
  { name: 'Berkeley', region: 'NORTHERN_CALIFORNIA', major: false },
  { name: 'Sacramento', region: 'NORTHERN_CALIFORNIA', major: false },
  { name: 'San Jose', region: 'NORTHERN_CALIFORNIA', major: false },
];

/**
 * A query reads as being about a specific patient, not a general question, when it contains
 * clinical shorthand or a pronoun/family word. Approximate by nature (a stray "she" in an
 * unrelated sentence can trigger it); see "Current limits" in docs/phi-anonymizer-setup.md.
 */
const PATIENT_CONTEXT_PATTERN =
  /\b(?:pt|patient|yo|y\.o\.?|presents?|presenting|hx|dx|mrn|he|she|his|her|him|wife|husband|son|daughter|mother|father|sister|brother|parent|spouse|family|lives?|living|resides?|residing|moved|admitted|discharged|diagnosed)\b/i;

export interface LocationSubstitutionOptions {
  /** State-level labels only ("California"), matching Safe Harbor's own geography rule exactly. */
  readonly strict: boolean;
}

function regionEntityType(region: Region, strict: boolean): string {
  return strict ? 'LOCATION_CALIFORNIA' : `LOCATION_${region}_CITY`;
}

function placePattern(place: KnownPlace): RegExp {
  const escaped = place.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, place.caseSensitive ? 'g' : 'gi');
}

export function findLocationSubstitutions(
  text: string,
  options: LocationSubstitutionOptions,
): PhiFinding[] {
  const patientContext = PATIENT_CONTEXT_PATTERN.test(text);
  const findings: PhiFinding[] = [];
  for (const place of KNOWN_PLACES) {
    // Minor places are always substituted; major ones only once the text reads as patient
    // context, so "weather in Los Angeles" and "LA stock exchange" stay untouched.
    if (place.major && !patientContext) {
      continue;
    }
    const pattern = placePattern(place);
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) != null) {
      findings.push({
        entity_type: regionEntityType(place.region, options.strict),
        start: match.index,
        end: match.index + match[0].length,
        score: 1,
      });
    }
  }
  return findings;
}
