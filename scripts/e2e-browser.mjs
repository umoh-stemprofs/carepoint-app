/**
 * CarePoint end-to-end browser test (plan Phase 12), driven through Playwright
 * against a running dev server and the REAL Supabase project.
 *
 * What it proves, in order:
 *   1. Email/password login works for a patient (the auth flow you tested).
 *   2. Phase 8.2/8.4: health profile saves server-side, a document uploads to
 *      Storage, lands in "Your papers", and OPEN mints a signed URL that loads.
 *   3. The new past-time guard: on TODAY, every slot that has already passed
 *      is disabled and badged PASSED, in the UI (the RPC refuses it too — see
 *      scripts/test-integration.mjs).
 *   4. A real booking flows through the atomic RPC and lands on /appointments.
 *   5. Phase 11: the realtime notification toast fires and the bell inbox
 *      lists "Appointment requested".
 *   6. Phase 9.2: the doctor toggles a period closed and back on.
 *   7. Phase 9.3: the patient record modal shows the saved symptoms.
 *   8. THE VIDEO CALL: patient and doctor each open the room, signalling runs
 *      over call_signals, WebRTC connects, and both sides receive real remote
 *      video frames (asserted via videoWidth/videoHeight > 0).
 *   9. Phase 9.4: Confirm / Cancel status buttons propagate to the patient.
 *
 * Accounts come from .qa-credentials.json (written by scripts/test-integration.mjs).
 * Screenshots land in e2e-artifacts/ (git-ignored).
 *
 *   node scripts/e2e-browser.mjs            # base URL http://localhost:3105
 *   E2E_BASE_URL=http://localhost:3000 node scripts/e2e-browser.mjs
 *
 * Chromium runs with a fake camera/microphone so getUserMedia succeeds
 * headlessly; the fake device emits real frames, which is what we assert on.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3105";
const ART = resolve(process.cwd(), "e2e-artifacts");
const CREDENTIALS_FILE = resolve(process.cwd(), ".qa-credentials.json");

const SYMPTOM_TEXT = "E2E automated check: mild cough for two days, no fever.";
const REASON_TEXT = "E2E automated check: headache for two days.";
const UPLOAD_NAME = "qa-lab-report.png";

/** WAT is fixed at UTC+1 all year (Africa/Lagos has no DST). */
const WAT = "Africa/Lagos";

/** Slot start hours in WAT — must mirror TIME_SLOTS in app/(patient)/book/page.tsx. */
const SLOTS = [
  { label: "Morning", hour: 9 },
  { label: "Midday", hour: 12 },
  { label: "Afternoon", hour: 15 },
  { label: "Evening", hour: 17 },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function watClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: WAT,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  return {
    hour: Number(parts.find((p) => p.type === "hour").value),
    minute: Number(parts.find((p) => p.type === "minute").value),
  };
}

/** Poll a truthy check; throw when it never becomes true. */
async function waitFor(description, fn, timeoutMs = 15000, everyMs = 250) {
  const end = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < end) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(everyMs);
  }
  throw new Error(
    `timed out waiting for: ${description}${lastError ? ` (last error: ${lastError.message})` : ""}`,
  );
}

mkdirSync(ART, { recursive: true });
// A valid 1x1 PNG so the upload passes the MIME whitelist (plan D7).
writeFileSync(
  resolve(ART, UPLOAD_NAME),
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

const credentials = JSON.parse(readFileSync(CREDENTIALS_FILE, "utf8"));

/** Uploads are timestamp-prefixed, so clear last run's files to keep the bucket tidy. */
async function cleanPreviousUploads() {
  const env = Object.fromEntries(
    readFileSync(resolve(process.cwd(), ".env.local"), "utf8")
      .split(/\r?\n/)
      .filter((line) => line.includes("="))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );
  const headers = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };
  const base = env.NEXT_PUBLIC_SUPABASE_URL;
  const list = await fetch(`${base}/storage/v1/object/list/health-records`, {
    method: "POST",
    headers,
    body: JSON.stringify({ prefix: credentials.patient.id, limit: 100 }),
  });
  const objects = (await list.json()) ?? [];
  const stale = objects.filter((object) => object.name?.endsWith(UPLOAD_NAME));
  if (stale.length === 0) return;
  await fetch(`${base}/storage/v1/object/health-records`, {
    method: "DELETE",
    headers,
    body: JSON.stringify({ prefixes: stale.map((object) => `${credentials.patient.id}/${object.name}`) }),
  });
  console.log(`  info   removed ${stale.length} leftover qa upload(s) from a previous run`);
}
await cleanPreviousUploads();

let passed = 0;
const failures = [];
/** @type {import("playwright").Page[]} */
const watchedPages = [];
const consoleIssues = [];

function attachWatchers(page, tag) {
  watchedPages.push(page);
  page.on("pageerror", (error) => {
    consoleIssues.push(`[pageerror ${tag}] ${error.message}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleIssues.push(`[console ${tag}] ${message.text()}`);
    }
  });
}

async function shot(page, name) {
  try {
    await page.screenshot({ path: resolve(ART, `${name}.png`) });
  } catch {
    // Screenshots are evidence, never a reason to fail a step.
  }
}

async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS   ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
    console.log(`  FAIL   ${name}\n         ${error.message}`);
    let i = 0;
    for (const page of watchedPages) {
      if (!page.isClosed()) await shot(page, `fail-${passed + failures.length}-${i++}`);
    }
  }
}

/**
 * Fill a controlled React input and verify the value survived hydration.
 *
 * The login page mounts its form behind a Suspense boundary, so a value typed
 * between DOMContentLoaded and hydration gets wiped by the remount. Filling,
 * checking and retrying rides out that window.
 */
async function fillVerified(page, selector, value) {
  await waitFor(
    `field ${selector} to hold "${value.slice(0, 20)}"`,
    async () => {
      await page.fill(selector, value);
      await page.waitForTimeout(150);
      return (await page.$eval(selector, (el) => el.value)) === value;
    },
    20000,
    500,
  );
}

async function login(page, who) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await fillVerified(page, "#email", who.email);
  await fillVerified(page, "#password", who.password);

  // The form sits behind a Suspense boundary: a click that lands before
  // hydration does nothing at all, and a native (un-hydrated) submit falls
  // through to a GET reload of /login. Clicking, checking whether the app
  // reacted, and refilling if a reload wiped the fields rides out that window.
  await waitFor(
    "login to leave /login",
    async () => {
      const onLoginPage = () => new URL(page.url()).pathname.startsWith("/login");
      if (!onLoginPage()) return true;
      const submit = page.locator('button[type="submit"]');
      if ((await submit.count()) > 0 && !(await submit.isDisabled())) {
        await submit.click({ noWaitAfter: true });
      }
      try {
        await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
          timeout: 4000,
          waitUntil: "commit",
        });
        return true;
      } catch {
        if (!onLoginPage()) return true;
        await fillVerified(page, "#email", who.email);
        await fillVerified(page, "#password", who.password);
        return false;
      }
    },
    60000,
    1500,
  );
  await page.waitForLoadState("domcontentloaded");
}

/** Remote (first) <video> must report real frame dimensions. */
async function remoteFramesFlow(page, description) {
  await waitFor(
    `${description}: remote video renders frames`,
    async () => {
      const frames = await page.evaluate(() =>
        Array.from(document.querySelectorAll("video")).map((video) => ({
          width: video.videoWidth,
          height: video.videoHeight,
          muted: video.muted,
          readyState: video.readyState,
        })),
      );
      const remote = frames.find((video) => !video.muted);
      return Boolean(remote && remote.width > 0 && remote.height > 0 && remote.readyState >= 2);
    },
    20000,
  );
}

// ---------------------------------------------------------------------------

console.log(`\nCarePoint browser E2E against ${BASE}`);

const reach = await fetch(BASE).catch(() => null);
if (!reach || !reach.ok) {
  console.error(
    `The dev server at ${BASE} is not answering. Start it first: npm run dev -- --port 3105`,
  );
  process.exit(1);
}

const browser = await chromium.launch({
  headless: true,
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
  ],
});

const patientContext = await browser.newContext({
  permissions: ["camera", "microphone"],
  viewport: { width: 430, height: 932 },
});
const doctorContext = await browser.newContext({
  permissions: ["camera", "microphone"],
  viewport: { width: 430, height: 932 },
});

const patient = await patientContext.newPage();
const doctor = await doctorContext.newPage();
// Cold Turbopack compiles on a dev server can take a while on first hit, so
// navigation gets a generous budget while element waits stay tighter.
for (const page of [patient, doctor]) {
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(90000);
}
attachWatchers(patient, "patient");
attachWatchers(doctor, "doctor");

try {
  // --- 1. auth ------------------------------------------------------------
  await check("patient logs in with email + password", async () => {
    await login(patient, credentials.patient);
    await patient.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20000 });
    await shot(patient, "patient-logged-in");
  });

  // --- 2. health profile (phase 8.1/8.4) ---------------------------------
  await check("health profile saves server-side (phase 8)", async () => {
    await patient.goto(`${BASE}/health-profile`, { waitUntil: "domcontentloaded" });
    await fillVerified(patient, "#symptoms", SYMPTOM_TEXT);
    await fillVerified(patient, "#emergencyContactName", "QA Emergency Contact");
    await fillVerified(patient, "#emergencyContactPhone", "08012345678");
    await patient.click('button:has-text("SAVE HEALTH PROFILE")');
    await patient.getByText("Your health profile has been saved.").waitFor({ timeout: 15000 });
  });

  await check("document uploads, lists in 'Your papers', opens via signed URL (phase 8.4)", async () => {
    await patient.setInputFiles("#medicalDocument", resolve(ART, UPLOAD_NAME));
    await patient.click('button:has-text("UPLOAD DOCUMENT")');
    await patient
      .getByText(`Uploaded ${UPLOAD_NAME} to your record.`)
      .waitFor({ timeout: 20000 });

    // Reload so the papers list re-reads Storage, then prove the signed URL.
    await patient.reload({ waitUntil: "domcontentloaded" });
    await patient.getByText(UPLOAD_NAME, { exact: false }).first().waitFor({ timeout: 15000 });
    const row = patient.locator("li").filter({ hasText: UPLOAD_NAME }).first();
    const [popup] = await Promise.all([
      patient.waitForEvent("popup", { timeout: 20000 }),
      row.locator('button:has-text("OPEN")').first().click(),
    ]);
    await popup.waitForLoadState("domcontentloaded");
    const popupUrl = popup.url();
    await popup.close();
    if (!/storage.*sign|token=/.test(popupUrl)) {
      throw new Error(`expected a signed storage URL, opened: ${popupUrl}`);
    }
    await shot(patient, "health-profile-paper");
  });

  // --- 3. booking + past-time guard --------------------------------------
  const clock = watClock();
  console.log(
    `  info   WAT now ${String(clock.hour).padStart(2, "0")}:${String(clock.minute).padStart(2, "0")}`,
  );

  await check("past times on TODAY are disabled and badged PASSED", async () => {
    await patient.goto(`${BASE}/book`, { waitUntil: "domcontentloaded" });
    // Pick the qa doctor's card by name so the call later has a real peer.
    const doctorCard = patient.locator("article").filter({ hasText: "qa-doctor" }).first();
    await doctorCard.waitFor({ timeout: 20000 });
    await doctorCard.locator('button:has-text("SELECT")').click();
    // "NEXT" must not match the "NEXT DAY" day tile, hence exact role name.
    await patient.getByRole("button", { name: "NEXT", exact: true }).click();

    const today = patient.getByRole("radio", { name: "TODAY" });
    await today.click();

    // Slot labels are uppercased by CSS ("MORNING 9:00 AM"), and Playwright
    // regex name-matching honours the regex's own case sensitivity.
    for (const slot of SLOTS) {
      const radio = patient.getByRole("radio", { name: new RegExp(slot.label, "i") });
      // A slot is gone once its start time (hour:00 WAT) is in the past.
      // The degenerate minute == 0 boundary is skipped to avoid flakiness.
      const definitelyPassed =
        clock.hour > slot.hour ||
        (clock.hour === slot.hour && clock.minute > 0);
      if (clock.hour === slot.hour && clock.minute === 0) continue;

      const text = (await radio.textContent()) ?? "";
      if (definitelyPassed) {
        if (!(await radio.isDisabled())) {
          throw new Error(`${slot.label} should be disabled after its time passed`);
        }
        if (!text.includes("PASSED")) {
          throw new Error(`${slot.label} should carry the PASSED badge, got: "${text}"`);
        }
      } else if (await radio.isDisabled()) {
        throw new Error(`${slot.label} should still be bookable, but it is disabled`);
      }
    }
  });

  await check("booking a future slot reaches /appointments with the real reason", async () => {
    // Tomorrow: always in the future, so the guard never blocks the flow itself.
    await patient.getByRole("radio", { name: /TOMORROW/i }).click();
    await patient.getByRole("radio", { name: /Morning/i }).click();
    await patient.getByRole("button", { name: "NEXT", exact: true }).click();
    await fillVerified(patient, "#reason", REASON_TEXT);
    await patient.click('button:has-text("REVIEW BOOKING")');
    await patient.click('button:has-text("CONFIRM & BOOK")');
    await patient.waitForURL(/\/appointments/, { timeout: 25000 });
    await patient
      .locator("article")
      .filter({ hasText: REASON_TEXT })
      .waitFor({ timeout: 15000 });
    await shot(patient, "patient-appointment-booked");
  });

  // --- 4. phase 11 notifications -----------------------------------------
  await check("realtime toast fires on booking (phase 11.1)", async () => {
    await patient
      .getByText("Appointment requested")
      .first()
      .waitFor({ timeout: 15000 });
  });

  await check("notification bell inbox lists the booking (phase 11.4)", async () => {
    const bells = patient.locator('button[aria-label^="Notifications"]');
    const count = await bells.count();
    if (count !== 1) console.log(`  info   ${count} bell buttons in the DOM (using the first)`);
    await bells.first().click();
    const inbox = patient.locator('[role="dialog"][aria-label="Notification inbox"]');
    await inbox.waitFor({ timeout: 10000 });
    await inbox.getByText("Appointment requested").first().waitFor({ timeout: 10000 });
    await bells.first().click(); // close
    await shot(patient, "notification-inbox");
  });

  // --- 5. doctor side -----------------------------------------------------
  await check("doctor logs in and sees the booking in the queue", async () => {
    await login(doctor, credentials.doctor);
    await doctor.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
    await doctor
      .locator("article")
      .filter({ hasText: REASON_TEXT })
      .first()
      .waitFor({ timeout: 20000 });
    await shot(doctor, "doctor-queue");
  });

  await check("availability toggle closes and reopens a period (phase 9.2)", async () => {
    const morning = doctor
      .locator('button[aria-pressed]')
      .filter({ hasText: "Morning" })
      .first();
    await morning.waitFor({ timeout: 15000 });
    const before = await morning.getAttribute("aria-pressed");
    try {
      await morning.click();
      await waitFor(
        "period state flips after toggle",
        async () => (await morning.getAttribute("aria-pressed")) !== before,
      );
      await doctor.getByText("Your hours were updated.").waitFor({ timeout: 10000 });
    } finally {
      // Always restore so the doctor keeps their original hours.
      if ((await morning.getAttribute("aria-pressed")) !== before) {
        await morning.click();
        await waitFor(
          "period state restored",
          async () => (await morning.getAttribute("aria-pressed")) === before,
        );
      }
    }
  });

  await check("patient record modal shows saved symptoms (phase 9.3)", async () => {
    const card = doctor.locator("article").filter({ hasText: REASON_TEXT }).first();
    await card.locator('button:has-text("Patient record")').click();
    const modal = doctor.locator('[role="dialog"][aria-label^="Patient record for"]');
    try {
      await modal.waitFor({ timeout: 15000 });
      await modal.getByText("mild cough", { exact: false }).first().waitFor({ timeout: 15000 });
      await shot(doctor, "patient-record-modal");
    } finally {
      // An open modal blocks every later click on the dashboard.
      if (await modal.isVisible().catch(() => false)) {
        await modal.locator('button:has-text("CLOSE RECORD")').click();
        await modal.waitFor({ state: "hidden", timeout: 10000 });
      }
    }
  });

  // --- 6. the live video call --------------------------------------------
  await check("doctor opens the call room and waits", async () => {
    const card = doctor.locator("article").filter({ hasText: REASON_TEXT }).first();
    await card.locator('button:has-text("VIDEO CALL")').click();
    await doctor
      .locator('[role="dialog"][aria-label^="Video call with"]')
      .waitFor({ timeout: 15000 });
    await shot(doctor, "doctor-call-open");
  });

  await check("patient joins the room", async () => {
    await patient.goto(`${BASE}/appointments`, { waitUntil: "domcontentloaded" });
    const card = patient.locator("article").filter({ hasText: REASON_TEXT }).first();
    await card.waitFor({ timeout: 15000 });
    await card.locator('button:has-text("VIDEO CALL")').click();
    await patient
      .locator('[role="dialog"][aria-label^="Video call with"]')
      .waitFor({ timeout: 15000 });
    await shot(patient, "patient-call-open");
  });

  await check("both sides reach LIVE (signalling + WebRTC handshake)", async () => {
    await waitFor(
      "doctor sees LIVE",
      async () =>
        doctor
          .locator('[role="dialog"][aria-label^="Video call with"]')
          .getByText("LIVE", { exact: true })
          .isVisible(),
      60000,
    );
    await waitFor(
      "patient sees LIVE",
      async () =>
        patient
          .locator('[role="dialog"][aria-label^="Video call with"]')
          .getByText("LIVE", { exact: true })
          .isVisible(),
      60000,
    );
  });

  await check("real video frames flow both ways (videoWidth > 0)", async () => {
    await remoteFramesFlow(doctor, "doctor");
    await remoteFramesFlow(patient, "patient");
    await shot(doctor, "doctor-call-live");
    await shot(patient, "patient-call-live");
  });

  await check("doctor ends the call; patient is told it ended", async () => {
    await doctor
      .locator('[role="dialog"][aria-label^="Video call with"]')
      .locator('button:has-text("END CALL")')
      .click();
    await patient
      .getByText("ended the call.", { exact: false })
      .first()
      .waitFor({ timeout: 15000 });
    await patient
      .locator('[role="dialog"][aria-label^="Video call with"]')
      .getByText("ENDED", { exact: true })
      .waitFor({ timeout: 10000 });
    await patient
      .locator('[role="dialog"][aria-label^="Video call with"]')
      .locator('button:has-text("CLOSE")')
      .click();
    await doctor
      .locator('[role="dialog"][aria-label^="Video call with"]')
      .locator('button:has-text("CLOSE")')
      .click();
    await shot(patient, "patient-call-ended");
  });

  // --- 7. status buttons (phase 9.4) --------------------------------------
  await check("doctor confirms; patient sees CONFIRMED", async () => {
    const card = doctor.locator("article").filter({ hasText: REASON_TEXT }).first();
    await card.locator('button:has-text("Confirm")').click();
    await waitFor(
      "doctor card shows confirmed",
      async () =>
        (await card.locator("span").filter({ hasText: /^confirmed$/ }).count()) > 0,
    );
    await patient.reload({ waitUntil: "domcontentloaded" });
    const pCard = patient.locator("article").filter({ hasText: REASON_TEXT }).first();
    await pCard.waitFor({ timeout: 15000 });
    await waitFor(
      "patient card shows confirmed",
      async () => (await pCard.getByText("confirmed", { exact: true }).count()) > 0,
    );
  });

  await check("doctor cancels; patient sees CANCELLED and no call button", async () => {
    const card = doctor.locator("article").filter({ hasText: REASON_TEXT }).first();
    await card.locator('button:has-text("Cancel")').click();
    await waitFor(
      "doctor card shows cancelled",
      async () =>
        (await card.locator("span").filter({ hasText: /^cancelled$/ }).count()) > 0,
    );
    await patient.reload({ waitUntil: "domcontentloaded" });
    const pCard = patient.locator("article").filter({ hasText: REASON_TEXT }).first();
    await pCard.waitFor({ timeout: 15000 });
    await waitFor(
      "patient card shows cancelled",
      async () => (await pCard.getByText("cancelled", { exact: true }).count()) > 0,
    );
    if (await pCard.locator('button:has-text("VIDEO CALL")').count()) {
      throw new Error("cancelled appointment should not offer a video call");
    }
    await shot(patient, "patient-appointment-cancelled");
  });
} catch (error) {
  failures.push(`harness: ${error.stack ?? error.message}`);
  console.error(error);
} finally {
  await browser.close();
}

console.log(`\nRESULT: ${passed} passed, ${failures.length} failed`);
if (consoleIssues.length > 0) {
  console.log(`\nBrowser errors captured (${consoleIssues.length}):`);
  for (const issue of consoleIssues.slice(0, 20)) console.log(`  - ${issue}`);
}
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Screenshots: ${ART}`);
}
