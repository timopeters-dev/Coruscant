import {
  getLatestExternalSnapshot,
  parseSnapshotAccounts,
  parseSnapshotPositions,
} from "@/db/queries/external-snapshots";
import { loadPlanningBase } from "@/db/queries/planning-base";
import { extractContractMilestones } from "@/lib/domain/contracts";
import {
  MAX_CONTEXT_GOALS,
  MAX_CONTEXT_MILESTONES,
  type InvestmentContextInput,
} from "@/lib/domain/investment-context";

export interface LoadInvestmentContextInputOptions {
  asOfDate: string;
  monthlySavingsRateCents?: number;
}

/**
 * Sammelt alle Rohdaten für den Investment-Coach (rein lesend). Der Aufrufer baut daraus
 * über die Domäne den anonymisierten Kontext – der Client liefert nie Kontextdaten.
 */
export function loadInvestmentContextInput(
  options: LoadInvestmentContextInputOptions,
): InvestmentContextInput {
  const snapshot = getLatestExternalSnapshot();
  const base = loadPlanningBase();
  const { consolidated } = base;

  const monthlyLivingCostsCents = consolidated.hasHouseholdData
    ? consolidated.calibratedFixedOutflowCents + consolidated.variableOutflowCents
    : null;

  return {
    asOfDate: options.asOfDate,
    snapshotFetchedAt: snapshot?.fetchedAt ?? null,
    isDummyHousehold: base.isDummy,
    positions: parseSnapshotPositions(snapshot).map((p) => ({
      id: p.id,
      accountId: p.accountId,
      name: p.name,
      isin: p.isin,
      assetClass: p.assetClass,
      marketValueCents: p.marketValueCents,
    })),
    accounts: parseSnapshotAccounts(snapshot).map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      scope: a.scope,
      balanceCents: a.balanceCents,
    })),
    pots: base.pots.map((p) => ({
      id: p.id,
      name: p.name,
      priority: p.priority,
      purpose: p.purpose,
      currentCents: p.currentCents,
      targetCents: p.targetCents,
      linkedContractId: p.linkedContractId,
      linkedPropertyId: p.linkedPropertyId,
    })),
    contracts: base.contracts,
    monthlyLivingCostsCents,
    monthlySurplusCents: consolidated.monthlySurplusCents,
    monthlySavingsRateCents:
      options.monthlySavingsRateCents ??
      Math.max(0, consolidated.monthlySurplusCents),
  };
}

/**
 * Löst Kontext-Refs lokal zu echten Namen auf. Ausschließlich für die UI – diese Zuordnung
 * geht nie an die KI-Payload.
 */
export function buildRefLabelMap(
  input: InvestmentContextInput,
): Record<string, string> {
  const labels: Record<string, string> = {};

  const prefix = { etf: "ETF", stock: "AKTIE", crypto: "KRYPTO" } as const;
  const counters = { etf: 0, stock: 0, crypto: 0 };
  [...input.positions]
    .filter((p) => p.marketValueCents > 0)
    .sort(
      (a, b) =>
        b.marketValueCents - a.marketValueCents || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    .forEach((p) => {
      counters[p.assetClass] += 1;
      labels[`${prefix[p.assetClass]}-${counters[p.assetClass]}`] = p.name;
    });

  input.pots
    .filter((p) => p.purpose !== "emergency_fund")
    .sort((a, b) => a.priority - b.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, MAX_CONTEXT_GOALS)
    .forEach((p, i) => {
      labels[`ZIEL-${i + 1}`] = p.name;
    });

  extractContractMilestones(
    input.contracts.filter((c) => c.status === "active"),
    input.asOfDate,
  )
    .filter((m) => !m.isOverdue)
    .slice(0, MAX_CONTEXT_MILESTONES)
    .forEach((m, i) => {
      labels[`MEILENSTEIN-${i + 1}`] =
        m.label === m.contractName ? m.contractName : `${m.contractName} · ${m.label}`;
    });

  labels.NOTGROSCHEN = "Notgroschen";
  return labels;
}
