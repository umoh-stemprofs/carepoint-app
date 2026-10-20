-- ---------------------------------------------------------------------------
-- 20261019000009 — restore the patient-side doctor profile read policy
--
-- `profiles_patient_reads_doctors` was added to 20261019000000_initial_schema.sql
-- AFTER that migration had already been applied to the live project, and
-- Supabase runs each migration file exactly once — so the live database never
-- received it. Verified live on 2026-10-20: with the anon key, with a patient
-- JWT and through the doctors -> profiles embed, every doctor profile reads as
-- null/empty.
--
-- Without this policy the booking wizard, the appointments view and the
-- video-call header all show null doctor names for patients, because those
-- screens resolve the name through `doctors -> profiles(full_name)` under RLS.
--
-- Idempotent (drop then create, the convention used by every policy in this
-- project), so running it against a database that already has the policy is a
-- no-op.
-- ---------------------------------------------------------------------------

drop policy if exists profiles_patient_reads_doctors on public.profiles;
create policy profiles_patient_reads_doctors on public.profiles
  for select using (
    exists (
      select 1 from public.doctors d
      where d.id = profiles.id
    )
  );
