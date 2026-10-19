-- CarePoint: private `health-records` bucket for Phase 08 medical documents.
--
-- Kept in its own migration because storage.buckets / storage.objects live in
-- the `storage` schema and are owned by another role: if this file cannot be
-- applied, the core schema in 20261019000000_initial_schema.sql must still
-- land rather than roll back with it.

-- Server-enforced ceiling (plan D7): 5 MB and a PDF/PNG/JPEG whitelist. The
-- page validates these too, but the bucket is the layer that cannot be bypassed
-- by a hand-crafted request.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'health-records',
  'health-records',
  false,
  5242880,
  array['application/pdf', 'image/png', 'image/jpeg']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Objects are private; the app reads them through short-lived signed URLs.
-- Every path is {patient_id}/{filename}, and storage.foldername() returns that
-- first segment, so a patient can only read, write or delete under their own id.

drop policy if exists health_records_read_own on storage.objects;
create policy health_records_read_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'health-records'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists health_records_insert_own on storage.objects;
create policy health_records_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'health-records'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists health_records_delete_own on storage.objects;
create policy health_records_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'health-records'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
