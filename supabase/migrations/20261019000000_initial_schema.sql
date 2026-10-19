-- CarePoint: initial schema, anti-double-booking RPC, and Row Level Security.
-- Target: Supabase PostgreSQL (plan Phase 05).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enum types
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type user_role as enum ('patient', 'doctor');
  end if;
  if not exists (select 1 from pg_type where typname = 'appointment_status') then
    create type appointment_status as enum ('pending', 'confirmed', 'completed', 'cancelled');
  end if;
  if not exists (select 1 from pg_type where typname = 'slot_period') then
    create type slot_period as enum ('morning', 'midday', 'afternoon', 'evening');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- profiles: single source of truth for identity, mirrored from auth.users
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  role        user_role not null default 'patient',
  full_name   text not null,
  phone_number text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists profiles_role_idx on public.profiles (role);

-- ---------------------------------------------------------------------------
-- doctors: one row per physician, keyed to their profile
-- ---------------------------------------------------------------------------

create table if not exists public.doctors (
  id                     uuid primary key references public.profiles (id) on delete cascade,
  specialty              text,
  license_number         text,
  is_accepting_bookings  boolean not null default true,
  created_at             timestamptz not null default now()
);

create index if not exists doctors_accepting_idx on public.doctors (is_accepting_bookings);

-- ---------------------------------------------------------------------------
-- appointments: scheduling core
-- ---------------------------------------------------------------------------

create table if not exists public.appointments (
  id               uuid primary key default gen_random_uuid(),
  patient_id       uuid not null references public.profiles (id) on delete cascade,
  doctor_id        uuid not null references public.doctors (id) on delete cascade,
  appointment_date date not null,
  start_time       timestamptz not null,
  end_time         timestamptz not null,
  slot_period      slot_period not null,
  reason_for_visit text not null,
  status           appointment_status not null default 'pending',
  created_at       timestamptz not null default now(),
  -- Hard backstop against two patients claiming an identical slot.
  constraint prevent_double_booking
    unique (doctor_id, appointment_date, start_time),
  constraint appointment_window_valid
    check (end_time > start_time)
);

create index if not exists appointments_patient_idx  on public.appointments (patient_id);
create index if not exists appointments_doctor_idx   on public.appointments (doctor_id, appointment_date);
create index if not exists appointments_schedule_idx  on public.appointments (doctor_id, start_time, end_time);
create index if not exists appointments_status_idx    on public.appointments (status);

-- ---------------------------------------------------------------------------
-- health_profiles: one medical record per patient
-- ---------------------------------------------------------------------------

create table if not exists public.health_profiles (
  id                      uuid primary key default gen_random_uuid(),
  patient_id              uuid not null unique references public.profiles (id) on delete cascade,
  medical_history         text,
  allergies               text,
  current_medications     text,
  emergency_contact_name  text,
  emergency_contact_phone text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- cdss_logs: audit trail for every DeepSeek clinical decision request
-- ---------------------------------------------------------------------------

create table if not exists public.cdss_logs (
  id               uuid primary key default gen_random_uuid(),
  doctor_id        uuid not null references public.doctors (id) on delete cascade,
  appointment_id   uuid references public.appointments (id) on delete set null,
  model            text not null,
  request_payload  jsonb not null default '{}'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);

create index if not exists cdss_logs_doctor_idx    on public.cdss_logs (doctor_id, created_at desc);
create index if not exists cdss_logs_appointment_idx on public.cdss_logs (appointment_id);

-- ---------------------------------------------------------------------------
-- Atomic anti-double-booking RPC
--
-- Serialises bookings per doctor with a row lock, then rejects any window that
-- overlaps an existing appointment. Overlap violations are raised with the
-- 23505 unique_violation SQLSTATE so the API layer can map them to HTTP 409.
-- ---------------------------------------------------------------------------

create or replace function public.book_appointment_prevent_overlap(
  p_patient_id       uuid,
  p_doctor_id        uuid,
  p_appointment_date date,
  p_start_time       timestamptz,
  p_end_time         timestamptz,
  p_slot_period      slot_period,
  p_reason_for_visit text
) returns public.appointments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_open     boolean;
  v_clash    public.appointments;
  v_booking  public.appointments;
begin
  if p_end_time <= p_start_time then
    raise exception 'end_time must be after start_time';
  end if;

  -- A patient may only book on their own behalf.
  if auth.uid() is distinct from p_patient_id then
    raise exception 'patients may only book for themselves';
  end if;

  -- Serialize every concurrent booking attempt for this doctor.
  select is_accepting_bookings
    into v_open
    from public.doctors
   where id = p_doctor_id
     for update;

  if not found then
    raise exception 'doctor % not found', p_doctor_id;
  end if;

  if v_open is not true then
    raise exception 'doctor % is not accepting bookings', p_doctor_id;
  end if;

  -- Reject any overlapping window (start < other_end and end > other_start).
  select *
    into v_clash
    from public.appointments
   where doctor_id = p_doctor_id
     and status <> 'cancelled'
     and start_time < p_end_time
     and end_time   > p_start_time
   limit 1;

  if found then
    raise exception 'slot already booked'
      using errcode = '23505';
  end if;

  insert into public.appointments
    (patient_id, doctor_id, appointment_date, start_time, end_time, slot_period, reason_for_visit)
  values
    (p_patient_id, p_doctor_id, p_appointment_date, p_start_time, p_end_time, p_slot_period, p_reason_for_visit)
  returning * into v_booking;

  return v_booking;
end;
$$;

revoke all on function public.book_appointment_prevent_overlap(uuid, uuid, date, timestamptz, timestamptz, slot_period, text) from public, anon;
grant execute on function public.book_appointment_prevent_overlap(uuid, uuid, date, timestamptz, timestamptz, slot_period, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles       enable row level security;
alter table public.doctors        enable row level security;
alter table public.appointments   enable row level security;
alter table public.health_profiles enable row level security;
alter table public.cdss_logs      enable row level security;

-- profiles ------------------------------------------------------------------

drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles
  for select using (auth.uid() = id);

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles
  for insert with check (auth.uid() = id);

-- A doctor may look up a patient only when an appointment links them.

drop policy if exists profiles_doctor_reads_patients on public.profiles;
create policy profiles_doctor_reads_patients on public.profiles
  for select using (
    exists (
      select 1 from public.appointments a
      join public.doctors d on d.id = a.doctor_id
      where a.patient_id = profiles.id
        and d.id = auth.uid()
    )
  );

-- doctors -------------------------------------------------------------------

drop policy if exists doctors_public_read on public.doctors;
create policy doctors_public_read on public.doctors
  for select using (true);

drop policy if exists doctors_update_own on public.doctors;
create policy doctors_update_own on public.doctors
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- appointments --------------------------------------------------------------

drop policy if exists appointments_patient_select on public.appointments;
create policy appointments_patient_select on public.appointments
  for select using (auth.uid() = patient_id);

drop policy if exists appointments_patient_insert on public.appointments;
create policy appointments_patient_insert on public.appointments
  for insert with check (auth.uid() = patient_id);

drop policy if exists appointments_doctor_select on public.appointments;
create policy appointments_doctor_select on public.appointments
  for select using (
    exists (
      select 1 from public.doctors d
      where d.id = appointments.doctor_id
        and d.id = auth.uid()
    )
  );

drop policy if exists appointments_doctor_update on public.appointments;
create policy appointments_doctor_update on public.appointments
  for update using (
    exists (
      select 1 from public.doctors d
      where d.id = appointments.doctor_id
        and d.id = auth.uid()
    )
  );

-- health_profiles -----------------------------------------------------------

drop policy if exists health_profiles_select_own on public.health_profiles;
create policy health_profiles_select_own on public.health_profiles
  for select using (auth.uid() = patient_id);

drop policy if exists health_profiles_upsert_own on public.health_profiles;
create policy health_profiles_upsert_own on public.health_profiles
  for insert with check (auth.uid() = patient_id);

drop policy if exists health_profiles_update_own on public.health_profiles;
create policy health_profiles_update_own on public.health_profiles
  for update using (auth.uid() = patient_id) with check (auth.uid() = patient_id);

drop policy if exists health_profiles_doctor_select on public.health_profiles;
create policy health_profiles_doctor_select on public.health_profiles
  for select using (
    exists (
      select 1 from public.appointments a
      join public.doctors d on d.id = a.doctor_id
      where a.patient_id = health_profiles.patient_id
        and d.id = auth.uid()
    )
  );

-- cdss_logs -----------------------------------------------------------------

drop policy if exists cdss_logs_insert_own on public.cdss_logs;
create policy cdss_logs_insert_own on public.cdss_logs
  for insert with check (
    exists (
      select 1 from public.doctors d
      where d.id = cdss_logs.doctor_id
        and d.id = auth.uid()
    )
  );

drop policy if exists cdss_logs_select_own on public.cdss_logs;
create policy cdss_logs_select_own on public.cdss_logs
  for select using (
    exists (
      select 1 from public.doctors d
      where d.id = cdss_logs.doctor_id
        and d.id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Grants (RLS above is what actually scopes the rows)
-- ---------------------------------------------------------------------------

grant select on public.profiles        to authenticated;
grant update on public.profiles        to authenticated;
grant insert on public.profiles        to authenticated;

grant select on public.doctors         to authenticated;

grant select, insert, update on public.appointments to authenticated;

grant select, insert, update on public.health_profiles to authenticated;

grant select, insert on public.cdss_logs to authenticated;
