import { PlanungWorkspace } from "@/components/planung/planung-workspace";
import type { LoanOption } from "@/components/planung/prepayment-vs-etf-card";
import {
  getAllocationSettings,
  getPendingTransferCentsByPotId,
  listManualCashflowItems,
  listPots,
} from "@/db/queries/allocation";
import {
  getLatestExternalSnapshot,
  parseSnapshotHousehold,
} from "@/db/queries/cockpit";
import { listContracts } from "@/db/queries/contracts";
import {
  calculateConsolidatedCashflow,
  deriveContractCashflowItems,
} from "@/lib/domain/cashflow";
import {
  addMonthsToYearMonth,
  getTodayIsoDate,
  toYearMonth,
} from "@/lib/domain/date";
import { applyPendingTransfers } from "@/lib/domain/pot-sync";
import { buildPrepaymentDefaults } from "@/lib/domain/scenarios";
import type { DomainPot } from "@/lib/domain/waterfall";
import { resolveHouseholdDataForWorkspace } from "@/lib/integrations/household-dummy";

export const dynamic = "force-dynamic";

export default function PlanungPage() {
  const asOfDate = getTodayIsoDate();
  const contracts = listContracts();

  const loanOptions: LoanOption[] = contracts
    .filter((c) => c.category === "loan" && c.status === "active")
    .map((c) => ({
      id: c.id,
      name: c.name,
      provider: c.provider,
      sphere: c.sphere,
      defaults: buildPrepaymentDefaults(c, asOfDate),
    }));

  const settings = getAllocationSettings();
  const resolvedHousehold = resolveHouseholdDataForWorkspace(
    parseSnapshotHousehold(getLatestExternalSnapshot()),
  );
  const consolidated = calculateConsolidatedCashflow({
    household: resolvedHousehold.household,
    variableBasis: settings.variableBasis,
    manualItems: listManualCashflowItems(),
    contractItems: deriveContractCashflowItems(contracts),
    includeContractItems: settings.includeContractItems,
  });

  // Same basis as /allokation: stand + open transfers.
  const pots: DomainPot[] = applyPendingTransfers(
    listPots(),
    getPendingTransferCentsByPotId(),
  ).map((p) => ({
    id: p.id,
    name: p.name,
    priority: p.priority,
    currentCents: p.currentCents,
    targetCents: p.targetCents,
    ruleType: p.ruleType,
    fixedMonthlyCents: p.fixedMonthlyCents,
    remainderPercentage: p.remainderPercentage,
  }));

  return (
    <PlanungWorkspace
      asOfDate={asOfDate}
      loanOptions={loanOptions}
      baseSurplusCents={consolidated.monthlySurplusCents}
      hasHouseholdData={consolidated.hasHouseholdData}
      isDummy={resolvedHousehold.isDummy}
      pots={pots}
      startMonth={addMonthsToYearMonth(toYearMonth(asOfDate), 1)}
    />
  );
}
