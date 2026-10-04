# Audit: accuracy, completeness, consistency

Scope: the Claude artifact (`artifact/`, built to `dist/artifact.html`) and the shared engines in `src/lib`. Date of audit: build 5 of the artifact.

## How it was audited
1. **Cross-product truth audit** (`tests/audit.test.ts`): 6 resumes × 5 job descriptions (generic DV, formal manager, functional safety, AI+DV, junior). For every pair, every candidate-facing text the system can generate (tailored resume with *everything* accepted, cover letter, LinkedIn headlines/About, outreach messages, deck slides, interview evidence) is checked for ontology terms, metrics, credentials and leadership claims the profile does not support. 30 pairs.
2. **Vocabulary integrity** (`tests/ontology-integrity.test.ts`): unique canonicals, no alias claimed by two entries, all relations resolve, acyclic parents, every alias resolves to its own entry, interview-bank topics exist.
3. **Browser audit** (headless Chromium): full flow with 3 uploaded resumes (TXT, TXT, PDF), every tab and every top-level view at 1280 px and 400 px (horizontal overflow), unlabeled form controls, dark mode, localStorage blocked, ATS check on the exported PDF, vocabulary add/clash.
4. **Spec walk-through**: each numbered requirement of the original brief checked against code.

5. **Gold-set evaluation** (`eval/`, `npm run eval`, floors in `tests/eval.test.ts`): accuracy measured on unseen inputs with a holdout split. Baseline, fixes and open failures are in [eval/README.md](eval/README.md). The fixes are not repeated in the table below.

## Defects found and fixed
Rows 19–34 are from the third audit (generated-output review of every engine on the demo profile against 9 job descriptions, plus a docs-vs-code check).

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
| 16 | **Latent bug found while building server parity:** the page stored the `sample` (ask-Claude) function with `setSample(fn)`; React treats a function argument as an updater and *called it with the previous state*. In a real Claude viewer this would have replaced `sample` with a rejected promise, so the "Use Claude" toggle looked enabled but could not work. Local tests had never exercised a function-valued `sample`. | `setSample(() => fn)`; `e2e/claude-mode.mjs` simulates a function-valued `sample` and `downloads`. |
| 17 | Skills parsing accepted any sentence containing an ontology term as a skill ("Mentored students at a robotics club…" became a skill). | Skill items must be terms, not sentences. |
| 18 | `claude`-only persistence: the server app lacked everything after Phase 2 in its UI. | Server serves the same workspace; old duplicate server UI and routes removed so the two cannot drift. |
| 19 | `artifact/head.html` never closed its `<style>` tag. The artifact rendered by accident; the server workspace CSS (`public/workspace/app.css`) shipped with **no colour tokens**, so server mode was unstyled. | Tag closed; build verified to emit the tokens. |
| 20 | JD location was read only from a `Location:` label: empty for every gold JD, so location scoring and risks never ran. | Location taken from the company line (`Company — City`, `· City`, `\| City`, `(Remote)`). |
| 21 | `Company · City` headers leaked the city into the company name, and from there into cover letters and messages. | `·` added to the header split. |
| 22 | "Xcelium or VCS", "APB, AHB or AXI" became separate mandatory requirements, so a candidate with Xcelium got a VCS gap. | Same-type terms joined by or-separators form one requirement any member satisfies. |
| 23 | "2-4 years" lost its upper bound; a 13-year principal scored STRONG APPLY for a junior role. "12+ years of CPU verification" was checked against total career years. | Ranges kept; heavy overqualification caps the verdict at APPLY with a reason; domain years count only roles showing that domain. |
| 24 | A skills-section-only term was called "not evidenced" in gaps, "listed in skills" in the matrix, "hands-on" in the summary, and asked as "Have you worked with…?" | One consistent message; skills-only terms stay out of "Hands-on experience"; interview asks for a concrete example. |
| 25 | Cover letter: "I also…" on every later sentence; "Role at X is a logical next step" without an article and wrong for down-level roles; a sentence after the call to action; hard-coded UK "centres". | Fixed wording and order; spelling-neutral. |
| 26 | Cover letter and outreach said the posting matched "my current work" using skills from any past role. | Uses the most recent role only. |
| 27 | "Latest role" was picked by comparing date strings alphabetically. | Compared as dates (`latestRole`). |
| 28 | LinkedIn About ended "Open to … roles in USA" (the default country setting) for a candidate in India; the same bullet appeared as both a lead and a weak bullet. | Uses the profile location; weak bullets excluded from leads. |
| 29 | Deck: specialization repeated ("M.Tech in VLSI Design, VLSI Design"); "– listed projects" stat when there are none. | Fixed. |
| 30 | Credibility flagged "Ethernet" as undemonstrated although a bullet showed "Ethernet MAC". | Child terms count as evidence for the parent. |
| 31 | Answer coach capped a correct technical answer because explaining the topic ("lower privilege modes must trap") read as an unsupported claim; feedback showed only the first reason and doubled punctuation. "$2M" was not checked. | Terms from the question's own key points are not claims; all reasons shown; money is a checked metric. |
| 32 | Physical-design jobs: no PD vocabulary, so the engine saw almost no requirements and said "no critical requirement missing" (LOW PRIORITY). | Small PD vocabulary added; the PD control job now scores DO NOT APPLY with its PD gaps listed. |
| 33 | Gap interview questions read "Have you worked with People Management?" | Tools keep that form; concepts get "How much X experience do you have…". |
| 34 | Docs: 15+ stale statements (term/test/question counts, dropped data model, a 409 export route that no longer exists, rate-limit list, "not built" features that exist, pdfkit as the app PDF engine). | README/AUDIT corrected. |

## Spec coverage (brief sections)
Legend: ✅ done · 🟡 partial · ⛔ not built

| § | Requirement | Status | Note |
|---|---|---|---|
| 1 | Core workflow (1–12) | ✅ | Job **URL fetch** works in the server app only; the artifact cannot fetch pages (paste text). |
| 2 | Stack | 🟡 | Next/React/TS/Tailwind/Prisma/Postgres ✅. shadcn-*style* hand-written components, not the shadcn CLI. Auth is a custom signed-cookie session ("or equivalent"). S3 storage written but untested. |
| 2 | AI provider abstraction | ✅ | Mock, OpenAI, Anthropic, Gemini, Claude-in-artifact. OpenAI-compatible path tested against a local stub; **no vendor has been run live.** |
| 3 | Privacy | ✅ | Server: private storage, deletion, no content logging. Artifact: data stays in the browser. |
| 4 | Master profile | ✅ | Parser is heuristic; unusual layouts need manual correction. |
| 5 | Ontology | ✅ | 175 terms; exact/equivalent/related/weak/missing. |
| 6–8 | JD parser, match engine, requirement matrix | ✅ | |
| 9, 29 | Truth protection, hallucination controls | ✅ | Audited across 30 resume×job pairs. |
| 10 | Seniority | ✅ | |
| 11 | Resume optimisation | ✅ | Lengths 1–4/CV now enforced. |
| 12 | Bullet rewriting | 🟡 | Bullets are classified; automatic rewrites need an LLM or your own edit (deterministic mode adds only keyword proposals). |
| 13 | Cover letter | 🟡 | 13 countries adjust spelling, salutation/closing and date format; no deeper regional conventions. |
| 14–15 | LinkedIn, headlines | ✅ | |
| 16 | Recruiter messages | ✅ | |
| 17–18 | Decision, gap analysis | ✅ | |
| 19 | Interview prediction | ✅ | Curated bank of 123 questions; a preparation aid, not a prediction. |
| 20 | ATS parser | ✅ | Simulates text extraction. It is not a real vendor ATS; image detection is best-effort. |
| 21 | Export | ✅ | |
| 22 | Application pack + record | ✅ | |
| 23 | Tracker + dashboard + analytics | ✅ | |
| 24 | UI | 🟡 | Top navigation instead of a sidebar. Cover letters, LinkedIn and Interview Prep live inside each application rather than as separate pages. |
| 25–27 | Score visualisation, explainability, change control | ✅ | |
| 28 | Separate prompts | 🟡 | Prompts exist for resume parse, JD parse, rewrite, cover letter, truth audit, LinkedIn, recruiter message, interview, answer coach. No separate "skill ontology", "match analysis" or "seniority audit" prompts: those are deterministic on purpose. |
| 30 | Editable knowledge base | 🟡 | Built-ins are a JSON file in the repo; custom terms are editable in the UI. |
| 31 | Countries | ✅ | |
| 32 | Demo data | ✅ | Fictional. |
| 33 | Security | ✅ | Server app. |
| 35 | Acceptance scenario | ✅ | `tests/acceptance.test.ts`. |
| 37 | Tests, README, schema, migrations, seed | ✅ | 234 unit tests + browser e2e scripts. |

## Known limits that remain
- **Separate GitHub repo**: the GitHub integration returned 403 on repo creation; the project is a self-contained folder in `savdhesh/FIFO`.
- **Not verifiable here**: Claude `sample` (the "Use Claude" toggle) and `downloads` (saving files) only run in the real claude.ai viewer; the .pptx was validated structurally but not rendered visually.
- **Server app vs artifact**: now the same workspace (Phase 6). The OpenAI/Anthropic/Gemini transports were exercised against a local stub (request shape, key handling, JSON mode) but never against the real vendors.
- **Heuristic parsing** remains the main accuracy risk for real-world resumes.
- **Single-sample statistics**: analytics warns below 5 applications.
