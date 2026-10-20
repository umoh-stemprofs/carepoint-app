"use client";

import { useState, type FormEvent } from "react";

import Icon from "@/components/common/Icon";
import { cdssRequestSchema, type CDSSInput } from "@/lib/validations/cdss";

type DiagnosesResult = {
  primaryDiagnosis?: {
    name?: string;
    confidence?: string;
    rationale?: string;
  };
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

function toPayload(values: {
  symptoms: string;
  age: string;
  gender: string;
  notes: string;
}): CDSSInput {
  return {
    symptoms: values.symptoms
      .split(/[,\n]+/)
      .map((symptom) => symptom.trim())
      .filter(Boolean),
    patientAge: Number(values.age),
    gender: values.gender as CDSSInput["gender"],
    medicalHistory: values.notes.trim() || undefined,
  };
}

const inputClass =
  "min-h-16 w-full rounded-xl bg-surface-container-low px-4 py-3 text-body-xl text-on-surface placeholder:text-outline focus:bg-white";

const labelClass = "flex items-center gap-2 text-label-lg text-on-surface";

function Card({
  title,
  icon,
  accent,
  count,
  children,
}: {
  title: string;
  icon: string;
  accent: string;
  count?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-space-xs rounded-xl border-2 border-surface-container-high bg-white p-space-sm">
      <div className="flex items-center justify-between gap-2 border-b-2 border-surface-container-high pb-space-xs">
        <h3 className="flex items-center gap-2 text-label-xl uppercase text-on-surface">
          <Icon name={icon} size={26} className={accent} />
          {title}
        </h3>
        {count ? (
          <span className="rounded-md bg-surface-container px-2 py-0.5 text-label-lg text-on-surface-variant">
            {count}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export default function AIDiagnosticDrawer() {
  const [open, setOpen] = useState(false);
  const [symptoms, setSymptoms] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("female");
  const [notes, setNotes] = useState("");

  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<string[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [response, setResponse] = useState<ApiSuccess | null>(null);

  function reset() {
    setIssues([]);
    setFailure(null);
    setResponse(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    reset();

    const payload = toPayload({ symptoms, age, gender, notes });
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
        const failure = data as ApiFailure;
        setIssues(
          failure.issues?.map((issue) => `${issue.path}: ${issue.message}`) ?? [
            failure.error || `The assistant returned HTTP ${res.status}.`,
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

  return (
    <section aria-label="Clinical decision support" className="mt-space-lg">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        className="flex min-h-18 w-full items-center justify-center gap-space-xs rounded-xl bg-secondary text-label-xl text-white shadow-tactile press"
      >
        <Icon name="psychology" size={34} />
        AI DIAGNOSTIC ASSISTANCE
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="cdss-title"
          className="fixed inset-0 z-50 overflow-y-auto bg-surface"
        >
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-space-sm p-space-md">
            {/* Header */}
            <div className="flex flex-wrap items-start justify-between gap-space-sm border-b-2 border-surface-container-high pb-space-sm">
              <div className="flex items-center gap-space-sm">
                <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-secondary text-white shadow-tactile-sm">
                  <Icon name="psychology" size={32} />
                </span>
                <div className="flex flex-col">
                  <span className="w-fit rounded-full bg-secondary px-2.5 py-0.5 text-label-lg uppercase text-white">
                    DeepSeek clinical AI
                  </span>
                  <h2 id="cdss-title" className="text-headline-lg-mobile text-on-surface">
                    Physician AI CDSS assistant
                  </h2>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex min-h-14 items-center gap-2 rounded-lg bg-surface-container-high px-space-sm text-label-lg text-on-surface press"
              >
                <Icon name="close" size={26} />
                Close
              </button>
            </div>

            {/* Mandatory disclaimer banner (plan D11). */}
            <div
              role="note"
              className="flex items-center gap-2 rounded-lg border-2 border-[#dc6803] bg-[#fde6ca] px-space-sm py-space-xs text-body-lg font-bold text-[#7a2e05]"
            >
              <Icon name="warning" size={28} className="shrink-0" />
              AI Clinical Assistance Only — the decision rests with the attending doctor.
              Patient identifiers are stripped before this request leaves the server.
            </div>

            <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-space-sm">
              <div className="flex flex-col gap-1.5">
                <label className={labelClass} htmlFor="cdss-symptoms">
                  <Icon name="sick" size={24} className="text-primary" />
                  Patient symptoms
                </label>
                <textarea
                  id="cdss-symptoms"
                  rows={3}
                  value={symptoms}
                  onChange={(event) => setSymptoms(event.target.value)}
                  placeholder="fever, chills, headache (comma or line separated)"
                  className={`${inputClass} min-h-24 resize-y`}
                />
              </div>

              <div className="grid grid-cols-1 gap-space-sm sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <label className={labelClass} htmlFor="cdss-age">
                    <Icon name="person" size={24} className="text-primary" />
                    Patient age
                  </label>
                  <input
                    id="cdss-age"
                    type="number"
                    min={0}
                    max={120}
                    value={age}
                    onChange={(event) => setAge(event.target.value)}
                    className={inputClass}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className={labelClass} htmlFor="cdss-gender">
                    <Icon name="diversity_3" size={24} className="text-primary" />
                    Gender
                  </label>
                  <select
                    id="cdss-gender"
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
                <label className={labelClass} htmlFor="cdss-notes">
                  <Icon name="description" size={24} className="text-primary" />
                  Medical notes
                </label>
                <textarea
                  id="cdss-notes"
                  rows={3}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Relevant history, duration, vitals"
                  className={`${inputClass} min-h-24 resize-y`}
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

              {failure ? (
                <div
                  role="alert"
                  className="flex items-center gap-2 rounded-lg border-2 border-tertiary bg-error-container px-space-sm py-space-xs text-body-lg text-on-error-container"
                >
                  <Icon name="error" size={28} className="shrink-0" />
                  {failure}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={busy}
                className="flex min-h-16 w-full items-center justify-center gap-space-xs rounded-xl bg-secondary text-label-xl text-white shadow-tactile press disabled:cursor-wait disabled:opacity-70"
              >
                <Icon name="science" size={30} />
                {busy ? "ANALYSING…" : "RUN DIAGNOSTIC ASSISTANCE"}
              </button>
            </form>

            {response ? (
              <div className="flex flex-col gap-space-sm">
                <p
                  role="status"
                  className={`flex items-center gap-2 text-body-lg font-bold ${
                    response.source === "deepseek" ? "text-primary" : "text-[#7a2e05]"
                  }`}
                >
                  <Icon
                    name={response.source === "deepseek" ? "verified" : "info"}
                    size={26}
                  />
                  {response.source === "deepseek"
                    ? `Generated by ${response.model}.`
                    : "Offline fallback output — no live model response."}
                </p>

                <div className="grid grid-cols-1 gap-space-sm lg:grid-cols-3">
                  {/* Column 1: differentials */}
                  <Card
                    title="Top differentials"
                    icon="monitor_heart"
                    accent="text-primary"
                    count={`${(response.result.differentialDiagnoses ?? []).length} hypotheses`}
                  >
                    <div className="rounded-lg border-2 border-primary bg-primary-fixed p-space-xs">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-headline-lg-mobile text-on-primary-fixed">
                          {response.result.primaryDiagnosis?.name || "Not determined"}
                        </span>
                        {response.result.primaryDiagnosis?.confidence ? (
                          <span className="rounded-md bg-primary px-2 py-0.5 text-label-lg uppercase text-white">
                            {response.result.primaryDiagnosis.confidence}
                          </span>
                        ) : null}
                      </div>
                      {response.result.primaryDiagnosis?.rationale ? (
                        <p className="mt-1 text-body-lg text-on-primary-fixed">
                          {response.result.primaryDiagnosis.rationale}
                        </p>
                      ) : null}
                    </div>

                    <ul className="m-0 flex list-none flex-col gap-space-xs p-0">
                      {(response.result.differentialDiagnoses ?? []).map((entry, index) => (
                        <li key={`${entry.name}-${index}`} className="rounded-lg bg-surface-container-low p-space-xs">
                          <span className="block text-label-lg text-on-surface">{entry.name}</span>
                          {entry.rationale ? (
                            <span className="block text-body-lg text-on-surface-variant">
                              {entry.rationale}
                            </span>
                          ) : null}
                        </li>
                      ))}
                      {(response.result.differentialDiagnoses ?? []).length === 0 ? (
                        <li className="text-body-lg text-on-surface-variant">None returned.</li>
                      ) : null}
                    </ul>
                  </Card>

                  {/* Column 2: labs */}
                  <Card
                    title="Recommended labs"
                    icon="biotech"
                    accent="text-secondary"
                    count={`${(response.result.recommendedTests ?? []).length} tests`}
                  >
                    <ul className="m-0 flex list-none flex-col gap-space-xs p-0">
                      {(response.result.recommendedTests ?? []).map((entry, index) => (
                        <li key={`${entry.name}-${index}`} className="flex items-start gap-2 rounded-lg bg-surface-container-low p-space-xs">
                          <Icon name="check_circle" size={24} className="mt-0.5 shrink-0 text-secondary" />
                          <span className="flex flex-col">
                            <span className="text-label-lg text-on-surface">{entry.name}</span>
                            {entry.purpose ? (
                              <span className="text-body-lg text-on-surface-variant">
                                {entry.purpose}
                              </span>
                            ) : null}
                          </span>
                        </li>
                      ))}
                      {(response.result.recommendedTests ?? []).length === 0 ? (
                        <li className="text-body-lg text-on-surface-variant">None returned.</li>
                      ) : null}
                    </ul>
                  </Card>

                  {/* Column 3: red flags — the one place tertiary red is allowed. */}
                  <Card
                    title="Red-flag alerts"
                    icon="warning"
                    accent="text-tertiary"
                    count="Immediate triage"
                  >
                    <ul className="m-0 flex list-none flex-col gap-space-xs p-0">
                      {(response.result.redFlags ?? []).map((flag) => (
                        <li
                          key={flag}
                          className="rounded-lg border-2 border-tertiary bg-tertiary-fixed p-space-xs text-body-lg font-bold text-on-tertiary-fixed"
                        >
                          {flag}
                        </li>
                      ))}
                      {(response.result.contraindications ?? []).map((item) => (
                        <li
                          key={item}
                          className="rounded-lg bg-surface-container-low p-space-xs text-body-lg text-on-surface"
                        >
                          {item}
                        </li>
                      ))}
                      {(response.result.redFlags ?? []).length === 0 &&
                      (response.result.contraindications ?? []).length === 0 ? (
                        <li className="text-body-lg text-on-surface-variant">None returned.</li>
                      ) : null}
                    </ul>
                  </Card>
                </div>

                <p className="text-body-lg text-on-surface-variant">{response.disclaimer}</p>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
