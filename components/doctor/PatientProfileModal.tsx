"use client";

import { useEffect, useState } from "react";

import Icon from "@/components/common/Icon";
import SpeakButton from "@/components/common/SpeakButton";
import { tryCreateSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatInWat } from "@/lib/utils/datetime";

/**
 * Plan 9.3 — the patient medical history inspector.
 *
 * Opens from a queue card and shows the patient's health profile (symptoms,
 * history, allergies, medications, emergency contact) together with their
 * uploaded documents, each opened through a short-lived signed URL.
 *
 * Nothing here is privileged: RLS already allows a doctor to read a health
 * profile and a storage folder only when a live appointment links the two
 * (health_profiles_doctor_select, and health_records_read_appointment_doctor
 * from migration 20261019000007). If the appointment is cancelled or the
 * caller is not its doctor, every query returns empty rather than a record.
 *
 * Note on plan D3/8.3: selective encryption of the narrative fields is a
 * separate, unimplemented phase — what is displayed is what the patient saved
 * in plaintext.
 */

const STORAGE_BUCKET = "health-records";
const SIGNED_URL_LIFETIME_SECONDS = 15 * 60; // plan D7: 15-minute links

export type PatientRecordItem = {
  id: string;
  patientId: string;
  patientName: string;
  reasonForVisit: string;
  startTime: string;
  endTime: string;
  status: string;
};

type HealthProfileRow = {
  symptoms: string | null;
  medical_history: string | null;
  allergies: string | null;
  current_medications: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
};

type StoredDocument = {
  name: string;
  size: number | null;
  createdAt: string | null;
};

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "size unknown";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="border-b border-surface-container-high pb-space-xs last:border-0">
      <dt className="text-label-lg text-on-surface-variant">{label}</dt>
      <dd className="m-0 text-body-lg whitespace-pre-wrap text-on-surface">
        {value && value.trim() ? value : "— not recorded —"}
      </dd>
    </div>
  );
}

export default function PatientProfileModal({
  item,
  onClose,
}: {
  item: PatientRecordItem;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<HealthProfileRow | null>(null);
  const [documents, setDocuments] = useState<StoredDocument[]>([]);
  const [previewing, setPreviewing] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const supabase = tryCreateSupabaseBrowserClient();
      if (!supabase) {
        if (!cancelled) {
          setError("Supabase is not configured.");
          setLoading(false);
        }
        return;
      }

      try {
        const [{ data: healthRow, error: healthError }, { data: files, error: filesError }] =
          await Promise.all([
            supabase.from("health_profiles").select("*").eq("patient_id", item.patientId).maybeSingle(),
            supabase.storage
              .from(STORAGE_BUCKET)
              .list(item.patientId, {
                limit: 50,
                sortBy: { column: "created_at", order: "desc" },
              }),
          ]);

        if (cancelled) return;

        const problems: string[] = [];
        if (healthError) problems.push(healthError.message);
        else setProfile((healthRow ?? null) as HealthProfileRow | null);

        if (filesError) {
          problems.push(filesError.message);
        } else {
          const entries = (files ?? []).filter(
            (entry) =>
              !entry.name.endsWith("/") &&
              (entry.metadata as { mimetype?: string } | null | undefined)?.mimetype !== "folder",
          );
          setDocuments(
            entries.map((entry) => ({
              name: entry.name,
              size:
                typeof (entry.metadata as { size?: number } | null)?.size === "number"
                  ? ((entry.metadata as { size?: number }).size as number)
                  : null,
              createdAt: entry.created_at ?? null,
            })),
          );
        }

        if (problems.length > 0) setError(problems.join("; "));
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "the record was unreachable");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [item.patientId]);

  async function openDocument(name: string): Promise<void> {
    const supabase = tryCreateSupabaseBrowserClient();
    if (!supabase) return;

    setPreviewing(name);
    try {
      const { data, error: signError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(`${item.patientId}/${name}`, SIGNED_URL_LIFETIME_SECONDS);
      if (signError) throw new Error(signError.message);
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? `That document could not be opened: ${caught.message}`
          : "That document could not be opened.",
      );
    } finally {
      setPreviewing(null);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Patient record for ${item.patientName}`}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-space-xs sm:p-space-sm"
    >
      <div className="w-full max-w-2xl rounded-xl bg-white p-space-sm">
        <div className="flex items-start justify-between gap-space-xs">
          <div className="min-w-0">
            <p className="eyebrow mb-0">PATIENT RECORD · PLAN 9.3</p>
            <h2 className="text-headline-lg-mobile text-on-surface">{item.patientName}</h2>
            <p className="m-0 text-body-lg text-on-surface-variant">
              <Icon name="schedule" size={20} className="mr-1 align-text-bottom" />
              {formatInWat(item.startTime, "EEEE d MMMM yyyy")} ·{" "}
              {formatInWat(item.startTime, "h:mm a")} – {formatInWat(item.endTime, "h:mm a")} WAT
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close patient record"
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-surface-container-high text-on-surface press"
          >
            <Icon name="close" size={30} />
          </button>
        </div>

        <p className="mt-space-xs rounded-lg bg-surface-container-low p-space-xs text-body-lg text-on-surface">
          <span className="text-label-lg text-on-surface-variant">Reason for visit: </span>
          {item.reasonForVisit}
        </p>

        {loading ? (
          <p className="text-body-lg text-on-surface-variant">Loading the record…</p>
        ) : null}

        {error ? (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-lg border-2 border-tertiary bg-error-container px-space-sm py-space-xs text-body-lg text-on-error-container"
          >
            <Icon name="error" size={28} className="mt-0.5 shrink-0" />
            {error}
          </p>
        ) : null}

        {!loading && !profile ? (
          <p className="rounded-lg bg-surface-container-low p-space-xs text-body-lg text-on-surface-variant">
            This patient has not saved a health profile yet.
          </p>
        ) : null}

        {profile ? (
          <dl className="mt-space-xs flex flex-col gap-space-sm rounded-xl bg-surface-container-low p-space-sm">
            <Field label="Symptoms today" value={profile.symptoms} />
            <Field label="Medical history" value={profile.medical_history} />
            <Field label="Known allergies" value={profile.allergies} />
            <Field label="Current medications" value={profile.current_medications} />
            <Field
              label="Emergency contact"
              value={
                profile.emergency_contact_name || profile.emergency_contact_phone
                  ? [profile.emergency_contact_name, profile.emergency_contact_phone]
                      .filter(Boolean)
                      .join(" · ")
                  : null
              }
            />
          </dl>
        ) : null}

        <section className="mt-space-sm" aria-labelledby="documents-heading">
          <div className="flex items-center justify-between gap-space-xs">
            <h3 id="documents-heading" className="flex items-center gap-2 text-headline-lg-mobile text-on-surface">
              <Icon name="folder" size={26} className="text-secondary" />
              Patient documents
            </h3>
            <SpeakButton
              phrase={`Patient record for ${item.patientName}. Reason for visit: ${item.reasonForVisit}.`}
              label="Listen to this record summary"
              className="bg-secondary text-white"
              size={48}
            />
          </div>

          {documents.length === 0 && !loading ? (
            <p className="m-0 text-body-lg text-on-surface-variant">
              No lab results or photos uploaded yet.
            </p>
          ) : (
            <ul className="m-2 flex list-none flex-col gap-space-xs p-0">
              {documents.map((document) => (
                <li
                  key={document.name}
                  className="flex items-center justify-between gap-space-xs rounded-lg bg-surface-container-low p-space-xs"
                >
                  <span className="flex min-w-0 items-center gap-space-xs">
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-secondary-fixed text-on-secondary-fixed">
                      <Icon
                        name={document.name.toLowerCase().endsWith(".pdf") ? "picture_as_pdf" : "image"}
                        size={28}
                      />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-label-lg text-on-surface">
                        {document.name}
                      </span>
                      <span className="block text-body-lg text-on-surface-variant">
                        {formatBytes(document.size)}
                        {document.createdAt
                          ? ` · ${formatInWat(document.createdAt, "d MMM yyyy")}`
                          : ""}
                      </span>
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => void openDocument(document.name)}
                    disabled={previewing !== null}
                    className="flex min-h-14 items-center gap-2 rounded-lg bg-secondary px-4 text-label-lg text-white press disabled:opacity-60"
                  >
                    <Icon name="visibility" size={24} />
                    {previewing === document.name ? "OPENING…" : "PREVIEW"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="mt-space-sm text-body-lg text-on-surface-variant">
          You can see this record because a live appointment links you to this patient.
          Document links expire after 15 minutes.
        </p>

        <button
          type="button"
          onClick={onClose}
          className="mt-space-xs flex min-h-16 w-full items-center justify-center gap-space-xs rounded-xl bg-primary text-label-xl text-white shadow-tactile press"
        >
          <Icon name="close" size={28} />
          CLOSE RECORD
        </button>
      </div>
    </div>
  );
}
