/**
 * Wird bei jeder Navigation neu gemountet: sanftes Einblenden der Seite.
 * Reines CSS (kein JS nötig), respektiert `prefers-reduced-motion`.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
