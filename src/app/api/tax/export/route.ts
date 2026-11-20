import { fileResponse, route } from "@/backend/http";
import { exportTaxYear } from "@/backend/services/tax-export";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = route((request) => {
  const file = exportTaxYear(request);
  return fileResponse(file.body, {
    "Content-Type": file.contentType,
    "Content-Disposition": `attachment; filename="${file.filename}"`,
    ...file.headers,
  });
});
