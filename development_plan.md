# DEVELOPMENT_PLAN.md

## Master Development & Architectural Plan

**Project Title:** **CarePoint — Accessible Telemedicine & AI CDSS** (`SEN_Coding_Health_TeamName_Telemedicine`)

**Target Kickoff / Submission Deadline:** October 13, 2026 (15 days prior to October 28, 2026 Kickoff)

**Submission Email:** `senior@stemfestival.org` | **Subject Line:** `SEN_Coding_Health_TeamName_Telemedicine`

**Target Audience / Persona:** Nigerian Patients (including low-literacy users and individuals with cognitive impairments / IQ < 60) and Attending Physicians.

---

## 1. Tech Stack & Architectural Overview

```
 ┌─────────────────────────────────────────────────────────────┐
 │           CarePoint Next.js 14 Full-Stack Architecture      │
 │ ┌───────────────────────────┬─────────────────────────────┐ │
 │ │ React Server Components   │ API Routes & Server Actions │ │
 │ │ (Ultra-Accessible UI)     │ (DeepSeek AI & Security)    │ │
 │ └─────────────┬─────────────┴──────────────┬──────────────┘ │
 └───────────────┼────────────────────────────┼────────────────┘
                 │                            │
   ┌─────────────▼─────────────┐ ┌────────────▼─────────────┐
   │ Zustand State Management  │ │   Supabase Backend       │
   │ & SWR Polling Fallback    │ │   - PostgreSQL DB        │
   │ (Offline Read-Only Engine)│ │   - Auth & Storage RLS   │
   └───────────────────────────┘ └──────────────────────────┘

```

* **Frontend Framework:** Next.js 14+ (React 18, App Router, TypeScript 5.x)
* **Styling & Design System:** Tailwind CSS v3.4+ with custom high-contrast theme, Lucide React Icons, and Speech Synthesis Web API hooks.
* **Backend Runtime:** Next.js Server Actions & API Route Handlers (Node.js runtime).
* **Database & BaaS:** Supabase PostgreSQL with `pgcrypto` extension, Realtime Subscriptions, and Row Level Security (RLS).
* **AI Engine:** DeepSeek API (`deepseek-chat` / `deepseek-reasoner`) via secure Next.js API Routes for Doctor-side Clinical Decision Support System (CDSS).
* **State Management & Caching:** Zustand (client UI state & offline cache) + SWR (stale-while-revalidate data fetching & WebSocket fallback polling).
* **Generative UI Tooling:** Google Stitch (`stitch.withgoogle.com`) for ultra-accessible UI mockup and layout synthesis.

### Ultra-Accessible Design System Specifications (Target Audience: IQ < 60 / Low Literacy)

To serve users with cognitive difficulties, low digital literacy, or visual impairments, CarePoint's frontend adheres to strict cognitive accessibility rules:

* **Typography:** Minimum body text 20px, header text 28px–36px. High-readability sans-serif font (`Lexend` / `Inter`).
* **Button Target Dimensions:** Minimum **64px height** with full-width horizontal tap targets.
* **Color Palette (Ultra-High Contrast):**
* Primary Action / Confirm: Green (`#10B981` / Tailwind `emerald-600`)
* Secondary / Navigation: Blue (`#3B82F6` / Tailwind `blue-600`)
* Emergency Call / Alert: Bright Red (`#EF4444` / Tailwind `red-600`)
* Background: Clean White (`#FFFFFF`) / Soft Off-White (`#F8FAFC`)
* Text Contrast Ratio: Exceeds **WCAG AAA standard (7:1)**.


* **Navigation Principles:** Zero dropdown lists, zero nested accordions, zero multi-select boxes. Every action uses large step-by-step visual cards with paired iconography and voice text-to-speech audio readout support.

---

## 2. Key Architectural Decisions (D1 – D11)

### D1: Single Source of Truth & Role-Based Access Control (RBAC)

* **Decision:** Supabase Auth is the Single Source of Truth (SSOT). User roles (`patient` vs `doctor`) are stored in `auth.users.user_metadata` and mirrored in the `public.profiles` database table. Next.js middleware enforces strict route protection: `/patient/*` routes redirect unauthenticated users or doctor accounts, and `/doctor/*` routes redirect patient accounts.

### D2: Atomic Concurrency-Safe Anti-Double-Booking Lock

* **Decision:** Anti-double-booking is enforced at the PostgreSQL engine level via two complementary mechanisms:
1. A strict database composite unique constraint: `ALTER TABLE appointments ADD CONSTRAINT prevent_double_booking UNIQUE (doctor_id, appointment_date, slot_time);`
2. Booking operations execute through an atomic Supabase RPC function (`book_appointment_atomic`) using `SELECT ... FOR UPDATE` locking. If a race condition occurs, PostgreSQL rejects the second operation with a `23505` constraint violation code, triggering a clean `409 Conflict` response to the client.



### D3: Hybrid Selective Field Encryption Strategy

* **Decision:** Encrypting entire patient records client-side renders database search and SQL index lookup impossible. We implement **Selective Encryption**:
* **Plaintext / Indexed Fields:** Metadata required for querying (e.g., `appointment_date`, `doctor_id`, `status`, `symptom_category_tags`) is stored as plaintext/enums for SQL indexing and doctor dashboard filters.
* **Encrypted Sensitive Payload:** Raw confidential notes, detailed medical history, and uploaded attachment URLs are encrypted before database insertion using Supabase `pgcrypto` functions (`pgp_sym_encrypt`) or client-side AES-256-GCM. A secure backend API route decrypts notes only when requested by an authorized, authenticated treating doctor (`auth.uid() = assigned_doctor_id`).



### D4: Offline Read-Only Mock Engine Fallback

* **Decision:** Offline local storage synchronization can corrupt database state if stale offline edits push to production. When network connectivity drops or the Supabase endpoint is unreachable, CarePoint falls back to a **Read-Only Local Engine**:
* Users can view cached appointments and local profile data.
* Mutation actions (e.g., "Book Slot", "Update Profile") are disabled with a prominent visual banner: *"You are offline. Reconnect to book."*
* No conflicting offline write queues are sent upon reconnection; the backend database remains the absolute authority.



### D5: Network Resilience & WebSocket Fallback Polling

* **Decision:** Unstable mobile internet (2G/3G/4G in regional West Africa) often drops WebSocket connections silently. The real-time notification layer uses SWR with dual synchronization:
1. Primary: Supabase Realtime WebSocket subscription for live updates.
2. Fallback: SWR periodic polling every 15 seconds if the WebSocket heartbeat fails.



### D6: ISO-8601 UTC Storage & Fixed WAT Timezone Lock

* **Decision:** All timestamps are saved in PostgreSQL as `TIMESTAMPTZ` normalized to UTC. Client display logic uses `date-fns-tz` locked explicitly to West Africa Time (`Africa/Lagos` / WAT / UTC+1). This prevents timezone offset shifting when doctors or patients access the app from devices set to different system clocks.

### D7: Multi-Layer Storage Security & MIME Validation

* **Decision:** Patient attachment uploads (symptom photos, paper record photos, lab PDFs) enforce strict client and server validation:
* Maximum file size: **5 MB**.
* Allowed MIME types: `image/jpeg`, `image/png`, `application/pdf`.
* Uploads go to a private Supabase Storage bucket (`patient-medical-docs`).
* Access is secured using Supabase Storage RLS policies where `(bucket_id = 'patient-medical-docs' AND auth.uid()::text = (storage.foldername(name))[1])`. Files are rendered in the UI exclusively via short-lived Signed URLs (15-minute expiration).



### D8: Ultra-Accessible Visual Step-Wizard Architecture

* **Decision:** Patient-facing flows bypass standard complex form elements. Booking uses a 3-step visual wizard with giant cards, visual sun/moon icons for time of day, color-coded badges, and voice synthesis support (Web Speech API) so illiterate users can listen to screen contents.

### D9: In-App & Simulated Email Notification Pipeline

* **Decision:** Confirmations trigger dual outputs:
1. Real-time PostgreSQL database insertion into `public.notifications` (visible in UI badge).
2. Email simulation log printed to server console and captured in `public.email_logs` for evaluation during competition judging.



### D10: Non-Emergency Triage Disclaimer Protocol

* **Decision:** A mandatory, persistent non-emergency safety bar appears across all patient screens: *"For severe chest pain, major bleeding, or life-threatening emergencies, call 112 immediately."* A giant red "Emergency Call 112" button initiates a direct phone dialer (`tel:112`).

### D11: DeepSeek AI Clinical Decision Support System (CDSS) & Anonymization Protocol

* **Decision:** CarePoint integrates a doctor-facing AI diagnostic copilot powered by DeepSeek API:
* **Doctor-Only Access:** The AI diagnostic interface is strictly restricted to authenticated physician accounts on the `/doctor/dashboard` route. Patients never interact with the raw AI model.
* **Strict PII Anonymization:** Before sending symptom data to DeepSeek, a backend pipeline strips all Personally Identifiable Information (names, phone numbers, addresses, exact IDs). Only clinical variables (Age, Gender, Vitals, Duration, Symptoms) are transmitted.
* **Structured Differential Output:** DeepSeek is prompted to act as a Clinical Decision Support Assistant, returning a JSON schema containing:
1. Top 3 probable differential diagnoses.
2. Recommended confirmatory diagnostic/laboratory tests (e.g., Rapid Diagnostic Test for Malaria, Full Blood Count).
3. Clinical "Red Flag" warning symptoms to monitor.


* **Human-in-the-Loop & Rate Limiting:** All AI outputs feature a persistent warning badge (*"AI Clinical Assistance Only — Decision rests with attending doctor"*). Server-side rate limiting prevents API key exhaustion (max 20 diagnostic queries/doctor/day).



---

## 3. Google Stitch Design System & Prompts

Use the following exact prompts inside **Google Stitch** (`stitch.withgoogle.com`) to generate responsive layouts that match CarePoint's ultra-accessibility requirements.

### Prompt A: Super-Simple Patient Landing Screen

> **Stitch Prompt:**
> "Design an ultra-simple, high-accessibility mobile screen for CarePoint, a non-literate telemedicine app. Background is bright white (#FFFFFF). Include a large header at the top with a green shield icon and text reading 'CarePoint — See A Doctor'. The main screen body has only TWO massive, colorful visual card buttons stacked vertically:
> 1. A green card (#10B981) with a large icon of a doctor with a stethoscope, displaying text in massive bold font: 'BOOK DOCTOR NOW'.
> 2. A blue card (#3B82F6) with a large icon of a calendar with a green checkmark, displaying text: 'MY APPOINTMENTS'.
> Place a persistent red emergency button at the very bottom with a phone icon: 'Emergency? Call 112'. High contrast, 64px button heights, zero clutter, no text smaller than 20px, highly intuitive for users with cognitive impairments."
> 
> 

### Prompt B: Visual Step 1 – Doctor & Date Selector

> **Stitch Prompt:**
> "Design an extremely simple visual screen titled 'Step 1: Choose Your Doctor'. Show 2 large doctor cards. Each card contains a clear circular profile photo, doctor name in bold 22px text (e.g. 'Dr. Sarah'), a green dot indicating 'Available', and a giant green button saying 'SELECT'. Below the cards, show 3 large horizontal calendar tiles for days: 'TODAY' (with a bright sun icon), 'TOMORROW', and 'NEXT DAY'. Selecting a tile lights it up in bright blue with a thick border. Keep the UI ultra-clean, minimal text, giant touch targets, high contrast."

### Prompt C: Visual Step 2 – Time Slot Grid

> **Stitch Prompt:**
> "Design a visual time selection screen titled 'Step 2: Pick Time'. Display 4 large grid cards representing time of day:
> 1. 'MORNING' card with a bright yellow sun icon and time text '9:00 AM'.
> 2. 'MIDDAY' card with a full sun icon and text '12:00 PM'.
> 3. 'AFTERNOON' card with a setting sun icon and text '3:00 PM'.
> 4. 'EVENING' card with a moon icon and text '5:00 PM'.
> Below the grid, show a giant bottom action bar with a green button: 'CONFIRM & BOOK'. Ensure all cards have thick borders, high-contrast text, and zero complex inputs."
> 
> 

### Prompt D: Visual Booking Confirmation & Pass

> **Stitch Prompt:**
> "Design a confirmation screen for a successfully booked doctor appointment on CarePoint. Display a giant green circle with a white checkmark at the top. Below, present a clean ticket-style card with a thick border showing: Doctor's photo and name ('Dr. Sarah'), Date ('Today'), Time ('9:00 AM'), and a simplified visual status badge ('CONFIRMED'). Add two big action buttons: A giant blue button with a speaker icon reading 'READ OUT LOUD' (for voice assistance) and a grey button reading 'BACK TO HOME'. Extremely accessible, high contrast, bold visual typography."

---

## 4. Phased Execution Roadmap

### Phase 01: UI/UX & High-Accessibility Design Tokens

**Phase Goal:** Establish accessibility-first design system tokens, Google Stitch component templates, CarePoint branding, and asset guidelines.

* [ ] **1.1** Define Tailwind CSS extensions in `tailwind.config.ts` for high-contrast color tokens (`emerald-600`, `blue-600`, `red-600`, `slate-900`) and custom target heights (`h-16` / `64px`).
* [ ] **1.2** Export and organize static visual assets in `/public/assets/icons/` (Doctor, Calendar, Sun, Moon, Checkmark, Shield, Emergency Phone, CarePoint Logo).
* [ ] **1.3** Implement Web Speech API wrapper in `lib/utils/speech.ts` to support voice audio readout for on-screen text labels.
* [ ] **1.4** Create accessible visual button component (`components/ui/AccessibleButton.tsx`) enforcing 64px height, high-contrast state styling, and large icon layout.

**Phase Verification Gate:**

* `npm run build` succeeds without CSS or TypeScript errors.
* Visual review confirms all primary touch targets measure $\ge 64\text{px}$ in height and pass WCAG AAA contrast ratio checks.

---

### Phase 02: Project Foundation & Environment Setup

**Phase Goal:** Construct the Next.js 14 App Router project skeleton, core directories, environment configuration, and root layout shell.

* [ ] **2.1** Initialize Next.js 14 App Router project with TypeScript, Tailwind CSS, and ESLint.
* [ ] **2.2** Configure `.env.local` and `.env.example` with Supabase keys (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) and DeepSeek API configuration (`DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL_NAME=deepseek-chat`).
* [ ] **2.3** Create initial project folder architecture:
* `/app/(auth)` - Login & Registration routes
* `/app/(patient)` - Patient dashboard & booking wizard
* `/app/(doctor)` - Doctor schedule, intake dashboard & DeepSeek AI CDSS
* `/app/api` - Next.js API route handlers (Auth, Appointments, DeepSeek AI)
* `/components/patient` & `/components/doctor` - Domain-specific UI
* `/lib/supabase` - Client and server database initialization helpers
* `/lib/types` - Domain TypeScript interfaces


* [ ] **2.4** Build `app/layout.tsx` shell containing CarePoint branding and the persistent Non-Emergency Disclaimer Bar (`components/common/EmergencyBanner.tsx`).

**Phase Verification Gate:**

* `npm run dev` boots cleanly on `http://localhost:3000`.
* Root shell displays persistent emergency disclaimer bar across all viewports.

---

### Phase 03: Data Layer & Core Models

**Phase Goal:** Define pure TypeScript domain models, DeepSeek AI prompt schemas, ISO-8601 WAT date helper utilities, validation schemas, and JSON serialization.

* [ ] **3.1** Create core entity interfaces in `lib/types/database.ts` (`UserProfile`, `DoctorAvailability`, `Appointment`, `MedicalHistory`, `NotificationLog`, `AIConsultationLog`).
* [ ] **3.2** Create Zod validation schemas in `lib/validations/appointment.ts`, `lib/validations/auth.ts`, and `lib/validations/aiDiagnostic.ts`.
* [ ] **3.3** Implement date/time helper utilities in `lib/utils/datetime.ts` using `date-fns-tz` to lock date operations to UTC storage and `Africa/Lagos` display.
* [ ] **3.4** Write unit tests in `__tests__/datetime.test.ts` to verify timezone conversion correctness across UTC and WAT boundaries.

**Phase Verification Gate:**

* `npm test` passes all timezone and Zod validation schema tests with 100% coverage.

---

### Phase 04: Local Caching & Offline Read-Only Mock Engine

**Phase Goal:** Create a local mock data provider and Zustand caching store with a strict read-only offline fallback mechanism (including offline rule-based diagnostic guidance).

* [ ] **4.1** Populate static development fallback dataset in `lib/mock/seedData.ts` (CarePoint doctors, available slots, sample appointments, offline diagnostic rules for local conditions like Malaria/Typhoid).
* [ ] **4.2** Create Zustand global offline store (`lib/store/useOfflineStore.ts`) tracking network state (`isOnline`) via browser `online`/`offline` window events.
* [ ] **4.3** Implement Read-Only Mock Engine (`lib/services/mockEngine.ts`) that serves cached seed data when `isOnline === false`.
* [ ] **4.4** Add visual offline warning header (`components/common/OfflineBadge.tsx`) that activates when offline and disables mutation buttons.

**Phase Verification Gate:**

* Toggling browser DevTools to "Offline" disables booking submit actions and displays the offline badge while retaining read access to cached mock listings.

---

### Phase 05: Database Schema, Anti-Double-Booking Locking & Security RLS

**Phase Goal:** Provision Supabase PostgreSQL schema, database migration scripts, anti-double-booking constraints, DeepSeek consultation audit tables, and RLS security policies.

* [ ] **5.1** Write initial SQL migration (`supabase/migrations/01_schema.sql`) creating `profiles`, `doctor_schedules`, `appointments`, `medical_profiles`, and `ai_consultations` tables.
* [ ] **5.2** Execute SQL constraint in migration:
`ALTER TABLE appointments ADD CONSTRAINT prevent_double_booking UNIQUE (doctor_id, appointment_date, slot_time);`
* [ ] **5.3** Create atomic stored procedure `book_appointment_atomic` (`supabase/migrations/02_rpc.sql`) implementing row locking (`SELECT ... FOR UPDATE`) and conflict detection.
* [ ] **5.4** Enable Supabase Row Level Security (RLS) policies (`supabase/migrations/03_rls.sql`) restricting profile and medical history access strictly to record owners and assigned doctors.
* [ ] **5.5** Configure `pgcrypto` functions for encrypting confidential symptom text before persistence.

**Phase Verification Gate:**

* Execute SQL migration suite against Supabase instance without errors.
* Manual execution of two concurrent RPC booking calls for the same doctor/time slot in Supabase SQL editor yields exactly one success and one constraint violation (`23505`).

---

### Phase 06: Auth System & Role-Based Access Control (RBAC)

**Phase Goal:** Implement registration, login, session persistence, and middleware-based role routing for doctors and patients.

* [ ] **6.1** Build simple, high-contrast login screen (`app/(auth)/login/page.tsx`) with clear toggle for "I am a Patient" vs "I am a Doctor".
* [ ] **6.2** Create Supabase Auth helpers (`lib/supabase/client.ts` and `lib/supabase/server.ts`).
* [ ] **6.3** Implement Next.js Middleware (`middleware.ts`) enforcing role-based route access (`/patient/*` vs `/doctor/*`).
* [ ] **6.4** Build high-accessibility registration flow (`app/(auth)/register/page.tsx`) capturing basic user profile details.

**Phase Verification Gate:**

* Logging in as a Doctor account blocks access to `/patient/book` and redirects to `/doctor/dashboard`.
* Logging in as a Patient account blocks access to `/doctor/schedule` and redirects to `/patient/dashboard`.

---

### Phase 07: Patient Scheduling & Ultra-Accessible Wizard Flow

**Phase Goal:** Deliver the 3-step simplified booking wizard for patients with giant visual cards, time-of-day slots, and audio readout support.

* [ ] **7.1** Build Patient Main Landing Page (`app/(patient)/dashboard/page.tsx`) using Google Stitch Prompt A design pattern (Giant "Book Doctor", "My Appointments", "Emergency Call 112").
* [ ] **7.2** Implement Step 1 Screen (`app/(patient)/book/step-1/page.tsx`) displaying doctor cards and 3 visual day tiles ("Today", "Tomorrow", "Next Day").
* [ ] **7.3** Implement Step 2 Screen (`app/(patient)/book/step-2/page.tsx`) displaying 4 large time-of-day cards (Morning 9:00 AM, Midday 12:00 PM, Afternoon 3:00 PM, Evening 5:00 PM).
* [ ] **7.4** Integrate atomic RPC call (`book_appointment_atomic`) on Step 3 confirmation submit.
* [ ] **7.5** Build Confirmation Screen (`app/(patient)/book/confirmation/page.tsx`) presenting the booked ticket pass and "Read Out Loud" audio button.

**Phase Verification Gate:**

* Complete end-to-end booking flow as a patient in under 4 taps.
* Verify double-booking attempt displays user-friendly conflict alert without crashing UI.

---

### Phase 08: Patient Digital Health Profile & Secure Document Upload

**Phase Goal:** Enable patients to manage symptom history, upload attachments securely (photos/lab PDFs), and store selectively encrypted medical notes.

* [ ] **8.1** Create Digital Health Profile Page (`app/(patient)/profile/page.tsx`).
* [ ] **8.2** Construct Secure File Uploader (`components/patient/DocumentUploader.tsx`) enforcing 5MB limit and MIME-type restrictions (`jpeg`, `png`, `pdf`).
* [ ] **8.3** Integrate encrypted backend endpoint (`app/api/patient/medical-history/route.ts`) storing confidential symptoms via `pgcrypto` while retaining plaintext category tags.
* [ ] **8.4** Implement document preview renderer using Supabase Storage signed URLs.

**Phase Verification Gate:**

* Patient can upload a valid JPG/PDF file under 5MB.
* Attempting to upload a 10MB file or `.exe` script triggers a clear validation error.
* Direct query on `medical_profiles` table in Supabase dashboard confirms raw symptom body is stored as encrypted ciphertext.

---

### Phase 09: Doctor Dashboard & Schedule Management Engine

**Phase Goal:** Provide doctors with availability controls, appointment queue dashboards, and decrypted patient history viewers.

* [ ] **9.1** Build Doctor Dashboard Home (`app/(doctor)/dashboard/page.tsx`) listing upcoming scheduled appointments sorted chronologically.
* [ ] **9.2** Construct Availability Setter Component (`components/doctor/ScheduleManager.tsx`) allowing doctors to toggle open/closed booking slots.
* [ ] **9.3** Build Patient Medical History Inspector Modal (`components/doctor/PatientProfileModal.tsx`) that invokes authorized decryption endpoint to display patient symptoms and signed document URLs.
* [ ] **9.4** Implement appointment status updater (Confirm, Complete, Cancel).

**Phase Verification Gate:**

* Doctor updating schedule availability immediately reflects updated slot options on patient booking wizard.
* Doctor viewing patient details successfully decrypts and displays symptom text.

---

### Phase 10: DeepSeek AI Clinical Decision Support System (CDSS) Integration

**Phase Goal:** Implement doctor-side AI diagnostic copilot powered by DeepSeek API with PII sanitization, structured output, and rate limiting.

* [ ] **10.1** Build PII anonymization helper (`lib/utils/sanitizer.ts`) to strip patient names, phone numbers, and addresses from symptom inputs.
* [ ] **10.2** Construct secure backend route (`app/api/doctor/ai-diagnose/route.ts`) enforcing doctor-only session authentication and rate-limiting (max 20 requests/doctor/day).
* [ ] **10.3** Configure DeepSeek prompt template instructing the model to act as a CDSS and return structured JSON containing top 3 differential diagnoses, recommended lab tests, and red-flag symptoms.
* [ ] **10.4** Build Doctor AI Assistant UI drawer/modal (`components/doctor/AIDiagnosticModal.tsx`) featuring streaming typewriter response effect, one-click symptom populator, and mandatory clinical disclaimer banner.
* [ ] **10.5** Save AI consultation outputs to `ai_consultations` table for auditability and technical report documentation.

**Phase Verification Gate:**

* Authenticated doctor clicking "AI Diagnostic Assistance" receives structured differential diagnoses within 3 seconds.
* Patient PII is confirmed stripped in API payload logs.
* Unauthenticated or patient accounts attempting to call `/api/doctor/ai-diagnose` receive `403 Forbidden`.

---

### Phase 11: Email Simulation & Realtime Notification Engine

**Phase Goal:** Deliver automatic confirmational feedback via in-app real-time toasts and simulated email logs.

* [ ] **11.1** Create Notification Listener component (`components/common/NotificationListener.tsx`) connecting to Supabase Realtime channel `public:notifications`.
* [ ] **11.2** Build simulated email logger service (`lib/services/emailSimulator.ts`) printing formatted email logs to server console and saving records to `public.email_logs`.
* [ ] **11.3** Trigger notification dispatch automatically upon successful booking execution in `book_appointment_atomic` database procedure.
* [ ] **11.4** Build visual Notification Inbox dropdown in app header (`components/common/NotificationBell.tsx`).

**Phase Verification Gate:**

* Booking an appointment immediately triggers an in-app toast notification on both patient and doctor screens and appends an entry to `public.email_logs`.

---

### Phase 12: End-to-End Integration, Stress Testing & Optimization

**Phase Goal:** Perform system-wide verification across network drop scenarios, concurrent booking collisions, and accessibility audits.

* [ ] **12.1** Run automated concurrency test script (`scripts/test-concurrency.ts`) executing 20 simultaneous booking requests against a single time slot to guarantee anti-double-booking enforcement.
* [ ] **12.2** Perform network throttling tests (Simulated 2G/3G in Lighthouse/DevTools) verifying SWR fallback polling functionality.
* [ ] **12.3** Audit application accessibility using AXE DevTools to verify WCAG AAA compliance and screen-reader tree compatibility.
* [ ] **12.4** Execute full build (`npm run build`) and clean production start (`npm run start`).

**Phase Verification Gate:**

* Script confirms exactly 1 successful booking out of 20 concurrent requests without database deadlocks.
* Zero build errors, zero TypeScript warnings, zero accessibility violations.

---

### Phase 13: Deployment, Demonstration Video & Competition Handover

**Phase Goal:** Deploy functional CarePoint platform to Vercel, record demonstration video highlighting DeepSeek AI integration, finalize 4–8 page written technical report, and submit project artifacts before deadline.

* [ ] **13.1** Deploy Next.js full-stack application to **Vercel** and attach production Supabase and DeepSeek environment keys.
* [ ] **13.2** Verify live domain (`[https://carepoint-telemed.vercel.app](https://carepoint-telemed.vercel.app)`) accessibility and database connectivity.
* [ ] **13.3** Record 5–7 minute video demonstration showing:
1. Patient initiating booking via simplified wizard UI.
2. Double-booking prevention in action.
3. Patient uploading encrypted health history and medical documents.
4. Doctor receiving real-time notification, inspecting decrypted patient record, and launching the DeepSeek AI CDSS copilot.


* [ ] **13.4** Compile 4–8 page Written Technical Report covering CarePoint Architecture, Database Entity-Relationship Model, Anti-Double-Booking Logic, DeepSeek AI CDSS Integration, and Medical Data Privacy Discussion.
* [ ] **13.5** Submit email to `senior@stemfestival.org` with Subject Line: `SEN_Coding_Health_TeamName_Telemedicine` prior to October 13, 2026.

**Phase Verification Gate:**

* Live Vercel deployment link confirmed functional.
* Technical report PDF, demo video link, and public GitHub repository ready for submission.

---

## 5. AI Agent Execution Directives & Copy-Paste Prompts

When instructing your developer AI agent to write code phase by phase, copy and paste these exact directives. Do NOT allow the agent to execute multiple phases simultaneously.

### Prompt for Phase 01: Design Tokens & Accessibility

> "Act as a Senior Frontend Architect. Execute Phase 01 of DEVELOPMENT_PLAN.md for CarePoint. Configure `tailwind.config.ts` with custom color tokens (`emerald-600`, `blue-600`, `red-600`), and enforce minimum 64px (`h-16`) touch heights. Create the Web Speech API helper `lib/utils/speech.ts` for text-to-speech reading, and build `components/ui/AccessibleButton.tsx` with high-contrast states and WCAG AAA compliance. Do not generate code for future phases yet."

### Prompt for Phase 02: Foundation & Skeleton Setup

> "Act as a Full-Stack Engineer. Execute Phase 02 of DEVELOPMENT_PLAN.md. Initialize the Next.js 14 App Router layout shell, set up `.env.local` variables for Supabase and DeepSeek API (`DEEPSEEK_API_KEY`), build the core project folder structure, and implement the persistent Non-Emergency Disclaimer Banner in `app/layout.tsx` linking to `tel:112`. Verify `npm run dev` boots cleanly."

### Prompt for Phase 03: Data Layer & Types

> "Act as a Lead Backend Developer. Execute Phase 03 of DEVELOPMENT_PLAN.md. Create TypeScript interfaces in `lib/types/database.ts` for Profiles, Appointments, MedicalHistory, and AIConsultationLog. Implement Zod validation schemas for booking and AI requests. Create `lib/utils/datetime.ts` using `date-fns-tz` locked to UTC storage and WAT (`Africa/Lagos`) display, and write unit tests in `__tests__/datetime.test.ts`."

### Prompt for Phase 04: Offline Read-Only Mock Engine

> "Act as a Frontend Engineer. Execute Phase 04 of DEVELOPMENT_PLAN.md. Populate static fallback data in `lib/mock/seedData.ts`. Create the Zustand global offline store `lib/store/useOfflineStore.ts` tracking `isOnline` state via browser events, implement `lib/services/mockEngine.ts` for read-only offline fallback, and create `components/common/OfflineBadge.tsx` that locks write actions when offline."

### Prompt for Phase 05: Database Schema, RPC & Security RLS

> "Act as a Principal Database Engineer. Execute Phase 05 of DEVELOPMENT_PLAN.md. Write SQL migration files in `supabase/migrations/`: `01_schema.sql` (Tables), `02_rpc.sql` (Anti-double-booking atomic stored procedure `book_appointment_atomic` with `SELECT ... FOR UPDATE` locking), and `03_rls.sql` (Row Level Security policies). Add `pgcrypto` column encryption functions for patient notes. Ensure `UNIQUE(doctor_id, appointment_date, slot_time)` constraint is applied."

### Prompt for Phase 06: Auth System & Middleware RBAC

> "Act as a Security Specialist. Execute Phase 06 of DEVELOPMENT_PLAN.md. Set up Supabase Auth helpers in `lib/supabase/client.ts` and `server.ts`. Implement `middleware.ts` to enforce RBAC routing: redirecting doctors away from `/patient/*` routes and patients away from `/doctor/*` routes. Create simplified high-contrast login and registration pages."

### Prompt for Phase 07: Simplified Patient Booking Wizard

> "Act as an Accessibility UI Specialist. Execute Phase 07 of DEVELOPMENT_PLAN.md. Build the 3-step visual booking wizard for patients using giant visual cards (Google Stitch Prompts A–D). Step 1: Doctor selection & day tiles. Step 2: Time-of-day cards (Morning, Midday, Afternoon, Evening). Step 3: Atomic booking trigger via `book_appointment_atomic` RPC call and pass confirmation ticket with Text-To-Speech audio readout support."

### Prompt for Phase 08: Patient Digital Health Profile & Secure File Uploads

> "Act as a Full-Stack Security Engineer. Execute Phase 08 of DEVELOPMENT_PLAN.md. Build the patient profile page and file uploader supporting JPG, PNG, and PDF medical attachments up to 5MB. Connect to private Supabase Storage bucket `patient-medical-docs` with RLS. Integrate selective field encryption for confidential symptom notes using `pgcrypto` via `/api/patient/medical-history`."

### Prompt for Phase 09: Doctor Dashboard & Intake Management

> "Act as a Full-Stack Developer. Execute Phase 09 of DEVELOPMENT_PLAN.md. Build the doctor dashboard (`app/(doctor)/dashboard/page.tsx`) showing chronological appointment queues and availability toggles. Build the patient history modal that decrypts encrypted symptom notes and renders temporary 15-minute signed URLs for uploaded medical documents."

### Prompt for Phase 10: DeepSeek AI Clinical Decision Support System (CDSS)

> "Act as an AI Integration Specialist. Execute Phase 10 of DEVELOPMENT_PLAN.md. Build `lib/utils/sanitizer.ts` to strip PII (names, phone numbers, addresses) from medical text. Create `/api/doctor/ai-diagnose` API route restricted to authenticated doctors with rate-limiting (20 req/day). Configure DeepSeek prompt returning structured JSON (top 3 differential diagnoses, recommended lab tests, red-flag symptoms). Build the doctor AI copilot UI drawer with a clinical disclaimer banner."

### Prompt for Phase 11: Email Simulation & Realtime Notifications

> "Act as a Systems Engineer. Execute Phase 11 of DEVELOPMENT_PLAN.md. Create the Supabase Realtime listener `components/common/NotificationListener.tsx` for real-time toast alerts. Implement `lib/services/emailSimulator.ts` logging formatted emails to server console and `public.email_logs`. Trigger notification dispatch inside the booking RPC flow."

### Prompt for Phase 12: End-to-End Stress Testing & Audit

> "Act as a QA & Performance Engineer. Execute Phase 12 of DEVELOPMENT_PLAN.md. Create automated concurrency script `scripts/test-concurrency.ts` firing 20 parallel booking requests to verify anti-double-booking locks. Conduct AXE accessibility checks for WCAG AAA compliance and test SWR fallback polling under simulated offline network conditions."

### Prompt for Phase 13: Deployment & Competition Handover

> "Act as a Technical Project Manager. Execute Phase 13 of DEVELOPMENT_PLAN.md. Prepare Vercel production deployment configuration, verify live endpoints, generate submission video script outlining patient booking, anti-double-booking locking, file uploads, and doctor DeepSeek AI CDSS, and compile the final written technical report outline."

---

## 6. Comprehensive Technical Audit Matrix & Failure Mitigation Protocols

| Failure Point / Security Risk | System Layer | Potential Impact | Severity (1-10) | Mitigation Strategy in CarePoint Architecture |
| --- | --- | --- | --- | --- |
| **1. DeepSeek API Key Exposure & Unrestricted Endpoint Usage** | AI / Backend API | If `DEEPSEEK_API_KEY` is leaked to the client or if the API endpoint is left public, unauthorized users could exhaust API quotas or cause financial overspend. | **8 / 10** | **Enforced in D11 & Phase 10.2:** API key stored strictly in server-side `.env.local` (no `NEXT_PUBLIC_` prefix). Endpoint `/api/doctor/ai-diagnose` enforces session auth and verifies `role === 'doctor'`. Server-side rate-limiting restricts usage to max 20 queries/doctor/day. |
| **2. Patient PII Leakage to External AI Provider** | Medical Privacy / AI Layer | Sending un-sanitized patient notes (names, phone numbers, addresses) to an external LLM violates medical data privacy standards (NDPR / HIPAA). | **8 / 10** | **Enforced in D11 & Phase 10.1:** Strict PII sanitization middleware (`lib/utils/sanitizer.ts`) strips names, phone numbers, and location identifiers via regex and entity parsing prior to API dispatch. Only clinical parameters (age, gender, duration, symptoms) are transmitted. |
| **3. Client-Side AES-256 Encryption Breaking Database Search & Indexing** | Security / Data Layer | Encrypting all patient notes client-side prevents Supabase/PostgreSQL from indexing or searching records on doctor dashboards. | **8 / 10** | **Enforced in D3 & Phase 5.5:** Selective Field Encryption: Metadata (`appointment_date`, `doctor_id`, `symptom_tags`) remains plaintext for indexing, while raw sensitive narrative bodies are encrypted via `pgcrypto` or AES-256. |
| **4. Concurrency Double-Booking Race Conditions** | Backend / Scheduling Logic | Simultaneous bookings by two patients for the same slot can produce duplicate database records if checked only on the frontend. | **8 / 10** | **Enforced in D2 & Phase 5.2–5.3:** Database-level uniqueness constraint (`prevent_double_booking`) paired with atomic Supabase RPC function (`book_appointment_atomic`) utilizing `SELECT ... FOR UPDATE` row locking. |
| **5. AI Hallucination or Inaccurate Clinical Suggestion** | Clinical Safety / Triage | DeepSeek generating an inaccurate diagnosis or medication recommendation could misinform care if treated as authoritative advice. | **7 / 10** | **Enforced in D11 & Phase 10.3–10.4:** Feature is restricted to the authenticated Doctor Dashboard only (Human-in-the-Loop). Output requires structured differential diagnoses (top 3) with recommended confirmatory lab tests and persistent UI warning disclaimer. |
| **6. Offline Synchronization Data Conflicts** | Local Caching / Mock Engine | Offline write queues attempting to push stale appointments upon network re-establishment can corrupt production database state. | **7 / 10** | **Enforced in D4 & Phase 4.3–4.4:** Read-Only Offline Engine: When disconnected, CarePoint locks mutation actions and displays an offline banner while serving cached read-only data and local diagnostic templates. |
| **7. DeepSeek API Latency / Timeout Overhead** | AI / Realtime UI | Slow AI response times (5–10s) could freeze the doctor UI or cause Next.js API gateway timeouts. | **6 / 10** | **Enforced in Phase 10.4:** Streaming SSE responses (`ReadableStream`) render typewriter text effect in real time, backed by a strict 10-second request timeout and graceful fallback to local diagnostic matrices. |
| **8. Unauthenticated File Upload Exploit (Symptom Attachments)** | Supabase Storage | Malicious file uploads or quota exhaustion through patient file inputs. | **5 / 10** | **Enforced in D7 & Phase 8.2:** Max file size capped at 5MB, MIME-type whitelist (`jpeg`, `png`, `pdf`), storage bucket isolated via RLS, and access served via 15-minute temporary signed URLs. |
| **9. Timezone Shift Between Doctor & Patient** | Scheduling Logic | Device clock discrepancies causing appointment misalignments. | **4 / 10** | **Enforced in D6 & Phase 3.3:** Database timestamps normalized to UTC (`TIMESTAMPTZ`), rendered on frontend using `date-fns-tz` locked to West Africa Time (`Africa/Lagos` / WAT / UTC+1). |