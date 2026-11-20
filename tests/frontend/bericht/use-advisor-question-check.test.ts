import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const states: unknown[] = [];
let stateIdx = 0;
let lastEffectDeps: unknown[] | undefined;
let lastEffectCleanup: (() => void) | void;

vi.mock("react", () => ({
  useState: (initial: unknown) => {
    const idx = stateIdx++;
    if (!(idx in states)) {
      states[idx] = initial;
    }
    const setState = (val: unknown) => {
      states[idx] =
        typeof val === "function"
          ? (val as (prev: unknown) => unknown)(states[idx])
          : val;
    };
    return [states[idx], setState];
  },
  useEffect: (effect: () => (() => void) | void, deps?: unknown[]) => {
    const changed =
      !lastEffectDeps ||
      !deps ||
      deps.length !== lastEffectDeps.length ||
      deps.some((d, i) => !Object.is(d, lastEffectDeps![i]));
    if (changed) {
      if (typeof lastEffectCleanup === "function") {
        lastEffectCleanup();
      }
      lastEffectDeps = deps;
      lastEffectCleanup = effect();
    }
  },
}));

import type { AdvisorReportMode } from "@/domain/report/types";
import {
  useAdvisorQuestionCheck,
  type UseAdvisorQuestionCheckResult,
} from "@/frontend/bericht/use-advisor-question-check";

function renderHook(initialProps: { text: string; mode: AdvisorReportMode }) {
  let currentProps = initialProps;
  const result = {
    current: null as unknown as UseAdvisorQuestionCheckResult,
  };

  const RunHook = () => {
    stateIdx = 0;
    result.current = useAdvisorQuestionCheck(
      currentProps.text,
      currentProps.mode,
    );
  };

  RunHook();

  return {
    result,
    rerender: (nextProps: { text: string; mode: AdvisorReportMode }) => {
      currentProps = nextProps;
      RunHook();
    },
    refresh: () => {
      RunHook();
    },
    unmount: () => {
      if (typeof lastEffectCleanup === "function") {
        lastEffectCleanup();
        lastEffectCleanup = undefined;
      }
    },
  };
}

describe("useAdvisorQuestionCheck", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    if (typeof lastEffectCleanup === "function") {
      lastEffectCleanup();
    }
    states.length = 0;
    stateIdx = 0;
    lastEffectDeps = undefined;
    lastEffectCleanup = undefined;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("debounces by 400ms and fires exactly one POST request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, issues: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const hook = renderHook({ text: "ETF oder Tilgung?", mode: "anonymized" });
    expect(hook.result.current).toEqual({ status: "checking", issues: [] });
    expect(fetchSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(399);
    expect(fetchSpy).not.toHaveBeenCalled();
    hook.refresh();
    expect(hook.result.current.status).toBe("checking");

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/report/advisor/question-check",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ text: "ETF oder Tilgung?" }),
      }),
    );

    hook.refresh();
    expect(hook.result.current).toEqual({ status: "ok", issues: [] });
    hook.unmount();
  });

  it("aborts in-flight check and stays checking when user keeps typing; stale response cannot overwrite", async () => {
    let resolveFirst!: (res: Response) => void;
    let firstSignal: AbortSignal | undefined;
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce((_url, init) => {
        firstSignal = init?.signal as AbortSignal | undefined;
        return new Promise<Response>((resolve) => {
          resolveFirst = resolve;
        });
      })
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: false, issues: ["known_name"] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    const hook = renderHook({ text: "Frage 1", mode: "anonymized" });
    await vi.advanceTimersByTimeAsync(400);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(firstSignal?.aborted).toBe(false);

    // User types new text while first request is still pending
    hook.rerender({ text: "Frage 1 Musterbank", mode: "anonymized" });
    expect(firstSignal?.aborted).toBe(true);
    expect(hook.result.current).toEqual({ status: "checking", issues: [] });

    // Even if the stale first promise resolves with ok: true, status stays checking
    resolveFirst(
      new Response(JSON.stringify({ ok: true, issues: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await Promise.resolve();
    await Promise.resolve();
    hook.refresh();
    expect(hook.result.current).toEqual({ status: "checking", issues: [] });

    // Second request fires after 400ms and blocks
    await vi.advanceTimersByTimeAsync(400);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    hook.refresh();
    expect(hook.result.current).toEqual({
      status: "blocked",
      issues: ["known_name"],
    });
    hook.unmount();
  });

  it("returns error (keeping lock active) on HTTP 500 response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Internal Server Error", { status: 500 }),
    );

    const hook = renderHook({ text: "Frage", mode: "anonymized" });
    await vi.advanceTimersByTimeAsync(400);
    hook.refresh();

    expect(hook.result.current).toEqual({ status: "error", issues: [] });
    hook.unmount();
  });

  it("never calls fetch and returns ok immediately in full mode or for empty text", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const emptyHook = renderHook({ text: "   ", mode: "anonymized" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(emptyHook.result.current).toEqual({ status: "ok", issues: [] });
    expect(fetchSpy).not.toHaveBeenCalled();

    emptyHook.rerender({ text: "Musterbank AG", mode: "full" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(emptyHook.result.current).toEqual({ status: "ok", issues: [] });
    expect(fetchSpy).not.toHaveBeenCalled();
    emptyHook.unmount();
  });
});
