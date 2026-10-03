# Audit: accuracy, completeness, consistency

Scope: the Claude artifact (`artifact/`, built to `dist/artifact.html`) and the shared engines in `src/lib`. Date of audit: build 5 of the artifact.

## How it was audited
1. **Cross-product truth audit** (`tests/audit.test.ts`): 6 resumes × 5 job descriptions (generic DV, formal manager, functional safety, AI+DV, junior). For every pair, every candidate-facing text the system can generate (tailored resume with *everything* accepted, cover letter, LinkedIn headlines/About, outreach messages, deck slides, interview evidence) is checked for ontology terms, metrics, credentials and leadership claims the profile does not support. 30 pairs.
2. **Vocabulary integrity** (`tests/ontology-integrity.test.ts`): unique canonicals, no alias claimed by two entries, all relations resolve, acyclic parents, every alias resolves to its own entry, interview-bank topics exist.
3. **Browser audit** (headless Chromium): full flow with 3 uploaded resumes (TXT, TXT, PDF), every tab and every top-level view at 1280 px and 400 px (horizontal overflow), unlabeled form controls, dark mode, localStorage blocked, ATS check on the exported PDF, vocabulary add/clash.
4. **Spec walk-through**: each numbered requirement of the original brief checked against code.

## Defects found and fixed
| # | Finding | Fix |
|---|---|---|
| 1 | Ontology expansion made "regression triage" resolve to a new term that did not imply Debugging, so a legitimate keyword proposal was classified UNSUPPORTED. | Added `parent: Debugging`. |
| 2 | Truth engine treated "related only" evidence for *practice* terms (planning, debugging, coverage…) as UNSUPPORTED while the matcher called it a presentation gap. Inconsistent. | `related` + practice term is now INFERRED (needs approval) in both. |
| 3 | 12 alias collisions between entries (e.g. "subsystem verification", "UPF", "SPFM") meant the longer/older entry silently shadowed the intended one; "subsystem verification" produced a false UNSUPPORTED. | Aliases deduplicated; integrity test added so it cannot regress. |
| 4 | Headlines and summaries could say "Design Verification" / "Verification Architecture" for candidates whose profile did not evidence those terms (architecture flag came from a loose regex on "strategy"/"defined"). | Phrases now require the ontology term in the profile; parser's architecture-ownership regex tightened; fallback domain is "verification". |
| 5 | Resume structure in the brief lists "Major technical projects"; the generated resume had none, and profile projects were not parsed. | Projects/achievements parsed, edited, merged, included (3+ pages), exported, truth-audited. |
| 6 | Page length options were cosmetic: a "1 page" resume could export as 2+. | `fitResume` trims lowest-ranked items (never rewords) until the PDF fits; the UI shows pages and what was left out. |
| 7 | ATS parser (brief §20) was not built. | ATS check: extraction-order text, contact/section/date parsing, column/font/image/page checks, Low/Medium/High risk; shown per uploaded resume and on the exported PDF. |
| 8 | "Application strategy" (workflow step 9) and "technical credibility issues" (step 8) were not built. | Strategy tab; credibility audit (undemonstrated skills, title vs scope, date errors/overlaps/gaps, wrong years, missing metrics, weak bullets, buzzwords, technology-era anachronisms). |
| 9 | No design themes with ATS risk labels (§21). | Three single-column themes, each labelled. |
| 10 | Score weights were configurable only in code (§7); vocabulary only by editing JSON (§30). | Settings sliders; custom vocabulary (cannot override built-ins; clash detection). |
| 11 | No "Resume Versions"; application record lacked a resume version (§22). | Versions view; pack version/date recorded. |
| 12 | LinkedIn "Featured section" (§14) missing. | Featured suggestions from projects, publications, certifications, GitHub. |
| 13 | Five textareas had no accessible name. | `aria-label`s added. |
| 14 | Two LLM prompts (match analysis, seniority audit) were defined but never used, implying behaviour that does not exist. | Removed. Scoring is deterministic by design. |
| 15 | Report PDF omitted strategy / credibility / ATS. | Added. |

## Spec coverage (brief sections)
Legend: ✅ done · 🟡 partial · ⛔ not built

| § | Requirement | Status | Note |
|---|---|---|---|
| 1 | Core workflow (1–12) | ✅ | Job **URL fetch** works in the server app only; the artifact cannot fetch pages (paste text). |
| 2 | Stack | 🟡 | Next/React/TS/Tailwind/Prisma/Postgres ✅. shadcn-*style* hand-written components, not the shadcn CLI. Auth is a custom signed-cookie session ("or equivalent"). S3 storage written but untested. |
| 2 | AI provider abstraction | ✅ | Mock, OpenAI, Anthropic, Gemini, Claude-in-artifact. **OpenAI/Anthropic/Gemini never run against live endpoints.** |
| 3 | Privacy | ✅ | Server: private storage, deletion, no content logging. Artifact: data stays in the browser. |
| 4 | Master profile | ✅ | Parser is heuristic; unusual layouts need manual correction. |
| 5 | Ontology | ✅ | 165 terms; exact/equivalent/related/weak/missing. |
| 6–8 | JD parser, match engine, requirement matrix | ✅ | |
| 9, 29 | Truth protection, hallucination controls | ✅ | Audited across 30 resume×job pairs. |
| 10 | Seniority | ✅ | |
| 11 | Resume optimisation | ✅ | Lengths 1–4/CV now enforced. |
| 12 | Bullet rewriting | 🟡 | Bullets are classified; automatic rewrites need an LLM or your own edit (deterministic mode adds only keyword proposals). |
| 13 | Cover letter | 🟡 | 13 countries adjust spelling, salutation/closing and date format; no deeper regional conventions. |
| 14–15 | LinkedIn, headlines | ✅ | |
| 16 | Recruiter messages | ✅ | |
| 17–18 | Decision, gap analysis | ✅ | |
| 19 | Interview prediction | ✅ | Curated bank of ~110 questions; a preparation aid, not a prediction. |
| 20 | ATS parser | ✅ | Simulates text extraction. It is not a real vendor ATS; image detection is best-effort. |
| 21 | Export | ✅ | The server app's PDF only applies theme heading colour (no serif). |
| 22 | Application pack + record | ✅ | |
| 23 | Tracker + dashboard + analytics | ✅ | |
| 24 | UI | 🟡 | Top navigation instead of a sidebar. Cover letters, LinkedIn and Interview Prep live inside each application rather than as separate pages. |
| 25–27 | Score visualisation, explainability, change control | ✅ | |
| 28 | Separate prompts | 🟡 | Prompts exist for resume parse, JD parse, rewrite, cover letter, truth audit, LinkedIn, recruiter message, interview. No separate "skill ontology", "match analysis" or "seniority audit" prompts: those are deterministic on purpose. |
| 30 | Editable knowledge base | 🟡 | Built-ins are a JSON file in the repo; custom terms are editable in the UI. |
| 31 | Countries | ✅ | |
| 32 | Demo data | ✅ | Fictional. |
| 33 | Security | ✅ | Server app. |
| 35 | Acceptance scenario | ✅ | `tests/acceptance.test.ts`. |
| 37 | Tests, README, schema, migrations, seed | ✅ | 156 tests. |

## Known limits that remain
- **Separate GitHub repo**: the GitHub integration returned 403 on repo creation; the project is a self-contained folder in `savdhesh/FIFO`.
- **Not verifiable here**: Claude `sample` (the "Use Claude" toggle) and `downloads` (saving files) only run in the real claude.ai viewer; the .pptx was validated structurally but not rendered visually.
- **Server app vs artifact**: the Next.js app has the Phase 3–4 engines and a route for them but not the later UI (merge review, deck, ATS panel, strategy, analytics, versions, settings).
- **Heuristic parsing** remains the main accuracy risk for real-world resumes.
- **Single-sample statistics**: analytics warns below 5 applications.
