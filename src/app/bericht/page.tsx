import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { AdvisorReportToolbar } from "@/frontend/bericht/advisor-report-toolbar";
import { loadAdvisorReport } from "@/backend/db/queries/advisor-report";
import { parseAdvisorReportMode } from "@/domain/report/report";
import { AdvisorReportPiiError } from "@/domain/report/anonymize";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Berater-Bericht – Coruscant",
};

interface BerichtPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function firstParam(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function BerichtPage({ searchParams }: BerichtPageProps) {
  const params = await searchParams;
  const mode = parseAdvisorReportMode(firstParam(params.modus));
  const betragRaw = firstParam(params.betrag);

  let loaded: ReturnType<typeof loadAdvisorReport> | null = null;
  let piiError = false;

  try {
    loaded = loadAdvisorReport({
      mode,
      oneTimeRaw: betragRaw,
    });
  } catch (error) {
    if (error instanceof AdvisorReportPiiError) {
      console.error("AdvisorReportPiiError at field:", error.fieldPath);
      piiError = true;
    } else {
      throw error;
    }
  }

  if (piiError || loaded === null) {
    return (
      <div className="mx-auto max-w-xl rounded-xl border border-[var(--rose)]/40 bg-[var(--surface)] p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[var(--rose)]" />
          <div className="space-y-2">
            <h1 className="text-base font-semibold text-[var(--text-primary)]">
              Anonymisierung nicht sicher – Bericht wird nicht angezeigt.
            </h1>
            <p className="text-sm text-[var(--text-secondary)]">
              Bitte Modus „Vollständig“ nutzen oder Namen prüfen.
            </p>
            <div className="pt-1">
              <Link
                href="/bericht?modus=vollstaendig"
                className="inline-flex items-center rounded-lg border border-[var(--border-sub)] bg-[var(--surface-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:opacity-90"
              >
                Modus „Vollständig“ öffnen
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <AdvisorReportToolbar
      view={loaded.view}
      mode={mode}
      initialAmountRaw={betragRaw ?? ""}
      oneTimeInvalid={loaded.oneTimeInvalid}
    />
  );
}
