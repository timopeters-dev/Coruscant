import { NextResponse } from "next/server";
import {
  createManualCashflowItem,
  listManualCashflowItems,
} from "@/db/queries/allocation";
import { listContracts } from "@/db/queries/contracts";
import {
  internalErrorResponse,
  parseJsonBody,
  validationErrorResponse,
} from "@/lib/api/http";
import {
  calculateMonthlyCashflow,
  deriveContractCashflowItems,
} from "@/lib/domain/cashflow";
import { cashflowCreateSchema } from "@/lib/validation/allocation";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const items = listManualCashflowItems();
    const contracts = listContracts();
    const derivedContractItems = deriveContractCashflowItems(contracts);
    const summary = calculateMonthlyCashflow([
      ...items,
      ...derivedContractItems,
    ]);

    return NextResponse.json(
      { items, derivedContractItems, summary },
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
