import { DISCLAIMER } from "@vigil/contracts";

/** FR-12: persistent on every screen via the root layout. Never hide or dismiss. */
export function SafetyBanner() {
  return (
    <div
      role="region"
      aria-label="Safety notice"
      className="sticky top-0 z-50 bg-banner-bg text-banner-fg px-4 py-2 text-center text-sm font-semibold tracking-wide"
    >
      <span aria-hidden="true">⚠ </span>
      {DISCLAIMER}
      <span className="font-normal"> — synthetic data only; alerts are advisory and every decision is a clinician&apos;s.</span>
    </div>
  );
}
