/** Anonymisierte Sicht einer berechneten Empfehlung für die KI-Erklärung. */
import { formatMonthDE } from "@/domain/core/date-format";
import { selectContextGoalPots } from "./investment-context";
import { formatBpsDE, formatEuroDE } from "@/domain/core/money";
import type { RecommendationItemKind, RecommendationReason, RecommendationResult, RecommendationState } from "./types";

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
  return formatMonthDE(ym);
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
