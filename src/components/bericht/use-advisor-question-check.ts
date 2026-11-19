"use client";

import * as React from "react";
import type { AdvisorReportMode } from "@/lib/domain/advisor-report";
import type { AdvisorQuestionIssue } from "@/lib/domain/advisor-report-anonymize";

export type QuestionCheckStatus = "ok" | "checking" | "blocked" | "error";

export interface UseAdvisorQuestionCheckResult {
  status: QuestionCheckStatus;
  issues: AdvisorQuestionIssue[];
}

const DEBOUNCE_MS = 400;

export async function requestAdvisorQuestionCheck(
  text: string,
  signal?: AbortSignal,
): Promise<UseAdvisorQuestionCheckResult> {
  try {
    const response = await fetch("/api/report/advisor/question-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal,
    });
    if (!response.ok) {
      return { status: "error", issues: [] };
    }
    const data = (await response.json()) as {
      ok?: unknown;
      issues?: unknown;
    };
    const ok = data.ok === true;
    const issues = Array.isArray(data.issues)
      ? (data.issues as AdvisorQuestionIssue[])
      : [];
    return {
      status: ok ? "ok" : "blocked",
      issues,
    };
  } catch (err) {
    if ((err as { name?: string })?.name === "AbortError") {
      throw err;
    }
    return { status: "error", issues: [] };
  }
}

export function useAdvisorQuestionCheck(
  text: string,
  mode: AdvisorReportMode,
): UseAdvisorQuestionCheckResult {
  const trimmed = text.trim();
  const needsCheck = mode === "anonymized" && trimmed.length > 0;

  const [state, setState] = React.useState<{
    checkedText: string;
    status: QuestionCheckStatus;
    issues: AdvisorQuestionIssue[];
  }>({
    checkedText: "",
    status: "ok",
    issues: [],
  });

  React.useEffect(() => {
    if (!needsCheck) {
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const result = await requestAdvisorQuestionCheck(
            trimmed,
            controller.signal,
          );
          setState({
            checkedText: trimmed,
            status: result.status,
            issues: result.issues,
          });
        } catch (err) {
          if ((err as { name?: string })?.name === "AbortError") {
            return;
          }
          setState({
            checkedText: trimmed,
            status: "error",
            issues: [],
          });
        }
      })();
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [needsCheck, trimmed]);

  if (!needsCheck) {
    return { status: "ok", issues: [] };
  }

  if (state.checkedText !== trimmed) {
    return { status: "checking", issues: [] };
  }

  return { status: state.status, issues: state.issues };
}
