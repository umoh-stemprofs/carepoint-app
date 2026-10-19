"use client";

import Link from "next/link";
import { Suspense, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";

import Topbar from "@/components/common/Topbar";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Mode = "login" | "signup";
type Role = "patient" | "doctor";

/**
 * Accept only same-origin paths.
 *
 * `redirect` comes straight from the query string, so an absolute URL
 * ("https://evil.example") or a protocol-relative one ("//evil.example") would
 * bounce a freshly signed-in user off-site. Anything unsafe falls back.
 */
function safeInternalPath(raw: string | null, fallback: string): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  return raw;
}

const FRIENDLY_ERRORS: Record<string, string> = {
  invalid_credentials: "That email and password do not match an account. Try again.",
  user_already_exists: "An account already uses that email. Switch to Log In instead.",
  weak_password: "Please choose a password of at least 6 characters.",
  email_not_confirmed: "Confirm your email address first, then log in.",
  signup_disabled: "New registrations are currently disabled.",
  over_email_send_rate_limit: "Too many attempts. Please wait a moment and try again.",
  rate_limit_exceeded: "Too many attempts. Please wait a moment and try again.",
  email_invalid: "That email address does not look valid.",
};

function toFriendlyMessage(code: string | undefined, fallback: string): string {
  if (code && FRIENDLY_ERRORS[code]) return FRIENDLY_ERRORS[code];
  if (!fallback) return "Something went wrong. Please try again.";
  return fallback;
}

function AuthPanel() {
  const searchParams = useSearchParams();
  const redirectRaw = searchParams.get("redirect");

  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("patient");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function defaultLanding(forRole: Role): string {
    return forRole === "doctor" ? "/dashboard" : "/book";
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    if (!email.trim() || !password) {
      setError("Enter your email and password to continue.");
      return;
    }

    setBusy(true);
    try {
      const supabase = createSupabaseBrowserClient();

      if (mode === "login") {
        const { data, error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

        if (signInError) {
          setError(toFriendlyMessage(signInError.code, signInError.message));
          return;
        }

        const metadata = data.user?.user_metadata as { role?: unknown } | undefined;
        const userRole: Role = metadata?.role === "doctor" ? "doctor" : "patient";
        window.location.assign(safeInternalPath(redirectRaw, defaultLanding(userRole)));
        return;
      }

      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { data: { role } },
      });

      if (signUpError) {
        setError(toFriendlyMessage(signUpError.code, signUpError.message));
        return;
      }

      // Mirror the role into public.profiles (plan decision D1). Best effort:
      // with email confirmation on there is no session yet, and RLS then denies
      // the insert. Auth still succeeds either way.
      if (data.session?.user) {
        try {
          await supabase.from("profiles").upsert({
            id: data.session.user.id,
            role,
            full_name: email.trim().split("@")[0],
          });
        } catch {
          // Table not migrated yet, or RLS refused — not fatal for sign-up.
        }
      }

      if (!data.session) {
        setNotice("Account created. Confirm your email, then log in here.");
        setMode("login");
        setBusy(false);
        return;
      }

      window.location.assign(safeInternalPath(redirectRaw, defaultLanding(role)));
    } catch {
      setError("Could not reach the sign-in service. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const fieldStyle: React.CSSProperties = {
    width: "100%",
    minHeight: 64,
    fontSize: 20,
    padding: "12px 16px",
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
    marginTop: 20,
  };

  const primaryButton: React.CSSProperties = {
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
  };

  const secondaryButton: React.CSSProperties = {
    minHeight: 56,
    fontSize: 17,
    fontWeight: 700,
    borderRadius: 8,
    border: "2px solid var(--line)",
    background: "#fff",
    color: "var(--foreground)",
    cursor: "pointer",
    flex: 1,
    padding: "0 16px",
  };

  return (
    <main className="home-page">
      <Topbar label={mode === "login" ? "LOG IN" : "SIGN UP"} />

      <section className="welcome">
        <p className="eyebrow">CAREPOINT ACCOUNT</p>
        <h1>{mode === "login" ? "Welcome back." : "Create your account."}</h1>
        <p className="welcome-copy">
          {mode === "login"
            ? "Sign in to book a visit or manage your schedule."
            : "Choose whether you are a patient or a doctor, then register."}
        </p>
      </section>

      <div role="tablist" aria-label="Account action" style={{ display: "flex", gap: 12 }}>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "login"}
          onClick={() => {
            setMode("login");
            setError(null);
            setNotice(null);
          }}
          style={{
            ...secondaryButton,
            flex: 1,
            minHeight: 64,
            background: mode === "login" ? "var(--blue)" : "#fff",
            color: mode === "login" ? "#fff" : "var(--foreground)",
            borderColor: mode === "login" ? "var(--blue)" : "var(--line)",
          }}
        >
          LOG IN
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "signup"}
          onClick={() => {
            setMode("signup");
            setError(null);
            setNotice(null);
          }}
          style={{
            ...secondaryButton,
            flex: 1,
            minHeight: 64,
            background: mode === "signup" ? "var(--blue)" : "#fff",
            color: mode === "signup" ? "#fff" : "var(--foreground)",
            borderColor: mode === "signup" ? "var(--blue)" : "var(--line)",
          }}
        >
          SIGN UP
        </button>
      </div>

      <form onSubmit={handleSubmit} noValidate>
        <label style={labelStyle} htmlFor="email">
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          style={fieldStyle}
        />

        <label style={labelStyle} htmlFor="password">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          required
          minLength={6}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          style={fieldStyle}
        />

        {mode === "signup" ? (
          <fieldset style={{ border: "none", padding: 0, margin: "24px 0 0" }}>
            <legend style={{ fontSize: 16, fontWeight: 700 }}>I am a</legend>
            <div style={{ display: "flex", gap: 12, marginTop: 10 }}>
              {(["patient", "doctor"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setRole(option)}
                  aria-pressed={role === option}
                  style={{
                    ...secondaryButton,
                    minHeight: 64,
                    fontSize: 18,
                    background: role === option ? "var(--green)" : "#fff",
                    color: role === option ? "#fff" : "var(--foreground)",
                    borderColor: role === option ? "var(--green)" : "var(--line)",
                  }}
                >
                  {option === "patient" ? "I AM A PATIENT" : "I AM A DOCTOR"}
                </button>
              ))}
            </div>
          </fieldset>
        ) : null}

        {error ? (
          <p
            role="alert"
            style={{
              marginTop: 22,
              minHeight: 56,
              display: "flex",
              alignItems: "center",
              padding: "12px 16px",
              borderRadius: 8,
              background: "#fee4e2",
              border: "2px solid var(--red)",
              color: "#7a271a",
              fontSize: 17,
            }}
          >
            {error}
          </p>
        ) : null}

        {notice ? (
          <p
            role="status"
            style={{
              marginTop: 22,
              minHeight: 56,
              display: "flex",
              alignItems: "center",
              padding: "12px 16px",
              borderRadius: 8,
              background: "#dcfae6",
              border: "2px solid var(--green)",
              color: "#05603a",
              fontSize: 17,
            }}
          >
            {notice}
          </p>
        ) : null}

        <button type="submit" style={primaryButton} disabled={busy}>
          {busy ? "PLEASE WAIT…" : mode === "login" ? "LOG IN" : "CREATE ACCOUNT"}
        </button>
      </form>

      <p className="welcome-copy" style={{ marginTop: 28 }}>
        Need help? <Link href="/">Back to home</Link>
      </p>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="home-page">Loading…</main>}>
      <AuthPanel />
    </Suspense>
  );
}
