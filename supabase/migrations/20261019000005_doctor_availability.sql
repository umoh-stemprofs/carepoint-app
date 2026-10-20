-- CarePoint: doctor availability (plan 9.2) and no bookings in the past.
--
-- Two rules the booking RPC now enforces server-side, because the browser is
-- not an authority anyone should trust:
--   1. A slot whose start time has already passed cannot be booked — at 1 PM
--      you cannot take a 9 AM slot today.
--   2. A doctor can close parts of the day (morning/midday/afternoon/evening);
--      closed periods are refused here as well as hidden in the wizard.
--
-- Also lets a doctor create their own `doctors` row on first use: sign-up only
-- writes `profiles`, so without this a self-registered physician could not be
-- booked and had nothing to toggle in ScheduleManager.

alter table public.doctors
  add column if not exists closed_periods public.slot_period[] not null default '{}';

-- Self-service setup (RLS scopes it: only a row with id = auth.uid()).

drop policy if exists doctors_insert_own on public.doctors;
create policy doctors_insert_own on public.doctors
  for insert with check (auth.uid() = id);

grant insert, update on public.doctors to authenticated;

-- ---------------------------------------------------------------------------
-- The RPC, re-issued with the two new checks. Applied as a replacement because
-- 20261019000000 and ...0002 have already run against the live project.
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
  v_closed   public.slot_period[];
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

  -- Booking is a patient action: a doctor profile must not create
  -- appointments, whoever is asking.
  if not exists (
    select 1 from public.profiles where id = p_patient_id and role = 'patient'
  ) then
    raise exception 'only patient accounts may book appointments';
  end if;

  -- Slots in the past are gone: the wizard hides them, and a hand-crafted
  -- request with an old timestamp is refused here (plan Phase 07 verification).
  if p_start_time <= now() then
    raise exception 'that time has already passed — pick a later slot';
  end if;

  -- Serialize every concurrent booking attempt for this doctor.
  select is_accepting_bookings, closed_periods
    into v_open, v_closed
    from public.doctors
   where id = p_doctor_id
     for update;

  if not found then
    raise exception 'doctor % not found', p_doctor_id;
  end if;

  if v_open is not true then
    raise exception 'doctor % is not accepting bookings', p_doctor_id;
  end if;

  -- Availability setter (plan 9.2): periods the doctor closed are refused.
  if p_slot_period = any (coalesce(v_closed, array[]::public.slot_period[])) then
    raise exception 'the doctor is not open at that time of day';
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
