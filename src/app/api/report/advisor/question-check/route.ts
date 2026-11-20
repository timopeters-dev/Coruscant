import { NextResponse } from "next/server";
import { loadAdvisorSensitiveStrings } from "@/backend/db/queries/advisor-report";
import { checkAdvisorQuestion } from "@/domain/report/anonymize";
import { advisorQuestionCheckSchema } from "@/validation/advisor-report";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
} as const;

export async function POST(request: Request) {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_input" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const parsed = advisorQuestionCheckSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const sensitive = loadAdvisorSensitiveStrings();
  const result = checkAdvisorQuestion(parsed.data.text, sensitive);

  return NextResponse.json(
    { ok: result.ok, issues: result.issues },
    { status: 200, headers: NO_STORE_HEADERS },
  );
}
