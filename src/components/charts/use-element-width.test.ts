import { afterEach, describe, expect, it, vi } from "vitest";

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
      states[idx] = val;
    };
    return [states[idx], setState];
  },
  useCallback: (fn: unknown) => fn,
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

import { useElementWidth } from "./use-element-width";

describe("useElementWidth", () => {
  afterEach(() => {
    states.length = 0;
    stateIdx = 0;
    lastEffectDeps = undefined;
    lastEffectCleanup = undefined;
    vi.unstubAllGlobals();
  });

  it("observes element even when container mounts after an initial empty render", () => {
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe = observe;
        disconnect = disconnect;
      },
    );

    // 1. Initial empty render (no container mounted yet)
    stateIdx = 0;
    const [ref1, width1] = useElementWidth(640);
    expect(width1).toBe(640);
    expect(observe).not.toHaveBeenCalled();

    // 2. Data arrives -> container mounts -> callback ref receives element
    const fakeElement = {
      getBoundingClientRect: () => ({ width: 320 }),
    } as unknown as HTMLElement;
    ref1(fakeElement);

    // 3. Re-render with mounted element
    stateIdx = 0;
    useElementWidth(640);
    expect(observe).toHaveBeenCalledTimes(1);
    expect(observe).toHaveBeenCalledWith(fakeElement);

    // 4. Subsequent render reflects measured width
    stateIdx = 0;
    const [, width3] = useElementWidth(640);
    expect(width3).toBe(320);
  });
});
