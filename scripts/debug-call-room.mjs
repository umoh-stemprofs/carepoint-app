/** One-shot probe: open the doctor's call room and dump what actually renders. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const BASE = "http://localhost:3105";
const credentials = JSON.parse(readFileSync(resolve(process.cwd(), ".qa-credentials.json"), "utf8"));

const browser = await chromium.launch({
  headless: true,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});
const context = await browser.newContext({ permissions: ["camera", "microphone"] });
const page = await context.newPage();

// setup() in VideoCallRoom is fire-and-forget, so a rejected await inside it
// vanishes silently. Surface every unhandled rejection through the console.
await page.addInitScript(() => {
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    console.error(
      "[unhandledrejection]",
      (reason && (reason.message || reason)) || String(reason),
      (reason && reason.stack) || "",
    );
  });
  window.__reqs = [];
  const originalFetch = window.fetch;
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input?.url ?? String(input);
    window.__reqs.push(`${init?.method ?? "GET"} ${url.slice(0, 150)}`);
    return originalFetch(input, init);
  };
});

const errors = [];
const bad = [];
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message.slice(0, 300)}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text().slice(0, 300));
});
page.on("response", (r) => {
  const stamp = new Date().toISOString().slice(17, 23);
  if (r.status() >= 400) {
    bad.push(`${stamp} ${r.status()} ${r.request().method()} ${r.url().slice(0, 160)}`);
  }
  const path = r.url().replace(/^https?:\/\/[^/]+/, "");
  if (path.startsWith("/rest/v1/") || path.startsWith("/auth/v1/")) {
    console.log(`REQ   ${stamp} ${r.status()} ${path.slice(0, 130)}`);
  }
});

await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
for (let attempt = 0; attempt < 4; attempt += 1) {
  await page.fill("#email", credentials.doctor.email);
  await page.fill("#password", credentials.doctor.password);
  await page.waitForTimeout(300);
  if ((await page.$eval("#email", (el) => el.value)) === credentials.doctor.email) break;
}
await page.click('button[type="submit"]');
for (let i = 0; i < 30; i += 1) {
  await page.waitForTimeout(1000);
  if (!page.url().includes("/login")) break;
}

await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);

// Does the served bundle even carry the new toolbox?
const scripts = await page.evaluate(() =>
  performance
    .getEntriesByType("resource")
    .map((r) => r.name)
    .filter((n) => n.includes(".js") && n.startsWith("http")),
);
let bundleHit = "no js resources";
for (const url of scripts) {
  const body = await page.evaluate(async (u) => (await fetch(u)).text(), url).catch(() => "");
  if (body.includes("CALL NOTES")) {
    bundleHit = `FOUND in ${url.split("/").slice(-1)[0]}`;
    break;
  }
  bundleHit = "not found in any served chunk";
}
console.log(`INFO  toolbox code in bundle: ${bundleHit}`);

const calls = await page.locator('button:has-text("VIDEO CALL")').count();
console.log(`INFO  video call buttons on dashboard: ${calls}`);

if (calls > 0) {
  await page.locator('button:has-text("VIDEO CALL")').first().click();
  await page.waitForTimeout(8000);

  console.log(`INFO  dialogs: ${await page.locator('[role="dialog"]').count()}`);
  console.log(`INFO  AI DIAGNOSTICS buttons: ${await page.locator('button:has-text("AI DIAGNOSTICS")').count()}`);
  console.log(`INFO  CALL NOTES buttons: ${await page.locator('button:has-text("CALL NOTES")').count()}`);

  const dialog = page.locator('[role="dialog"][aria-label^="Video call"]');
  if ((await dialog.count()) > 0) {
    const buttonLabels = await dialog.locator("button").allTextContents();
    console.log(`INFO  buttons in room: ${JSON.stringify(buttonLabels.map((b) => b.replace(/\s+/g, " ").trim()))}`);
  }

  const reqs = await page.evaluate(() => (window.__reqs ?? []).slice(-25));
  console.log("INFO  fetches since room opened:");
  for (const line of reqs) console.log(`      ${line}`);
  const text = ((await dialog.count()) > 0 ? await dialog.first().textContent() : (await page.textContent("body"))) ?? "";
  console.log(`INFO  room text: ${text.replace(/\s+/g, " ").slice(0, 700)}`);
  await page.screenshot({ path: resolve(process.cwd(), "e2e-artifacts", "debug-call-room.png"), fullPage: true });
}

console.log(`INFO  4xx: ${bad.slice(0, 8).join(" | ")}`);
console.log(`INFO  errors: ${errors.slice(0, 6).join(" | ") || "none"}`);

await browser.close();
