# Password recovery

Two screens, no new backend: Supabase Auth issues the one-time code, the app
verifies it and sets the new password.

| Screen | Route | What happens |
|---|---|---|
| Request | `/forgot-password` | `resetPasswordForEmail(email)` → Supabase emails a 6-digit code |
| Reset | `/reset-password?email=…` | `verifyOtp({ type: "recovery" })` → `updateUser({ password })` → sign out everywhere → `/login?reset=done` |

A password is **never** emailed. Supabase stores only a hash, so the message
carries a code that lets the user choose a new password.

## Why a 6-digit code and not a link

Supabase's recovery link carries a PKCE verifier that only the browser which
*requested* the reset can redeem. Starting on a laptop and opening the mail on a
phone fails with "invalid link", and Android's in-app mail webview loses the
session too. A code works from any device, and it is typeable by a user who has
never filled a web form before.

## Supabase dashboard checklist

1. **Authentication → URL Configuration**
   - Site URL: the deployed origin (`https://…`).
   - Redirect URLs: add `http://localhost:3105/login` and
     `https://<production-origin>/login`. Only needed when the template also
     contains a link; the code flow itself does not redirect.
2. **Authentication → Email Templates → Reset Password**
   - Include the code. Replace the default body with something like:

     ```html
     <h2>Your CarePoint code</h2>
     <p>Type this code in the app to choose a new password:</p>
     <p style="font-size:32px;letter-spacing:8px;font-weight:bold">{{ .Token }}</p>
     <p>The code expires in 1 hour. If you did not ask for it, ignore this email.</p>
     ```

   - `{{ .Token }}` is the 6 digits. `{{ .ConfirmationURL }}` is the link — keep
     it only if you also want the link flow, which needs an `/auth/confirm`
     route handler that this app does not have.
3. **Authentication → Providers → Email**: "Confirm email" can stay on; recovery
   works whether or not the address was confirmed.
4. **Authentication → Rate Limits**: after custom SMTP the send limit defaults to
   30/hour; the app surfaces `over_email_send_rate_limit` as a friendly message
   and enforces a 60-second resend cooldown.

## Sending the email: Resend over Supabase SMTP

Supabase's built-in sender allows **2 emails per hour and only to members of
your Supabase organisation** — enough to demo one account, not enough for real
patients. Configure custom SMTP:

| Field | Value |
|---|---|
| Host | `smtp.resend.com` |
| Port | `465` (TLS) |
| Username | `resend` |
| Password | your Resend API key (`re_…`) |
| Sender email | an address on a domain verified in Resend |
| Sender name | `CarePoint` |

Resend's free tier covers 3,000 emails/month. Until a domain is verified, the
test sender `onboarding@resend.dev` only delivers to the address that owns the
Resend account.

## Testing

1. Request a code with an address you control; the screen must move on whether
   or not the account exists (no account enumeration).
2. Wrong code → "That code is not right, or it has expired." with no session.
3. Expired code (>1 hour) → "That code has expired. Send a new one below."
4. Correct code + mismatched passwords → caught before any network call.
5. Correct code + new password → signed out of every session, landed on
   `/login?reset=done` with "Password changed. Log in with your new password."
6. Old password refused, new password accepted.
