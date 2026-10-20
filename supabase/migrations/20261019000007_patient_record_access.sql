-- CarePoint: a doctor can open the documents of a patient they are booked
-- with (plan 9.3 — the record inspector shows signed document URLs).
--
-- 20261019000001 only let a patient read their own folder. The doctor side of
-- the same bucket had no path at all, so PatientProfileModal could list
-- nothing. The condition mirrors the RLS used for health_profiles: the link
-- must be a live appointment between that patient and the signed-in doctor.

drop policy if exists health_records_read_appointment_doctor on storage.objects;
create policy health_records_read_appointment_doctor on storage.objects
  for select to authenticated
  using (
    bucket_id = 'health-records'
    and exists (
      select 1
      from public.appointments a
      join public.doctors d on d.id = a.doctor_id
      where a.patient_id::text = (storage.foldername(name))[1]
        and d.id = auth.uid()
        and a.status <> 'cancelled'
    )
  );
