/**
 * Seeds a demo account with FICTIONAL data (no real person, employer or customer).
 * Usage: npm run db:seed   (DEMO_EMAIL / DEMO_PASSWORD override the defaults)
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { parseResumeHeuristic } from "../src/lib/parsing/resume-parser";
import { parseJobDescriptionHeuristic } from "../src/lib/parsing/jd-parser";
import { analyzeMatch } from "../src/lib/matching/matcher";
import { SettingsSchema } from "../src/lib/types";
import { DEMO_JD_TEXT, DEMO_RESUME_TEXT } from "../src/lib/demo";

const db = new PrismaClient();

async function main() {
  const email = process.env.DEMO_EMAIL ?? "demo@example.com";
  const password = process.env.DEMO_PASSWORD ?? "demo-password-123";
  const user = await db.user.upsert({ where: { email }, update: {}, create: { email, name: "Demo User", passwordHash: await bcrypt.hash(password, 12) } });
  const profile = parseResumeHeuristic(DEMO_RESUME_TEXT);
  await db.careerProfile.upsert({ where: { userId: user.id }, update: { data: profile as object }, create: { userId: user.id, data: profile as object } });

  if (!(await db.application.count({ where: { userId: user.id } }))) {
    const jd = parseJobDescriptionHeuristic(DEMO_JD_TEXT);
    const settings = SettingsSchema.parse({ targetRole: jd.roleTitle, country: "USA", seniority: "Principal", length: "3" });
    const match = analyzeMatch(profile, jd, settings);
    await db.application.create({ data: { userId: user.id, company: jd.company, roleTitle: jd.roleTitle, jdText: DEMO_JD_TEXT, settings: settings as object, parsedJd: jd as object, match: match as object, matchScore: match.overall, recommendation: match.recommendation.verdict } });
  }
  console.log(`Seeded demo user ${email} / ${password}`);
}
main().finally(() => db.$disconnect());
