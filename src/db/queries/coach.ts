import {
  getLatestExternalSnapshot,
  parseSnapshotAccounts,
  parseSnapshotPositions,
} from "@/db/queries/external-snapshots";
import { loadPlanningBase, type PlanningBase } from "@/db/queries/planning-base";
import {
  rankContextPositions,
  selectContextGoalPots,
  selectContextMilestones,
  type InvestmentContextInput,
} from "@/lib/domain/investment-context";
import { selectHouseholdHoldings } from "@/lib/domain/household-scope";

export interface LoadInvestmentContextInputOptions {
  asOfDate: string;
  monthlySavingsRateCents?: number;
  /** Bereits geladene Planungsbasis (vermeidet doppeltes Laden). */
  base?: PlanningBase;
}

/**
 * Sammelt alle Rohdaten für den Investment-Coach (rein lesend). Der Aufrufer baut daraus
 * über die Domäne den anonymisierten Kontext – der Client liefert nie Kontextdaten.
 */
export function loadInvestmentContextInput(
  options: LoadInvestmentContextInputOptions,
): InvestmentContextInput {
  const snapshot = getLatestExternalSnapshot();
  const base = options.base ?? loadPlanningBase();
  const { consolidated } = base;

  const monthlyLivingCostsCents = consolidated.hasHouseholdData
    ? consolidated.totalOutflowCents
    : null;

  const { accounts, positions } = selectHouseholdHoldings(
    parseSnapshotAccounts(snapshot),
    parseSnapshotPositions(snapshot),
  );

  return {
    asOfDate: options.asOfDate,
    snapshotFetchedAt: snapshot?.fetchedAt ?? null,
    isDummyHousehold: base.isDummy,
    positions: positions.map((p) => ({
      id: p.id,
      accountId: p.accountId,
      name: p.name,
      isin: p.isin,
      assetClass: p.assetClass,
      marketValueCents: p.marketValueCents,
    })),
    accounts: accounts.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
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

  // Gleiche Auswahl-/Ranking-Funktionen wie der Kontext-Builder → Refs laufen nie auseinander.
  for (const { position, ref } of rankContextPositions(input.positions)) {
    labels[ref] = position.name;
  }

  selectContextGoalPots(input.pots).forEach((p, i) => {
    labels[`ZIEL-${i + 1}`] = p.name;
  });

  selectContextMilestones(input.contracts, input.asOfDate).forEach(
    (m, i) => {
      labels[`MEILENSTEIN-${i + 1}`] =
        m.label === m.contractName ? m.contractName : `${m.contractName} · ${m.label}`;
    },
  );

  labels.NOTGROSCHEN = "Notgroschen";
  return labels;
}
