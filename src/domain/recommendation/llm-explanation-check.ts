/** Prüft KI-Erklärungen: nur bekannte Posten, keine erfundenen Zahlen. */
import { recommendationExplanationSchema, type RecommendationExplanation } from "@/validation/recommendation";
import type { RecommendationLlmView } from "./llm-recommendation-view";

export type ExplanationViolation =
  | { code: "invalid_json"; message: string }
  | { code: "unknown_ref"; ref: string }
  | { code: "unknown_placeholder"; placeholder: string }
  | { code: "literal_amount"; token: string }
  | { code: "cent_like"; token: string }
  | { code: "unknown_number"; token: string };

export type ValidateExplanationResult =
  | { ok: true; explanation: RecommendationExplanation }
  | { ok: false; violations: ExplanationViolation[] };

function extractAllowedLiterals(view: RecommendationLlmView): Set<number> {
  const allowed = new Set<number>();
  for (const val of Object.values(view.werte)) {
    const monateMatch = val.match(/^(\d+)\s+(?:Monate|Monatsausgaben|Wechsel)$/);
    if (monateMatch) {
      const n = Number(monateMatch[1]);
      if (Number.isSafeInteger(n) && n <= 120) {
        allowed.add(n);
      }
    }
    const dateMatch = val.match(/^\d{2}\.(\d{4})$/);
    if (dateMatch) {
      const year = Number(dateMatch[1]);
      if (Number.isSafeInteger(year)) {
        allowed.add(year);
      }
    }
  }
  return allowed;
}

const PLACEHOLDER_REGEX = /\{([A-Z]+[0-9]*(?:\.[a-zA-Z]+)?)\}/g;

function buildViewRefRegex(view: RecommendationLlmView): RegExp | null {
  const refs = new Set<string>();
  for (const p of view.posten) {
    refs.add(p.ref);
    if (p.ziel) refs.add(p.ziel);
  }
  for (const h of view.hinweise) {
    if (h.ziel) refs.add(h.ziel);
  }
  const withDigits = Array.from(refs)
    .filter((r) => /\d/.test(r))
    .sort((a, b) => b.length - a.length);
  if (withDigits.length === 0) return null;
  const escaped = withDigits.map((r) =>
    r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  return new RegExp(`\\b(?:${escaped.join("|")})\\b`, "g");
}

function checkTextField(
  text: string,
  view: RecommendationLlmView,
  allowedLiterals: Set<number>,
  rawCentSet: Set<number>,
  viewRefRegex: RegExp | null,
  violations: ExplanationViolation[],
): string {
  PLACEHOLDER_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PLACEHOLDER_REGEX.exec(text)) !== null) {
    const key = match[1]!;
    if (!(key in view.werte)) {
      violations.push({ code: "unknown_placeholder", placeholder: key });
    }
  }

  let stripped = text.replace(PLACEHOLDER_REGEX, " ");
  if (viewRefRegex) {
    viewRefRegex.lastIndex = 0;
    stripped = stripped.replace(viewRefRegex, " ");
  }
  const numRegex = /\d+(?:[.,]\d+)*/g;
  numRegex.lastIndex = 0;
  while ((match = numRegex.exec(stripped)) !== null) {
    const token = match[0];
    const after = stripped.slice(match.index + token.length);
    if (
      /^\s*(?:€|%|(?:EUR|Euro|Cent|ct|Prozent|Prozentpunkte?)\b)/i.test(after)
    ) {
      violations.push({ code: "literal_amount", token });
      continue;
    }
    if (/^\d+(?:\.\d{3})*$/.test(token)) {
      const n = Number(token.replaceAll(".", ""));
      if (allowedLiterals.has(n)) {
        continue;
      }
      if (rawCentSet.has(n) || n >= 1000) {
        violations.push({ code: "cent_like", token });
        continue;
      }
    }
    violations.push({ code: "unknown_number", token });
  }

  return text.replace(PLACEHOLDER_REGEX, (_, key: string) => {
    return view.werte[key] ?? `{${key}}`;
  });
}

export function validateExplanation(
  raw: unknown,
  view: RecommendationLlmView,
  rawCentValues: readonly number[] = [],
): ValidateExplanationResult {
  const parsed = recommendationExplanationSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      violations: [
        {
          code: "invalid_json",
          message: parsed.error.issues[0]?.message ?? "Ungültiges Schema",
        },
      ],
    };
  }

  const violations: ExplanationViolation[] = [];
  const validRefs = new Set(view.posten.map((p) => p.ref));
  const seenRefs = new Set<string>();

  for (const item of parsed.data.items) {
    if (!validRefs.has(item.ref) || seenRefs.has(item.ref)) {
      violations.push({ code: "unknown_ref", ref: item.ref });
    }
    seenRefs.add(item.ref);
  }

  const allowedLiterals = extractAllowedLiterals(view);
  const rawCentSet = new Set(rawCentValues.map((v) => Math.abs(v)));
  const viewRefRegex = buildViewRefRegex(view);

  const substitutedSummary = checkTextField(
    parsed.data.summary,
    view,
    allowedLiterals,
    rawCentSet,
    viewRefRegex,
    violations,
  );
  const substitutedItems = parsed.data.items.map((item) => ({
    ref: item.ref,
    text: checkTextField(
      item.text,
      view,
      allowedLiterals,
      rawCentSet,
      viewRefRegex,
      violations,
    ),
  }));
  const substitutedCaveats = parsed.data.caveats.map((c) =>
    checkTextField(
      c,
      view,
      allowedLiterals,
      rawCentSet,
      viewRefRegex,
      violations,
    ),
  );

  if (violations.length > 0) {
    return { ok: false, violations };
  }

  const allSubstituted = [
    substitutedSummary,
    ...substitutedItems.map((i) => i.text),
    ...substitutedCaveats,
  ];
  for (const s of allSubstituted) {
    if (/\b(?:cent|ct)\b/i.test(s)) {
      return {
        ok: false,
        violations: [{ code: "cent_like", token: "Cent" }],
      };
    }
  }

  return {
    ok: true,
    explanation: {
      summary: substitutedSummary,
      items: substitutedItems,
      caveats: substitutedCaveats,
    },
  };
}
