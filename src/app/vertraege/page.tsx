import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { formatBpsDE, formatCentsDE } from "@/lib/domain/money";

export default function VertraegePage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
          Verträge &amp; Immobilien
        </h1>
        <p className="text-sm text-[var(--text-secondary)]">
          Generisches Register für Kredite, Privatdarlehen, Bausparverträge und
          Immobilie #0.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle>Immobilie #0 (Musterstraße 1)</CardTitle>
              <StatusBadge variant="calibrated" detail="Kaufpreis" />
            </div>
            <CardDescription>Selbstgenutztes Eigenheim</CardDescription>
          </CardHeader>
          <CardContent className="flex items-baseline justify-between gap-4">
            <span className="text-xs text-[var(--text-secondary)]">
              Geschätzter Wert
            </span>
            <span className="tabular-nums text-lg font-semibold text-[var(--sky)]">
              {formatCentsDE(48000000)}
            </span>
          </CardContent>
        </Card>

        <Card className="border-dashed border-[var(--border-sub)]">
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle>Baufinanzierung Musterbank</CardTitle>
              <StatusBadge variant="modeled" detail="Projiziert" />
            </div>
            <CardDescription>
              Annuitätendarlehen · Sollzins{" "}
              <span className="tabular-nums">{formatBpsDE(350)}</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-baseline justify-between gap-4">
            <span className="text-xs text-[var(--text-secondary)]">
              Restschuld (Dummy)
            </span>
            <span className="tabular-nums text-lg font-semibold text-[var(--rose)]">
              {formatCentsDE(-29500000)}
            </span>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
