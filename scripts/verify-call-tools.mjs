/**
 * Verify the two new surfaces in a real browser:
 *
 *  A. patient /book  — the collapsible "Other hours this day" section offers the
 *     rest of the day's hours and the chosen hour travels all the way to the
 *     review step (so the RPC receives an off-tile start time).
 *  B. doctor /dashboard → VIDEO CALL — the physician-only toolbox appears inside
 *     the call box, the note panel saves (or, while migration 0011 is pending,
 *     names the exact SQL it is missing), and the AI panel opens prefilled with
 *     the visit reason.
 *  C. patient /appointments → VIDEO CALL — the patient's room must show NONE of
 *     the doctor's tools.
 *
 * Expected 4xx while migrations 0010/0011 are pending (meeting_url, the 'ring'
 * insert, consultation_notes) are reported as INFO, never as failures.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const BASE = "http://localhost:3105";
const credentials = JSON.parse(readFileSync(resolve(process.cwd(), ".qa-credentials.json"), "utf8"));
const ARTIFACTS = resolve(process.cwd(), "e2e-artifacts");
/** Distinctive reason used by the real booking, matched again for cleanup. */
const TEST_REASON = "Follow-up: cough that will not settle";
/** The QA patient this script books (and then deletes) a test slot for. */
const QA_PATIENT_ID = "2ee8a1d9-19bf-4496-b0bb-f8082f14e3ae";

const browser = await chromium.launch({
  headless: true,
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
  ],
});

let failures = 0;

function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

function info(label, detail) {
  console.log(`INFO  ${label}${detail ? ` — ${detail}` : ""}`);
}

async function login(role) {
  const context = await browser.newContext({ permissions: ["camera", "microphone"] });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  const badResponses = [];

  page.on("pageerror", (e) => pageErrors.push(e.message.slice(0, 300)));
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
  });
  page.on("response", (r) => {
    if (r.status() >= 400) badResponses.push(`${r.status()} ${r.request().method()} ${r.url()}`);
  });

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.fill("#email", credentials[role].email);
    await page.fill("#password", credentials[role].password);
    await page.waitForTimeout(300);
    const email = await page.$eval("#email", (el) => el.value);
    if (email === credentials[role].email) break;
    info(`${role} fill attempt ${attempt + 1} lost the value, retrying`);
  }
  await page.click('button[type="submit"]');

  let signedIn = false;
  for (let i = 0; i < 30; i += 1) {
    await page.waitForTimeout(1000);
    if (!page.url().includes("/login")) {
      signedIn = true;
      break;
    }
  }
  check(`${role} signs in`, signedIn);
  if (!signedIn) await context.close();

  return { context, page, pageErrors, consoleErrors, badResponses };
}

function reportNetwork(role, label, badResponses) {
  const expected = badResponses.filter((line) =>
    /meeting_url|consultation_notes|kind=eq|rest\/v1\/call_signals/.test(line),
  );
  const unexpected = badResponses.filter((line) => !expected.includes(line));
  if (expected.length > 0) info(`${role} ${label} pending-migration 4xx`, expected.slice(0, 4).join(" | "));
  check(`${role} ${label} no unexpected failed requests`, unexpected.length === 0, unexpected.slice(0, 3).join(" | "));
}

/* ---------------------------------------------------------------- A: booking */

async function checkPatientBooking() {
  const { context, page, pageErrors, badResponses } = await login("patient");

  await page.goto(`${BASE}/book`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  await page.locator('button:has-text("SELECT")').first().click();
  // Exact name: the day tiles are labelled "NEXT DAY", "TODAY"…
  await page.getByRole("button", { name: "NEXT", exact: true }).click();
  await page.waitForTimeout(1200);

  let body = (await page.textContent("body")) ?? "";
  check("book step 2 renders the time step", body.includes("Pick time"));

  // Open the collapsible section.
  const toggle = page.locator('button[aria-expanded]').filter({ hasText: "Other hours this day" });
  check("collapsible section is present", (await toggle.count()) === 1);
  await toggle.first().click();
  await page.waitForTimeout(500);

  const group = page.locator('[role="radiogroup"][aria-label="Hours of the day"]');
  const chips = group.locator("button");
  const chipCount = await chips.count();
  check("collapsible lists the rest of the day", chipCount === 9, `chips=${chipCount} (expected 9: 08:00–20:00 minus the four featured tiles)`);

  body = (await page.textContent("body")) ?? "";
  check("expanded copy explains the rules", body.includes("8:00 AM to 8:00 PM"));

  // Pick the last day so no hour has passed yet, then an open hour.
  await page.locator('[aria-label="Consultation day"] button').nth(2).click();
  await page.waitForTimeout(400);

  const openChips = group.locator('button:not([aria-disabled="true"])');
  const openCount = await openChips.count();
  check("future day offers bookable other hours", openCount > 0, `open=${openCount}`);

  const chosenText = (await openChips.first().textContent()) ?? "";
  const chosenTime = chosenText.match(/\d{2}:\d{2}/)?.[0] ?? "";
  check("a chosen hour is readable", /^\d{2}:\d{2}$/.test(chosenTime), `chosen=${chosenTime || "none"}`);
  await openChips.first().click();
  await page.waitForTimeout(300);

  const chosenPeriod = /MORNING|AFTERNOON|EVENING|MIDDAY/.exec(chosenText)?.[0] ?? "";
  info("picked hour", `${chosenTime} (${chosenPeriod})`);

  await page.getByRole("button", { name: "NEXT", exact: true }).click();
  await page.waitForTimeout(800);

  if ((await page.locator("#reason").count()) === 0) {
    check("NEXT advances past the time step", false, "still on step 2 — an hour was not actually selected");
    reportNetwork("patient", "/book", badResponses);
    await context.close();
    return;
  }

  await page.fill("#reason", TEST_REASON);
  await page.locator('button:has-text("REVIEW BOOKING")').first().click();
  await page.waitForTimeout(800);

  body = (await page.textContent("body")) ?? "";
  check("review step shows the off-tile hour", chosenTime && body.includes(`${chosenTime} WAT`), `looking for "${chosenTime} WAT"`);

  await page.screenshot({ path: resolve(ARTIFACTS, "other-hours-review.png"), fullPage: true });

  // The booking RPC is the authority: an off-tile hour must actually book.
  await page.locator('button:has-text("CONFIRM & BOOK")').click();
  let booked = false;
  for (let i = 0; i < 24; i += 1) {
    await page.waitForTimeout(500);
    if (page.url().includes("/appointments")) {
      booked = true;
      break;
    }
  }
  check("booking a non-featured hour succeeds", booked, `url=${page.url()}`);

  if (booked) {
    await page.waitForTimeout(2500);
    body = (await page.textContent("body")) ?? "";
    check("appointment appears in the patient's list", body.includes(TEST_REASON.slice(0, 20)));

    // Same account, same room — but the toolbox belongs to the doctor.
    const callButton = page.locator('button:has-text("VIDEO CALL")').first();
    const canCall = (await callButton.count()) > 0;
    check("booked appointment offers a video call", canCall);
    if (canCall) {
      await callButton.click();
      await page.waitForTimeout(7000);
      const doctorTools =
        (await page.locator('button:has-text("AI DIAGNOSTICS")').count()) +
        (await page.locator('button:has-text("CALL NOTES")').count());
      check("patient room hides the doctor toolbox", doctorTools === 0, `doctor tool buttons=${doctorTools}`);
      await page.screenshot({ path: resolve(ARTIFACTS, "patient-call-room.png"), fullPage: true });
    }
  }

  reportNetwork("patient", "/book", badResponses);
  check("patient /book no page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
  await context.close();
}

/* ----------------------------------------------------------- B: doctor tools */

async function checkDoctorTools() {
  const { context, page, pageErrors, badResponses } = await login("doctor");

  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);

  const callButton = page.locator('button:has-text("VIDEO CALL")').first();
  if ((await callButton.count()) === 0) {
    check("doctor has an appointment to call", false, "no VIDEO CALL button on the dashboard");
    reportNetwork("doctor", "/dashboard", badResponses);
    await context.close();
    return;
  }

  await callButton.click();
  await page.waitForTimeout(7000);

  const diagnosticsButton = page.locator('button:has-text("AI DIAGNOSTICS")');
  const notesButton = page.locator('button:has-text("CALL NOTES")');
  check("doctor toolbox offers AI diagnostics", (await diagnosticsButton.count()) === 1);
  check("doctor toolbox offers call notes", (await notesButton.count()) === 1);

  // --- notes panel -------------------------------------------------------
  await notesButton.click();
  await page.waitForTimeout(2500);

  const noteArea = page.locator("#call-note");
  check("notes panel opens with a textarea", (await noteArea.count()) === 1);
  await noteArea.fill("BP 120/80. Advised rest, fluids and review in 3 days.");

  const save = page.locator('button:has-text("SAVE NOTE")');
  check("save button enabled after typing", await save.isEnabled());
  await save.click();
  await page.waitForTimeout(3000);

  let body = (await page.textContent("body")) ?? "";
  const savedToSupabase = /Saved \d/.test(body) && !body.includes("Not saved yet");
  const namesMigration = body.includes("20261019000011_consultation_notes.sql");
  check(
    "notes save to Supabase (or name the missing migration)",
    savedToSupabase || namesMigration,
    savedToSupabase ? "row written to consultation_notes" : "migration 0011 not applied yet — panel says so instead of lying",
  );
  info("notes panel status", body.includes("Private to you") ? "privacy line shown" : "privacy line missing");

  await page.screenshot({ path: resolve(ARTIFACTS, "in-call-notes.png"), fullPage: true });

  // --- AI diagnostics panel ---------------------------------------------
  await page.locator('section[aria-label="Consultation notes"] button:has-text("Close")').click();
  await page.waitForTimeout(400);
  await diagnosticsButton.click();
  await page.waitForTimeout(1500);

  const symptoms = page.locator("#in-call-symptoms");
  check("AI panel opens inside the call box", (await symptoms.count()) === 1);
  const prefilled = await symptoms.inputValue().catch(() => "");
  check("AI panel is prefilled with the visit reason", prefilled.trim().length > 0, JSON.stringify(prefilled.slice(0, 80)));

  body = (await page.textContent("body")) ?? "";
  check("AI panel keeps the mandatory disclaimer", body.includes("the decision rests with you"));
  check("video call is still open behind the panel", (await page.locator('video').count()) >= 1);

  await page.screenshot({ path: resolve(ARTIFACTS, "in-call-ai.png"), fullPage: true });

  reportNetwork("doctor", "/dashboard call", badResponses);
  check("doctor call room no page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
  await context.close();
}

/* ------------------------------------------------------------ housekeeping */

/** Remove the booking this script really made, so the QA data stays clean. */
async function cleanupTestBooking() {
  try {
    const env = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    const url = env.match(/^NEXT_PUBLIC_SUPABASE_URL=(.*)$/m)?.[1]?.trim();
    const key = env.match(/^SUPABASE_SERVICE_ROLE_KEY=(.*)$/m)?.[1]?.trim();
    if (!url || !key) {
      info("cleanup", "no service role key in .env.local — test booking left in place");
      return;
    }
    const filter = `patient_id=eq.${QA_PATIENT_ID}&reason_for_visit=eq.${encodeURIComponent(TEST_REASON)}`;
    const headers = { apikey: key, Authorization: `Bearer ${key}` };
    const found = await fetch(`${url}/rest/v1/appointments?${filter}&select=id`, { headers }).then((r) =>
      r.json(),
    );
    if (!Array.isArray(found) || found.length === 0) {
      info("cleanup", "no test booking left behind");
      return;
    }
    const res = await fetch(`${url}/rest/v1/appointments?${filter}`, {
      method: "DELETE",
      headers: { ...headers, Prefer: "return=representation" },
    });
    const rows = await res.json().catch(() => []);
    info("cleanup", `removed ${Array.isArray(rows) ? rows.length : found.length} test booking(s) (email/notification rows cascade)`);
  } catch (caught) {
    info("cleanup", `could not remove the test booking: ${caught.message}`);
  }
}

try {
  for (const [name, run] of [
    ["patient booking", checkPatientBooking],
    ["doctor toolbox", checkDoctorTools],
  ]) {
    try {
      await run();
    } catch (caught) {
      check(`${name} completed`, false, caught instanceof Error ? caught.message.slice(0, 200) : String(caught));
    }
  }
  await cleanupTestBooking();
} finally {
  await browser.close();
}

console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
