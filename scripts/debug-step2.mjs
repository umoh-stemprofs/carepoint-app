/** Throwaway probe: watch the booking wizard's step 2 in a browser. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const BASE = "http://localhost:3105";
const credentials = JSON.parse(readFileSync(resolve(process.cwd(), ".qa-credentials.json"), "utf8"));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message.slice(0, 300)));

await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
for (let i = 0; i < 5; i += 1) {
  await page.fill("#email", credentials.patient.email);
  await page.fill("#password", credentials.patient.password);
  await page.waitForTimeout(300);
  if ((await page.$eval("#email", (el) => el.value)) === credentials.patient.email) break;
}
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000, waitUntil: "commit" });
await page.waitForLoadState("domcontentloaded").catch(() => {});

await page.goto(`${BASE}/book`, { waitUntil: "domcontentloaded" });
const card = page.locator("article").filter({ hasText: "qa-doctor" }).first();
await card.waitFor({ timeout: 20000 });
console.log("doctor card found");
await card.locator('button:has-text("SELECT")').click();
await page.locator('button:has-text("NEXT")').click();
await page.waitForTimeout(1500);

console.log("URL after NEXT:", page.url());
const headings = await page.locator("h1, h2").allTextContents();
console.log("headings:", JSON.stringify(headings));
const radios = await page.locator('[role="radio"]').all();
console.log("radio count:", radios.length);
for (const radio of radios) {
  console.log("  radio:", JSON.stringify((await radio.textContent())?.replace(/\s+/g, " ")));
}
const today = page.getByRole("radio", { name: "TODAY" });
console.log("TODAY count:", await today.count());
await today.click().catch((e) => console.log("TODAY click failed:", e.message.split("\n")[0]));
await page.waitForTimeout(1000);
const morning = page.getByRole("radio", { name: /Morning/ });
console.log("Morning count:", await morning.count());
console.log("Morning accessible-ish text:", JSON.stringify((await page.locator('[role="radio"]').allTextContents()).map((t) => t.replace(/\s+/g, " ").trim())));
await page.screenshot({ path: resolve(process.cwd(), "e2e-artifacts", "debug-step2.png"), fullPage: true });
await browser.close();
