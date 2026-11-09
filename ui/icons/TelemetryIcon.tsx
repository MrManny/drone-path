// Line glyph in the Lucide grid and stroke style (24px grid, 2px round strokes).
// Drawn for this app rather than vendored, so THIRD-PARTY-NOTICES.md needs no entry.
export function TelemetryIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M8 12h1.5l1.5-3 2 6 1.5-3H16" />
    </svg>
  );
}
