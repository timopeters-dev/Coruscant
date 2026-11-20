import type { HistoryRangeId } from "@/domain/cockpit/balance-history";

export const HISTORY_RANGE_STORAGE_KEY = "coruscant:cockpit-history-range";
export const HISTORY_RANGE_EVENT = "coruscant:history-range-change";
export const DEFAULT_HISTORY_RANGE: HistoryRangeId = "12m";

function isHistoryRangeId(value: string | null): value is HistoryRangeId {
  return (
    value === "3m" || value === "6m" || value === "12m" || value === "all"
  );
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function createHistoryRangeStore(options?: {
  getStorage?: () => StorageLike | null;
  subscribeExternal?: (onExternalChange: () => void) => () => void;
}) {
  let memoryRange: HistoryRangeId | null = null;
  const listeners = new Set<() => void>();

  const getStorage =
    options?.getStorage ??
    (() => (typeof window !== "undefined" ? window.localStorage : null));

  const subscribeExternal =
    options?.subscribeExternal ??
    ((onExternalChange: () => void) => {
      if (typeof window === "undefined") {
        return () => {};
      }
      const handleStorage = (event: StorageEvent) => {
        if (event.key === HISTORY_RANGE_STORAGE_KEY || event.key === null) {
          onExternalChange();
        }
      };
      window.addEventListener("storage", handleStorage);
      return () => {
        window.removeEventListener("storage", handleStorage);
      };
    });

  function notify(): void {
    for (const listener of listeners) {
      listener();
    }
  }

  function getSnapshot(): HistoryRangeId {
    if (memoryRange !== null) {
      return memoryRange;
    }
    try {
      const stored = getStorage()?.getItem(HISTORY_RANGE_STORAGE_KEY) ?? null;
      if (isHistoryRangeId(stored)) {
        return stored;
      }
    } catch {
      // Ignore storage access errors (private mode, disabled cookies, quota)
    }
    return DEFAULT_HISTORY_RANGE;
  }

  function getServerSnapshot(): HistoryRangeId {
    return DEFAULT_HISTORY_RANGE;
  }

  function setRange(next: HistoryRangeId): void {
    memoryRange = next;
    try {
      getStorage()?.setItem(HISTORY_RANGE_STORAGE_KEY, next);
    } catch {
      // Ignore storage write errors; in-memory fallback keeps the switch working
    }
    notify();
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    const unsubscribeExternal = subscribeExternal(() => {
      memoryRange = null;
      listener();
    });
    return () => {
      listeners.delete(listener);
      unsubscribeExternal();
    };
  }

  return {
    getSnapshot,
    getServerSnapshot,
    setRange,
    subscribe,
  };
}

export const cockpitHistoryRangeStore = createHistoryRangeStore();
