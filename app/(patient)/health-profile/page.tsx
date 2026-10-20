"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import Icon from "@/components/common/Icon";
import SpeakButton from "@/components/common/SpeakButton";
import Topbar from "@/components/common/Topbar";
import { tryCreateSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  healthProfileSchema,
  type HealthProfileInput,
} from "@/lib/validations/health-profile";

type FormState = {
  symptoms: string;
  medicalHistory: string;
  allergies: string;
  currentMedications: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
};

const EMPTY: FormState = {
  symptoms: "",
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

/** An entry of the patient's own storage folder (plan 8.4). */
type StoredDocument = {
  name: string;
  size: number | null;
  createdAt: string | null;
};

type Row = {
  symptoms: string | null;
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
        symptoms: values.symptoms ?? "",
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

  // Fields the patient has already edited. The record loads asynchronously;
  // without this, a slow response would silently wipe whatever was typed in
  // the meantime (the save then stored nulls while the form looked filled).
  const dirtyFields = useRef<Set<keyof FormState>>(new Set());

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadIssue, setUploadIssue] = useState<string | null>(null);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);

  // Plan 8.4: the uploaded papers themselves, previewed through signed URLs.
  const [documents, setDocuments] = useState<StoredDocument[]>([]);
  const [docsError, setDocsError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const loadDocuments = useCallback(async (userId: string): Promise<void> => {
    const supabase = tryCreateSupabaseBrowserClient();
    if (!supabase) return;

    try {
      const { data, error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .list(userId, { limit: 50, sortBy: { column: "created_at", order: "desc" } });
      if (error) {
        setDocsError(error.message);
        return;
      }
      const entries = (data ?? []).filter(
        (entry) =>
          !entry.name.endsWith("/") &&
          (entry.metadata as { mimetype?: string } | null | undefined)?.mimetype !== "folder",
      );
      setDocsError(null);
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
    } catch {
      setDocsError("Your documents could not be listed right now.");
    }
  }, []);

  /** Open a paper through a 15-minute signed link (plan D7 / 8.4). */
  async function previewDocument(name: string): Promise<void> {
    const supabase = tryCreateSupabaseBrowserClient();
    if (!supabase) return;

    setPreviewing(name);
    setDocsError(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Please sign in again to open your documents.");

      const { data, error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(`${user.id}/${name}`, 15 * 60);
      if (error) throw new Error(error.message);
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (caught) {
      setDocsError(
        caught instanceof Error ? caught.message : "That document could not be opened.",
      );
    } finally {
      setPreviewing(null);
    }
  }

  /** Two taps: first marks the row for deletion, second performs it. */
  async function deleteDocument(name: string): Promise<void> {
    const supabase = tryCreateSupabaseBrowserClient();
    if (!supabase) return;

    setDocsError(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Please sign in again to manage your documents.");

      const { error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .remove([`${user.id}/${name}`]);
      if (error) throw new Error(error.message);
      setDocuments((previous) => previous.filter((document) => document.name !== name));
    } catch (caught) {
      setDocsError(
        caught instanceof Error ? caught.message : "That document could not be deleted.",
      );
    } finally {
      setPendingDelete(null);
    }
  }

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
            // Plan 8.4: the papers live under the same account, load with them.
            void loadDocuments(user.id);

            const { data, error } = await supabase
              .from("health_profiles")
              .select("*")
              .eq("patient_id", user.id)
              .maybeSingle();

            if (!error && data && !cancelled) {
              const row = data as Row;
              applyLoaded({
                symptoms: row.symptoms ?? "",
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
      if (draft) applyLoaded(draft);
      setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [loadDocuments]);

  function update(key: keyof FormState, value: string) {
    dirtyFields.current.add(key);
    setValues((previous) => ({ ...previous, [key]: value }));
    setNotice(null);
  }

  /** Merge record/draft values in, never touching fields already edited. */
  function applyLoaded(next: FormState): void {
    setValues((current) => {
      const merged = { ...current };
      (Object.keys(next) as Array<keyof FormState>).forEach((key) => {
        if (!dirtyFields.current.has(key)) merged[key] = next[key];
      });
      return merged;
    });
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);

    const payload: HealthProfileInput = {
      symptoms: values.symptoms.trim() || undefined,
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
              symptoms: parsed.data.symptoms ?? null,
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
      void loadDocuments(user.id);
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
            <label htmlFor="symptoms" className="flex items-center gap-2 text-label-lg text-on-surface">
              <Icon name="sick" size={24} className="text-primary" />
              What is wrong with you today?
            </label>
            <textarea
              id="symptoms"
              rows={3}
              value={values.symptoms}
              onChange={(event) => update("symptoms", event.target.value)}
              placeholder="For example: fever and headache since Tuesday, stomach pain at night"
              aria-describedby="symptoms-help"
              className={`${fieldClass} min-h-24 resize-y`}
            />
            <p id="symptoms-help" className="text-body-lg text-on-surface-variant">
              Tell the doctor what you are feeling before you book. Between 3 and 2000
              characters, and you can leave it empty.
            </p>

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

        {/* Plan 8.4: the documents themselves, opened through signed URLs. */}
        <div className="mt-space-sm flex flex-col gap-space-xs">
          <div className="flex items-center justify-between gap-space-xs">
            <h3 className="flex items-center gap-2 text-headline-lg-mobile text-on-surface">
              <Icon name="description" size={26} className="text-secondary" />
              Your papers
            </h3>
            <span className="text-label-lg text-on-surface-variant">
              {documents.length} on file
            </span>
          </div>

          {docsError ? (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-lg border-2 border-tertiary bg-error-container px-space-sm py-space-xs text-body-lg text-on-error-container"
            >
              <Icon name="error" size={28} className="mt-0.5 shrink-0" />
              {docsError}
            </p>
          ) : null}

          {documents.length === 0 ? (
            <p className="m-0 rounded-xl bg-surface-container-low p-space-xs text-body-lg text-on-surface-variant">
              Nothing uploaded yet. Papers you upload appear here and can be opened any time.
            </p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-space-xs p-0">
              {documents.map((document) => (
                <li
                  key={document.name}
                  className="flex items-center justify-between gap-space-xs rounded-xl bg-surface-container-low p-space-xs"
                >
                  <span className="flex min-w-0 items-center gap-space-xs">
                    <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-secondary-fixed text-on-secondary-fixed">
                      <Icon
                        name={
                          document.name.toLowerCase().endsWith(".pdf")
                            ? "picture_as_pdf"
                            : "image"
                        }
                        size={30}
                      />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-label-lg text-on-surface">
                        {document.name}
                      </span>
                      <span className="block text-body-lg text-on-surface-variant">
                        {document.size === null ? "size unknown" : formatMegabytes(document.size)}
                        {document.createdAt
                          ? ` · ${new Date(document.createdAt).toLocaleDateString("en-GB")}`
                          : ""}
                      </span>
                    </span>
                  </span>

                  <span className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => void previewDocument(document.name)}
                      disabled={previewing !== null}
                      className="flex min-h-14 items-center gap-2 rounded-lg bg-secondary px-4 text-label-lg text-white press disabled:opacity-60"
                    >
                      <Icon name="visibility" size={24} />
                      {previewing === document.name ? "OPENING…" : "OPEN"}
                    </button>
                    <button
                      type="button"
                      aria-label={
                        pendingDelete === document.name
                          ? `Confirm deleting ${document.name}`
                          : `Delete ${document.name}`
                      }
                      onClick={() => {
                        if (pendingDelete === document.name) void deleteDocument(document.name);
                        else setPendingDelete(document.name);
                      }}
                      className={`flex min-h-14 min-w-14 items-center justify-center rounded-lg press ${
                        pendingDelete === document.name
                          ? "bg-tertiary text-white"
                          : "bg-surface-container-highest text-tertiary"
                      }`}
                    >
                      <Icon name="delete" size={26} />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <p className="mt-space-lg text-body-lg">
        <Link href="/" className="text-primary">
          ← Back to home
        </Link>
      </p>
    </main>
  );
}
