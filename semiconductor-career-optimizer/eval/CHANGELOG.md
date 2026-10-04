# Gold-set changelog
Every change to a label after its first commit is recorded here with the reason. Labels are never changed to match engine output.

- v1: initial labels (6 resumes, 8 job descriptions, 8 resume×job pairs, 50 claims), written before any engine run on these inputs.
- v1 evaluated: baseline at engine `1afdff3` (`report/baseline.md`), then dev-only engine fixes (`report/report.md`). No label changed.
- Degree-claim check added to the truth engine because of a **holdout** failure ("Holds a PhD…" leaked). From here on, holdout *truth* numbers are contaminated: holdout blocked recall 86%→100% and leak 5%→0% are no longer independent. Parser, JD and match holdout numbers are unaffected. Gold v2 needs fresh holdout claims.
- Audit round 3 (engine changes, no label change): JD location/`·` header parsing, or-alternatives grouped into one requirement, year ranges and domain years, overqualification cap, physical-design vocabulary. Several were found on holdout JDs (j1, j3, j5, j7), so **holdout JD and match numbers are now contaminated too**. The holdout split is spent; gold v2 needs fresh holdout items.
- Alternatives change two dev outcomes by design: p6 "Python or Perl" no longer flags Perl critical (the guideline has no rule for "A or B" requirements; add one in v2), and p8 drops from 68 to 67 (APPLY → APPLY WITH GAPS) because "CHI or AXI" now counts once instead of twice. The verdict floor in `tests/eval.test.ts` was lowered to 3/4 dev for this reason.
