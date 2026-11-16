import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { formatCentsDE } from "@/lib/domain/money";

export default function CockpitPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
          Haushalts-Cockpit
        </h1>
        <p className="text-sm text-[var(--text-secondary)]">
          Konsolidierter Überblick über Aktiva, Passiva, Nettovermögen und
          anstehende Meilensteine.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardDescription>Nettovermögen (Beispiel)</CardDescription>
              <StatusBadge variant="calibrated" detail="01.11.2026" />
            </div>
            <CardTitle className="tabular-nums text-2xl text-[var(--emerald)]">
              {formatCentsDE(24850000)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-[var(--text-secondary)]">
              Konsolidiert aus Haushalts-Aktiva und{" "}
              <span className="font-medium text-[var(--text-primary)]">
                finanz_cockpit
              </span>
              .
            </p>
          </CardContent>
        </Card>

        <Card className="border-dashed border-[var(--border-sub)]">
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardDescription>Monatlicher Überschuss</CardDescription>
              <StatusBadge variant="modeled" />
            </div>
            <CardTitle className="tabular-nums text-2xl">
              {formatCentsDE(145000, { showPlusSign: true })}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-[var(--text-secondary)]">
              Modelliert nach Modus A (Split-Haushaltspositionen).
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardDescription>Nächster Meilenstein</CardDescription>
              <StatusBadge variant="ai_suggestion" label="Hinweis" />
            </div>
            <CardTitle className="tabular-nums text-2xl text-[var(--sky)]">
              {formatCentsDE(3200000)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-[var(--text-secondary)]">
              Bauspar-Zuteilung (Musterbank) voraussichtlich{" "}
              <span className="tabular-nums font-medium text-[var(--text-primary)]">
                06/2028
              </span>
              .
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
