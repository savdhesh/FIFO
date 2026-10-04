# Semiconductor Career Optimizer

Truth-protected resume tailoring, job-match analysis and cover-letter generation for semiconductor verification engineers (DV, SoC/IP, RISC-V/CPU, formal, functional safety).

**Status: Phases 1–4 and 6 complete, plus ATS check, credibility audit, application strategy, multi-resume merge, projects deck and a gold-set evaluation harness** (auth, resume upload/parse, editable career profile, JD parsing, ontology-based match, requirement matrix, gap analysis, tailored resume with change control, cover letter, truth audit, DOCX/PDF export, application save). Phase 3 adds the LinkedIn optimizer (keyword coverage ✓/△/✗, headline variants ≤220 chars, About, skill order, title-keyword check that never lets you claim an unheld title), recruiter messages (connection request ≤300 chars, post-application, reply to recruiter, hiring-manager; placeholders for names, no invented mutual contacts), and tracker status history/pipeline. Phase 4 adds interview prediction (a curated bank of 123 technical questions, Basic/Intermediate/Staff/Principal, top-20 weighted to the JD and target level, questions drilled from your own bullets, honest-gap questions, likely live exercises, prepared-tracking), analytics (funnel from status history, response/interview rates, median days to response, weekly activity, market demand vs your coverage, gap priorities that separate real gaps from presentation gaps, small-sample warnings), the expanded ontology (175 terms: UVM internals, formal techniques, RISC-V extensions/PMP/memory model, PCIe link/transaction layers, safety metrics, power intent, CDC/metastability, security, AI-assisted verification) and multi-provider AI (mock, OpenAI, Anthropic, Gemini, and Claude-in-artifact).

## Audit
See [AUDIT.md](AUDIT.md): what was tested, the defects found and fixed in each audit round, and a requirement-by-requirement coverage table with what is still partial or unverified.

## Measured accuracy
`npm run eval` scores the engines against a hand-labelled gold set (6 resumes, 8 JDs, 109 requirement labels, 50 truth claims) with a dev/holdout split. First uncontaminated holdout run: parser roles/dates 100%, role employer 50%, JD requirement recall 78%, match-type 88%, overclaim 6%, truth blocked recall 86%, 5% leak. Later fixes were partly motivated by holdout failures (degree claims, PD vocabulary, JD header parsing), so current holdout figures are better but no longer independent. Details: [eval/README.md](eval/README.md).

## ATS check, credibility, strategy, themes, versions
- **ATS check** (`src/lib/ats`): simulates a text-extracting parser on an uploaded or exported resume (reading order, contact/section/date parsing, columns, icons, tables, font size, images, pages) and shows exactly what was extracted with a Low/Medium/High risk.
- **Technical credibility** (`src/lib/credibility`): undemonstrated skills, title vs scope, date errors/overlaps/gaps, wrong stated years, missing metrics, weak bullets, filler wording, technology-era anachronisms.
- **Application strategy** (`src/lib/strategy`): priority, positioning, evidence to lead with, keywords you can support, gaps to handle honestly, do-not-claim list, risks (including work authorization, which it never judges), sequence, interview focus.
- **Themes**: Plain, Classic serif, Accent headings, each labelled with its ATS risk. Page length is enforced by trimming lowest-ranked items, never by rewording.
- **Settings**: score weights and custom vocabulary. **Versions**: one row per generated pack.

## Multi-resume merge and projects deck
- **Resume library:** add resumes as many times as you like, from anywhere (file picker, drag and drop, pasted text); the library persists, duplicates (same text) are skipped, and each file shows its parse quality and ATS risk. Nothing touches your profile until you select **Build profile** (or **Merge N new resumes** later). Each is parsed; `src/lib/merge` compares them against your profile and proposes additions (new bullets, roles, projects, skills, tools, education, certifications, achievements), richer versions of existing bullets, and **conflicts** (title/date/phone/metric differences, e.g. "team of 6" vs "team of 4"). Nothing is applied until you accept it; conflicts never auto-resolve, and "Accept all additions" skips them. It also reports timeline gaps over 3 months and terms that appear only in older resumes. Every added line is verbatim from one of your resumes.
- **Projects & achievements deck:** `src/lib/deck` builds a 16:9 .pptx (title, snapshot, timeline, project slides, achievements, leadership, toolbox, education, closing), optionally ranked for a target job. Text is your own bullets (trimmed at clause boundaries, never reworded), your real metrics and your tools; if you have no measurable results it says so instead of inventing any. Verified structurally (valid OOXML, parses in python-pptx, no off-slide shapes); I could not render it visually in this environment, so check the layout in PowerPoint/Keynote.

## Phase 6
- **Parser accuracy:** 11 fictional layouts in the corpus (right-aligned dates, employer-first, contract/client, promotions, wrapped bullets, European date-column CVs with German/French/Dutch/Swedish headings, plain-text and PDF two-column pages, academic CVs with publications/patents/awards, Indian-style labelled blocks with personal-details/declaration dropped, one-line headers, pipe headers). Two-column PDFs are read column by column from glyph positions. Every parse gets **diagnostics** (share of the text placed, flags, lines it could not place with one-click assignment) and shows High/Medium/Low confidence. With an AI provider on, both parsers run and the better-grounded result wins; AI output is filtered to text that exists in the source. *I could not tune against your real resumes; send anonymised ones (or failures) and the corpus can grow from them.*
- **Answer coach:** practice any interview question; feedback on key-point coverage, specificity, structure, ownership and consistency with your profile. Claims your profile does not support cap the grade and are flagged; "I have not used X" is treated as honest. Attempt history and weakest topics are tracked. With AI on, a critique is added and filtered so it cannot suggest claims you do not have.
- **Server parity:** the self-hosted app now serves the same workspace as the Claude artifact (`public/workspace`, built by `npm run build`) behind its auth middleware. State is one validated document per user in Postgres (`/api/state`), AI goes through an authenticated proxy (`/api/ai/complete`, key stays on the server, base URLs overridable for testing), job URLs are fetched server-side with the SSRF guard, original resumes are kept in private storage, and account/data deletion removes everything.

## Run it inside Claude (no API keys)
`npm run build:artifact` produces `dist/artifact.html`, a single page with the same engines bundled in. Published as a Claude Artifact it uses the artifact `sample` capability for the AI steps (resume parsing, rewrites, cover letter, LinkedIn About, message polish) on the viewer's own Claude usage, and falls back to the offline engine when Claude is unavailable. Data stays in the browser (local storage, with JSON backup/restore); files are saved through the `downloads` capability. Job URLs can't be fetched there (paste the text). The self-hosted app serves the **same workspace** (see Phase 6 above), so both run identical code.

## How it works

```
resume (PDF/DOCX/TXT) ─► parser ─► structured CareerProfile (editable, Zod-validated, single source of truth)
job description / URL ─► JD parser ─► requirements (mandatory | preferred | implied | boilerplate | administrative)
                              │
                ontology (src/lib/ontology/vocabulary.json, 175 terms w/ aliases + relations)
                              ▼
 match engine ─► exact | equivalent | related | weak | missing  per requirement, with evidence + confidence
              ─► weighted score (configurable weights), seniority detection, gap analysis, recommendation
                              ▼
 tailoring ─► change proposals (original / proposed / reason / evidence / claim status) ─► you Accept / Reject / Edit
                              ▼
 truth engine re-audits the FINAL text ─► VERIFIED | SUPPORTED | INFERRED | UNSUPPORTED ─► export (blocked if UNSUPPORTED)
```

### Truth protection (the core rule)
- AI/heuristics **propose**; `src/lib/truth` **disposes**. Every claim is checked against the profile: unknown tools/protocols, metrics (`40%`, `team of 25`, `3 tapeouts`), certifications/patents, employers and leadership wording are flagged `POTENTIAL HALLUCINATION`.
- *Related ≠ direct.* Questa Formal makes **formal verification** a direct match but **JasperGold** a tool gap (`related`, "Do not claim"). Covered by `tests/acceptance.test.ts`.
- `INFERRED` changes (e.g. adding "verification planning" because you did coverage closure) need explicit per-item approval; `UNSUPPORTED` can never be accepted, and "Accept all safe" only accepts `VERIFIED/SUPPORTED`.
- Exports re-audit the final text before download and are blocked if anything unsupported remains.
- Pending/rejected changes fall back to the original wording. Only page-fit trimming/reordering of your existing bullets is automatic.

### Scores
Weighted blend: mandatory technical 30 · core domain 20 · seniority 15 · architecture 10 · leadership 10 · preferred 5 · tools 5 · education/other 5 (`DEFAULT_WEIGHTS` in `src/lib/matching/matcher.ts`; categories with no JD requirements are dropped and weights renormalised). Every score has a "why" list (click it in the UI). "ATS keyword coverage" counts exact wording 1.0 and equivalent wording 0.5.

## Quick start

Requirements: Node 20+, PostgreSQL 14+.

```bash
cd semiconductor-career-optimizer
npm install
cp .env.example .env            # set DATABASE_URL and AUTH_SECRET (openssl rand -base64 32)
createdb sco                    # or create the DB/user from DATABASE_URL
npx prisma migrate deploy       # applies prisma/migrations
npm run db:seed                 # optional: demo@example.com / demo-password-123 (fictional data)
npm run dev                     # http://localhost:3000
```

Without any API keys it runs with `AI_PROVIDER=mock`: deterministic, offline, nothing leaves the server. The analysis, matching, truth audit and cover letter are all real logic, not canned output.

### Tests
```bash
# unit + audit tests (browser end-to-end checks are in e2e/)
npm test      # 264 tests: ontology integrity, scoring, truth validation, parsers + layout corpus, merge, deck, ATS, credibility, cross-product truth audit, exports
npm run lint  # tsc --noEmit
```

## Configuration (`.env.example`)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection |
| `AUTH_SECRET` | 32+ chars; signs the session JWT (httpOnly cookie, 7 days) |
| `AI_PROVIDER` | `mock` (default) \| `openai` \| `anthropic` \| `gemini`; `AI_MODEL` optional override; matching `*_API_KEY` |
| `STORAGE_DRIVER` | `local` (default, `STORAGE_DIR`) \| `s3` (`S3_*`; run `npm i @aws-sdk/client-s3`) |
| `MAX_UPLOAD_MB` | upload limit (default 5) |
| `OPENAI_BASE_URL` · `ANTHROPIC_BASE_URL` · `GEMINI_BASE_URL` | optional vendor endpoint overrides (proxies, testing against a stub) |

### AI providers
`src/lib/ai/provider.ts` defines `AIProvider` (`analyzeResume`, `analyzeJob`, `compareResumeToJob`, `rewriteResume`, `generateCoverLetter`, `auditClaims`, plus `optimizeLinkedIn`, `generateRecruiterMessage`, `generateInterviewPrep`, `coachAnswer`). `MockProvider` is the offline reference; `LLMProvider` wraps any vendor transport, uses a separate prompt per task (`prompts.ts`), validates replies with Zod and retries invalid JSON. Safeguards: LLM-parsed resumes are *grounded* against the source text (invented bullets/tools dropped); scoring stays deterministic; LLM claim audits can only make a verdict stricter; LLM cover letters go through the same sentence-level sanitizer.

> The OpenAI / Anthropic / Gemini transports are implemented from their public API shapes but **have not been run against live endpoints** (no keys were available when this was built). Expect to verify model names and response shapes with your own key. With a non-mock provider, resume/JD text is sent to that vendor; Settings shows this.

## Privacy & security
- Auth: bcrypt (cost 12) + signed httpOnly session cookie; middleware + per-route auth; every query is scoped to the user (cross-user access returns 404).
- Resume files stored under random keys outside any public directory; downloads only through authenticated API. No public URLs.
- Logging is whitelist-only metadata (`src/lib/server/log.ts`); resume/JD content is never logged, and 500 errors don't echo messages.
- Uploads: PDF/DOCX/TXT only, extension **and** magic-byte check, size cap, sanitised filenames.
- Job-URL fetch: SSRF guard (blocks private/loopback/link-local, re-checked per redirect, size/time limits).
- Rate limits on login/register, upload, the AI proxy, job fetch, state saves and account deletion (in-memory; use Redis/Upstash behind multiple instances).
- Settings → delete all data / delete account (password-confirmed; removes files, DB rows by cascade). Resume content is not used for training.

## Data model (`prisma/schema.prisma`)
`User` · `UserState` (one Zod-validated JSON workspace per user: profile, applications, resume library, preferences) · `ResumeFile` (metadata + storage key + extracted text). The workspace is one JSON document because the same state shape runs in the Claude artifact (browser storage) and the server app; the older `CareerProfile`/`Application` tables were dropped in migration `20261003190000_drop_legacy_and_defaults`.

## Known limitations
- Resume/JD parsing is heuristic (regex + ontology) unless an LLM provider is enabled; tables and unusual layouts can still mis-split roles (two-column PDFs are read column by column) — that is why the profile editor exists. Scanned/image PDFs are rejected (no OCR).
- Ontology covers 175 terms (verification-focused; a small physical-design set exists so PD jobs are recognised as a mismatch); extend `src/lib/ontology/vocabulary.json` (aliases, `related`, `parent`, `family`, `weak`).
- No automatic bullet rewriting in mock mode (weak bullets are flagged; rewrites need an LLM provider or your own edit). Keyword insertions are proposed only as `INFERRED` changes.
- Country settings change spelling, date format, salutation/closing and default length only; no immigration advice.
- Job URL fetching can't read pages behind login/JS rendering — paste the text instead.
- Not load-tested; rate limiter is per-process.

## Layout
```
src/lib/ontology   vocabulary.json + matcher        src/lib/matching  scoring, gaps, seniority, bullet quality
src/lib/parsing    resume/JD parsers, text extract  src/lib/truth     claim classification + sanitizer
src/lib/tailoring  resume + cover letter engines    src/lib/export    DOCX, themes, names (app PDFs: jsPDF in artifact/exporters.ts)
src/lib/ai         provider abstraction             src/lib/server    db, session, storage, security, api wrapper
src/lib/outreach   LinkedIn + recruiter messages    src/lib/interview interview bank + planner
src/lib/coach      answer coach                     src/lib/{ats,credibility,strategy,merge,deck,analytics}
artifact/          workspace UI (one React app)     src/app           auth + API routes
eval/              gold set + harness               tests/  vitest suites    e2e/  browser checks
```
