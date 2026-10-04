# Gold-set changelog
Every change to a label after its first commit is recorded here with the reason. Labels are never changed to match engine output.

- v1: initial labels (6 resumes, 8 job descriptions, 8 resume×job pairs, 50 claims), written before any engine run on these inputs.
- v1 evaluated: baseline at engine `1afdff3` (`report/baseline.md`), then dev-only engine fixes (`report/report.md`). No label changed.
- Degree-claim check added to the truth engine because of a **holdout** failure ("Holds a PhD…" leaked). From here on, holdout *truth* numbers are contaminated: holdout blocked recall 86%→100% and leak 5%→0% are no longer independent. Parser, JD and match holdout numbers are unaffected. Gold v2 needs fresh holdout claims.
