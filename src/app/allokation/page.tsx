import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { formatCentsDE } from "@/lib/domain/money";

export default function AllokationPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
          Cashflow &amp; Wasserfall
        </h1>
        <p className="text-sm text-[var(--text-secondary)]">
          Haushalts-Positionen (Modus A), priorisierte Ziel-Töpfe und
          1-Klick-Verteilung.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border-dashed border-[var(--border-sub)]">
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle>Haushalts-Überschuss (Modus A)</CardTitle>
              <StatusBadge variant="modeled" />
            </div>
            <CardDescription>
              Abgeleitet aus Pauschalen &amp; verknüpften Vertragsraten
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-baseline justify-between gap-4">
            <span className="text-xs text-[var(--text-secondary)]">
              Frei verteilbar / Monat
            </span>
            <span className="tabular-nums text-lg font-semibold text-[var(--emerald)]">
              {formatCentsDE(145000, { showPlusSign: true })}
            </span>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle>Topf: Instandhaltungsrücklage</CardTitle>
              <StatusBadge variant="calibrated" detail="Priorität 1" />
            </div>
            <CardDescription>Zielregel: Bis Zielwert auffüllen</CardDescription>
          </CardHeader>
          <CardContent className="flex items-baseline justify-between gap-4">
            <span className="text-xs text-[var(--text-secondary)]">
              Aktuell / Ziel
            </span>
            <span className="tabular-nums text-lg font-semibold">
              {formatCentsDE(850000)} / {formatCentsDE(1500000)}
            </span>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
