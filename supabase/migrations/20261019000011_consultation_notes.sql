-- CarePoint: the physician's consultation notes, taken while the call is live.
--
-- One row per appointment. The doctor types during the video call and the note
-- is saved straight to Supabase, so it is still there when they reopen the
-- appointment — no local state, no lost typing.
--
-- These are the clinician's own working notes: RLS lets only the doctor who
-- owns the appointment read or write them. The patient cannot see them, and no
-- other account can reach them. When a note should become part of the shared
-- record it belongs in health_records, not here.

create table if not exists public.consultation_notes (
  appointment_id uuid primary key references public.appointments (id) on delete cascade,
  doctor_id      uuid not null references public.doctors (id) on delete cascade,
  notes          text not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists consultation_notes_doctor_idx
  on public.consultation_notes (doctor_id, updated_at desc);

alter table public.consultation_notes enable row level security;

-- Read: only my own rows, and only for appointments I am the doctor on.
drop policy if exists consultation_notes_doctor_read on public.consultation_notes;
create policy consultation_notes_doctor_read on public.consultation_notes
  for select using (
    doctor_id = auth.uid()
    and exists (
      select 1 from public.appointments a
      where a.id = consultation_notes.appointment_id
        and a.doctor_id = auth.uid()
    )
  );

-- Create: a note may only be attached to my own appointment, under my id.
drop policy if exists consultation_notes_doctor_insert on public.consultation_notes;
create policy consultation_notes_doctor_insert on public.consultation_notes
  for insert with check (
    doctor_id = auth.uid()
    and exists (
      select 1 from public.appointments a
      where a.id = consultation_notes.appointment_id
        and a.doctor_id = auth.uid()
    )
  );

-- Update / delete: my rows only (the upsert the call room sends lands here).
drop policy if exists consultation_notes_doctor_update on public.consultation_notes;
create policy consultation_notes_doctor_update on public.consultation_notes
  for update using (doctor_id = auth.uid()) with check (doctor_id = auth.uid());

drop policy if exists consultation_notes_doctor_delete on public.consultation_notes;
create policy consultation_notes_doctor_delete on public.consultation_notes
  for delete using (doctor_id = auth.uid());

grant select, insert, update, delete on public.consultation_notes to authenticated;
