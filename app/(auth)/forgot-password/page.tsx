"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import Icon from "@/components/common/Icon";
import Topbar from "@/components/common/Topbar";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const FRIENDLY_ERRORS: Record<string, string> = {
  over_email_send_rate_limit: "Too many codes requested. Wait a few minutes and try again.",
  over_request_rate_limit: "Too many attempts. Wait a few minutes and try again.",
  email_invalid: "That email address does not look valid.",
  email_address_invalid: "That email address does not look valid.",
  email_address_not_authorized:
    "This project's email sender is not configured yet. Ask the organiser for help.",
  signup_disabled: "Password recovery is currently disabled.",
};

function toFriendlyMessage(code: string | undefined, fallback: string): string {
  if (code && FRIENDLY_ERRORS[code]) return FRIENDLY_ERRORS[code];
  return fallback || "Something went wrong. Please try again.";
}

/**
 * Step 1 of password recovery: ask Supabase to email a one-time code.
 *
 * The success path is deliberately indistinguishable from "no such account",
 * and it moves straight on to the code screen either way. Saying "we couldn't
 * find that email" would turn this form into a way to discover who has an
 * account here — a real privacy problem for a health app.
 *
 * No password is ever emailed: Supabase stores only a hash, so the message can
 * carry a code that lets the user choose a *new* password, never the old one.
 */
export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const address = email.trim();
    if (!address) {
      setError("Enter the email address you signed up with.");
      return;
    }

    setBusy(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: sendError } = await supabase.auth.resetPasswordForEmail(address, {
        // Only used if the email template also includes a link; the flow here
        // is the 6-digit code, which needs no redirect.
        redirectTo: `${window.location.origin}/login`,
      });

      if (sendError) {
        setError(toFriendlyMessage(sendError.code, sendError.message));
        return;
      }

      router.push(`/reset-password?email=${encodeURIComponent(address)}`);
    } catch {
      setError("Could not reach the account service. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="home-page">
      <Topbar label="RESET PASSWORD" />

      <section className="welcome">
        <p className="eyebrow">CAREPOINT ACCOUNT</p>
        <h1 className="text-headline-xl-mobile sm:text-headline-xl">Forgotten password?</h1>
        <p className="welcome-copy">
          Enter your email address and we will send you a 6-digit code. You will use it to
          choose a new password.
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

        {error ? (
          <p
            role="alert"
            className="flex min-h-14 items-center gap-2 rounded-lg border-2 border-tertiary bg-error-container px-space-sm py-space-xs text-body-lg text-on-error-container"
          >
            <Icon name="error" size={28} className="shrink-0" />
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={busy}
          className="flex min-h-16 w-full items-center justify-center gap-space-xs rounded-xl bg-primary text-label-xl text-white shadow-tactile press disabled:cursor-wait disabled:opacity-70"
        >
          {busy ? "SENDING…" : "SEND MY CODE"}
          <Icon name="mail" size={28} />
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
