import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { formatCentsDE } from "@/lib/domain/money";

export default function DokumentePage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
          KI-Dokumenten-Inbox
        </h1>
        <p className="text-sm text-[var(--text-secondary)]">
          PDF-Upload, KI-gestützte Extraktion mit 1-Klick-Freigabe,
          Steuer-Tagging und Vertrags-Eichung.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border-[var(--amber)]/35">
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle>Jahresauszug_Musterbank_2025.pdf</CardTitle>
              <StatusBadge variant="ai_suggestion" />
            </div>
            <CardDescription>
              Vorgeschlagene Vertrags-Eichung · wartet auf Freigabe
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-baseline justify-between gap-4">
            <span className="text-xs text-[var(--text-secondary)]">
              Erkannter Saldo
            </span>
            <span className="tabular-nums text-lg font-semibold text-[var(--amber)]">
              {formatCentsDE(-29500000)}
            </span>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle>Handwerker_Musterbetrieb_2025.pdf</CardTitle>
              <StatusBadge variant="calibrated" detail="Verifiziert" />
            </div>
            <CardDescription>Steuerrelevant (§ 35a) · Steuerjahr 2025</CardDescription>
          </CardHeader>
          <CardContent className="flex items-baseline justify-between gap-4">
            <span className="text-xs text-[var(--text-secondary)]">
              Absetzbarer Lohnanteil
            </span>
            <span className="tabular-nums text-lg font-semibold text-[var(--emerald)]">
              {formatCentsDE(84000)}
            </span>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
