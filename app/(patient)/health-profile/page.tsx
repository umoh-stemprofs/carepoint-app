"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

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

      <p className="welcome-copy" style={{ marginTop: 30, fontSize: 16 }}>
        <Link href="/">← Back to home</Link>
      </p>
    </main>
  );
}
