import { loadAdvisorSensitiveStrings } from "@/backend/db/queries/advisor-report";
import { json } from "@/backend/http";
import { checkAdvisorQuestion } from "@/domain/report/anonymize";
import { advisorQuestionCheckSchema } from "@/validation/advisor-report";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** Prüft eine Berater-Frage auf personenbezogene Daten; der Text wird nirgends gespeichert. */
export async function POST(request: Request): Promise<Response> {
  const parsed = advisorQuestionCheckSchema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return json({ error: "invalid_input" }, 400, NO_STORE);
  const { ok, issues } = checkAdvisorQuestion(parsed.data.text, loadAdvisorSensitiveStrings());
  return json({ ok, issues }, 200, NO_STORE);
}
