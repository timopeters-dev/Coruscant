/**
 * Bildmarke der Begleit-App Bespin (Wolkenstadt). Gleiche Geometrie wie in
 * `finanz_cockpit` (`src/app/components/ui/bespin-mark.tsx`); einfarbig über
 * `currentColor`, damit sie sich dem Eichamt-Look unterordnet.
 */
export function BespinMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <rect x="11.35" y="2.6" width="1.3" height="3" rx="0.65" />
      <path d="M8.4 9.1a3.6 3.3 0 0 1 7.2 0Z" />
      <path d="M1.6 9.9h20.8l-1.05 1.45H2.65Z" />
      <path d="M3.4 12.4h17.2c-1.85 2.75-4.95 3.95-8.6 3.95s-6.75-1.2-8.6-3.95Z" />
      <rect x="11.3" y="16" width="1.4" height="3" />
      <path d="M12 18.2l2.2 2.2-2.2 2.2-2.2-2.2Z" />
    </svg>
  );
}
