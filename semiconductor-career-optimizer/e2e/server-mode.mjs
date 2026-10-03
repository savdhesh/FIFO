import { chromium } from "playwright-core"; import fs from "fs";
const exe = fs.readdirSync("/opt/pw-browsers").filter(d=>d.startsWith("chromium-"))[0];
const b = await chromium.launch({ executablePath: `${process.env.CHROMIUM ?? `/opt/pw-browsers/${exe}/chrome-linux/chrome`}`, args:["--no-sandbox"] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true }); await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort()); const page = await ctx.newPage();
const errs=[]; page.on("pageerror", e=>errs.push(e.message)); page.on("console", m => m.type()==="error" && !/ERR_CERT|Failed to load resource/.test(m.text()) && errs.push(m.text()));
const email = `e2e${Date.now()}@example.com`;
await page.goto("http://localhost:3100/register");
await page.fill("input[name=email]", email); await page.fill("input[name=password]", "correct-horse-battery"); await page.click("button:has-text('Create account')");
await page.waitForURL("**/workspace/index.html"); await page.waitForSelector("text=Resume library");
console.log("workspace loaded; user shown:", (await page.textContent("header")).includes(email), "| AI toggle:", (await page.textContent("label[title]")).trim());
// upload resume w/ AI on (stub returns forged profile)
await page.check("#use-claude");
await page.setInputFiles("#resume-file", "tests/fixtures/demo-resume.txt");
await page.waitForSelector("#parse-review", { timeout: 30000 });
const rev = await page.textContent("#parse-review"); console.log("parse source:", /built-in parser/.test(rev) ? "built-in (AI result rejected: covered less)" : "AI", "| roles in profile:", await page.locator("input[id$='-title']").count());
const prof = await page.inputValue("#r0-employer"); console.log("employer:", prof);
const bullets = await page.inputValue("#r0-resp"); console.log("forged content absent:", !/Imaginary|40%|JasperGold/.test(bullets));
// state persisted to server: reload
await page.waitForTimeout(1500); await page.reload(); await page.waitForSelector("text=Resume library");
console.log("after reload, profile name:", await page.inputValue("#id-name"));
// job fetch SSRF
await page.click("nav >> button:has-text('Analyze a job')"); await page.fill("#jurl", "http://127.0.0.1:3100/"); await page.click("button:has-text('Fetch')");
await page.waitForSelector("text=private address"); console.log("SSRF blocked in UI");
await page.click("text=Use sample JD"); await page.click("button:has-text('Analyze match')"); await page.waitForSelector("text=Recommendation");
await page.click("[role=tab]:has-text('Resume Changes')"); await page.click("button:has-text('Generate application pack')"); await page.waitForSelector("text=Accept all safe changes");
await page.click("button:has-text('Accept all safe changes')");
const [dl] = await Promise.all([page.waitForEvent("download"), page.click("button:has-text('Download Resume (PDF)')")]);
const path = await dl.path(); console.log("downloaded:", dl.suggestedFilename(), fs.statSync(path).size > 2000);
await page.waitForTimeout(1500);
const stats = await (await fetch("http://localhost:4010/__stats")).json(); console.log("stub calls:", stats.calls, "| key sent:", stats.seen[0]?.auth, "| json mode:", stats.seen[0]?.json, "| key in page?", (await page.content()).includes("sk-test"));
// delete data
await page.click("nav >> button:has-text('Settings')"); await page.fill("#del-pw", "correct-horse-battery"); await page.click("button:has-text('Delete all my data')"); await page.click("button:has-text('Yes, delete everything')");
await page.waitForLoadState("load"); await page.waitForSelector("text=Resume library"); console.log("after delete, profile present:", await page.locator("#id-name").count());
console.log("errors:", errs); await b.close();
