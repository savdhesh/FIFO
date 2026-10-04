import { chromium } from "playwright-core"; import fs from "fs";
const exe = fs.readdirSync("/opt/pw-browsers").filter(d=>d.startsWith("chromium-"))[0];
const URL = `file://${process.cwd()}/dist/artifact.html`;
const b = await chromium.launch({ executablePath: `${process.env.CHROMIUM ?? `/opt/pw-browsers/${exe}/chrome-linux/chrome`}`, args:["--no-sandbox"] });
const problems = [];
const mk = async (opts = {}) => { const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: opts.dark ? "dark" : "light" }); const page = await ctx.newPage();
  page.on("pageerror", e => problems.push("PAGEERR " + e.message)); page.on("console", m => { if (m.type()==="error" && !/ERR_CERT|Failed to load resource/.test(m.text())) problems.push("CONSOLE " + m.text()); }); return page; };

// 1. storage blocked
{ const page = await mk(); await page.addInitScript(() => { const bad = () => { throw new Error("blocked"); }; Storage.prototype.setItem = bad; Storage.prototype.getItem = bad; Storage.prototype.removeItem = bad; });
  await page.goto(URL); await page.click("button:has-text('Load demo profile')"); await page.waitForSelector("text=Career profile"); console.log("storage-blocked: demo loads OK"); await page.context().close(); }

// 2. full flow + every tab, desktop and mobile
const page = await mk(); await page.goto(URL);
await page.setInputFiles("#resume-file", ["tests/fixtures/demo-resume.txt", "tests/fixtures/demo-resume.txt", "tests/fixtures/demo-resume.txt"]);
await page.waitForSelector("#merge-review", { timeout: 30000 });
console.log("library ATS badges:", await page.locator("text=/ATS (Low|Medium|High)/").allTextContents());
await page.click("button:has-text('Accept all additions')");
if (await page.locator("button:has-text('Apply'):not([disabled])").count()) await page.click("button:has-text('Apply')"); else await page.click("#merge-review >> button:has-text('Close')");
await page.click("button:has-text('Analyze a job')"); await page.click("text=Use sample JD"); await page.click("button:has-text('Analyze match')"); await page.waitForSelector("text=Recommendation");
const unlabeled = async (where) => { const n = await page.evaluate(() => [...document.querySelectorAll("input,select,textarea")].filter(e => e.type!=="hidden" && e.type!=="file" && !e.labels?.length && !e.getAttribute("aria-label") && !e.closest("label")).map(e => e.id || e.placeholder || e.tagName)); if (n.length) problems.push(`UNLABELED(${where}): ${n.join(",")}`); };
const overflow = async (where) => { const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); if (o > 1) problems.push(`H-OVERFLOW ${o}px (${where})`); };
await page.click("[role=tab]:has-text('Resume Changes')"); await page.click("button:has-text('Generate application pack')"); await page.waitForSelector("text=Accept all safe changes");
await page.click("button:has-text('Accept all safe changes')");
await page.selectOption("#theme", "accent");
await page.click("button:has-text('Run ATS check on this PDF')"); await page.waitForSelector("text=ATS parse risk", { timeout: 20000 });
console.log("ATS panel:", await page.evaluate(() => (document.body.innerText.match(/ATS parse risk[^\n]*\n?[^\n]*/) ?? ["?"])[0].replace(/\s+/g, " ")));
const fitText = await page.locator("text=/Fits \\d+ page/").first().textContent(); console.log("fit:", fitText);
const tabs = ["Overview","Strategy","Requirements","Skill Match","Resume Changes","Cover Letter","LinkedIn","Recruiter Messages","Interview Prep","Truth Audit","Tracking"];
for (const w of [1280, 400]) {
  await page.setViewportSize({ width: w, height: 900 });
  for (const t of tabs) { await page.click(`[role=tab]:has-text('${t}')`); if (t==="LinkedIn") { if (await page.locator("button:has-text('Build LinkedIn plan')").count()) await page.click("button:has-text('Build LinkedIn plan')"); await page.waitForSelector("text=Headline variants"); }
    if (t==="Recruiter Messages" && await page.locator("button:has-text('Draft messages')").count()) { await page.click("button:has-text('Draft messages')"); await page.waitForSelector("text=Connection request"); }
    if (t==="Interview Prep" && await page.locator("button:has-text('Build interview prep')").count()) { await page.click("button:has-text('Build interview prep')"); await page.waitForSelector("text=Topic likelihood"); }
    await overflow(`${t}@${w}`); if (w===1280) await unlabeled(t); }
  for (const v of ["Profile","Analyze a job","Applications","Versions","Analytics","Presentation","Settings"]) { await page.click(`nav >> button:has-text('${v}')`); await page.waitForTimeout(150); await overflow(`${v}@${w}`); if (w===1280) await unlabeled(v); await page.screenshot({ path: `${process.env.SHOTS ?? "."}/ui-${v.replace(/\W/g,"")}-${w}.png`, fullPage: false }); }
  await page.click("nav >> button:has-text('Applications')"); await page.click("table button");
}
// settings: weights + vocab
await page.setViewportSize({ width: 1280, height: 900 }); await page.click("nav >> button:has-text('Settings')");
await page.fill("#v-c", "Zeta Harness"); await page.fill("#v-a", "ZetaH"); await page.click("button:has-text('Add term')"); await page.waitForSelector("text=Added \"Zeta Harness\"");
await page.fill("#v-c", "UVM"); await page.click("button:has-text('Add term')"); await page.waitForSelector("text=already exists");
console.log("vocab add/clash OK");
// dark mode
{ const dp = await mk({ dark: true }); await dp.goto(URL); await dp.click("button:has-text('Load demo profile')"); await dp.screenshot({ path: `${process.env.SHOTS ?? "."}/ui-dark.png` }); }
console.log("PROBLEMS:", problems.length ? problems : "none"); await b.close();
