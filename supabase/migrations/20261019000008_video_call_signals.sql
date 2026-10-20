-- CarePoint: signalling channel for the in-app video call (plan Phase 07
-- "Doctor video call", and the answering-machine pattern the wizard promises).
--
-- WebRTC needs a way for the two peers to hand each other an offer, an answer
-- and an "end call" notice. Supabase is already the only backend, so the
-- session description travels as rows scoped by RLS to the two participants
-- of one appointment: the patient in it, or the doctor on the other side.
-- Polling every second is plenty — signalling happens once or twice per call,
-- media itself never touches this table (peer-to-peer).

create table if not exists public.call_signals (
  id             uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments (id) on delete cascade,
  sender_id      uuid not null references public.profiles (id) on delete cascade,
  kind           text not null check (kind in ('offer', 'answer', 'end')),
  payload        text not null default '',
  created_at     timestamptz not null default now()
);

create index if not exists call_signals_appointment_idx
  on public.call_signals (appointment_id, created_at);

alter table public.call_signals enable row level security;

drop policy if exists call_signals_participants_read on public.call_signals;
create policy call_signals_participants_read on public.call_signals
  for select using (
    exists (
      select 1 from public.appointments a
      where a.id = call_signals.appointment_id
        and (a.patient_id = auth.uid() or a.doctor_id = auth.uid())
    )
  );

drop policy if exists call_signals_participants_insert on public.call_signals;
create policy call_signals_participants_insert on public.call_signals
  for insert with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.appointments a
      where a.id = call_signals.appointment_id
        and (a.patient_id = auth.uid() or a.doctor_id = auth.uid())
    )
  );

drop policy if exists call_signals_delete_own on public.call_signals;
create policy call_signals_delete_own on public.call_signals
  for delete using (sender_id = auth.uid());

grant select, insert, delete on public.call_signals to authenticated;
