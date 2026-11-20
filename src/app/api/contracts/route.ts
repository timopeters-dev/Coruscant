import { createContract, listContracts } from "@/backend/db/queries/contracts";
import { json, readJson, route } from "@/backend/http";
import { contractCreateSchema } from "@/validation/contracts";

export const dynamic = "force-dynamic";

export const GET = route(() => json({ contracts: listContracts() }));

export const POST = route(async (request) => {
  const contract = createContract(await readJson(request, contractCreateSchema));
  return json({ contract }, 201);
});
