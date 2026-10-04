export const safePart = (s: string) => (s || "Unknown").normalize("NFKD").replace(/[^\w]+/g, "").slice(0, 40) || "Unknown";
export const packName = (candidate: string, company: string, doc: "Resume" | "CoverLetter" | "MatchReport", ext: string) =>
  `${safePart(candidate)}_${safePart(company)}_${doc}.${ext}`;
