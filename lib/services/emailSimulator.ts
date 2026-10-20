/**
 * Plan 11.2: the simulated email logger.
 *
 * CarePoint has no mail provider — the plan deliberately *simulates* outbound
 * email so the prototype never sends real mail from a festival stand. The
 * authoritative record is the `public.email_logs` row written by the dispatch
 * trigger in 20261019000004 (right beside the appointment row it describes);
 * this module is the "server console" half of the same feature: it formats a
 * stored row into something that reads like an email and prints it.
 *
 * Server-side only — it belongs in route handlers, never in a client bundle.
 */

export type EmailLogRow = {
  id: string;
  recipient_email: string;
  kind: string;
  subject: string;
  body: string;
  sent_at: string;
};

/** Render one log row in an email-shaped block. */
export function formatEmailLog(row: EmailLogRow): string {
  const rule = "-".repeat(72);
  return [
    rule,
    `To:      ${row.recipient_email || "(no address on file for this account)"}`,
    `Subject: ${row.subject}`,
    `Kind:    ${row.kind}`,
    `Logged:  ${row.sent_at}`,
    rule,
    row.body,
    rule,
  ].join("\n");
}

/** Print every row to the server console, one block per message. */
export function logEmailToServerConsole(rows: readonly EmailLogRow[]): void {
  if (rows.length === 0) {
    console.log("[carepoint/email] no email_logs rows for that appointment");
    return;
  }
  for (const row of rows) {
    console.log(`[carepoint/email]\n${formatEmailLog(row)}`);
  }
}
