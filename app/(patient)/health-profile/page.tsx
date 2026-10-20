"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";

import Icon from "@/components/common/Icon";
import SpeakButton from "@/components/common/SpeakButton";
import Topbar from "@/components/common/Topbar";
import { tryCreateSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  healthProfileSchema,
  type HealthProfileInput,
} from "@/lib/validations/health-profile";

type FormState = {
  medicalHistory: string;
  allergies: string;
  currentMedications: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
};

const EMPTY: FormState = {
  medicalHistory: "",
  allergies: "",
  currentMedications: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
};

const LOCAL_KEY = "carepoint.health-profile.draft";

/** Plan decision D7: 5 MB ceiling and a strict MIME whitelist. */
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = ["application/pdf", "image/png", "image/jpeg"] as const;
const STORAGE_BUCKET = "health-records";

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Storage keys must not contain path separators or shell-sensitive characters. */
function safeFileName(name: string): string {
  return name.replace(/[/\\^%*?:"<>|\s]+/g, "_").slice(-80) || "record";
}

type Row = {
  medical_history: string | null;
  allergies: string | null;
  current_medications: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
};

function readLocalDraft(): FormState | null {
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FormState>;
    return { ...EMPTY, ...parsed };
  } catch {
    return null;
  }
}

function writeLocalDraft(values: HealthProfileInput): void {
  try {
    window.localStorage.setItem(
      LOCAL_KEY,
      JSON.stringify({
        medicalHistory: values.medicalHistory ?? "",
        allergies: values.allergies ?? "",
        currentMedications: values.currentMedications ?? "",
        emergencyContactName: values.emergencyContactName,
        emergencyContactPhone: values.emergencyContactPhone,
      }),
    );
  } catch {
    // Storage may be full or blocked; the form still keeps its values.
  }
}

const fieldClass =
  "min-h-16 w-full rounded-xl bg-surface-container-low px-4 py-3 text-body-xl text-on-surface placeholder:text-outline focus:bg-white";

export default function HealthProfilePage() {
  const [values, setValues] = useState<FormState>(EMPTY);
  const [issues, setIssues] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadIssue, setUploadIssue] = useState<string | null>(null);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const supabase = tryCreateSupabaseBrowserClient();

      if (supabase) {
        try {
          const {
            data: { user },
          } = await supabase.auth.getUser();

          if (user) {
            const { data, error } = await supabase
              .from("health_profiles")
              .select("*")
              .eq("patient_id", user.id)
              .maybeSingle();

            if (!error && data && !cancelled) {
              const row = data as Row;
              setValues({
                medicalHistory: row.medical_history ?? "",
                allergies: row.allergies ?? "",
                currentMedications: row.current_medications ?? "",
                emergencyContactName: row.emergency_contact_name ?? "",
                emergencyContactPhone: row.emergency_contact_phone ?? "",
              });
              setLoading(false);
              return;
            }
          }
        } catch {
          // Table missing or unreachable — fall through to the local draft.
        }
      }

      // Deferred so state is never written synchronously inside the effect.
      await Promise.resolve();
      if (cancelled) return;

      const draft = readLocalDraft();
      if (draft) setValues(draft);
      setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  function update(key: keyof FormState, value: string) {
    setValues((previous) => ({ ...previous, [key]: value }));
    setNotice(null);
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);

    const payload: HealthProfileInput = {
      medicalHistory: values.medicalHistory.trim() || undefined,
      allergies: values.allergies.trim() || undefined,
      currentMedications: values.currentMedications.trim() || undefined,
      emergencyContactName: values.emergencyContactName.trim(),
      emergencyContactPhone: values.emergencyContactPhone.trim(),
    };

    const parsed = healthProfileSchema.safeParse(payload);
    if (!parsed.success) {
      setIssues(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`));
      return;
    }
    setIssues([]);

    setBusy(true);
    try {
      const supabase = tryCreateSupabaseBrowserClient();
      if (supabase) {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (user) {
          const { error } = await supabase.from("health_profiles").upsert(
            {
              patient_id: user.id,
              medical_history: parsed.data.medicalHistory ?? null,
              allergies: parsed.data.allergies ?? null,
              current_medications: parsed.data.currentMedications ?? null,
              emergency_contact_name: parsed.data.emergencyContactName,
              emergency_contact_phone: parsed.data.emergencyContactPhone,
            },
            { onConflict: "patient_id" },
          );

          if (!error) {
            setNotice("saved-server");
            return;
          }
        }
      }
      throw new Error("database unavailable");
    } catch {
      writeLocalDraft(parsed.data);
      setNotice("saved-local");
    } finally {
      setBusy(false);
    }
  }

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUploadIssue(null);
    setUploadNotice(null);

    if (!pendingFile) {
      setUploadIssue("Choose a file to upload first.");
      return;
    }
    if (pendingFile.size > MAX_UPLOAD_BYTES) {
      setUploadIssue(
        `That file is ${formatMegabytes(pendingFile.size)}. The limit is ${formatMegabytes(MAX_UPLOAD_BYTES)}.`,
      );
      return;
    }
    if (!(ALLOWED_MIME as readonly string[]).includes(pendingFile.type)) {
      setUploadIssue("Only PDF, PNG and JPG files are accepted.");
      return;
    }

    setUploading(true);
    try {
      const supabase = tryCreateSupabaseBrowserClient();
      if (!supabase) throw new Error("Supabase is not configured.");

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Please sign in again before uploading.");

      // Stored under patient_id/ so Storage RLS can scope it per patient (D7).
      const key = `${user.id}/${Date.now()}-${safeFileName(pendingFile.name)}`;
      const { error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(key, pendingFile, { contentType: pendingFile.type, upsert: false });

      if (error) throw new Error(error.message);

      setUploadNotice(`Uploaded ${pendingFile.name} to your record.`);
      setPendingFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (error) {
      setUploadIssue(
        error instanceof Error ? error.message : "The file could not be uploaded.",
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <main className="home-page">
      <Topbar label="MY HEALTH PROFILE" />

      <header className="flex items-center justify-between gap-space-sm py-space-sm">
        <Link
          href="/"
          className="flex min-h-16 items-center gap-space-xs rounded-lg bg-surface-container-high px-space-sm text-secondary no-underline press"
        >
          <Icon name="arrow_back" size={32} />
          <span className="text-label-lg uppercase">Back</span>
        </Link>
        <h1 className="text-center text-headline-lg-mobile text-on-surface">My health profile</h1>
      </header>

      <div className="mb-space-md flex items-center gap-space-xs rounded-xl bg-surface-container-low p-space-sm">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-secondary-fixed text-on-secondary-fixed">
          <Icon name="hearing" size={28} />
        </span>
        <p className="text-body-lg text-on-surface">
          Record your symptoms and show your papers to the doctor.
        </p>
        <SpeakButton
          phrase="My health profile. Record your symptoms, upload papers, then save your health profile."
          label="Listen to this page"
          className="bg-secondary text-white"
        />
      </div>

      {loading ? <p className="text-body-lg text-on-surface-variant">Loading your record…</p> : null}

      <form onSubmit={handleSave} noValidate className="flex flex-col gap-space-lg">
        <section aria-labelledby="symptoms-heading" className="flex flex-col gap-space-xs">
          <div className="flex items-center gap-space-xs">
            <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary-container text-white">
              <Icon name="monitor_heart" size={30} />
            </span>
            <h2 id="symptoms-heading" className="text-headline-lg-mobile text-on-surface">
              1. My symptoms
            </h2>
          </div>

          <div className="flex flex-col gap-space-xs rounded-xl bg-surface-container-low p-space-md">
            <label htmlFor="medicalHistory" className="flex items-center gap-2 text-label-lg text-on-surface">
              <Icon name="record_voice_over" size={24} className="text-primary" />
              Medical history
            </label>
            <textarea
              id="medicalHistory"
              rows={3}
              value={values.medicalHistory}
              onChange={(event) => update("medicalHistory", event.target.value)}
              placeholder="Past conditions, surgeries, ongoing care"
              className={`${fieldClass} min-h-24 resize-y`}
            />

            <label htmlFor="allergies" className="flex items-center gap-2 text-label-lg text-on-surface">
              <Icon name="warning" size={24} className="text-primary" />
              Known allergies
            </label>
            <textarea
              id="allergies"
              rows={2}
              value={values.allergies}
              onChange={(event) => update("allergies", event.target.value)}
              placeholder="For example: penicillin, sulpha drugs"
              className={`${fieldClass} min-h-20 resize-y`}
            />

            <label htmlFor="currentMedications" className="flex items-center gap-2 text-label-lg text-on-surface">
              <Icon name="medication" size={24} className="text-primary" />
              Current medications
            </label>
            <textarea
              id="currentMedications"
              rows={2}
              value={values.currentMedications}
              onChange={(event) => update("currentMedications", event.target.value)}
              placeholder="List doses where you know them"
              className={`${fieldClass} min-h-20 resize-y`}
            />

            <label htmlFor="emergencyContactName" className="flex items-center gap-2 text-label-lg text-on-surface">
              <Icon name="person" size={24} className="text-primary" />
              Emergency contact name
            </label>
            <input
              id="emergencyContactName"
              type="text"
              required
              value={values.emergencyContactName}
              onChange={(event) => update("emergencyContactName", event.target.value)}
              className={fieldClass}
            />

            <label htmlFor="emergencyContactPhone" className="flex items-center gap-2 text-label-lg text-on-surface">
              <Icon name="call" size={24} className="text-primary" />
              Emergency contact phone
            </label>
            <input
              id="emergencyContactPhone"
              type="tel"
              required
              value={values.emergencyContactPhone}
              onChange={(event) => update("emergencyContactPhone", event.target.value)}
              placeholder="+234 803 123 4567"
              className={fieldClass}
            />
          </div>
        </section>

        {issues.length > 0 ? (
          <div
            role="alert"
            className="rounded-lg border-2 border-tertiary bg-error-container px-space-sm py-space-xs text-body-lg text-on-error-container"
          >
            <ul className="m-0 list-disc pl-6">
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {notice === "saved-server" ? (
          <p
            role="status"
            className="flex items-center gap-2 rounded-lg border-2 border-primary bg-primary-fixed px-space-sm py-space-xs text-body-lg font-bold text-on-primary-fixed"
          >
            <Icon name="check_circle" size={30} />
            Your health profile has been saved.
          </p>
        ) : null}

        {notice === "saved-local" ? (
          <p
            role="status"
            className="flex items-start gap-2 rounded-lg border-2 border-[#dc6803] bg-[#fde6ca] px-space-sm py-space-xs text-body-lg text-[#7a2e05]"
          >
            <Icon name="info" size={28} className="mt-0.5 shrink-0" />
            <span>
              Saved on this device only — your record could not reach the server, so it is not
              synced to your account yet. Reconnect and save again to store it properly.
            </span>
          </p>
        ) : null}

        <button
          type="submit"
          disabled={busy}
          className="flex min-h-18 w-full items-center justify-center gap-space-xs rounded-xl bg-primary-container text-headline-lg-mobile text-white shadow-tactile press disabled:cursor-wait disabled:opacity-70"
        >
          <Icon name="check_circle" size={36} />
          {busy ? "SAVING…" : "SAVE HEALTH PROFILE"}
        </button>
      </form>

      <section aria-labelledby="papers-heading" className="mt-space-xl flex flex-col gap-space-xs">
        <div className="flex items-center gap-space-xs">
          <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-secondary text-white">
            <Icon name="folder" size={30} />
          </span>
          <h2 id="papers-heading" className="text-headline-lg-mobile text-on-surface">
            2. Upload papers
          </h2>
        </div>

        <p className="text-body-lg text-on-surface-variant">
          Lab results, prescriptions or photos of paper records. PDF, PNG or JPG, up to 5 MB.
        </p>

        <form onSubmit={handleUpload} noValidate className="flex flex-col gap-space-xs">
          <label
            htmlFor="medicalDocument"
            className="flex min-h-32 w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xl bg-secondary-container p-space-sm text-center text-on-secondary-container press"
          >
            <span className="flex items-center justify-center gap-space-md">
              <Icon name="photo_camera" size={34} />
              <Icon name="upload_file" size={34} />
            </span>
            <span className="text-label-xl uppercase">Take photo or upload lab PDF</span>
            <span className="text-label-lg">Tap here — max 5 MB</span>
          </label>

          <input
            id="medicalDocument"
            ref={fileInputRef}
            type="file"
            accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg"
            onChange={(event) => {
              setPendingFile(event.target.files?.[0] ?? null);
              setUploadIssue(null);
              setUploadNotice(null);
            }}
            className="min-h-14 w-full rounded-xl border-2 border-dashed border-outline-variant bg-white p-3 text-body-lg text-on-surface file:mr-3 file:rounded-lg file:border-0 file:bg-surface-container-high file:px-4 file:py-2 file:text-label-lg file:text-on-surface"
          />

          {pendingFile ? (
            <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-container-low p-space-xs">
              <span className="flex min-w-0 items-center gap-space-xs">
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-secondary-fixed text-on-secondary-fixed">
                  <Icon
                    name={pendingFile.type === "application/pdf" ? "picture_as_pdf" : "image"}
                    size={32}
                  />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-label-lg text-on-surface">{pendingFile.name}</span>
                  <span className="text-body-lg text-on-surface-variant">
                    {formatMegabytes(pendingFile.size)} of 5.0 MB
                  </span>
                </span>
              </span>
              <button
                type="button"
                aria-label={`Remove ${pendingFile.name}`}
                onClick={() => {
                  setPendingFile(null);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
                className="flex min-h-14 min-w-14 items-center justify-center rounded-lg bg-surface-container-highest text-tertiary press"
              >
                <Icon name="delete" size={28} />
              </button>
            </div>
          ) : null}

          {uploadIssue ? (
            <p
              role="alert"
              className="flex items-center gap-2 rounded-lg border-2 border-tertiary bg-error-container px-space-sm py-space-xs text-body-lg text-on-error-container"
            >
              <Icon name="error" size={28} className="shrink-0" />
              {uploadIssue}
            </p>
          ) : null}

          {uploadNotice ? (
            <p
              role="status"
              className="flex items-center gap-2 rounded-lg border-2 border-primary bg-primary-fixed px-space-sm py-space-xs text-body-lg font-bold text-on-primary-fixed"
            >
              <Icon name="check_circle" size={28} className="shrink-0" />
              {uploadNotice}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={uploading}
            className="flex min-h-16 w-full items-center justify-center gap-space-xs rounded-xl bg-primary text-label-xl text-white shadow-tactile press disabled:cursor-wait disabled:opacity-70"
          >
            <Icon name="cloud_upload" size={30} />
            {uploading ? "UPLOADING…" : "UPLOAD DOCUMENT"}
          </button>
        </form>
      </section>

      <p className="mt-space-lg text-body-lg">
        <Link href="/" className="text-primary">
          ← Back to home
        </Link>
      </p>
    </main>
  );
}
