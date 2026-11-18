import { NextResponse } from "next/server";
import {
  createManualCashflowItem,
  getAllocationSettings,
  listManualCashflowItems,
} from "@/db/queries/allocation";
import {
  getLatestExternalSnapshot,
  parseSnapshotHousehold,
} from "@/db/queries/cockpit";
import { listContracts, listProperties } from "@/db/queries/contracts";
import {
  internalErrorResponse,
  parseJsonBody,
  validationErrorResponse,
} from "@/lib/api/http";
import {
  calculateConsolidatedCashflow,
  deriveContractCashflowItems,
  derivePropertyCashflowItems,
} from "@/lib/domain/cashflow";
import { resolveHouseholdDataForWorkspace } from "@/lib/integrations/household-dummy";
import { cashflowCreateSchema } from "@/lib/validation/allocation";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const items = listManualCashflowItems();
    const contracts = listContracts();
    const properties = listProperties();
    const settings = getAllocationSettings();
    const latestSnapshot = getLatestExternalSnapshot();
    const snapshotHousehold = parseSnapshotHousehold(latestSnapshot);
    const resolvedHousehold =
      resolveHouseholdDataForWorkspace(snapshotHousehold);

    const derivedContractItems = deriveContractCashflowItems(contracts);
    const derivedPropertyItems = derivePropertyCashflowItems(
      properties,
      contracts,
    );
    const summary = calculateConsolidatedCashflow({
      household: resolvedHousehold.household,
      variableBasis: settings.variableBasis,
      manualItems: items,
      contractItems: derivedContractItems,
      includeContractItems: settings.includeContractItems,
      propertyItems: derivedPropertyItems,
      includePropertyItems: settings.includePropertyItems,
    });

    return NextResponse.json(
      { items, derivedContractItems, derivedPropertyItems, summary },
      { status: 200 },
    );
  } catch {
    return internalErrorResponse();
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const body = await parseJsonBody(request);
  if (!body.ok) {
    return body.response;
  }

  const parsed = cashflowCreateSchema.safeParse(body.data);
  if (!parsed.success) {
    return validationErrorResponse(parsed.error);
  }

  try {
    const item = createManualCashflowItem(parsed.data);
    return NextResponse.json({ item }, { status: 201 });
  } catch {
    return internalErrorResponse();
  }
}
