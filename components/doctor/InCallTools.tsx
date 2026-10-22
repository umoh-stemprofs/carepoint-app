"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";

import Icon from "@/components/common/Icon";
import { tryCreateSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatInWat } from "@/lib/utils/datetime";
import { cdssRequestSchema, type CDSSInput } from "@/lib/validations/cdss";

/**
 * The physician's in-call toolbox (plan Phase 07, "Doctor video call").
 *
 * Two panels the doctor can pull up *without leaving the call* — the video
 * keeps running while they are open, because the panel is a section inside the
 * call box rather than a full-screen takeover:
 *
 *   1. InCallNotes      — consultation notes written during the consultation,
 *                         saved straight to `public.consultation_notes`
 *                         (migration 20261019000011) under the doctor's own
 *                         RLS scope, so they are waiting on the next appointment
 *                         screen and never lost to a closed tab.
 *   2. InCallDiagnostics — the same DeepSeek CDSS endpoint the dashboard drawer
 *                         uses, with the visit reason already in the symptoms
 *                         box, so the doctor does not retype what the patient
 *                         said thirty seconds ago.
 *
 * Both degrade honestly: if migration 0011 has not been applied the note panel
 * says exactly which SQL is missing instead of pretending to save.
 */

/** PostgREST 404/PGRST205 wording when the notes table does not exist yet. */
function isMissingNotesTable(message: string): boolean {
  return /consultation_notes|could not find the table|schema cache/i.test(message);
}

const inputClass =
  "min-h-14 w-full rounded-xl bg-surface-container-low px-4 py-3 text-body-xl text-on-surface placeholder:text-outline focus:bg-white";

const labelClass = "flex items-center gap-2 text-label-lg text-on-surface";

/** Shared shell: heading, close button, and a body that scrolls on its own. */
function ToolPanel({
  title,
  caption,
  icon,
  accent,
  onClose,
  children,
}: {
  title: string;
  caption: string;
  icon: string;
  accent: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="flex flex-col gap-space-xs rounded-xl border-2 border-secondary bg-white p-space-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-space-xs border-b-2 border-surface-container-high pb-space-xs">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-white ${accent}`}
          >
            <Icon name={icon} size={26} />
          </span>
          <div className="min-w-0">
            <p className="m-0 text-label-lg uppercase text-on-surface-variant">{caption}</p>
            <h3 className="m-0 text-headline-lg-mobile text-on-surface">{title}</h3>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="flex min-h-12 items-center gap-2 rounded-lg bg-surface-container-high px-3 text-label-lg uppercase text-on-surface press"
        >
          <Icon name="close" size={24} />
          Close
        </button>
      </div>

      <div className="flex max-h-[55vh] flex-col gap-space-xs overflow-y-auto pr-1">
        {children}
      </div>
    </section>
  );
}

function Notice({
  tone,
  icon,
  children,
}: {
  tone: "error" | "info";
  icon: string;
  children: ReactNode;
}) {
  const palette =
    tone === "error"
      ? "border-tertiary bg-error-container text-on-error-container"
      : "border-[#dc6803] bg-[#fde6ca] text-[#7a2e05]";

  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={`m-0 flex items-start gap-2 rounded-lg border-2 px-space-sm py-space-xs text-body-lg font-bold ${palette}`}
    >
      <Icon name={icon} size={26} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/* -------------------------------------------------------------------------- */
/* 1. Consultation notes                                                      */
/* -------------------------------------------------------------------------- */

type NoteRow = { notes: string; updated_at: string };

export function InCallNotes({
  appointmentId,
  reasonForVisit,
  peerName,
  onClose,
}: {
  appointmentId: string;
  reasonForVisit: string;
  peerName: string;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [storageMissing, setStorageMissing] = useState(false);

  // Read the existing note once, so reopening the appointment shows what was
  // written during the last call instead of an empty box.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const supabase = tryCreateSupabaseBrowserClient();
      if (!supabase) {
        if (!cancelled) setLoading(false);
        return;
      }

      const { data, error: loadError } = await supabase
        .from("consultation_notes")
        .select("notes, updated_at")
        .eq("appointment_id", appointmentId)
        .maybeSingle();
      if (cancelled) return;

      if (loadError) {
        if (isMissingNotesTable(loadError.message)) {
          setStorageMissing(true);
        } else {
          setError(loadError.message);
        }
      } else if (data) {
        const row = data as NoteRow;
        setText(row.notes);
        setSavedAt(row.updated_at);
        setDirty(false);
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [appointmentId]);

  async function save(): Promise<void> {
    const supabase = tryCreateSupabaseBrowserClient();
    if (!supabase) {
      setError("Supabase is not configured, so the note cannot be saved.");
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
    if (!user) {
      setError("Your session has expired. Sign in again, then save the note.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const { error: writeError } = await supabase.from("consultation_notes").upsert(
        {
          appointment_id: appointmentId,
          doctor_id: user.id,
          notes: text,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "appointment_id" },
      );
      if (writeError) throw new Error(writeError.message);

      setStorageMissing(false);
      setDirty(false);
      setSavedAt(new Date().toISOString());
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "The note could not be saved.";
      if (isMissingNotesTable(message)) {
        // Never claim a save that did not happen: name the missing migration.
        setStorageMissing(true);
      } else {
        setError(message);
      }
    } finally {
      setSaving(false);
    }
  }

  const status = storageMissing
    ? "Not saved yet"
    : dirty
      ? "Unsaved changes"
      : savedAt
        ? `Saved ${formatInWat(savedAt, "h:mm a")} WAT`
        : "Nothing to save yet";

  return (
    <ToolPanel
      title="Consultation notes"
      caption={`During the call with ${peerName}`}
      icon="edit"
      accent="bg-primary"
      onClose={onClose}
    >
      {reasonForVisit ? (
        <p className="m-0 rounded-lg bg-surface-container-low p-space-xs text-body-lg text-on-surface">
          <span className="text-label-lg uppercase text-on-surface-variant">Visit reason · </span>
          {reasonForVisit}
        </p>
      ) : null}

      {storageMissing ? (
        <Notice tone="info" icon="warning">
          Notes are not being saved yet: run migration
          <code className="mx-1 rounded bg-white px-1">20261019000011_consultation_notes.sql</code>
          in Supabase, then reload. Your typing below stays on this screen only.
        </Notice>
      ) : null}

      {error ? <Notice tone="error" icon="error">{error}</Notice> : null}

      <label className={labelClass} htmlFor="call-note">
        <Icon name="description" size={24} className="text-primary" />
        Note for this appointment
      </label>
      <textarea
        id="call-note"
        rows={8}
        value={text}
        disabled={loading}
        onChange={(event) => {
          setText(event.target.value);
          setDirty(true);
        }}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "s") {
            event.preventDefault();
            if (!saving && !loading) void save();
          }
        }}
        placeholder="Findings, vitals, advice given, follow-up…"
        className={`${inputClass} min-h-40 resize-y`}
      />

      <div className="flex flex-wrap items-center justify-between gap-space-xs">
        <span
          className={`flex items-center gap-2 text-label-lg uppercase ${
            dirty ? "text-[#7a2e05]" : "text-on-surface-variant"
          }`}
        >
          <Icon name={dirty ? "pending_actions" : "check_circle"} size={22} />
          {loading ? "Loading note…" : status}
        </span>

        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || loading || (!dirty && !storageMissing)}
          className="flex min-h-14 items-center justify-center gap-2 rounded-lg bg-primary px-space-sm text-label-lg text-white shadow-tactile-sm press disabled:cursor-not-allowed disabled:opacity-45"
        >
          <Icon name="cloud_upload" size={26} />
          {saving ? "SAVING…" : "SAVE NOTE"}
        </button>
      </div>

      <p className="m-0 text-label-lg text-on-surface-variant">
        Private to you — the patient cannot read these notes. Ctrl/Cmd + S saves.
      </p>
    </ToolPanel>
  );
}

/* -------------------------------------------------------------------------- */
/* 2. AI diagnostics                                                          */
/* -------------------------------------------------------------------------- */

type DiagnosesResult = {
  primaryDiagnosis?: { name?: string; confidence?: string; rationale?: string };
  differentialDiagnoses?: Array<{ name?: string; rationale?: string }>;
  recommendedTests?: Array<{ name?: string; purpose?: string }>;
  redFlags?: string[];
  contraindications?: string[];
};

type ApiSuccess = {
  ok: boolean;
  source: "deepseek" | "fallback";
  model: string;
  result: DiagnosesResult;
  disclaimer: string;
};

type ApiFailure = {
  ok: false;
  error: string;
  issues?: Array<{ path: string; message: string }>;
};

export function InCallDiagnostics({
  reasonForVisit,
  peerName,
  onClose,
}: {
  reasonForVisit: string;
  peerName: string;
  onClose: () => void;
}) {
  const [symptoms, setSymptoms] = useState(reasonForVisit);
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("female");
  const [history, setHistory] = useState("");

  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<string[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [response, setResponse] = useState<ApiSuccess | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIssues([]);
    setFailure(null);
    setResponse(null);

    const payload: CDSSInput = {
      symptoms: symptoms
        .split(/[,\\n]+/)
        .map((symptom) => symptom.trim())
        .filter(Boolean),
      patientAge: Number(age),
      gender: gender as CDSSInput["gender"],
      medicalHistory: history.trim() || undefined,
    };

    const parsed = cdssRequestSchema.safeParse(payload);
    if (!parsed.success) {
      setIssues(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`));
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/doctor/ai-diagnose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });

      const data = (await res.json()) as ApiSuccess | ApiFailure;

      if (!res.ok || data.ok === false) {
        const problem = data as ApiFailure;
        setIssues(
          problem.issues?.map((issue) => `${issue.path}: ${issue.message}`) ?? [
            problem.error || `The assistant returned HTTP ${res.status}.`,
          ],
        );
        return;
      }

      setResponse(data as ApiSuccess);
    } catch {
      setFailure("Could not reach the diagnostic service. Check your connection and retry.");
    } finally {
      setBusy(false);
    }
  }

  const result = response?.result;

  return (
    <ToolPanel
      title="AI diagnostic assistance"
      caption={`With ${peerName} on the line`}
      icon="psychology"
      accent="bg-secondary"
      onClose={onClose}
    >
      <Notice tone="info" icon="warning">
        AI clinical assistance only — the decision rests with you, the attending doctor.
        Identifiers are stripped before the request leaves the server.
      </Notice>

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-space-xs">
        <div className="flex flex-col gap-1.5">
          <label className={labelClass} htmlFor="in-call-symptoms">
            <Icon name="sick" size={24} className="text-primary" />
            Patient symptoms
          </label>
          <textarea
            id="in-call-symptoms"
            rows={3}
            value={symptoms}
            onChange={(event) => setSymptoms(event.target.value)}
            placeholder="fever, chills, headache (comma or line separated)"
            className={`${inputClass} min-h-24 resize-y`}
          />
        </div>

        <div className="grid grid-cols-1 gap-space-xs sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label className={labelClass} htmlFor="in-call-age">
              <Icon name="person" size={24} className="text-primary" />
              Patient age
            </label>
            <input
              id="in-call-age"
              type="number"
              min={0}
              max={120}
              value={age}
              onChange={(event) => setAge(event.target.value)}
              className={inputClass}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className={labelClass} htmlFor="in-call-gender">
              <Icon name="diversity_3" size={24} className="text-primary" />
              Gender
            </label>
            <select
              id="in-call-gender"
              value={gender}
              onChange={(event) => setGender(event.target.value)}
              className={inputClass}
            >
              <option value="female">Female</option>
              <option value="male">Male</option>
              <option value="other">Other</option>
              <option value="unknown">Unknown</option>
            </select>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className={labelClass} htmlFor="in-call-history">
            <Icon name="medication" size={24} className="text-primary" />
            Medical notes
          </label>
          <textarea
            id="in-call-history"
            rows={2}
            value={history}
            onChange={(event) => setHistory(event.target.value)}
            placeholder="Relevant history, duration, vitals"
            className={`${inputClass} min-h-20 resize-y`}
          />
        </div>

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

        {failure ? <Notice tone="error" icon="error">{failure}</Notice> : null}

        <button
          type="submit"
          disabled={busy}
          className="flex min-h-16 w-full items-center justify-center gap-space-xs rounded-xl bg-secondary text-label-xl text-white shadow-tactile press disabled:cursor-wait disabled:opacity-70"
        >
          <Icon name="science" size={30} />
          {busy ? "ANALYSING…" : "RUN DIAGNOSTIC ASSISTANCE"}
        </button>
      </form>

      {response && result ? (
        <div className="flex flex-col gap-space-xs">
          <p
            role="status"
            className={`m-0 flex items-center gap-2 text-body-lg font-bold ${
              response.source === "deepseek" ? "text-primary" : "text-[#7a2e05]"
            }`}
          >
            <Icon name={response.source === "deepseek" ? "verified" : "info"} size={26} />
            {response.source === "deepseek"
              ? `Generated by ${response.model}.`
              : "Offline fallback output — no live model response."}
          </p>

          <div className="rounded-xl border-2 border-primary bg-primary-fixed p-space-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <span className="text-headline-lg-mobile text-on-primary-fixed">
                {result.primaryDiagnosis?.name || "Not determined"}
              </span>
              {result.primaryDiagnosis?.confidence ? (
                <span className="rounded-md bg-primary px-2 py-0.5 text-label-lg uppercase text-white">
                  {result.primaryDiagnosis.confidence}
                </span>
              ) : null}
            </div>
            {result.primaryDiagnosis?.rationale ? (
              <p className="mt-1 mb-0 text-body-lg text-on-primary-fixed">
                {result.primaryDiagnosis.rationale}
              </p>
            ) : null}
          </div>

          {(result.differentialDiagnoses ?? []).length > 0 ? (
            <div className="rounded-xl border-2 border-surface-container-high bg-white p-space-xs">
              <p className="m-0 mb-1 flex items-center gap-2 text-label-lg uppercase text-on-surface">
                <Icon name="monitor_heart" size={24} className="text-primary" />
                Top differentials
              </p>
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {(result.differentialDiagnoses ?? []).map((entry, index) => (
                  <li key={`${entry.name}-${index}`} className="rounded-lg bg-surface-container-low p-space-xs">
                    <span className="block text-label-lg text-on-surface">{entry.name}</span>
                    {entry.rationale ? (
                      <span className="block text-body-lg text-on-surface-variant">
                        {entry.rationale}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {(result.recommendedTests ?? []).length > 0 ? (
            <div className="rounded-xl border-2 border-surface-container-high bg-white p-space-xs">
              <p className="m-0 mb-1 flex items-center gap-2 text-label-lg uppercase text-on-surface">
                <Icon name="biotech" size={24} className="text-secondary" />
                Recommended labs
              </p>
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {(result.recommendedTests ?? []).map((entry, index) => (
                  <li key={`${entry.name}-${index}`} className="flex items-start gap-2 rounded-lg bg-surface-container-low p-space-xs">
                    <Icon name="check_circle" size={22} className="mt-0.5 shrink-0 text-secondary" />
                    <span className="flex flex-col">
                      <span className="text-label-lg text-on-surface">{entry.name}</span>
                      {entry.purpose ? (
                        <span className="text-body-lg text-on-surface-variant">{entry.purpose}</span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {(result.redFlags ?? []).length > 0 || (result.contraindications ?? []).length > 0 ? (
            <div className="rounded-xl border-2 border-tertiary bg-tertiary-fixed p-space-xs">
              <p className="m-0 mb-1 flex items-center gap-2 text-label-lg uppercase font-bold text-on-tertiary-fixed">
                <Icon name="warning" size={24} />
                Red-flag alerts
              </p>
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {(result.redFlags ?? []).map((flag) => (
                  <li key={flag} className="text-body-lg font-bold text-on-tertiary-fixed">
                    {flag}
                  </li>
                ))}
                {(result.contraindications ?? []).map((item) => (
                  <li key={item} className="text-body-lg text-on-tertiary-fixed">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className="m-0 text-body-lg text-on-surface-variant">{response.disclaimer}</p>
        </div>
      ) : null}
    </ToolPanel>
  );
}
