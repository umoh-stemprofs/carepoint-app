/** Throwaway probe: does / render patient cards for a patient and clinic cards for a doctor? */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const BASE = "http://localhost:3105";
const credentials = JSON.parse(readFileSync(resolve(process.cwd(), ".qa-credentials.json"), "utf8"));

const browser = await chromium.launch({ headless: true });

async function probe(label, account) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.fill("#email", account.email);
    await page.fill("#password", account.password);
    await page.waitForTimeout(200);
    if ((await page.$eval("#email", (el) => el.value)) === account.email) break;
  }
  console.log(`[${label}] filled: ${await page.$eval("#email", (el) => el.value)} / pw len ${await page.$eval("#password", (el) => el.value.length)}`);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(6000);
  console.log(`[${label}] after login url: ${page.url()}`);
  const alerts = await page.locator('[role="alert"]').allTextContents();
  if (alerts.length) console.log(`[${label}] alerts: ${JSON.stringify(alerts)}`);

  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const hrefs = await page.locator("a[href]").evaluateAll((nodes) =>
    nodes.map((n) => n.getAttribute("href")),
  );
  const heading = (await page.locator("h1").first().textContent())?.trim();
  console.log(`\n[${label}] h1: ${heading}`);
  console.log(`[${label}] links: ${JSON.stringify(hrefs)}`);
  await context.close();
}

await probe("patient", credentials.patient);
await probe("doctor", credentials.doctor);

await browser.close();
