"use client";

import Link from "next/link";
import { Suspense, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";

import Icon from "@/components/common/Icon";
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

  const modeTab = (target: Mode, label: string) => {
    const active = mode === target;
    return (
      <button
        type="button"
        role="tab"
        aria-selected={active}
        onClick={() => {
          setMode(target);
          setError(null);
          setNotice(null);
        }}
        className={`flex min-h-16 flex-1 items-center justify-center gap-2 rounded-lg text-label-lg uppercase press ${
          active
            ? "bg-secondary text-white shadow-tactile-sm"
            : "bg-surface-container-low text-on-surface"
        }`}
      >
        {active ? <Icon name="check_circle" size={26} /> : null}
        {label}
      </button>
    );
  };

  const roleOption = (target: Role, label: string, icon: string) => {
    const active = role === target;
    const activeClass =
      target === "patient"
        ? "bg-primary text-white shadow-tactile-sm"
        : "bg-secondary text-secondary-fixed shadow-tactile-sm";

    return (
      <button
        type="button"
        role="radio"
        aria-checked={active}
        onClick={() => setRole(target)}
        className={`flex min-h-20 w-full items-center justify-between gap-space-xs rounded-xl p-space-xs press ${
          active ? activeClass : "bg-surface-container text-on-surface"
        }`}
      >
        <span className="flex items-center gap-space-xs">
          <span
            className={`flex h-12 w-12 items-center justify-center rounded-lg ${
              active ? "bg-white/20 text-white" : "bg-surface-container-highest text-secondary"
            }`}
          >
            <Icon name={icon} size={28} />
          </span>
          <span className="text-label-lg uppercase">{label}</span>
        </span>
        {active ? (
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-primary">
            <Icon name="check" size={22} />
          </span>
        ) : null}
      </button>
    );
  };

  return (
    <main className="home-page">
      <Topbar label={mode === "login" ? "LOG IN" : "SIGN UP"} />

      <section className="welcome">
        <p className="eyebrow">CAREPOINT ACCOUNT</p>
        <h1 className="text-headline-xl-mobile sm:text-headline-xl">
          {mode === "login" ? "Welcome back." : "Create your account."}
        </h1>
        <p className="welcome-copy">
          {mode === "login"
            ? "Sign in to book a visit or manage your schedule."
            : "Choose whether you are a patient or a doctor, then register."}
        </p>
      </section>

      <div role="tablist" aria-label="Account action" className="flex gap-3">
        {modeTab("login", "Log in")}
        {modeTab("signup", "Sign up")}
      </div>

      <form onSubmit={handleSubmit} noValidate className="mt-space-md flex flex-col gap-space-md">
        {mode === "signup" ? (
          <fieldset className="m-0 border-none p-0">
            <legend className="mb-space-xs flex items-center gap-2 text-label-lg text-on-surface">
              <Icon name="badge" size={26} className="text-primary" />
              I am a
            </legend>
            <div role="radiogroup" aria-label="Select your role" className="flex flex-col gap-space-xs">
              {roleOption("patient", "Patient", "person")}
              {roleOption("doctor", "Doctor", "stethoscope")}
            </div>
          </fieldset>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <label
            className="flex items-center gap-2 text-label-lg text-on-surface"
            htmlFor="email"
          >
            <Icon name="mail" size={24} className="text-primary" />
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
            className="min-h-16 w-full rounded-xl bg-surface-container-low px-4 text-body-xl text-on-surface placeholder:text-outline focus:bg-white"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            className="flex items-center gap-2 text-label-lg text-on-surface"
            htmlFor="password"
          >
            <Icon name="lock" size={24} className="text-primary" />
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
            className="min-h-16 w-full rounded-xl bg-surface-container-low px-4 text-body-xl text-on-surface placeholder:text-outline focus:bg-white"
          />
        </div>

        {error ? (
          <p
            role="alert"
            className="flex min-h-14 items-center gap-2 rounded-lg border-2 border-tertiary bg-error-container px-space-sm py-space-xs text-body-lg text-on-error-container"
          >
            <Icon name="error" size={28} className="shrink-0" />
            {error}
          </p>
        ) : null}

        {notice ? (
          <p
            role="status"
            className="flex min-h-14 items-center gap-2 rounded-lg border-2 border-primary bg-primary-fixed px-space-sm py-space-xs text-body-lg text-on-primary-fixed"
          >
            <Icon name="check_circle" size={28} className="shrink-0" />
            {notice}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={busy}
          className="flex min-h-16 w-full items-center justify-center gap-space-xs rounded-xl bg-primary text-label-xl text-white shadow-tactile press disabled:cursor-wait disabled:opacity-70"
        >
          {busy ? "PLEASE WAIT…" : mode === "login" ? "LOG IN" : "CREATE ACCOUNT"}
          <Icon name="arrow_forward" size={28} />
        </button>
      </form>

      <Link
        href="/"
        className="mt-space-lg flex min-h-14 w-full items-center justify-center gap-space-xs rounded-xl bg-surface-container-low text-label-lg text-primary no-underline press"
      >
        <Icon name="help_center" size={26} />
        Need help signing in? Back to home
      </Link>
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
