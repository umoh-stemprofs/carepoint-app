"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";

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

const fieldStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 64,
  fontSize: 19,
  padding: "12px 14px",
  border: "2px solid var(--line)",
  borderRadius: 8,
  background: "#fff",
  color: "var(--foreground)",
  marginTop: 8,
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 17,
  fontWeight: 700,
  marginTop: 22,
};

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

      <section className="welcome" style={{ paddingBottom: 20 }}>
        <p className="eyebrow">DIGITAL HEALTH RECORD</p>
        <h1>Your health profile</h1>
        <p className="welcome-copy">
          Keep your history, allergies and emergency contact in one place so your doctor can
          review it before you arrive.
        </p>
      </section>

      {loading ? <p className="welcome-copy">Loading your record…</p> : null}

      <form onSubmit={handleSave} noValidate>
        <label style={labelStyle} htmlFor="medicalHistory">
          Medical history
        </label>
        <textarea
          id="medicalHistory"
          rows={3}
          value={values.medicalHistory}
          onChange={(event) => update("medicalHistory", event.target.value)}
          placeholder="Past conditions, surgeries, ongoing care"
          style={{ ...fieldStyle, minHeight: 96, resize: "vertical" }}
        />

        <label style={labelStyle} htmlFor="allergies">
          Known allergies
        </label>
        <textarea
          id="allergies"
          rows={2}
          value={values.allergies}
          onChange={(event) => update("allergies", event.target.value)}
          placeholder="For example: penicillin, sulpha drugs"
          style={{ ...fieldStyle, minHeight: 72, resize: "vertical" }}
        />

        <label style={labelStyle} htmlFor="currentMedications">
          Current medications
        </label>
        <textarea
          id="currentMedications"
          rows={2}
          value={values.currentMedications}
          onChange={(event) => update("currentMedications", event.target.value)}
          placeholder="List doses where you know them"
          style={{ ...fieldStyle, minHeight: 72, resize: "vertical" }}
        />

        <label style={labelStyle} htmlFor="emergencyContactName">
          Emergency contact name
        </label>
        <input
          id="emergencyContactName"
          type="text"
          required
          value={values.emergencyContactName}
          onChange={(event) => update("emergencyContactName", event.target.value)}
          style={fieldStyle}
        />

        <label style={labelStyle} htmlFor="emergencyContactPhone">
          Emergency contact phone
        </label>
        <input
          id="emergencyContactPhone"
          type="tel"
          required
          value={values.emergencyContactPhone}
          onChange={(event) => update("emergencyContactPhone", event.target.value)}
          placeholder="+234 803 123 4567"
          style={fieldStyle}
        />

        {issues.length > 0 ? (
          <div
            role="alert"
            style={{
              marginTop: 22,
              padding: "14px 16px",
              borderRadius: 8,
              background: "#fee4e2",
              border: "2px solid var(--red)",
              color: "#7a271a",
              fontSize: 17,
            }}
          >
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {notice === "saved-server" ? (
          <p
            role="status"
            style={{
              marginTop: 22,
              padding: "16px 18px",
              borderRadius: 8,
              background: "#dcfae6",
              border: "3px solid var(--green)",
              color: "#05603a",
              fontSize: 18,
              fontWeight: 700,
            }}
          >
            Your health profile has been saved.
          </p>
        ) : null}

        {notice === "saved-local" ? (
          <p
            role="status"
            style={{
              marginTop: 22,
              padding: "16px 18px",
              borderRadius: 8,
              background: "#fde6ca",
              border: "3px solid #dc6803",
              color: "#7a2e05",
              fontSize: 17,
            }}
          >
            Saved on this device only — your record could not reach the server, so it is not
            synced to your account yet. Reconnect and save again to store it properly.
          </p>
        ) : null}

        <button
          type="submit"
          disabled={busy}
          style={{
            width: "100%",
            minHeight: 64,
            marginTop: 28,
            fontSize: 20,
            fontWeight: 750,
            borderRadius: 8,
            border: "none",
            background: "var(--green)",
            color: "#fff",
            cursor: busy ? "wait" : "pointer",
            opacity: busy ? 0.7 : 1,
          }}
        >
          {busy ? "SAVING…" : "SAVE PROFILE"}
        </button>
      </form>

      <hr style={{ border: "none", borderTop: "1px solid var(--line)", margin: "40px 0 0" }} />

      <section aria-label="Medical documents" style={{ marginTop: 26 }}>
        <p className="eyebrow" style={{ marginBottom: 10 }}>
          MEDICAL DOCUMENTS
        </p>
        <h2 style={{ fontSize: 24, margin: "0 0 8px" }}>Upload a record</h2>
        <p className="welcome-copy" style={{ fontSize: 17, marginTop: 0 }}>
          Lab results, prescriptions or photos of paper records. PDF, PNG or JPG, up to 5 MB.
        </p>

        <form onSubmit={handleUpload} noValidate>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg"
            onChange={(event) => {
              setPendingFile(event.target.files?.[0] ?? null);
              setUploadIssue(null);
              setUploadNotice(null);
            }}
            style={{
              display: "block",
              width: "100%",
              fontSize: 17,
              padding: "16px 14px",
              border: "2px dashed var(--line)",
              borderRadius: 8,
              background: "#fff",
            }}
          />

          {uploadIssue ? (
            <p
              role="alert"
              style={{
                marginTop: 16,
                padding: "14px 16px",
                borderRadius: 8,
                background: "#fee4e2",
                border: "2px solid var(--red)",
                color: "#7a271a",
                fontSize: 16,
              }}
            >
              {uploadIssue}
            </p>
          ) : null}

          {uploadNotice ? (
            <p
              role="status"
              style={{
                marginTop: 16,
                padding: "14px 16px",
                borderRadius: 8,
                background: "#dcfae6",
                border: "2px solid var(--green)",
                color: "#05603a",
                fontSize: 16,
                fontWeight: 700,
              }}
            >
              {uploadNotice}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={uploading}
            style={{
              width: "100%",
              minHeight: 64,
              marginTop: 20,
              fontSize: 19,
              fontWeight: 750,
              borderRadius: 8,
              border: "2px solid var(--blue)",
              background: uploading ? "#fff" : "var(--blue)",
              color: uploading ? "var(--blue)" : "#fff",
              cursor: uploading ? "wait" : "pointer",
              opacity: uploading ? 0.7 : 1,
            }}
          >
            {uploading ? "UPLOADING…" : "UPLOAD DOCUMENT"}
          </button>
        </form>
      </section>

      <p className="welcome-copy" style={{ marginTop: 30, fontSize: 16 }}>
        <Link href="/">← Back to home</Link>
      </p>
    </main>
  );
}
