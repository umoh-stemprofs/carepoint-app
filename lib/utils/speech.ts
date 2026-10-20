/**
 * Web Speech API read-aloud support (plan decision D8).
 *
 * The target user may not be able to read the screen, so every major card and
 * control offers an audio readout. Rate is held at 0.9 — slightly slower than
 * conversational speech — for cognitive parsing, matching the Stitch samples.
 *
 * Every call is guarded: a browser without speechSynthesis (or SSR) simply
 * does nothing rather than throwing.
 */
export function speakAloud(phrase: string): void {
  if (typeof window === "undefined") return;
  if (!("speechSynthesis" in window)) return;
  if (typeof SpeechSynthesisUtterance === "undefined") return;

  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(phrase);
    utterance.rate = 0.9;
    utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
  } catch {
    // Some webviews reject synthesis outright; silence is the safe fallback.
  }
}
