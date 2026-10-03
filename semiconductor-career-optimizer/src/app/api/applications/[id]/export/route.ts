import { z } from "zod";
import { route, HttpError } from "@/lib/server/api";
import { finalDocuments, loadProfile, ownApplication, view } from "@/lib/server/service";
import { resumePdf, coverLetterPdf, reportPdf } from "@/lib/export/pdf";
import { resumeDocx, coverLetterDocx } from "@/lib/export/docx";
import { packName } from "@/lib/export/names";
import { auditProse, summarizeChecks } from "@/lib/truth/truth";
import { buildIndex } from "@/lib/profile-index";

const Q = z.object({ doc: z.enum(["resume", "cover", "report"]), format: z.enum(["pdf", "docx"]).default("pdf") });
const MIME = { pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" } as const;

export const GET = route(async (req, { user, params }) => {
  const q = Q.parse(Object.fromEntries(new URL(req.url).searchParams));
  const app = await ownApplication(user.id, params.id);
  const profile = await loadProfile(user.id);
  const v = view(app);
  const name = profile.identity.name || "Candidate";
  let buf: Buffer, file: string;
  if (q.doc === "resume") {
    const { resume, audit } = finalDocuments(app, profile);
    // Hard gate: nothing unsupported leaves the system.
    if (!audit.passed) throw new HttpError(409, "POTENTIAL HALLUCINATION: the resume contains unsupported claims. Edit or reject them first.", { claims: audit.hallucinations.map((c) => ({ text: c.text, reasons: c.reasons })) });
    buf = q.format === "pdf" ? await resumePdf(resume, v.settings.length) : await resumeDocx(resume);
    file = packName(name, app.company, "Resume", q.format);
  } else if (q.doc === "cover") {
    if (!v.letter) throw new HttpError(409, "Generate the application pack first.");
    const audit = summarizeChecks(auditProse(v.letter.paragraphs.join("\n"), { index: buildIndex(profile), allowedNames: [v.jd.company, v.jd.roleTitle] }));
    if (!audit.passed) throw new HttpError(409, "POTENTIAL HALLUCINATION: the cover letter contains unsupported claims.", { claims: audit.hallucinations.map((c) => ({ text: c.text, reasons: c.reasons })) });
    buf = q.format === "pdf" ? await coverLetterPdf(v.letter, name, profile.identity) : await coverLetterDocx(v.letter, profile.identity);
    file = packName(name, app.company, "CoverLetter", q.format);
  } else {
    buf = await reportPdf({ candidate: name, company: app.company, role: app.roleTitle, jd: v.jd, match: v.match, audit: v.tailored ? finalDocuments(app, profile).audit : null });
    file = packName(name, app.company, "MatchReport", "pdf");
  }
  return new Response(new Uint8Array(buf), { headers: { "content-type": q.doc === "report" ? MIME.pdf : MIME[q.format], "content-disposition": `attachment; filename="${file}"`, "cache-control": "private, no-store" } });
}, { limit: { max: 60, windowMs: 3600_000, name: "export" } });
