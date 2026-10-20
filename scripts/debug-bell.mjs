/** Throwaway probe: why are there two notification bell buttons? */
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
// The form sits behind a Suspense boundary: click, and click again if the
// first click raced hydration.
for (let attempt = 0; attempt < 10; attempt += 1) {
  await page.click('button[type="submit"]', { noWaitAfter: true }).catch(() => {});
  try {
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 4000, waitUntil: "commit" });
    break;
  } catch {
    if (!page.url().includes("/login")) break;
    await page.waitForTimeout(1000);
  }
}

// Reproduce the E2E moment: book, then look at /appointments?booked=1.
await page.goto(`${BASE}/book`, { waitUntil: "domcontentloaded" });
const card = page.locator("article").filter({ hasText: "qa-doctor" }).first();
await card.waitFor({ timeout: 20000 });
await card.locator('button:has-text("SELECT")').click();
await page.getByRole("button", { name: "NEXT", exact: true }).click();
await page.getByRole("radio", { name: /TOMORROW/i }).click();
await page.getByRole("radio", { name: /Morning/i }).click();
await page.getByRole("button", { name: "NEXT", exact: true }).click();
await page.fill("#reason", "bell probe: checking duplicate bell");
await page.click('button:has-text("REVIEW BOOKING")');
await page.click('button:has-text("CONFIRM & BOOK")');
await page.waitForURL(/\/appointments/, { timeout: 25000, waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
const bells = await page.locator('button[aria-label^="Notifications"]').all();
console.log("bell count on /appointments:", bells.length);
for (const bell of bells) {
  const info = await bell.evaluate((el) => {
    const chain = [];
    let node = el;
    while (node && chain.length < 6) {
      chain.push(`${node.tagName.toLowerCase()}${node.id ? "#" + node.id : ""}${node.getAttribute && node.getAttribute("aria-label") ? `[aria-label="${node.getAttribute("aria-label")}"]` : ""}`);
      node = node.parentElement;
    }
    return { chain: chain.join(" < "), html: el.outerHTML.slice(0, 160) };
  });
  console.log("  -", info.chain);
  console.log("    ", info.html);
}
// Also count Topbars and mains.
console.log("mains:", await page.locator("main").count(), "topbars-ish headers:", await page.locator("header").count());
await browser.close();
