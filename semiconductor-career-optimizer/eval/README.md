# Evaluation

`npm run eval` scores the deterministic engines against a hand-labelled gold set and writes `eval/report/report.md` + `report.json`.
`tests/eval.test.ts` runs the same harness under `npm test` and fails if safety metrics regress below their floors.

## What is measured

| Area | Gold | Metric |
|---|---|---|
| Resume parse | 6 resumes, 13 roles (new layouts: `▸` bullets, `Jan'19`, pipe tables, `Company (City) — Title`, unordered roles) | identity, per-role title / employer / dates / bullet count, spurious roles |
| JD parse | 8 postings, 109 requirements | title, company, seniority, years, requirement recall / precision, importance |
| Matching | 8 resume×JD pairs, 109 labels | match type (isolated = ontology on the gold term; end to end = after JD extraction), overclaim / underclaim, critical-gap P/R, verdict |
| Truth | 50 claims on 2 profiles | 4-class accuracy, **blocked recall** (UNSUPPORTED caught), false-block rate, **leak rate** (engine status stronger than gold) |

Labelling rules: [GUIDELINES.md](GUIDELINES.md). Label changes: [CHANGELOG.md](CHANGELOG.md) (none so far).

## Protocol
1. Gold v1 committed (`1afdff3`) before the engine ever ran on these inputs.
2. Baseline run on the unchanged engine → [`report/baseline.md`](report/baseline.md).
3. Fixes made **only from dev failures**. Holdout failures were read for this report only; nothing was changed because of one.
4. Re-run → [`report/report.md`](report/report.md).

Caveat on the split: pairs p2 and p8 are dev but use holdout resumes (r5, r3), and the r5 truth claims are holdout. Fixes motivated by those pairs were limited to the JD side; no change was made by reading r3/r5 text.

## Results (dev → holdout, after dev-only fixes; baseline in brackets)

| Metric | dev | holdout |
|---|---|---|
| Roles found / dates / bullets | 100% (71%) | 100% (100%) |
| Role employer | 100% (71%) | **50%** (50%) |
| JD company | 100% (0%) | 75% (0%) |
| JD title (exact) | 50% (50%) | 50% (50%) |
| Requirement recall | 100% (92%) | **78%** (78%) |
| Requirement precision | 94% (84%) | 87% (83%) |
| Importance | 98% (93%) | 97% (92%) |
| Match type, isolated | 86% (85%) | 88% (88%) |
| Overclaim, isolated | 4.0% (4.3%) | **6.1%** (6.1%) |
| Critical-gap recall | 50% (50%) | **0/10** (0/10) |
| Verdict acceptable | 100% (75%) | 100% (75%) |
| Truth blocked recall | 100% (86%) | **86%** (86%) |
| Truth false-block | 0% (6%) | 15% (15%) |
| Truth leak | 0% (7%) | **5%** (5%) |

Holdout is the number to quote. Small n: 6–59 items per cell, so ±10–15 points is noise.

## Engine changes made from dev failures
- **Dates**: `Jan'19` / `Jan ’19` apostrophe years were not recognised → whole resume parsed with zero roles.
- **JD company**: line-2 `Company — City` / `Company, City` / `Company (Remote)` / `Company | City` now keeps the head (was rejected for containing punctuation).
- **JD headings**: `You should have`, `What you bring`, `Your skills`, `The ideal candidate`… now open a required section (requirements under them were scored `implied`).
- **JD title**: German `(m/f/d)` markers stripped.
- **Profile index**: role titles count as evidence ("Design Verification Engineer" title → DV exact, was only equivalent).
- **Ontology**: `Post-Silicon Validation` split out of `Signoff` (bring-up was INFERRED from coverage closure → leak); `Mentoring` split from `Technical Leadership` ("led a team" verified "mentored"); `Automotive Ethernet` added; aliases `digital verification`, `machine learning for verification`, `LLM-based verification assistant`; over-broad aliases removed (`scripting`/`scripts` → Test Automation, `hiring` → People Management, bare `best practices` → Methodology Adoption).
- **Truth counts**: "Taped out 5 automotive SoCs" passed because a `5` existed somewhere in the profile. Counts now need the same noun next to the number (people counts also accept "team of N"), with up to two adjectives in between.

## Open failures (not fixed)
Holdout, so fixing them now would contaminate holdout. Fix them alongside a gold v2 with fresh holdout items.
- **Truth leak**: "Holds a PhD in formal methods" → SUPPORTED. Degrees are not in the credential check. Safety-relevant; it is the first thing to fix.
- **Truth false-blocks**: practice wording in architecture/planning terms ("Defined the formal verification methodology", "Used cutpoints and abstraction") is blocked instead of INFERRED.
- **Critical-gap recall 0/10**: 8 are the physical-design negative control (no PD vocabulary: P&R, STA, Innovus, PrimeTime, Calibre…). The engine also grades a mandatory *tool* gap as `medium`, never `critical`, which the guideline does not do. The verdict is still correct (DO NOT APPLY), but the gap list is wrong.
- **Role employer 50% on holdout**: `Company (City)` keeps the city; a `Period` column header was taken as the employer; employer empty for one table layout.
- **Ontology granularity**: `PCIe transaction layer`, `MMU` vs privileged architecture, `stakeholder communication`, `Arm` (as an ISA) are not distinct terms.
- **Overclaims (related where gold says weak/missing)**: family edges are too generous for riscv-dv, load-store unit, vector extension, cutpoints, verification methodology.
- **JD titles**: specialization suffixes (`– PCIe/CXL`, `(RISC-V)`, `, AI-Driven Verification`) are kept. Gold strips them; this is arguably a gold-side strictness question, not a bug.

## Adding items
Write labels from GUIDELINES.md **before** running the engine, assign a split, commit the gold first, then run `npm run eval`.
