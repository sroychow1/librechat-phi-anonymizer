# Balanced PHI Anonymization List

Goal: remove anything that identifies you or a patient, and keep the ordinary words that make a query usable. The rules follow the HIPAA Safe Harbor identifier list ([HHS de-identification guidance](https://www.hhs.gov/hipaa/for-professionals/special-topics/de-identification/index.html)), loosened only where the text does not point to a person.

Why "Tuesday" was removed: Presidio's `DATE_TIME` detector tags every time expression, including weekdays, "tomorrow", and "6 weeks". Safe Harbor only requires removing date elements (day, month) of dates tied to an individual, such as birth, admission, discharge, death, or lab dates. A weekday by itself is not one of those. The fix is to turn off `DATE_TIME` and detect real calendar dates with a narrower pattern.

## Tier 1: Always redact

| Category | Examples |
|---|---|
| Names of patients, relatives, employers, household members | "John Smith", "his wife Maria" |
| Your own identifiers | Your name, family names, home address, personal phone and email, NPI, DEA, license number |
| Contact details | Phone, fax, email, URLs tied to a person, IP addresses |
| Government and financial IDs | SSN, ITIN, driver's license, passport, bank, credit card, IBAN |
| Health system numbers | MRN, chart number, health-plan member or subscriber ID, policy or group number, claim number, encounter or FIN number |
| Device and vehicle IDs | Device serial numbers, implant IDs, license plates, VINs |
| Biometrics and images | Voice recordings, fingerprints, full-face photos |
| Unique characteristics | Rare job plus small town, a public figure's role, "the only ___ in the practice" (your local review pass handles these) |

## Tier 2: Redact only when it is a real identifier

| Category | Redact | Keep |
|---|---|---|
| Calendar dates | 3/14/2026, 2026-03-14, March 14, 14 March 2026, 3/14 | 120/80 mmHg, 15/2.5 mg |
| Street addresses | 8700 Beverly Blvd Suite 200 | "Beverly Hills area" is still caught as a city by the location detector |
| ZIP codes | CA 90048, zip 90210 | CK 12500, platelets 25000 |
| Ages | Over 89: "92 yo", "aged 94" | 89 and under: "65 yo man" |
| Cities and counties | Cities where patients live, including Los Angeles | States and countries (permitted under Safe Harbor) |
| Record numbers | Only when labeled: "MRN 00482913", "Member ID W12345" | Unlabeled numbers: DAS28 5.1, IgG 1450 |

## Tier 3: Never redact (allow-list)

- Weekdays: Monday through Sunday, "next Tuesday", "Friday morning"
- Relative time: today, tonight, tomorrow, yesterday, last week, next month, end of quarter, YTD, Q3 2026, FY26
- Durations and dosing: 6 weeks, 3–6 months, 2 years ago, q2wk, q6mo, daily, weekly, 3 pm
- Year alone: 2026, 1990s (Safe Harbor keeps years, except years that imply age over 89)
- Month alone: October, "ACR in November" (trade-off noted below)
- Seasons and holidays: winter, Thanksgiving, Christmas, Diwali, Labor Day
- States and countries: California, New York, Portugal, Europe
- Markets and finance: NYSE, Nasdaq, Dow, S&P 500, Fed, FOMC, SEC, Wall Street
- Organizations and tools: ACR, EULAR, FDA, CDC, NIH, CMS, HIPAA, AWS, Bedrock, Claude, LibreChat, PubMed
- Medical eponyms: Sjögren's, Behçet's, Still's, Raynaud's, Takayasu, Kawasaki, Churg-Strauss, Libman-Sacks, Gottron's, Schirmer's, Schober's, anti-Smith, anti-Ro, anti-Jo-1
- Drugs: Rinvoq, Saphnelo, Benlysta, Actemra, Krystexxa, Plaquenil, and other common rheumatology brands
- Scores and labs: DAS28, CDAI, SLEDAI-2K, BASDAI, ESSDAI, ANA, dsDNA, CCP, ANCA, HLA-B27, HLA-B*58:01
- Nationality, ethnicity, religion: kept on purpose, because they are not Safe Harbor identifiers and are often clinically relevant (for example, HLA-B*58:01 screening or ancestry in genetic studies)

## Deliberate trade-offs

1. **Surname eponyms stay redacted.** Graves, Wilson, Baker, Murphy, Patrick, Hoffmann, and Smith are common surnames, so allowing them could leak a patient's name. Write "anti-Smith", or accept "<PERSON> disease" occasionally.
2. **Month alone is kept.** Strict Safe Harbor would also remove "admitted in March" for a patient. Your local review model is the safety net for that. Delete the `MONTH` line in `months_and_seasons` if you want the strict version.
3. **Los Angeles is handled by substitution, not deletion** (see the next section).
4. **Every allow-list pattern must match the whole flagged phrase.** "Tuesday" is kept, but "Tuesday, March 3, 2026" is still redacted as a date.

## Location substitution

`phi_location_substitution.py` runs before Presidio and swaps known places for reversible region tokens. The original names stay in a mapping on the Mac mini and are restored in the reply.

| Input | Sent to the model |
|---|---|
| Is the LA stock exchange open Tuesday? | Unchanged (no patient context, so major cities are kept) |
| What's the weather in Los Angeles this weekend? | Unchanged |
| Pt is a 54 yo woman from Pasadena with cocci exposure | Pt is a 54 yo woman from [LOC_1, a Southern California city] with cocci exposure |
| She moved from Beverly Hills to San Francisco | She moved from [LOC_3, a Southern California city] to [LOC_4, a Northern California city] |
| Anti-Ro and anti-La positive, lives in Torrance | Anti-Ro and anti-La positive, lives in [LOC_6, a Southern California city] |

- **Patient context** (pt, yo, presents, hx, dx, MRN, he or she, family words, and similar): every mapped place is substituted, including Los Angeles.
- **General queries:** LA, San Francisco, San Diego, New York, London, and a few other major cities are kept as written. Smaller places such as Santa Monica are still substituted, then restored.
- **Unknown towns** not on the lists are still fully redacted by Presidio.
- **Strict mode** (`strict=True`) labels every California place as just "California", the state level that Safe Harbor permits. The default "Southern California" label keeps clinically useful geography, such as coccidioidomycosis risk, but is more specific than Safe Harbor's state-level rule.
- **Tested on 7 examples:** all were substituted or kept as expected, and all 7 restored to exactly the original text.

## Test results (pattern level)

- Kept (34 of 34 test terms): Tuesday, next Tuesday, tomorrow, 6 weeks, q2wk, 2026, October, Thanksgiving, California, NYSE, Fed, Sjögren's, anti-Smith, Rinvoq, DAS28, Q3 2026, and others
- Still redacted (11 of 11 traps): "Tuesday, March 3, 2026", 3/14/2026, March 3, Los Angeles, Smith, John Smith, Graves, Wilson, Beverly Hills
- Date, address, ZIP code, age, and record-number detectors behaved as shown in Tier 2, with no false hits on BP, CK, platelets, DAS28, IgG, or age 65

These patterns were tested on their own, outside your anonymizer. Run your regression tests on the Mac mini after you plug them in.
