import Icon from "@/components/common/Icon";

/**
 * Isolated 112 emergency pad (plan decision D10, DESIGN.md "Isolation of
 * Emergency").
 *
 * The design system reserves crimson for this control alone and pins it to the
 * screen perimeter with clear margins, so it is reachable within a second yet
 * hard to hit by accident while scrolling. Rendered once by the root layout,
 * so it is present on every route.
 *
 * Layout note: the reassurance line is hidden below `sm`. At 390px it cannot
 * wrap inside the row without either pushing the body wider than the viewport
 * or shrinking "EMERGENCY?" past the type floor.
 */
export default function EmergencyBanner() {
  return (
    <aside
      aria-label="Emergency information"
      className="sticky bottom-0 z-10 mx-gutter my-space-sm"
    >
      <a
        href="tel:112"
        aria-label="Call emergency services at 112"
        className="flex min-h-16 w-full items-center justify-between gap-space-xs overflow-hidden rounded-xl bg-emergency px-space-sm py-space-xs text-white press sm:gap-space-sm sm:px-space-md"
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
          <span className="text-label-lg">112</span>
        </span>
      </a>
    </aside>
  );
}
