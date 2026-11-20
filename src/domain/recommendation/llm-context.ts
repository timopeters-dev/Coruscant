import { type ContextAssetClass, type ContextGoalKind, type InvestmentContext } from "./investment-context";
import { assertSafeInteger, formatBpsDE, formatEuroDE } from "@/domain/core/money";

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
