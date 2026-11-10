# Tax and benefit data sources

Every table the engine uses, where it came from and how far it has been checked.
Update this file with `2026.ts` each year. "Retrieved" is when the figure was last read from the source.

Status:
- **verified**: read directly from the primary source.
- **secondary**: taken from a reputable published table, not re-checked against the primary source.
- **approximate**: the engine uses a simplification; the note says what.
- **gated**: the rule is known to exist but isn't implemented until its source is confirmed.

## Income tax (`2026.ts`, `personal.ts`)

| Table | Year | Source | Retrieved | Status |
|---|---|---|---|---|
| Federal and provincial brackets | 2026 | [CRA current-year rates](https://www.canada.ca/en/revenue-agency/services/tax/individuals/frequently-asked-questions-individuals/canadian-income-tax-rates-individuals-current-previous-years.html); [KPMG 2026 brackets](https://assets.kpmg.com/content/dam/kpmgsites/ca/pdf/services/tax/personal-tables/ca-federal-and-provincial-territorial-income-tax-rates-and-brackets-for-2026.pdf.coredownload.inline.pdf) | 2026-11 | secondary |
| Basic, age and pension amounts; credit rates | 2026 | [KPMG 2026 credits](https://assets.kpmg.com/content/dam/kpmgsites/ca/pdf/services/tax/personal-tables/ca-federal-and-provincial-territorial-non-refundable-tax-credit-rates-and-amounts-2026.pdf.coredownload.inline.pdf), CRA T4127 (Jan 2026) | 2026-11 | secondary |
| Newfoundland basic amount | 2026, 2027+ | [NL personal income tax](https://www.gov.nl.ca/fin/tax-programs-incentives/personal/personalincometax/) ($13,094 for 2026, indexed); [Budget 2026](https://www.gov.nl.ca/budget/2026/news-release/) ($15,000). $13,094 is the exact midpoint of $11,188 and $15,000, so $15,000 is taken as the full-year amount from 2027 | 2026-11 | verified, except the 2027 start is inferred |
| Ontario surtax, order of calculation | 2025 form, 2026 values | [CRA form ON428](https://www.canada.ca/content/dam/cra-arc/formspubs/pbg/5006-c/5006-c-25e.pdf) | 2026-11 | verified |
| Ontario tax reduction, health premium | 2026 | CRA T4127 (Jan 2026) | 2026-11 | secondary |
| BC tax reduction ($690, not indexed for 2026) | 2026 | Budget Measures Implementation Act, 2026 (Bill 2), ss. 38, 40 | 2026-11 | verified |
| BC indexation pause 2027–2030 | 2027–2030 | Bill 2, s. 41, adding s. 4.52(4.25) to the Income Tax Act (BC). Read in the first-reading text; Bill 2 became S.B.C. 2026 c.5 | 2026-11 | verified (first-reading text) |
| Manitoba and PEI frozen thresholds | 2026 | KPMG tables above | 2026-11 | secondary |
| Saskatchewan basic amount: +$500 a year through 2028, on top of indexation | 2027–2028 | [Bill 30 explanatory notes](https://docs.legassembly.sk.ca/legdocs/Explanatory%20Notes/30L1S/Bill30-1EN.pdf). The senior supplement credit is not modelled | 2026-11 | verified |
| Federal $2,000 and fixed provincial pension amounts | current | Fixed in dollars; Ontario and Alberta indexed. [NL page](https://www.gov.nl.ca/fin/tax-programs-incentives/personal/personalincometax/) confirms for NL | 2026-11 | secondary |
| Eligible dividend credit rates | 2025 published | KPMG tables above | 2026-11 | secondary |
| Quebec age and retirement amounts, family-income reduction, sharing | 2025 form, 2026 amounts | Revenu Québec Schedule B, TP-1.D.B-V (2025-12); line 361 help. The amount for a person living alone is not modelled, since the plan doesn't say who lives together | 2026-11 | verified |
| Quebec health services fund | 2025 | Revenu Québec Schedule F, TP-1.D.F-V (2025-12); line 446 help. Thresholds are 2025's until the 2026 form is published | 2026-11 | verified (2025 values) |
| Quebec pension splitting | 2025 | Revenu Québec Schedule Q, TP-1.D.Q-V (2025-12); lines 123 and 245 help | 2026-11 | verified |
| Quebec unused credits between spouses | 2025 | Revenu Québec line 431 help. Line 430 is read as tax less all non-refundable credits, dividend credit included; the page doesn't define it | 2026-11 | verified, except that reading of line 430 |
| Spouse amount (federal and provincial, amounts and thresholds) | 2026 | [KPMG 2026 credits](https://assets.kpmg.com/content/dam/kpmgsites/ca/pdf/services/tax/personal-tables/ca-federal-and-provincial-territorial-non-refundable-tax-credit-rates-and-amounts-2026.pdf.coredownload.inline.pdf). Transfers of other unused credits are not modelled | 2026-11 | secondary |
| Pension splitting: receiver's pension credit | current | [CRA pension income splitting](https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/pension-income-splitting.html) | 2026-11 | verified |
| Low-income reductions in NS, NB, NL, PE; Nova Scotia age tax credit | 2025 forms | CRA [NS428](https://www.canada.ca/content/dam/cra-arc/formspubs/pbg/5003-c/5003-c-25e.pdf), [NB428](https://www.canada.ca/content/dam/cra-arc/formspubs/pbg/5004-c/5004-c-25e.pdf), [NL428](https://www.canada.ca/content/dam/cra-arc/formspubs/pbg/5001-c/5001-c-25e.pdf), [PE428](https://www.canada.ca/content/dam/cra-arc/formspubs/pbg/5002-c/5002-c-25e.pdf). 2026 values are published with the 2026 forms | 2026-11 | verified (2025 values) |
| Unused age and pension amounts between spouses | 2025 forms | CRA [Schedule 2](https://www.canada.ca/content/dam/cra-arc/formspubs/pbg/5000-s2/5000-s2-25e.pdf) and the provincial S2 forms. Disability and tuition amounts aren't modelled | 2026-11 | verified |

## Payroll (`payroll.ts`)

| Table | Year | Source | Retrieved | Status |
|---|---|---|---|---|
| CPP/QPP, EI, QPIP | 2026 | CRA T4127 (Jan 2026) | 2026-11 | secondary |

## Benefits (`src/lib/benefits/`)

| Table | Year | Source | Retrieved | Status |
|---|---|---|---|---|
| OAS maximum ($762.50/month, $9,150 annualized run rate) | Oct–Dec 2026 | [Canada.ca OAS and GIS amounts](https://www.canada.ca/en/services/benefits/publicpensions/old-age-security/payments.html) | 2026-11 | verified |
| GIS, Allowance and Allowance for the Survivor | Oct–Dec 2026 | [Table of Amounts](https://open.canada.ca/data/en/dataset/dfa4daf1-669e-4514-82cd-982f27707ed0), reduced to break points within $3 a month. Benefits use last year's income, or this year's for a drop in employment or pension income ([GIS while receiving](https://www.canada.ca/en/services/benefits/publicpensions/old-age-security/guaranteed-income-supplement/while-receiving.html)). Partial OAS isn't reflected | 2026-11 | verified |
| CPP survivor's pension | 2026 | [CPP Act s. 58](https://laws-lois.justice.gc.ca/eng/acts/c-8/section-58.html) and s. 57; [2026 maximums](https://www.canada.ca/en/employment-social-development/programs/pensions/pension/statistics/2026-quarterly-october-december.html). One pension figure is used, so base and enhanced parts aren't separated | 2026-11 | verified |
| QPP survivor's pension | 2026 | [Act respecting the Québec Pension Plan](https://www.legisquebec.gouv.qc.ca/en/document/cs/R-9), ss. 133–137 (consolidated to 2026-10-15). Flat amounts are the gaps between the [2026 maximums](https://www.retraitequebec.gouv.qc.ca/en/programs/quebec-pension-plan/quebec-pension-plan-figures). No dependent children or disability assumed; the additional plan's 50% isn't separated | 2026-11 | verified |
| QPP early-start reduction and 15% dropout | 2026 | R-9 ss. 116.4, 116.6, 120.1; Retraite Québec [leaflet 1036-2](https://www.retraitequebec.gouv.qc.ca/en/publications/our-programs/quebec-pension-plan/retirement/calculation-retirement-pension-quebec-pension-plan); base-plan maximum $1,441.25 (2026 figures) | 2026-11 | verified |

## Registered accounts (`src/lib/sim/steps/rrif.ts`)

| Table | Year | Source | Retrieved | Status |
|---|---|---|---|---|
| RRIF minimum factors | current | Income Tax Regulations s. 7308 | 2026-11 | verified |
| LIF maximum: common column (formula checked against the table), Manitoba, Nova Scotia, federal | 2026 | [Empire Life 2026 LIF table](https://www.empire.ca/sites/default/files/2026-01/INV-996A-LIFMinMaxWithdrawalPercentages-EN-web.pdf). The prior-year-return alternative is not used, which errs cautious | 2026-11 | secondary |
| LIF maximum: Saskatchewan | 2026 | Common column (the table lists Saskatchewan there) | 2026-11 | approximate |
| Contribution limits (TFSA, RRSP, FHSA) | 2026 | CRA | 2026-11 | secondary |
| FHSA closing deadline and rollover | current | [CRA closing your FHSA](https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/first-home-savings-account/closing-your-fhsa.html) | 2026-11 | verified |

## Estate (`probate.ts`)

| Table | Year | Source | Retrieved | Status |
|---|---|---|---|---|
| Provincial probate fees | 2026 | Provincial fee schedules, applied to the whole estate before income tax; labelled an estimate | 2026-11 | approximate |

## Return assumptions

| Table | Year | Source | Retrieved | Status |
|---|---|---|---|---|
| Asset-class returns, inflation | 2026 | [FP Canada 2026 guidelines](https://www.fpcanada.ca/newsdetail/fp-canada--and-the-institute-of-financial-planning-jointly-publish-the-2026-projection-assumption-guidelines-for-financial-planners) | 2026-11 | secondary |
| Historical Canadian returns | to 2015 | See `src/data/historical/SOURCES.md` | — | reconstructed estimates |

## Yearly update checklist

Do this when CRA publishes the January T4127 and the new year's tables.

1. Copy `2026.ts` to the new year and update every figure below from its source.
2. Federal and provincial brackets, credit amounts and rates. Note which provinces index and which froze.
3. Dated rules: `indexPauses` and `basicPersonalSteps` for any province, and remove steps now in the base amount.
4. Ontario surtax thresholds, tax reduction and health premium bands; BC reduction; Manitoba phase-out.
5. CPP/QPP, EI and QPIP rates and ceilings (T4127).
6. OAS maximum and clawback threshold; GIS maximums and cut-offs (quarterly on Canada.ca).
7. LIF tables and the RRIF factors if changed; contribution limits (TFSA, RRSP, FHSA).
8. Probate schedules. Asset-class return guidelines (FP Canada, usually spring).
9. Add golden cases to `src/test/tax-provinces.test.ts` with expected values worked by hand or taken from a form, never from the code.
10. Quebec: Schedule B and Schedule F amounts, including `healthContribution`. Revenu Québec blocks automated reading, so download them by hand.
11. Bump `MODEL_VERSION` in `src/lib/sim/funding.ts`, and update the status and date of each row above.
