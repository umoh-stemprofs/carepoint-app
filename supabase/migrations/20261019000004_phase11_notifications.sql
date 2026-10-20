-- CarePoint Phase 11: in-app notifications and a simulated email log.
--
-- Plan 11.1–11.4: a booking, or any later status change, must (a) land an
-- in-app notification for BOTH parties and (b) append a formatted record to
-- public.email_logs. Dispatch runs as a database trigger, immediately after
-- the appointment row is written (plan 11.3), so a client that disconnects
-- mid-flow can no longer skip the notification.
--
-- The client never inserts into these tables: the trigger is SECURITY DEFINER
-- and no INSERT grant is issued, so users cannot forge messages to each other.
-- Apply with `supabase db push`, or paste this file into the SQL editor.

-- ---------------------------------------------------------------------------
-- notifications: unread until the recipient marks them read
-- ---------------------------------------------------------------------------

create table if not exists public.notifications (
  id             uuid primary key default gen_random_uuid(),
  recipient_id   uuid not null references public.profiles (id) on delete cascade,
  appointment_id uuid references public.appointments (id) on delete cascade,
  kind           text not null,
  title          text not null,
  body           text not null,
  read_at        timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists notifications_recipient_idx
  on public.notifications (recipient_id, created_at desc);

-- ---------------------------------------------------------------------------
-- email_logs: the plan's simulated outbound email (plan 11.2). The rows are
-- the record; lib/services/emailSimulator.ts formats them for the server log.
-- ---------------------------------------------------------------------------

create table if not exists public.email_logs (
  id              uuid primary key default gen_random_uuid(),
  recipient_id    uuid not null references public.profiles (id) on delete cascade,
  recipient_email text not null default '',
  appointment_id  uuid references public.appointments (id) on delete cascade,
  kind            text not null,
  subject         text not null,
  body            text not null,
  sent_at         timestamptz not null default now()
);

create index if not exists email_logs_recipient_idx
  on public.email_logs (recipient_id, sent_at desc);
create index if not exists email_logs_appointment_idx
  on public.email_logs (appointment_id, sent_at desc);

-- ---------------------------------------------------------------------------
-- Dispatch trigger: fires on booking (insert) and on every status change
-- (update of status). Not on no-op updates, so one Confirm click = one notice.
-- ---------------------------------------------------------------------------

create or replace function public.notify_appointment_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_patient       public.profiles%rowtype;
  v_doctor        public.profiles%rowtype;
  v_patient_email text;
  v_doctor_email  text;
  v_when          text;
  v_kind          text;
  v_title         text;
  v_body          text;
begin
  if tg_op = 'UPDATE' and new.status = old.status then
    return null;
  end if;

  select * into v_patient from public.profiles where id = new.patient_id;
  select * into v_doctor  from public.profiles where id = new.doctor_id;
  select email into v_patient_email from auth.users where id = new.patient_id;
  select email into v_doctor_email  from auth.users where id = new.doctor_id;

  -- Wall-clock in the app's timezone (plan D6: display is always WAT).
  v_when := to_char(new.start_time at time zone 'Africa/Lagos', 'Dy D Mon YYYY, HH24:MI')
            || ' – '
            || to_char(new.end_time at time zone 'Africa/Lagos', 'HH24:MI')
            || ' WAT';

  if tg_op = 'INSERT' then
    v_kind  := 'booking_created';
    v_title := 'Appointment requested';
    v_body  := 'Patient ' || v_patient.full_name
               || ' booked with ' || v_doctor.full_name
               || ' on ' || v_when
               || '. Reason: ' || new.reason_for_visit;
  else
    v_kind  := 'appointment_' || new.status::text;
    v_title := 'Appointment ' || new.status::text;
    v_body  := 'Your visit with ' || v_doctor.full_name
               || ' (patient ' || v_patient.full_name || ') on ' || v_when
               || ' is now ' || new.status::text || '.';
  end if;

  insert into public.notifications (recipient_id, appointment_id, kind, title, body)
  values (new.patient_id, new.id, v_kind, v_title, v_body);

  insert into public.notifications (recipient_id, appointment_id, kind, title, body)
  values (new.doctor_id, new.id, v_kind, v_title, v_body);

  insert into public.email_logs
    (recipient_id, recipient_email, appointment_id, kind, subject, body)
  values
    (new.patient_id, coalesce(v_patient_email, ''), new.id, v_kind,
     'CarePoint: ' || v_title, v_body),
    (new.doctor_id, coalesce(v_doctor_email, ''), new.id, v_kind,
     'CarePoint: ' || v_title, v_body);

  return new;
end;
$$;

drop trigger if exists appointments_notify on public.appointments;
create trigger appointments_notify
  after insert or update of status on public.appointments
  for each row
  execute function public.notify_appointment_change();

-- ---------------------------------------------------------------------------
-- RLS: recipients read their own rows; nobody inserts from the client.
-- ---------------------------------------------------------------------------

alter table public.notifications enable row level security;
alter table public.email_logs     enable row level security;

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select using (auth.uid() = recipient_id);

drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications
  for update using (auth.uid() = recipient_id)
  with check (auth.uid() = recipient_id);

drop policy if exists notifications_delete_own on public.notifications;
create policy notifications_delete_own on public.notifications
  for delete using (auth.uid() = recipient_id);

drop policy if exists email_logs_select_own on public.email_logs;
create policy email_logs_select_own on public.email_logs
  for select using (auth.uid() = recipient_id);

grant select, update, delete on public.notifications to authenticated;
grant select on public.email_logs to authenticated;

-- Realtime (plan 11.1): the listener in components/common/NotificationListener
-- subscribes to inserts on this table. Guarded because the publication may
-- already contain the table on a re-run.
do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
