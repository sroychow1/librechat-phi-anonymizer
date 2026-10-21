import type { PhiAnonymizerConfig } from 'librechat-data-provider';
import type { PhiFinding } from './analyzer';
import { findAges, findCalendarDates } from './localRecognizers';
import { findLocationSubstitutions } from './location';
import { filterAllowlisted } from './allowlist';

/** Local (non-Presidio) detections: ages over the threshold, real calendar dates, and places. */
export function collectLocalFindings(
  text: string,
  config: Pick<
    PhiAnonymizerConfig,
    | 'redactAges'
    | 'ageRedactionThreshold'
    | 'redactCalendarDates'
    | 'locationSubstitution'
    | 'locationStrict'
  >,
): PhiFinding[] {
  const findings: PhiFinding[] = [];
  if (config.redactCalendarDates) {
    findings.push(...findCalendarDates(text));
  }
  if (config.redactAges) {
    findings.push(...findAges(text, config.ageRedactionThreshold));
  }
  if (config.locationSubstitution) {
    findings.push(...findLocationSubstitutions(text, { strict: config.locationStrict }));
  }
  return findings;
}

/**
 * Combines Presidio's findings with the local ones, then drops anything the Tier 3 allow-list
 * protects (a weekday, a lab score, a drug name, ...). This is the single place the middleware
 * needs to call between getting the analyzer's response and redacting the text.
 */
export function buildFindings(
  text: string,
  presidioFindings: readonly PhiFinding[],
  config: PhiAnonymizerConfig,
): PhiFinding[] {
  const combined = [...presidioFindings, ...collectLocalFindings(text, config)];
  return filterAllowlisted(text, combined);
}
