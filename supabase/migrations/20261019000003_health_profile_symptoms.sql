-- CarePoint: give the health profile somewhere to actually store symptoms.
--
-- The screen labels its first section "1. My symptoms" and its banner tells the
-- patient to "record your symptoms", but the table only carried medical history,
-- allergies, medications and the emergency contact — so there was nowhere to
-- write what the patient is feeling today. The column is nullable and its
-- length is capped in the app schema: an empty symptoms field must not stop a
-- patient saving their emergency contact.
--
-- RLS is untouched: health_profiles_select_own / _upsert_own / _update_own and
-- the doctor-select policy already scope rows by patient_id, so symptoms are
-- readable only by their owner and by a doctor who holds an appointment.

alter table public.health_profiles
  add column if not exists symptoms text;
