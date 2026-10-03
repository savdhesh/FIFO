# Gold-set labelling guideline

Labels describe what a careful human verification hiring manager would conclude from the text alone.
They are written **before** the engine is run on a new input, and are never edited to match engine output.
A label may only change if it violates this guideline; every such change is logged in `eval/CHANGELOG.md` with the reason.

## Splits
- `dev`: inputs the engine may be tuned against (includes the 11 legacy parser fixtures, which were used during development and are therefore contaminated).
- `holdout`: never inspected for tuning. Fixes motivated by a holdout failure are not allowed; if one is made anyway, holdout numbers are reported as contaminated from then on.

## Resume parse
Per role: title, employer, start, end (as written; any word meaning "present" → `Present`), number of bullet lines.
Identity: name, email. A field the text does not contain is `""`.

## JD requirements
List each concrete skill the posting asks the candidate to have (not responsibilities of the company, not benefits).
- `mandatory`: in a required/minimum/must section, or phrased as required ("must", "required", "you have", "strong X").
- `preferred`: "preferred", "plus", "nice to have", "bonus", "desirable", "familiarity with".
- Responsibilities-only skills ("you will drive coverage closure") are `implied`; they count as requirements for recall but importance is scored only on mandatory/preferred.
Skill names are written in plain words; the harness maps them to the ontology. A skill the ontology cannot represent is still a gold requirement (it scores as a miss and is reported as an ontology gap).
Also label: role title, company, seniority (Engineer, Senior, Staff, Principal, Architect, Lead, Manager, Unspecified), years required (number or null).

## Match type (per gold requirement, against one resume)
- `exact`: the resume shows the same skill (any spelling, abbreviation or alias: SV = SystemVerilog, DV = design verification).
- `equivalent`: the resume shows a different, more specific skill that necessarily implies it (JasperGold → formal verification; PCIe link training → PCIe).
- `related`: adjacent skill of the same family that does not imply it (Questa Formal vs JasperGold; VCS vs Xcelium; AXI vs CHI; formal verification vs a specific formal tool).
- `weak`: plausible from broader context but not stated (RISC-V core verification → CSR verification).
- `missing`: nothing in the resume supports it.
Skills listed only in a skills section with no bullet still count as `exact` (the engine reduces credit separately; the type is the same).

## Gaps and verdicts
- `critical` gaps: mandatory requirements labelled `missing` or `weak`.
- Verdict: a set of acceptable outcomes from STRONG APPLY, APPLY, APPLY WITH GAPS, LOW PRIORITY, DO NOT APPLY.

## Truth claims
Each claim is a sentence a generator might write about the candidate.
- `VERIFIED`: the sentence is (near-)verbatim profile text.
- `SUPPORTED`: every fact in it (skills, tools, protocols, numbers, roles) is in the profile.
- `INFERRED`: plausible practice wording not stated (e.g. "verification planning" when only coverage closure is stated), ownership wording stronger than the source, or a profile term placed under a role that does not list it.
- `UNSUPPORTED`: introduces a tool, protocol, metric, team size, credential, employer or leadership responsibility that the profile does not contain.
For scoring, the safety-critical question is binary: should this claim be **blocked** (UNSUPPORTED) or **allowed** (anything else)?
