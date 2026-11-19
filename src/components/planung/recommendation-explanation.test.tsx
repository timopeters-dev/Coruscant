import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RecommendationExplanationBox } from "./recommendation-explanation";

describe("RecommendationExplanationBox", () => {
  const baseExplanation = {
    summary: "Aufteilung auf NOTGROSCHEN und KREDIT-1.",
    items: [
      {
        ref: "P1",
        text: "2.000 € gehen an KREDIT-1 und ZIEL-1.",
      },
    ],
    caveats: ["Hinweis zu KREDIT-1."],
  };

  it("replaces refs with local labels in summary, items, and caveats", () => {
    const html = renderToStaticMarkup(
      <RecommendationExplanationBox
        explainState={{
          status: "ok",
          explanation: baseExplanation,
          fingerprint: "fp-1",
          requestFingerprint: "fp-1",
        }}
        currentFingerprint="fp-1"
        itemLabelsByRef={{ P1: "Musterkredit" }}
        refLabels={{
          NOTGROSCHEN: "Notgroschen",
          "KREDIT-1": "Musterkredit",
          "ZIEL-1": "Urlaub",
        }}
        showDebug={false}
        onRetry={() => {}}
      />,
    );

    expect(html).toContain("Musterkredit");
    expect(html).toContain("Urlaub");
    expect(html).not.toContain("KREDIT-1");
    expect(html).not.toContain("ZIEL-1");
  });

  it("hides explanation and shows reload message when server fingerprint differs from requestFingerprint", () => {
    const html = renderToStaticMarkup(
      <RecommendationExplanationBox
        explainState={{
          status: "ok",
          explanation: baseExplanation,
          fingerprint: "fp-server-changed",
          requestFingerprint: "fp-1",
        }}
        currentFingerprint="fp-1"
        itemLabelsByRef={{ P1: "Musterkredit" }}
        showDebug={false}
        onRetry={() => {}}
      />,
    );

    expect(html).toContain("Deine Daten haben sich geändert – Seite neu laden");
    expect(html).not.toContain("Aufteilung auf");
    expect(html).not.toContain("Veraltet");
  });

  it("marks explanation as stale when only currentFingerprint changed", () => {
    const html = renderToStaticMarkup(
      <RecommendationExplanationBox
        explainState={{
          status: "ok",
          explanation: baseExplanation,
          fingerprint: "fp-1",
          requestFingerprint: "fp-1",
        }}
        currentFingerprint="fp-2"
        itemLabelsByRef={{ P1: "Musterkredit" }}
        refLabels={{ "KREDIT-1": "Musterkredit" }}
        showDebug={false}
        onRetry={() => {}}
      />,
    );

    expect(html).toContain("Veraltet – Eingaben wurden geändert");
    expect(html).toContain("Neu erklären");
    expect(html).toContain("Aufteilung auf");
  });
});
