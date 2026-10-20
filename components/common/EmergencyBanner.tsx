"use client";

import { useRef, useState, type MouseEvent } from "react";

import Icon from "@/components/common/Icon";
import { deviceCanPlacePhoneCall } from "@/lib/utils/device";

const EMERGENCY_NUMBER = "112";

/**
 * Isolated 112 emergency pad (plan decision D10, DESIGN.md "Isolation of
 * Emergency").
 *
 * The design system reserves crimson for this control alone and pins it to the
 * screen perimeter with clear margins, so it is reachable within a second yet
 * hard to hit by accident while scrolling. Rendered once by the root layout,
 * so it is present on every route.
 *
 * Calling: the pad is a `tel:112` link, which hands the number to the handset's
 * dialer — the only way a web page can reach a phone's calling UI. Laptops have
 * no dialer, so there the same tap opens a panel that shows 112 at full size
 * with a copy button, instead of a link that does nothing.
 *
 * Layout note: the reassurance line is hidden below `sm`. At 390px it cannot
 * wrap inside the row without either pushing the body wider than the viewport
 * or shrinking "EMERGENCY?" past the type floor.
 */
export default function EmergencyBanner() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [copied, setCopied] = useState(false);

  function handleCall(event: MouseEvent<HTMLAnchorElement>) {
    // Phones: let the browser hand the number to the dialer.
    if (deviceCanPlacePhoneCall()) return;

    // Laptops: a `tel:` link has nowhere to go, so show the number instead.
    event.preventDefault();
    setCopied(false);
    dialogRef.current?.showModal();
  }

  async function copyNumber() {
    try {
      await navigator.clipboard.writeText(EMERGENCY_NUMBER);
      setCopied(true);
    } catch {
      // Clipboard blocked or unavailable: the number stays readable on screen.
      setCopied(false);
    }
  }

  function closePanel() {
    dialogRef.current?.close();
  }

  return (
    <aside aria-label="Emergency information" className="sticky bottom-0 z-10 mx-gutter my-space-sm">
      <a
        href={`tel:${EMERGENCY_NUMBER}`}
        onClick={handleCall}
        aria-label={`Call emergency services at ${EMERGENCY_NUMBER}`}
        className="emergency-hop flex min-h-16 w-full items-center justify-between gap-space-xs overflow-hidden rounded-xl bg-emergency px-space-sm py-space-xs text-white press sm:gap-space-sm sm:px-space-md"
      >
        <span className="flex min-w-0 items-center gap-space-xs">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emergency-deep sm:h-14 sm:w-14">
            <Icon name="emergency" size={28} />
          </span>
          <span className="flex min-w-0 flex-col text-left">
            <span className="text-label-xl leading-none font-bold">EMERGENCY?</span>
            <span className="hidden text-body-lg leading-tight sm:block">
              Severe chest pain, major bleeding — call 112 now
            </span>
          </span>
        </span>

        <span className="flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-lg bg-emergency-dark px-space-sm">
          <Icon name="call" size={24} />
          <span className="text-label-lg">{EMERGENCY_NUMBER}</span>
        </span>
      </a>

      {/* Desktop fallback. A laptop cannot dial, so the number, the instruction
          and a copy button take the place of a call that would never happen. */}
      <dialog
        ref={dialogRef}
        aria-labelledby="emergency-panel-title"
        aria-describedby="emergency-panel-help"
        className="emergency-dialog"
        onClick={(event) => {
          // A click on the backdrop lands on the dialog element itself.
          if (event.target === dialogRef.current) closePanel();
        }}
        onClose={() => setCopied(false)}
      >
        <div className="flex items-center gap-space-xs">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-emergency text-white">
            <Icon name="emergency" size={30} />
          </span>
          <h2 id="emergency-panel-title" className="text-headline-lg-mobile">
            Call {EMERGENCY_NUMBER} now
          </h2>
        </div>

        <p id="emergency-panel-help" className="mt-space-sm text-body-xl">
          This device cannot make phone calls. Pick up a phone and dial{" "}
          <strong>{EMERGENCY_NUMBER}</strong>.
        </p>

        <p className="my-space-sm text-center text-[5rem] leading-none font-bold text-emergency">
          {EMERGENCY_NUMBER}
        </p>

        <div className="flex flex-col gap-space-xs">
          <button
            type="button"
            onClick={copyNumber}
            className="flex min-h-16 items-center justify-center gap-3 rounded-lg bg-emergency px-space-md text-label-xl text-white press"
          >
            <Icon name={copied ? "check" : "call"} size={26} />
            {copied ? "NUMBER COPIED" : "COPY 112"}
          </button>

          <a
            href={`tel:${EMERGENCY_NUMBER}`}
            className="flex min-h-14 items-center justify-center gap-2 rounded-lg border-2 border-on-surface bg-white px-space-md text-label-lg text-on-surface no-underline press"
          >
            Try a calling app instead
          </a>

          <button
            type="button"
            onClick={closePanel}
            className="min-h-14 rounded-lg px-space-md text-label-lg font-bold text-on-surface-variant underline"
          >
            Close
          </button>
        </div>

        <p role="status" aria-live="polite" className="sr-only">
          {copied ? `${EMERGENCY_NUMBER} copied to clipboard` : ""}
        </p>
      </dialog>
    </aside>
  );
}
