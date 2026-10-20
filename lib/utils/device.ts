/**
 * Does this device have a phone dialer to hand `tel:` links to?
 *
 * The emergency pad is a plain `<a href="tel:112">`, which is the only thing a
 * web page can do to place a call: the browser hands the number to the
 * handset's dialer (its "phone" app) and the user presses the green call key.
 * A web page cannot open the contacts list or dial silently — no such API
 * exists — so `tel:` is the correct and complete implementation.
 *
 * On a laptop there is no dialer at all. Chrome silently does nothing, some
 * Windows builds launch the Microsoft Store, and macOS may bounce to FaceTime.
 * The pad therefore asks this function first and, when the answer is "no",
 * opens an on-screen panel with the number instead of pretending to dial.
 *
 * Detection is a heuristic, not a guarantee: User-Agent decides for phones and
 * tablets, and a coarse pointer plus touch points catches iPadOS, which reports
 * a desktop "Macintosh" UA. `canPlacePhoneCall` is pure so the rules can be
 * checked without a browser.
 */
export type CallCapability = {
  userAgent: string;
  maxTouchPoints: number;
  coarsePointer: boolean;
};

const MOBILE_USER_AGENT =
  /Android|iPhone|iPad|iPod|Windows Phone|IEMobile|Opera Mini|BlackBerry|Mobile Safari/i;

export function canPlacePhoneCall({
  userAgent,
  maxTouchPoints,
  coarsePointer,
}: CallCapability): boolean {
  if (MOBILE_USER_AGENT.test(userAgent)) return true;

  // Touch-only tablets (iPadOS above all) masquerade as desktop Safari.
  return coarsePointer && maxTouchPoints > 0;
}

/**
 * Reads the live browser. Defaults to `true` during SSR, so the server and the
 * first client render both produce the ordinary link — the check only runs
 * inside a click handler, which can never execute without a browser.
 */
export function deviceCanPlacePhoneCall(): boolean {
  if (typeof window === "undefined") return true;

  return canPlacePhoneCall({
    userAgent: navigator.userAgent ?? "",
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    coarsePointer: window.matchMedia?.("(pointer: coarse)").matches ?? false,
  });
}
