"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";

import Icon from "@/components/common/Icon";
import Topbar from "@/components/common/Topbar";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const CODE_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 60;

/**
 * Step 2 of password recovery: swap the emailed code for a session, then set a
 * new password.
 *
 * A 6-digit code rather than a magic link on purpose. The link Supabase sends
 * carries a PKCE verifier that only the browser which *requested* the reset can
 * use, so "start on the laptop, open the mail on the phone" fails; Android's
 * in-app mail webview loses it too. A code works from any device, and it is
 * typeable by a user who has never filled a web form before.
 *
 * `verifyOtp({ type: "recovery" })` mints a recovery-scoped session, which is
 * what `updateUser` needs — the password itself never leaves the browser except
 * as a fresh hash-bound request.
 */
function ResetPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const emailFromLink = searchParams.get("email") ?? "";

  const [email, setEmail] = useState(emailFromLink);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(
    emailFromLink ? `We sent a 6-digit code to ${emailFromLink}.` : null,
  );
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((seconds) => seconds - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const address = email.trim();
    if (!address) {
      setError("Enter the email address the code was sent to.");
      return;
    }
    if (code.length !== CODE_LENGTH) {
      setError(`Enter all ${CODE_LENGTH} digits of the code.`);
      return;
    }
    if (password.length < 6) {
      setError("Choose a password of at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }

    setBusy(true);
    try {
      const supabase = createSupabaseBrowserClient();

      const { error: verifyError } = await supabase.auth.verifyOtp({
        email: address,
        token: code,
        type: "recovery",
      });

      if (verifyError) {
        // Supabase answers `otp_expired` for a mistyped code as well as a stale
        // one, so the message has to cover both — telling someone their valid
        // code "expired" when they fat-fingered it sends them down the wrong path.
        setError(
          verifyError.code === "over_request_rate_limit"
            ? "Too many code checks. Wait a few minutes and try again."
            : "That code is not right, or it has expired. Check the digits or send a new one below.",
        );
        return;
      }

      const { error: updateError } = await supabase.auth.updateUser({ password });

      if (updateError) {
        setError(
          updateError.code === "same_password"
            ? "Choose a password you have not used on CarePoint before."
            : updateError.code === "weak_password"
              ? "Choose a password of at least 6 characters."
              : updateError.message ||
                "The password could not be changed. Request a new code and try again.",
        );
        return;
      }

      // A recovery session is still a session: end it everywhere, including
      // this tab, so the user proves the new password at the login screen. The
      // password is already changed at this point — a failed sign-out must not
      // be reported as a failed reset.
      try {
        await supabase.auth.signOut({ scope: "others" });
        await supabase.auth.signOut();
      } catch {
        // Sessions expire on their own; the reset itself succeeded.
      }

      router.replace("/login?reset=done");
    } catch {
      setError("Could not reach the account service. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function resendCode() {
    const address = email.trim();
    if (!address) {
      setError("Enter the email address the code was sent to.");
      return;
    }

    setError(null);
    setResending(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: sendError } = await supabase.auth.resetPasswordForEmail(address, {
        redirectTo: `${window.location.origin}/login`,
      });

      if (sendError) {
        setError(
          sendError.code === "over_email_send_rate_limit"
            ? "Too many codes requested. Wait a few minutes and try again."
            : sendError.message || "The code could not be sent. Try again in a moment.",
        );
        return;
      }

      setNotice(`A new code is on its way to ${address}.`);
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch {
      setError("Could not reach the account service. Check your connection and try again.");
    } finally {
      setResending(false);
    }
  }

  return (
    <main className="home-page">
      <Topbar label="RESET PASSWORD" />

      <section className="welcome">
        <p className="eyebrow">CAREPOINT ACCOUNT</p>
        <h1 className="text-headline-xl-mobile sm:text-headline-xl">Choose a new password.</h1>
        <p className="welcome-copy">
          Type the 6-digit code from your email, then choose a new password you will
          remember.
        </p>
      </section>

      <form onSubmit={handleSubmit} noValidate className="mt-space-md flex flex-col gap-space-md">
        <div className="flex flex-col gap-1.5">
          <label className="flex items-center gap-2 text-label-lg text-on-surface" htmlFor="email">
            <Icon name="mail" size={24} className="text-primary" />
            Email address
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="min-h-16 w-full rounded-xl bg-surface-container-low px-4 text-body-xl text-on-surface placeholder:text-outline focus:bg-white"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="flex items-center gap-2 text-label-lg text-on-surface" htmlFor="code">
            <Icon name="lock" size={24} className="text-primary" />
            6-digit code
          </label>
          <input
            id="code"
            name="code"
            type="text"
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={CODE_LENGTH}
            required
            value={code}
            onChange={(event) =>
              setCode(event.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH))
            }
            aria-describedby="code-help"
            className="min-h-16 w-full rounded-xl bg-surface-container-low px-4 text-center text-[32px] tracking-[0.4em] text-on-surface placeholder:text-outline focus:bg-white"
          />
          <p id="code-help" className="text-body-lg text-on-surface-variant">
            The code has 6 numbers. Check your spam folder if it has not arrived.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            className="flex items-center gap-2 text-label-lg text-on-surface"
            htmlFor="password"
          >
            <Icon name="lock" size={24} className="text-primary" />
            New password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={6}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="min-h-16 w-full rounded-xl bg-surface-container-low px-4 text-body-xl text-on-surface placeholder:text-outline focus:bg-white"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="flex items-center gap-2 text-label-lg text-on-surface" htmlFor="confirm">
            <Icon name="check_circle" size={24} className="text-primary" />
            Type the new password again
          </label>
          <input
            id="confirm"
            name="confirm"
            type="password"
            autoComplete="new-password"
            required
            minLength={6}
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
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
          {busy ? "SAVING…" : "SAVE NEW PASSWORD"}
          <Icon name="arrow_forward" size={28} />
        </button>

        <button
          type="button"
          onClick={resendCode}
          disabled={resending || cooldown > 0}
          className="flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-surface-container-low text-label-lg text-primary press disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Icon name="mail" size={24} />
          {cooldown > 0
            ? `SEND A NEW CODE IN ${cooldown}s`
            : resending
              ? "SENDING…"
              : "SEND A NEW CODE"}
        </button>
      </form>

      <Link
        href="/login"
        className="mt-space-lg flex min-h-14 w-full items-center justify-center gap-space-xs rounded-xl bg-surface-container-low text-label-lg text-primary no-underline press"
      >
        <Icon name="arrow_back" size={26} />
        Back to log in
      </Link>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<main className="home-page">Loading…</main>}>
      <ResetPanel />
    </Suspense>
  );
}
