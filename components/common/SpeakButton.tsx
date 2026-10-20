"use client";

import Icon from "@/components/common/Icon";
import { speakAloud } from "@/lib/utils/speech";

/**
 * Circular "speak aloud" trigger (plan decision D8, DESIGN.md "Buttons").
 *
 * Sits beside the card it describes so a non-literate user can hear that one
 * option without hearing every other control first. Minimum 56×56 per the
 * design system; colour comes from the caller so the same button can sit on a
 * white card, an emerald card or a blue card and stay at full contrast.
 */
export default function SpeakButton({
  phrase,
  label,
  className = "",
  size = 56,
}: {
  phrase: string;
  label: string;
  className?: string;
  size?: number;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => speakAloud(phrase)}
      className={`flex shrink-0 items-center justify-center rounded-full press ${className}`.trim()}
      style={{ minWidth: size, minHeight: size }}
    >
      <Icon name="volume_up" size={Math.round(size * 0.5)} />
    </button>
  );
}
