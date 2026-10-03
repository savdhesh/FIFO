# Semiconductor Career Optimizer

Truth-protected resume tailoring, job-match analysis and cover-letter generation for semiconductor verification engineers (DV, SoC/IP, RISC-V/CPU, formal, functional safety).

**Status: Phases 1–3 complete** (auth, resume upload/parse, editable career profile, JD parsing, ontology-based match, requirement matrix, gap analysis, tailored resume with change control, cover letter, truth audit, DOCX/PDF export, application save). Phase 3 adds the LinkedIn optimizer (keyword coverage ✓/△/✗, headline variants ≤220 chars, About, skill order, title-keyword check that never lets you claim an unheld title), recruiter messages (connection request ≤300 chars, post-application, reply to recruiter, hiring-manager; placeholders for names, no invented mutual contacts), and tracker status history/pipeline. Interview prediction and advanced analytics (Phase 4) are not built.

## Run it inside Claude (no API keys)
`npm run build:artifact` produces `dist/artifact.html`, a single page with the same engines bundled in. Published as a Claude Artifact it uses the artifact `sample` capability for the AI steps (resume parsing, rewrites, cover letter, LinkedIn About, message polish) on the viewer's own Claude usage, and falls back to the offline engine when Claude is unavailable. Data stays in the browser (local storage, with JSON backup/restore); files are saved through the `downloads` capability. Job URLs can't be fetched there (paste the text). The Next.js server app is the self-hosted alternative; its Phase 3 engines are exposed at `POST /api/applications/:id/outreach` (no UI tabs yet).

## How it works

```
resume (PDF/DOCX/TXT) ─► parser ─► structured CareerProfile (editable, Zod-validated, single source of truth)
job description / URL ─► JD parser ─► requirements (mandatory | preferred | implied | boilerplate | administrative)
                              │
                ontology (src/lib/ontology/vocabulary.json, 115 terms w/ aliases + relations)
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
- Exports re-audit the final text server-side and return **409** if anything unsupported remains.
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
npm test      # 49 tests: ontology, scoring, seniority, truth validation, parsers, security, export round-trips
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

### AI providers
`src/lib/ai/provider.ts` defines `AIProvider` (`analyzeResume`, `analyzeJob`, `compareResumeToJob`, `rewriteResume`, `generateCoverLetter`, `auditClaims`, plus Phase-3 `optimizeLinkedIn`, `generateRecruiterMessage`). `MockProvider` is the offline reference; `LLMProvider` wraps any vendor transport, uses a separate prompt per task (`prompts.ts`), validates replies with Zod and retries invalid JSON. Safeguards: LLM-parsed resumes are *grounded* against the source text (invented bullets/tools dropped); scoring stays deterministic; LLM claim audits can only make a verdict stricter; LLM cover letters go through the same sentence-level sanitizer.

> The OpenAI / Anthropic / Gemini transports are implemented from their public API shapes but **have not been run against live endpoints** (no keys were available when this was built). Expect to verify model names and response shapes with your own key. With a non-mock provider, resume/JD text is sent to that vendor; Settings shows this.

## Privacy & security
- Auth: bcrypt (cost 12) + signed httpOnly session cookie; middleware + per-route auth; every query is scoped to the user (cross-user access returns 404).
- Resume files stored under random keys outside any public directory; downloads only through authenticated API. No public URLs.
- Logging is whitelist-only metadata (`src/lib/server/log.ts`); resume/JD content is never logged, and 500 errors don't echo messages.
- Uploads: PDF/DOCX/TXT only, extension **and** magic-byte check, size cap, sanitised filenames.
- Job-URL fetch: SSRF guard (blocks private/loopback/link-local, re-checked per redirect, size/time limits).
- Rate limits on auth, upload, analyze, generate, export, delete (in-memory; use Redis/Upstash behind multiple instances).
- Settings → delete all data / delete account (password-confirmed; removes files, DB rows by cascade). Resume content is not used for training.

## Data model (`prisma/schema.prisma`)
`User` · `CareerProfile` (Zod-validated JSON document: identity, roles, education, skills by category) · `ResumeFile` (metadata + storage key + extracted text) · `Application` (JD, parsed JD, match, tailored resume, change proposals + decisions, cover letter, truth audit, tracking fields, status enum with the 12 statuses). The profile is JSON rather than normalised tables because it is always read/written as one validated document.

## Known limitations
- Resume/JD parsing is heuristic (regex + ontology) unless an LLM provider is enabled; unusual layouts (multi-column PDFs, tables) can mis-split roles — that is why the profile editor exists. Scanned/image PDFs are rejected (no OCR).
- Ontology covers ~115 terms; extend `src/lib/ontology/vocabulary.json` (aliases, `related`, `parent`, `family`, `weak`).
- No automatic bullet rewriting in mock mode (weak bullets are flagged; rewrites need an LLM provider or your own edit). Keyword insertions are proposed only as `INFERRED` changes.
- ATS parse preview (spec §20), LinkedIn, recruiter messages, interview prediction, analytics beyond the basic dashboard: not built.
- Country settings change spelling, date format, salutation/closing and default length only; no immigration advice.
- Job URL fetching can't read pages behind login/JS rendering — paste the text instead.
- Not load-tested; rate limiter is per-process.

## Layout
```
src/lib/ontology   vocabulary.json + matcher        src/lib/matching  scoring, gaps, seniority, bullet quality
src/lib/parsing    resume/JD parsers, text extract  src/lib/truth     claim classification + sanitizer
src/lib/tailoring  resume + cover letter engines    src/lib/export    PDF (pdfkit) + DOCX (docx), ATS-safe
src/lib/ai         provider abstraction             src/lib/server    db, session, storage, security, api wrapper
src/app            pages + API routes               tests/            vitest suites
```
