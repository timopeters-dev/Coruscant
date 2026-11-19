import { describe, expect, it, vi } from "vitest";
import { createHistoryRangeStore } from "./history-range-store";

describe("createHistoryRangeStore", () => {
  it("switches range and notifies subscribers even when localStorage getItem/setItem throw", () => {
    const throwingStorage = {
      getItem: () => {
        throw new Error("SecurityError: localStorage disabled");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    const store = createHistoryRangeStore({
      getStorage: () => throwingStorage,
      subscribeExternal: () => () => {},
    });

    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    expect(store.getSnapshot()).toBe("12m");
    store.setRange("3m");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toBe("3m");

    store.setRange("all");
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot()).toBe("all");

    unsubscribe();
  });

  it("reads initial value from storage and prefers in-memory selection if setItem fails", () => {
    const store = createHistoryRangeStore({
      getStorage: () => ({
        getItem: () => "6m",
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
      }),
      subscribeExternal: () => () => {},
    });

    expect(store.getSnapshot()).toBe("6m");
    store.setRange("3m");
    expect(store.getSnapshot()).toBe("3m");
  });
});
