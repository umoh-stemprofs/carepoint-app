export default function EmergencyBanner() {
  return (
    <aside className="emergency-banner" aria-label="Emergency information">
      <p>
        <strong>Severe chest pain, major bleeding, or another emergency?</strong>
        <span> Call 112 now.</span>
      </p>
      <a href="tel:112" aria-label="Call emergency services at 112">
        <span className="emergency-number" aria-hidden="true">112</span>
        Call 112
      </a>
    </aside>
  );
}