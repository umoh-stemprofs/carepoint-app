"use client";

import { useState, type FormEvent } from "react";

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

const cardStyle: React.CSSProperties = {
  border: "2px solid var(--line)",
  borderRadius: 10,
  padding: 18,
  background: "#fff",
};

const sectionTitle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 750,
  letterSpacing: "0.07em",
  textTransform: "uppercase",
  color: "#435249",
  margin: "0 0 10px",
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

  const inputStyle: React.CSSProperties = {
    width: "100%",
    minHeight: 56,
    fontSize: 18,
    padding: "10px 14px",
    border: "2px solid var(--line)",
    borderRadius: 8,
    background: "#fff",
    color: "var(--foreground)",
    marginTop: 8,
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: 16,
    fontWeight: 700,
    marginTop: 18,
  };

  return (
    <section aria-label="Clinical decision support" style={{ marginTop: 40 }}>
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        aria-expanded={open}
        style={{
          width: "100%",
          minHeight: 64,
          fontSize: 19,
          fontWeight: 750,
          borderRadius: 8,
          border: "2px solid var(--blue)",
          background: open ? "var(--blue)" : "#fff",
          color: open ? "#fff" : "var(--blue)",
          cursor: "pointer",
        }}
      >
        {open ? "CLOSE AI DIAGNOSTIC ASSISTANCE" : "AI DIAGNOSTIC ASSISTANCE"}
      </button>

      {open ? (
        <div style={{ border: "2px solid var(--line)", borderRadius: 10, padding: 20, marginTop: 16 }}>
          <div
            role="note"
            style={{
              padding: "12px 14px",
              borderRadius: 8,
              background: "#eef4ff",
              border: "2px solid #6172f3",
              color: "#3538cd",
              fontSize: 15,
              fontWeight: 700,
            }}
          >
            AI Clinical Assistance Only — decision rests with the attending doctor. Patient
            identifiers are stripped before this request leaves the server.
          </div>

          <form onSubmit={handleSubmit} noValidate>
            <label style={labelStyle} htmlFor="cdss-symptoms">
              Patient symptoms
            </label>
            <textarea
              id="cdss-symptoms"
              rows={3}
              value={symptoms}
              onChange={(event) => setSymptoms(event.target.value)}
              placeholder="fever, chills, headache (comma or line separated)"
              style={{ ...inputStyle, minHeight: 88, resize: "vertical" }}
            />

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div>
                <label style={labelStyle} htmlFor="cdss-age">
                  Patient age
                </label>
                <input
                  id="cdss-age"
                  type="number"
                  min={0}
                  max={120}
                  value={age}
                  onChange={(event) => setAge(event.target.value)}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle} htmlFor="cdss-gender">
                  Gender
                </label>
                <select
                  id="cdss-gender"
                  value={gender}
                  onChange={(event) => setGender(event.target.value)}
                  style={inputStyle}
                >
                  <option value="female">Female</option>
                  <option value="male">Male</option>
                  <option value="other">Other</option>
                  <option value="unknown">Unknown</option>
                </select>
              </div>
            </div>

            <label style={labelStyle} htmlFor="cdss-notes">
              Medical notes
            </label>
            <textarea
              id="cdss-notes"
              rows={3}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Relevant history, duration, vitals"
              style={{ ...inputStyle, minHeight: 88, resize: "vertical" }}
            />

            {issues.length > 0 ? (
              <div
                role="alert"
                style={{
                  marginTop: 18,
                  padding: "14px 16px",
                  borderRadius: 8,
                  background: "#fee4e2",
                  border: "2px solid var(--red)",
                  color: "#7a271a",
                  fontSize: 16,
                }}
              >
                <ul style={{ margin: 0, paddingLeft: 20 }}>
                  {issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {failure ? (
              <div
                role="alert"
                style={{
                  marginTop: 18,
                  padding: "14px 16px",
                  borderRadius: 8,
                  background: "#fee4e2",
                  border: "2px solid var(--red)",
                  color: "#7a271a",
                  fontSize: 16,
                }}
              >
                {failure}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={busy}
              style={{
                width: "100%",
                minHeight: 64,
                marginTop: 22,
                fontSize: 19,
                fontWeight: 750,
                borderRadius: 8,
                border: "none",
                background: "var(--blue)",
                color: "#fff",
                cursor: busy ? "wait" : "pointer",
                opacity: busy ? 0.7 : 1,
              }}
            >
              {busy ? "ANALYSING…" : "RUN DIAGNOSTIC ASSISTANCE"}
            </button>
          </form>

          {response ? (
            <div style={{ display: "grid", gap: 16, marginTop: 24 }}>
              <p
                role="status"
                style={{
                  margin: 0,
                  fontSize: 15,
                  fontWeight: 700,
                  color: response.source === "deepseek" ? "#05603a" : "#7a2e05",
                }}
              >
                {response.source === "deepseek"
                  ? `Generated by ${response.model}.`
                  : "Offline fallback output — no live model response."}
              </p>

              <div style={{ ...cardStyle, border: "3px solid var(--green)" }}>
                <p style={sectionTitle}>Primary diagnosis</p>
                <div style={{ fontSize: 22, fontWeight: 740 }}>
                  {response.result.primaryDiagnosis?.name || "Not determined"}
                  {response.result.primaryDiagnosis?.confidence ? (
                    <span
                      style={{
                        marginLeft: 10,
                        fontSize: 13,
                        fontWeight: 750,
                        textTransform: "uppercase",
                        color: "#435249",
                      }}
                    >
                      {response.result.primaryDiagnosis.confidence} confidence
                    </span>
                  ) : null}
                </div>
                {response.result.primaryDiagnosis?.rationale ? (
                  <p style={{ fontSize: 16, color: "#435249", marginBottom: 0, marginTop: 8 }}>
                    {response.result.primaryDiagnosis.rationale}
                  </p>
                ) : null}
              </div>

              <div style={cardStyle}>
                <p style={sectionTitle}>Differential diagnoses</p>
                <ul style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 8 }}>
                  {(response.result.differentialDiagnoses ?? []).map((entry, index) => (
                    <li key={`${entry.name}-${index}`} style={{ fontSize: 17 }}>
                      <strong>{entry.name}</strong>
                      {entry.rationale ? (
                        <span style={{ color: "#435249" }}> — {entry.rationale}</span>
                      ) : null}
                    </li>
                  ))}
                  {(response.result.differentialDiagnoses ?? []).length === 0 ? (
                    <li style={{ fontSize: 17, color: "#435249" }}>None returned.</li>
                  ) : null}
                </ul>
              </div>

              <div style={cardStyle}>
                <p style={sectionTitle}>Recommended diagnostic tests</p>
                <ul style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 8 }}>
                  {(response.result.recommendedTests ?? []).map((entry, index) => (
                    <li key={`${entry.name}-${index}`} style={{ fontSize: 17 }}>
                      <strong>{entry.name}</strong>
                      {entry.purpose ? (
                        <span style={{ color: "#435249" }}> — {entry.purpose}</span>
                      ) : null}
                    </li>
                  ))}
                  {(response.result.recommendedTests ?? []).length === 0 ? (
                    <li style={{ fontSize: 17, color: "#435249" }}>None returned.</li>
                  ) : null}
                </ul>
              </div>

              <div style={{ ...cardStyle, border: "3px solid #f79009" }}>
                <p style={sectionTitle}>Red flags &amp; contraindications</p>
                <ul
                  style={{
                    margin: 0,
                    paddingLeft: 20,
                    display: "grid",
                    gap: 8,
                    color: "#7a2e05",
                  }}
                >
                  {(response.result.redFlags ?? []).map((flag) => (
                    <li key={flag} style={{ fontSize: 17, fontWeight: 650 }}>
                      {flag}
                    </li>
                  ))}
                  {(response.result.contraindications ?? []).map((item) => (
                    <li key={item} style={{ fontSize: 17 }}>
                      {item}
                    </li>
                  ))}
                  {(response.result.redFlags ?? []).length === 0 &&
                  (response.result.contraindications ?? []).length === 0 ? (
                    <li style={{ fontSize: 17, fontWeight: 500, color: "#435249" }}>
                      None returned.
                    </li>
                  ) : null}
                </ul>
              </div>

              <p style={{ fontSize: 14, color: "#435249", margin: 0 }}>
                {response.disclaimer}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
