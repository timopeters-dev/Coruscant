import {
  createManualCashflowItem, listManualCashflowItems,
} from "@/backend/db/queries/cashflow-items";
import { getAllocationSettings } from "@/backend/db/queries/allocation-settings";
import { getLatestExternalSnapshot, parseSnapshotHousehold } from "@/backend/db/queries/cockpit";
import { listContracts } from "@/backend/db/queries/contracts";
import { listProperties } from "@/backend/db/queries/properties";
import { json, readJson, route } from "@/backend/http";
import { resolveHouseholdDataForWorkspace } from "@/backend/integrations/household-dummy";
import {
  calculateConsolidatedCashflow,
  deriveContractCashflowItems,
  derivePropertyCashflowItems,
} from "@/domain/allocation/cashflow";
import { cashflowCreateSchema } from "@/validation/allocation";

export const dynamic = "force-dynamic";

export const GET = route(() => {
  const items = listManualCashflowItems();
  const contracts = listContracts();
  const settings = getAllocationSettings();
  const { household } = resolveHouseholdDataForWorkspace(parseSnapshotHousehold(getLatestExternalSnapshot()));
  const derivedContractItems = deriveContractCashflowItems(contracts);
  const derivedPropertyItems = derivePropertyCashflowItems(listProperties(), contracts);
  const summary = calculateConsolidatedCashflow({
    household,
    variableBasis: settings.variableBasis,
    manualItems: items,
    contractItems: derivedContractItems,
    includeContractItems: settings.includeContractItems,
    propertyItems: derivedPropertyItems,
    includePropertyItems: settings.includePropertyItems,
  });
  return json({ items, derivedContractItems, derivedPropertyItems, summary });
});

export const POST = route(async (request) => {
  const item = createManualCashflowItem(await readJson(request, cashflowCreateSchema));
  return json({ item }, 201);
});
