export interface AdHocPattern {
  name: string;
  regex: string;
  score: number;
}

export interface AdHocRecognizer {
  name: string;
  supported_language: string;
  supported_entity: string;
  patterns: AdHocPattern[];
  context?: string[];
}

const STREET_SUFFIXES =
  '(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Way|Ct|Court|Pl|Place)';
const DIGIT_WORD = '(?:zero|one|two|three|four|five|six|seven|eight|nine)';
const US_STATES = [
  'AL',
  'AK',
  'AZ',
  'AR',
  'CA',
  'CO',
  'CT',
  'DE',
  'FL',
  'GA',
  'HI',
  'ID',
  'IL',
  'IN',
  'IA',
  'KS',
  'KY',
  'LA',
  'ME',
  'MD',
  'MA',
  'MI',
  'MN',
  'MS',
  'MO',
  'MT',
  'NE',
  'NV',
  'NH',
  'NJ',
  'NM',
  'NY',
  'NC',
  'ND',
  'OH',
  'OK',
  'OR',
  'PA',
  'RI',
  'SC',
  'SD',
  'TN',
  'TX',
  'UT',
  'VT',
  'VA',
  'WA',
  'WV',
  'WI',
  'WY',
];

/**
 * Clinical identifiers Presidio's built-in recognizers do not cover.
 * Ported from ObsidianAI's `redactor/presidio_engine.py` (v2 branch).
 */
export const PHI_AD_HOC_RECOGNIZERS: readonly AdHocRecognizer[] = [
  {
    name: 'mrn',
    supported_language: 'en',
    supported_entity: 'MEDICAL_RECORD_NUMBER',
    patterns: [
      {
        name: 'MRN',
        regex:
          '\\b(?:MRN|Medical\\s+Record(?:\\s+(?:No\\.?|Number))?)[:\\s#-]*\\d{3,}(?:[-\\s]\\d+)*(?:[-\\s][A-Z0-9])?\\b',
        score: 0.9,
      },
    ],
  },
  {
    name: 'patient_id',
    supported_language: 'en',
    supported_entity: 'PATIENT_ID',
    patterns: [{ name: 'PT_ID', regex: '\\bPT-\\d{3,}\\b', score: 0.85 }],
  },
  {
    name: 'npi',
    supported_language: 'en',
    supported_entity: 'NPI',
    patterns: [{ name: 'NPI', regex: '\\bNPI[:\\s#]*\\d{10}\\b', score: 0.9 }],
  },
  {
    name: 'dea',
    supported_language: 'en',
    supported_entity: 'DEA_NUMBER',
    patterns: [{ name: 'DEA', regex: '\\bDEA[:\\s#]*[A-Z]{2}\\d{7}\\b', score: 0.9 }],
  },
  {
    name: 'street_address',
    supported_language: 'en',
    supported_entity: 'STREET_ADDRESS',
    patterns: [
      {
        name: 'STREET_NUM_FIRST',
        regex: `\\b\\d{1,5}\\s+[A-Z][a-zA-Z]+(?:\\s+[A-Za-z]+){0,3}\\s+${STREET_SUFFIXES}\\.?\\b`,
        score: 0.8,
      },
      {
        name: 'STREET_ORDINAL',
        regex: `\\b\\d+(?:st|nd|rd|th)\\s+${STREET_SUFFIXES}\\.?\\b`,
        score: 0.8,
      },
    ],
  },
  {
    name: 'house_number',
    supported_language: 'en',
    supported_entity: 'HOUSE_NUMBER',
    patterns: [
      {
        name: 'HOUSE_NUM',
        regex: '\\b(?:house|unit|apt|apartment|suite|ste|#)\\s*#?\\s*\\d{1,5}\\b',
        score: 0.7,
      },
    ],
    context: [
      'street',
      'road',
      'avenue',
      'residence',
      'address',
      'corner',
      'near',
      'lives',
      'located',
    ],
  },
  {
    name: 'zip_code',
    supported_language: 'en',
    supported_entity: 'US_ZIP_CODE',
    patterns: [{ name: 'ZIP', regex: '\\b\\d{5}(?:-\\d{4})?\\b', score: 0.5 }],
    context: ['zip', 'postal', 'zip code', ...US_STATES],
  },
  {
    name: 'spelled_number',
    supported_language: 'en',
    supported_entity: 'SPELLED_NUMBER',
    patterns: [
      {
        name: 'SPELLED_NUM',
        regex: `(?i)\\b${DIGIT_WORD}(?:-${DIGIT_WORD}){2,}\\b`,
        score: 0.8,
      },
    ],
    context: ['code', 'pin', 'badge', 'number', 'id', 'identifier', 'access', 'employee'],
  },
  {
    name: 'health_plan_id',
    supported_language: 'en',
    supported_entity: 'HEALTH_PLAN_ID',
    // Health-plan member/subscriber, policy, group, claim, and encounter (FIN) numbers.
    // Labeled only, same as `mrn` above, so an unlabeled number is never touched.
    patterns: [
      {
        name: 'HEALTH_PLAN_ID',
        regex:
          '\\b(?:(?:Member|Subscriber)\\s*ID|Policy(?:\\s+Number)?|Group(?:\\s+Number)?|Claim(?:\\s+Number)?|(?:Encounter|FIN)(?:\\s+Number)?)[:\\s#-]*[A-Za-z0-9-]{3,}\\b',
        score: 0.8,
      },
    ],
  },
  {
    name: 'custom_id',
    supported_language: 'en',
    supported_entity: 'CUSTOM_ID',
    patterns: [
      {
        name: 'ALPHANUM_ID',
        regex: '\\b[A-Z]{2,8}-[A-Za-z0-9]{2,}(?:-[A-Za-z0-9]+)*\\b',
        score: 0.65,
      },
    ],
    context: [
      'id',
      'identifier',
      'code',
      'badge',
      'account',
      'portal',
      'employee',
      'system',
      'tracking',
      'reference',
      'record',
      'number',
      'case',
    ],
  },
];

/**
 * Presidio built-ins that cover the HIPAA Safe Harbor identifiers, plus the custom set above.
 *
 * `DATE_TIME` is deliberately left out: Presidio's built-in detector tags every time expression,
 * including weekdays, "tomorrow", and "6 weeks", none of which Safe Harbor requires removing.
 * Real calendar dates (the day/month elements Safe Harbor does require removing) are instead
 * matched locally by `findCalendarDates` in `localRecognizers.ts`, run alongside this entity set
 * by the PHI pipeline. An operator who wants Presidio's broader `DATE_TIME` back can still add it
 * via the `entities` override in `librechat.yaml`.
 */
export const PHI_DEFAULT_ENTITIES: readonly string[] = [
  'PERSON',
  'LOCATION',
  'PHONE_NUMBER',
  'EMAIL_ADDRESS',
  'US_SSN',
  'IP_ADDRESS',
  'URL',
  'US_DRIVER_LICENSE',
  'US_PASSPORT',
  'US_BANK_NUMBER',
  'CREDIT_CARD',
  'MEDICAL_LICENSE',
  'IBAN_CODE',
  'MEDICAL_RECORD_NUMBER',
  'PATIENT_ID',
  'NPI',
  'DEA_NUMBER',
  'STREET_ADDRESS',
  'HOUSE_NUMBER',
  'US_ZIP_CODE',
  'SPELLED_NUMBER',
  'CUSTOM_ID',
  'HEALTH_PLAN_ID',
];
