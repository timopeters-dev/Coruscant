import { CARD_SURFACE } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Lade-Skelett beim Seitenwechsel: ruhiger Shimmer in der Grundform einer Seite
 * (Titel, Kennzahlen, Hauptfläche). Blendet erst nach kurzer Verzögerung ein,
 * damit schnelle Wechsel nicht flackern.
 */
export default function Loading() {
  return (
    <div className="loading-delayed space-y-6" role="status" aria-live="polite">
      <span className="sr-only">Seite wird geladen …</span>
      <div className="space-y-2.5" aria-hidden="true">
        <div className="skeleton h-8 w-56" />
        <div className="skeleton h-4 w-80 max-w-full" />
      </div>
      <div className="grid gap-4 md:grid-cols-3" aria-hidden="true">
        {[0, 1, 2].map((key) => (
          <div key={key} className={cn(CARD_SURFACE, "space-y-5 p-5")}>
            <div className="flex items-center gap-2.5">
              <div className="skeleton h-7 w-7 rounded-lg" />
              <div className="skeleton h-4 w-24" />
            </div>
            <div className="skeleton h-8 w-40" />
          </div>
        ))}
      </div>
      <div className={cn(CARD_SURFACE, "space-y-4 p-5")} aria-hidden="true">
        <div className="skeleton h-5 w-48" />
        <div className="skeleton h-56 w-full rounded-lg" />
      </div>
    </div>
  );
}
