import { describe, expect, it } from "vitest";
import {
  HOUSEHOLD_SCOPE,
  isHouseholdScope,
  selectHouseholdHoldings,
} from "./household-scope";
import type { ExternalScope } from "./pot-sync";

const acc = (id: string, scope: ExternalScope) => ({ id, scope });
const pos = (id: string, accountId: string) => ({ id, accountId });

describe("isHouseholdScope", () => {
  it("accepts only household", () => {
    expect(HOUSEHOLD_SCOPE).toBe("household");
    expect(isHouseholdScope("household")).toBe(true);
    expect(isHouseholdScope("personal")).toBe(false);
  });
});

describe("selectHouseholdHoldings", () => {
  it("keeps everything when only household accounts exist", () => {
    const accounts = [acc("acc-hh-1", "household")];
    const positions = [pos("pos-hh-1", "acc-hh-1")];
    expect(selectHouseholdHoldings(accounts, positions)).toEqual({ accounts, positions });
  });

  it("returns empty lists when only personal accounts exist", () => {
    expect(
      selectHouseholdHoldings([acc("acc-pr-1", "personal")], [pos("pos-pr-1", "acc-pr-1")]),
    ).toEqual({ accounts: [], positions: [] });
  });

  it("filters mixed input and preserves order", () => {
    const result = selectHouseholdHoldings(
      [
        acc("acc-pr-1", "personal"),
        acc("acc-hh-2", "household"),
        acc("acc-pr-2", "personal"),
        acc("acc-hh-1", "household"),
      ],
      [
        pos("pos-1", "acc-pr-1"),
        pos("pos-2", "acc-hh-1"),
        pos("pos-3", "acc-pr-2"),
        pos("pos-4", "acc-hh-2"),
      ],
    );
    expect(result.accounts.map((a) => a.id)).toEqual(["acc-hh-2", "acc-hh-1"]);
    expect(result.positions.map((p) => p.id)).toEqual(["pos-2", "pos-4"]);
  });

  it("handles empty input and accounts without positions", () => {
    expect(selectHouseholdHoldings([], [])).toEqual({ accounts: [], positions: [] });
    expect(selectHouseholdHoldings([acc("acc-hh-1", "household")], [])).toEqual({
      accounts: [acc("acc-hh-1", "household")],
      positions: [],
    });
  });

  it("drops positions with an unknown account", () => {
    expect(
      selectHouseholdHoldings([acc("acc-hh-1", "household")], [pos("pos-x", "unknown")]).positions,
    ).toEqual([]);
  });

  it("does not mutate frozen inputs", () => {
    const accounts = Object.freeze([Object.freeze(acc("acc-hh-1", "household")), Object.freeze(acc("acc-pr-1", "personal"))]);
    const positions = Object.freeze([Object.freeze(pos("pos-1", "acc-pr-1"))]);
    expect(() => selectHouseholdHoldings(accounts, positions)).not.toThrow();
    expect(accounts).toHaveLength(2);
    expect(positions).toHaveLength(1);
  });
});
