import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AdvisorReportOutlineItem } from "@/domain/report/report";
import {
  AdvisorReportDialog,
  buildAdvisorDialogHref,
} from "@/frontend/bericht/advisor-report-dialog";

const SAMPLE_OUTLINE: AdvisorReportOutlineItem[] = [
  { sectionId: "profile", label: "Kurzprofil", count: null, isEmpty: false },
  { sectionId: "balance", label: "Bilanz", count: null, isEmpty: false },
  { sectionId: "history", label: "Verlauf", count: 6, isEmpty: false },
  {
    sectionId: "contracts",
    label: "Verträge & Kredite",
    count: 2,
    isEmpty: false,
  },
  { sectionId: "properties", label: "Immobilien", count: 1, isEmpty: false },
  { sectionId: "pots", label: "Töpfe & Ziele", count: 0, isEmpty: true },
  { sectionId: "cashflow", label: "Cashflow", count: null, isEmpty: false },
  {
    sectionId: "recommendations",
    label: "Empfehlungen",
    count: 3,
    isEmpty: false,
  },
];

describe("AdvisorReportDialog", () => {
  it("defaults to anonymized mode, renders outline counts, and links to modus=anonym", () => {
    const html = renderToStaticMarkup(
      <AdvisorReportDialog
        open
        onOpenChange={() => {}}
        outline={SAMPLE_OUTLINE}
      />,
    );

    expect(html).toContain('checked="" value="anonymized"');
    expect(html).toContain("Verträge &amp; Kredite");
    expect(html).toContain(">2<");
    expect(html).toContain("keine Daten");
    expect(html).toContain('href="/bericht?modus=anonym"');
    expect(html).toContain("Aus „Darlehen Musterbank“ wird „KREDIT-1 · Annuität“");
    expect(html).toContain("Die App sendet nichts.");
  });

  it("links to modus=vollstaendig when full mode is selected and omits invalid amounts", () => {
    const fullHtml = renderToStaticMarkup(
      <AdvisorReportDialog
        open
        onOpenChange={() => {}}
        outline={SAMPLE_OUTLINE}
        initialMode="full"
        initialAmount="5.000"
      />,
    );
    expect(fullHtml).toContain('checked="" value="full"');
    expect(fullHtml).toContain('href="/bericht?modus=vollstaendig&amp;betrag=5.000"');

    const invalidResult = buildAdvisorDialogHref("anonymized", "abc");
    expect(invalidResult.invalidAmount).toBe(true);
    expect(invalidResult.href).toBe("/bericht?modus=anonym");

    const invalidHtml = renderToStaticMarkup(
      <AdvisorReportDialog
        open
        onOpenChange={() => {}}
        outline={SAMPLE_OUTLINE}
        initialAmount="-100"
      />,
    );
    expect(invalidHtml).toContain('aria-invalid="true"');
    expect(invalidHtml).toContain('href="/bericht?modus=anonym"');
  });

  it("renders fallback section list without counts when outline is empty", () => {
    const html = renderToStaticMarkup(
      <AdvisorReportDialog open onOpenChange={() => {}} outline={[]} />,
    );
    expect(html).toContain("Kurzprofil");
    expect(html).toContain("Verträge &amp; Kredite");
    expect(html).toContain("Empfehlungen");
    expect(html).not.toContain("keine Daten");
  });
});
