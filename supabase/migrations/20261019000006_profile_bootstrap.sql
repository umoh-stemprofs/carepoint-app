-- CarePoint: every confirmed account gets a profile — and doctors get a
-- `doctors` row.
--
-- Sign-up mirrors role into public.profiles from the client, but that only
-- works while a session exists at sign-up. With email confirmation enabled
-- there is no session yet, RLS denies the insert, and the user ends up with
-- no profile row at all — which then fails the booking RPC's role check
-- ("only patient accounts may book appointments") and the appointments FK.
--
-- This moves profile creation into the database (the standard Supabase
-- `handle_new_user` pattern) and backfills anyone who already signed up
-- without one. Doctors additionally get their `doctors` row, which the booking
-- wizard, ScheduleManager and the availability toggle all read.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role public.user_role;
  v_name text;
begin
  v_role := case when new.raw_user_meta_data ->> 'role' = 'doctor'
                 then 'doctor'::public.user_role
                 else 'patient'::public.user_role end;

  v_name := coalesce(
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
    split_part(coalesce(new.email, 'user'), '@', 1)
  );

  insert into public.profiles (id, role, full_name)
  values (new.id, v_role, v_name)
  on conflict (id) do nothing;

  if v_role = 'doctor' then
    insert into public.doctors (id)
    values (new.id)
    on conflict (id) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Backfill: accounts that predate this migration (including the two existing
-- physicians) must end up with the rows their role needs.
-- ---------------------------------------------------------------------------

insert into public.profiles (id, role, full_name)
select u.id,
       case when u.raw_user_meta_data ->> 'role' = 'doctor'
            then 'doctor'::public.user_role
            else 'patient'::public.user_role end,
       coalesce(
         nullif(trim(coalesce(u.raw_user_meta_data ->> 'full_name', '')), ''),
         split_part(coalesce(u.email, 'user'), '@', 1)
       )
from auth.users u
where not exists (
  select 1 from public.profiles p where p.id = u.id
)
on conflict (id) do nothing;

insert into public.doctors (id)
select p.id
from public.profiles p
where p.role = 'doctor'
  and not exists (select 1 from public.doctors d where d.id = p.id)
on conflict (id) do nothing;
