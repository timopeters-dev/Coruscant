import {
  recommendationExplanationSchema,
  type RecommendationExplanation,
} from "@/lib/validation/recommendation";
import {
  selectContextGoalPots,
  type ContextAssetClass,
  type ContextGoalKind,
  type InvestmentContext,
} from "./investment-context";
import { assertSafeInteger, formatBpsDE, formatEuroDE } from "./money";
import type {
  RecommendationItemKind,
  RecommendationReason,
  RecommendationResult,
  RecommendationState,
} from "./recommendation";

export interface LlmInvestmentContextView {
  schemaVersion: 2;
  asOfMonth: string;
  dataQuality: {
    snapshotAgeDays: number | null;
    isDummyHousehold: boolean;
    positionCount: number;
    truncatedPositionCount: number;
  };
  portfolio: {
    totalValue: string;
    assetClasses: {
      assetClass: ContextAssetClass;
      value: string;
      weight: string;
    }[];
    positions: {
      ref: string;
      assetClass: ContextAssetClass;
      weight: string;
      instrumentName: string | null;
      isin: string | null;
    }[];
    otherPositionsWeight: string;
    largestPositionWeight: string;
  };
  liquidity: {
    liquid: string;
    brokerageCash: string;
    monthlyLivingCosts: string | null;
    coverageMonths: string | null;
  };
  emergencyFund: {
    configured: boolean;
    current: string;
    target: string | null;
    coverageMonths: string | null;
  };
  goals: {
    ref: string;
    purpose: "goal" | "investment" | "unspecified";
    kind: ContextGoalKind;
    current: string;
    target: string | null;
    horizonMonths: number | null;
  }[];
  milestones: {
    ref: string;
    category: "loan" | "savings_contract";
    kind: "milestone" | "fixed_interest_end";
    monthsUntil: number;
    outstandingBalance: string | null;
    interestRate: string | null;
  }[];
  cashflow: {
    monthlySurplus: string;
    monthlySavingsRate: string;
  };
}

function formatTenthsDE(tenths: number | null): string | null {
  if (tenths === null) return null;
  const safe = assertSafeInteger(tenths, "tenths");
  const abs = Math.abs(safe);
  const whole = Math.trunc(abs / 10);
  const frac = abs % 10;
  const sign = safe < 0 ? "-" : "";
  return `${sign}${whole},${frac}`;
}

export function buildLlmInvestmentContextView(
  ctx: InvestmentContext,
): LlmInvestmentContextView {
  return {
    schemaVersion: 2,
    asOfMonth: ctx.asOfMonth,
    dataQuality: {
      snapshotAgeDays: ctx.dataQuality.snapshotAgeDays,
      isDummyHousehold: ctx.dataQuality.isDummyHousehold,
      positionCount: ctx.dataQuality.positionCount,
      truncatedPositionCount: ctx.dataQuality.truncatedPositionCount,
    },
    portfolio: {
      totalValue: formatEuroDE(ctx.portfolio.totalValueCents),
      assetClasses: ctx.portfolio.assetClasses.map((a) => ({
        assetClass: a.assetClass,
        value: formatEuroDE(a.valueCents),
        weight: formatBpsDE(a.weightBps),
      })),
      positions: ctx.portfolio.positions.map((p) => ({
        ref: p.ref,
        assetClass: p.assetClass,
        weight: formatBpsDE(p.weightBps),
        instrumentName: p.instrumentName,
        isin: p.isin,
      })),
      otherPositionsWeight: formatBpsDE(ctx.portfolio.otherPositionsWeightBps),
      largestPositionWeight: formatBpsDE(
        ctx.portfolio.largestPositionWeightBps,
      ),
    },
    liquidity: {
      liquid: formatEuroDE(ctx.liquidity.liquidCents),
      brokerageCash: formatEuroDE(ctx.liquidity.brokerageCashCents),
      monthlyLivingCosts:
        ctx.liquidity.monthlyLivingCostsCents !== null
          ? formatEuroDE(ctx.liquidity.monthlyLivingCostsCents)
          : null,
      coverageMonths: formatTenthsDE(ctx.liquidity.coverageMonthsTenths),
    },
    emergencyFund: {
      configured: ctx.emergencyFund.configured,
      current: formatEuroDE(ctx.emergencyFund.currentCents),
      target:
        ctx.emergencyFund.targetCents !== null
          ? formatEuroDE(ctx.emergencyFund.targetCents)
          : null,
      coverageMonths: formatTenthsDE(ctx.emergencyFund.coverageMonthsTenths),
    },
    goals: ctx.goals.map((g) => ({
      ref: g.ref,
      purpose: g.purpose,
      kind: g.kind,
      current: formatEuroDE(g.currentCents),
      target: g.targetCents !== null ? formatEuroDE(g.targetCents) : null,
      horizonMonths: g.horizonMonths,
    })),
    milestones: ctx.milestones.map((m) => ({
      ref: m.ref,
      category: m.category,
      kind: m.kind,
      monthsUntil: m.monthsUntil,
      outstandingBalance:
        m.outstandingBalanceCents !== null
          ? formatEuroDE(m.outstandingBalanceCents)
          : null,
      interestRate:
        m.interestRateBps !== null ? formatBpsDE(m.interestRateBps) : null,
    })),
    cashflow: {
      monthlySurplus: formatEuroDE(ctx.cashflow.monthlySurplusCents),
      monthlySavingsRate: formatEuroDE(ctx.cashflow.monthlySavingsRateCents),
    },
  };
}

export function serializeLlmContext(view: unknown): string {
  return JSON.stringify(view);
}

export function collectRawCentValues(ctx: InvestmentContext): number[] {
  const candidates: (number | null)[] = [
    ctx.portfolio.totalValueCents,
    ...ctx.portfolio.assetClasses.map((a) => a.valueCents),
    ctx.liquidity.liquidCents,
    ctx.liquidity.brokerageCashCents,
    ctx.liquidity.monthlyLivingCostsCents,
    ctx.emergencyFund.currentCents,
    ctx.emergencyFund.targetCents,
    ...ctx.goals.flatMap((g) => [g.currentCents, g.targetCents]),
    ...ctx.milestones.map((m) => m.outstandingBalanceCents),
    ctx.cashflow.monthlySurplusCents,
    ctx.cashflow.monthlySavingsRateCents,
  ];
  const out = new Set<number>();
  for (const val of candidates) {
    if (val !== null && Math.abs(val) >= 1000) {
      out.add(Math.abs(val));
    }
  }
  return Array.from(out);
}

export function findCentLikeNumbers(
  texts: readonly string[],
  rawCentValues: readonly number[],
): string[] {
  const centSet = new Set(rawCentValues.map((v) => Math.abs(v)));
  const hits: string[] = [];
  const numberRegex = /\d+(?:[.,]\d+)*/g;

  for (const text of texts) {
    let match: RegExpExecArray | null;
    numberRegex.lastIndex = 0;
    while ((match = numberRegex.exec(text)) !== null) {
      const token = match[0];
      const after = text.slice(match.index + token.length);
      if (/^\s*(?:cent|ct)\b/i.test(after)) {
        hits.push(token);
        continue;
      }
      if (/^\d+(?:\.\d{3})*$/.test(token)) {
        const num = Number(token.replaceAll(".", ""));
        if (Number.isSafeInteger(num) && num >= 1000 && centSet.has(num)) {
          hits.push(token);
        }
      }
    }
  }
  return hits;
}

export type RecommendationLlmArt =
  | "notgroschen"
  | "ziel_topf"
  | "sondertilgung"
  | "ratenerhoehung"
  | "tilgungsreserve"
  | "etf"
  | "liquiditaet";

const ITEM_KIND_TO_LLM_ART: Record<RecommendationItemKind, RecommendationLlmArt> =
  {
    emergency_fund: "notgroschen",
    pot_deadline: "ziel_topf",
    loan_prepayment: "sondertilgung",
    loan_rate_increase: "ratenerhoehung",
    loan_reserve: "tilgungsreserve",
    etf: "etf",
    keep_liquid: "liquiditaet",
  };

export interface RecommendationLlmView {
  schemaVersion: 1;
  art: "einmalbetrag" | "sparrate";
  posten: {
    ref: string;
    art: RecommendationLlmArt;
    ziel: string;
    gruende: {
      code: RecommendationReason["code"];
      platzhalter: string[];
    }[];
  }[];
  hinweise: {
    code: string;
    ziel?: string;
  }[];
  annahmen: {
    platzhalter: string[];
  };
  werte: Record<string, string>;
  datenqualitaet: {
    isDummyHousehold: boolean;
    horizonEstimated: boolean;
  };
}

function formatMonthYearDE(ym: string): string {
  const [year, month] = ym.split("-");
  if (!year || !month) return ym;
  return `${month}.${year}`;
}

function formatIsoDateMonthYearDE(isoDate: string): string {
  return formatMonthYearDE(isoDate.slice(0, 7));
}

export function buildRecommendationLlmView(
  result: RecommendationResult,
  state: RecommendationState,
  options: { isDummyHousehold: boolean },
): RecommendationLlmView {
  const goalPots = selectContextGoalPots(state.pots);
  const potRefMap = new Map<string, string>();
  for (const pot of state.pots) {
    if (pot.purpose === "emergency_fund") {
      potRefMap.set(pot.id, "NOTGROSCHEN");
    }
  }
  goalPots.forEach((pot, idx) => {
    potRefMap.set(pot.id, `ZIEL-${idx + 1}`);
  });

  const loanRefMap = new Map<string, string>();
  result.loanOrder.forEach((loanId, idx) => {
    loanRefMap.set(loanId, `KREDIT-${idx + 1}`);
  });

  const werte: Record<string, string> = {
    BETRAG: formatEuroDE(result.amountCents),
    "ANNAHME.rendite": formatBpsDE(result.assumptions.etfAnnualReturnBps),
    "ANNAHME.aufschlag": formatBpsDE(result.assumptions.safetyMarginBps),
    "ANNAHME.notgroschenMonate": `${result.assumptions.emergencyFundMonths} Monatsausgaben`,
    "ANNAHME.terminHorizontMonate": `${result.assumptions.shortHorizonMonths} Monate`,
    "ANNAHME.pauschbetrag": formatEuroDE(result.assumptions.saverAllowanceCents),
    "ANNAHME.puffer": formatBpsDE(result.assumptions.savingsBufferBps),
    "ANNAHME.notgroschenAuffuellMonate": `${result.assumptions.emergencyFillMonths} Monate`,
  };

  let horizonEstimated = false;

  const posten = result.items.map((item) => {
    const betragKey = `${item.ref}.betrag`;
    werte[betragKey] = formatEuroDE(item.amountCents);
    if (item.currentMonthlyRateCents !== undefined) {
      werte[`${item.ref}.aktuelleRate`] = formatEuroDE(
        item.currentMonthlyRateCents,
      );
    }
    if (item.newMonthlyRateCents !== undefined) {
      werte[`${item.ref}.neueRate`] = formatEuroDE(item.newMonthlyRateCents);
    }

    let ziel = "KONTO";
    if (item.target.type === "pot") {
      ziel = potRefMap.get(item.target.potId) ?? "ZIEL";
    } else if (item.target.type === "loan") {
      ziel = loanRefMap.get(item.target.loanId) ?? "KREDIT";
    } else if (item.kind === "emergency_fund") {
      ziel = "NOTGROSCHEN";
    } else if (item.kind === "etf") {
      ziel = "ETF";
    } else if (item.kind === "loan_reserve") {
      ziel = "KREDIT";
    }

    const gruende = item.reasons.map((reason) => {
      const platzhalter: string[] = [betragKey];
      const addVal = (suffix: string, formatted: string) => {
        const key = `${item.ref}.${suffix}`;
        werte[key] = formatted;
        platzhalter.push(key);
      };

      switch (reason.code) {
        case "EMERGENCY_FUND_GAP":
          addVal("ziel", formatEuroDE(reason.targetCents));
          addVal("aktuell", formatEuroDE(reason.currentCents));
          addVal("monate", `${reason.months} Monatsausgaben`);
          break;
        case "EMERGENCY_FUND_NO_POT":
          break;
        case "POT_DEADLINE_GAP":
          addVal("termin", formatMonthYearDE(reason.targetMonth));
          addVal("restMonate", `${reason.restMonths} Monate`);
          addVal("luecke", formatEuroDE(reason.shortfallAtDeadlineCents));
          break;
        case "POT_DEADLINE_UNREACHABLE":
          addVal("termin", formatMonthYearDE(reason.targetMonth));
          addVal("restLuecke", formatEuroDE(reason.remainingGapCents));
          break;
        case "PREPAYMENT_BEATS_ETF":
          addVal("zins", formatBpsDE(reason.interestRateBps));
          if (reason.breakEvenBps !== null) {
            addVal("breakEven", formatBpsDE(reason.breakEvenBps));
          }
          addVal("rendite", formatBpsDE(reason.expectedReturnBps));
          break;
        case "PREPAYMENT_CAP_REACHED":
          addVal("limit", formatEuroDE(reason.capCents));
          addVal("genutzt", formatEuroDE(reason.usedCents));
          addVal("ueberlauf", formatEuroDE(reason.overflowCents));
          break;
        case "PREPAYMENT_CAP_UNKNOWN":
          break;
        case "FIXED_INTEREST_ENDS_SOON":
          addVal("zinsende", formatIsoDateMonthYearDE(reason.fixedInterestUntil));
          addVal("restMonate", `${reason.monthsUntil} Monate`);
          if (reason.futureRateBps !== null) {
            addVal("folgeZins", formatBpsDE(reason.futureRateBps));
          }
          break;
        case "HORIZON_ESTIMATED":
          horizonEstimated = true;
          addVal("horizont", `${reason.horizonMonths} Monate`);
          break;
        case "ETF_BEATS_PREPAYMENT":
          addVal("zins", formatBpsDE(reason.interestRateBps));
          addVal("breakEven", formatBpsDE(reason.breakEvenBps));
          addVal("rendite", formatBpsDE(reason.expectedReturnBps));
          break;
        case "ETF_NO_LOAN":
        case "ETF_AFTER_LOANS":
          break;
        case "KEEP_LIQUID_NON_POSITIVE_RETURN":
          addVal("rendite", formatBpsDE(reason.expectedReturnBps));
          break;
        case "SURPLUS_BUFFER":
          addVal("puffer", formatBpsDE(reason.bufferBps));
          break;
        case "EMERGENCY_FUND_MONTHLY":
          addVal("luecke", formatEuroDE(reason.gapCents));
          addVal("auffuellMonate", `${reason.fillMonths} Monate`);
          break;
        case "POT_MONTHLY_REQUIRED":
          addVal("rate", formatEuroDE(reason.requiredMonthlyCents));
          addVal("termin", formatMonthYearDE(reason.targetMonth));
          break;
        case "POT_MONTHLY_INSUFFICIENT":
          addVal("rate", formatEuroDE(reason.requiredMonthlyCents));
          addVal("termin", formatMonthYearDE(reason.targetMonth));
          break;
        case "RATE_INCREASE_BEATS_ETF":
          addVal("zins", formatBpsDE(reason.interestRateBps));
          if (reason.breakEvenBps !== null) {
            addVal("breakEven", formatBpsDE(reason.breakEvenBps));
          }
          addVal("rendite", formatBpsDE(reason.expectedReturnBps));
          addVal("aktuelleRate", formatEuroDE(reason.currentMonthlyRateCents));
          addVal("neueRate", formatEuroDE(reason.newMonthlyRateCents));
          if (reason.remainingChangesAfter !== null) {
            addVal("restWechsel", `${reason.remainingChangesAfter} Wechsel`);
          }
          if (reason.latestChangeDate !== null) {
            addVal(
              "wechselBis",
              formatIsoDateMonthYearDE(reason.latestChangeDate),
            );
          }
          break;
        case "RATE_CHANGE_CORRIDOR_LIMIT":
          addVal("maxRate", formatEuroDE(reason.maxMonthlyCents));
          break;
        case "RATE_CHANGE_SHARE_LIMIT":
          addVal("anteilLimit", formatBpsDE(reason.shareBps));
          break;
        case "RATE_CHANGE_COUNT_UNKNOWN":
          break;
        case "PREPAYMENT_CAP_PERCENT_OF_BALANCE":
          addVal("prozentLimit", formatBpsDE(reason.percentBps));
          addVal("limit", formatEuroDE(reason.capCents));
          break;
      }

      return { code: reason.code, platzhalter };
    });

    return {
      ref: item.ref,
      art: ITEM_KIND_TO_LLM_ART[item.kind],
      ziel,
      gruende,
    };
  });

  const hinweise = result.notes.map((note) => {
    if ("potId" in note) {
      return {
        code: note.code,
        ziel: potRefMap.get(note.potId) ?? "ZIEL",
      };
    }
    if ("loanId" in note) {
      return {
        code: note.code,
        ziel: loanRefMap.get(note.loanId) ?? "KREDIT",
      };
    }
    return { code: note.code };
  });

  return {
    schemaVersion: 1,
    art: result.mode === "one_time" ? "einmalbetrag" : "sparrate",
    posten,
    hinweise,
    annahmen: {
      platzhalter: Object.keys(werte).filter((k) => k.startsWith("ANNAHME.")),
    },
    werte,
    datenqualitaet: {
      isDummyHousehold: options.isDummyHousehold,
      horizonEstimated,
    },
  };
}

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
