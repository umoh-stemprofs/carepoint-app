import Icon from "@/components/common/Icon";

/**
 * Persistent safety + honesty strip (rulebook Ethical Code, plan decision D10).
 *
 * The STEM Festival Health track requires the system to state plainly that it
 * is for non-emergency appointments and that it is a prototype. It lives in the
 * root layout so the statement is on every route, including the ones a judge
 * lands on directly.
 */
export default function PrototypeNotice() {
  return (
    <aside
      aria-label="Prototype and non-emergency notice"
      className="mx-gutter my-space-sm flex items-start gap-3 rounded-lg border-2 border-outline-variant bg-surface-container-high px-space-sm py-space-xs"
    >
      <Icon name="info" size={30} className="mt-1 shrink-0 text-primary" />
      <p className="text-body-lg text-on-surface">
        CarePoint is a <strong>prototype</strong>. It handles{" "}
        <strong>non-emergency appointments only</strong> and must not be used for real
        diagnosis or treatment.
      </p>
    </aside>
  );
}
