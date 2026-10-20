/** Throwaway probe: watch what the login form actually does. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const BASE = "http://localhost:3105";
const credentials = JSON.parse(readFileSync(resolve(process.cwd(), ".qa-credentials.json"), "utf8"));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on("console", (m) => console.log(`[console:${m.type()}]`, m.text().slice(0, 300)));
page.on("pageerror", (e) => console.log("[pageerror]", e.message.slice(0, 300)));
page.on("requestfailed", (r) =>
  console.log("[requestfailed]", r.method(), r.url().slice(0, 160), r.failure()?.errorText),
);
page.on("request", (r) => {
  if (r.url().includes("supabase.co")) console.log("[request]", r.method(), r.url().slice(0, 160));
});
page.on("response", async (r) => {
  if (r.url().includes("supabase.co")) {
    let body = "";
    try { body = (await r.text()).slice(0, 200); } catch {}
    console.log("[response]", r.status(), r.url().slice(0, 120), body);
  }
});

await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
console.log("after goto URL:", page.url());
for (let attempt = 0; attempt < 3; attempt += 1) {
  await page.fill("#email", credentials.patient.email);
  await page.fill("#password", credentials.patient.password);
  await page.waitForTimeout(200);
  if ((await page.$eval("#email", (el) => el.value)) === credentials.patient.email) break;
  console.log(`fill attempt ${attempt + 1} lost the value, retrying`);
}
console.log("input values:", await page.$eval("#email", (el) => el.value), "/", await page.$eval("#password", (el) => el.value.length));
await page.click('button[type="submit"]');
await page.waitForTimeout(2000);
const alert = await page.locator('[role="alert"]').allTextContents();
console.log("alerts after 2s:", JSON.stringify(alert));
await page.waitForTimeout(10000);
console.log("after submit URL:", page.url());
console.log("alerts after 12s:", JSON.stringify(await page.locator('[role="alert"]').allTextContents()));
const body = (await page.textContent("body")) ?? "";
console.log("BODY SNIPPET:\n", body.replace(/\s+/g, " ").slice(0, 500));
await page.screenshot({ path: resolve(process.cwd(), "e2e-artifacts", "debug-login.png") });
await browser.close();
