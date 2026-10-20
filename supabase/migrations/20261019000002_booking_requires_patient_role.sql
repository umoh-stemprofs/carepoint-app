-- CarePoint: only patient accounts may book appointments.
--
-- The first migration's RPC asserted `auth.uid() = p_patient_id`, which stops a
-- user booking for someone else but still lets a *doctor* book a slot for
-- themselves — the wizard and the middleware would bounce them, but the RPC is
-- the authority that actually writes the row. `profiles.role` is now checked
-- inside the function, so the rule holds no matter which client calls it.
--
-- Delivered as a new migration rather than an edit to 20261019000000: that file
-- has already been applied to the live project, and editing an applied
-- migration does nothing for it while making the next `db reset` disagree with
-- production.
--
-- Note for scripts/test-concurrency.ts: the TEST_EMAIL account it signs in as
-- must have a public.profiles row with role = 'patient' (sign-up writes one),
-- or every booking attempt now fails with the exception below.

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

  -- Booking is a patient action: a doctor profile must not create
  -- appointments, whoever is asking. This runs after the self-booking check so
  -- the first error a caller sees is the true one, and it reads profiles
  -- directly because the function is SECURITY DEFINER.
  if not exists (
    select 1 from public.profiles where id = p_patient_id and role = 'patient'
  ) then
    raise exception 'only patient accounts may book appointments';
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
