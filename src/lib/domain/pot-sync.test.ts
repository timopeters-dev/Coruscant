import { describe, expect, it } from "vitest";
import { calculateWaterfallSuggestion, type DomainPot } from "./waterfall";
import {
  applyPendingTransfers,
  buildPotLinkOptions,
  findAccountPositionOverlap,
  computePotSyncPlan,
  type ExternalAccountInput,
  type ExternalPositionInput,
  type PotLinkState,
  resolveExternalLinkValue,
} from "./pot-sync";

const accounts: ExternalAccountInput[] = [
  { id: "acc-giro", scope: "household", balanceCents: 250_000, holdingsValueCents: 0 },
  { id: "acc-depot", scope: "household", balanceCents: 10_000, holdingsValueCents: 500_000 },
  { id: "acc-dispo", scope: "household", balanceCents: -30_000, holdingsValueCents: 0 },
  { id: "acc-leer", scope: "household", balanceCents: 0, holdingsValueCents: 0 },
];

const positions: ExternalPositionInput[] = [
  { id: "pos-mstr", accountId: "acc-depot", marketValueCents: 400_000 },
  { id: "pos-waise", accountId: "acc-unbekannt", marketValueCents: 1_000 },
];

function pot(
  id: string,
  kind: PotLinkState["externalLinkKind"],
  ref: string | null,
  currentCents = 0,
): PotLinkState {
  return { id, currentCents, externalLinkKind: kind, externalLinkRef: ref };
}

describe("resolveExternalLinkValue", () => {
  it("sums balance and holdings for accounts and inherits scope", () => {
    expect(resolveExternalLinkValue("account", "acc-depot", accounts, positions)).toEqual({
      valueCents: 510_000,
      scope: "household",
      clampedNegative: false,
      asOf: null,
    });
    expect(resolveExternalLinkValue("account", "acc-giro", accounts, positions)).toEqual({
      valueCents: 250_000,
      scope: "household",
      clampedNegative: false,
      asOf: null,
    });
  });

  it("uses the market value for positions and the scope of the owning account", () => {
    expect(resolveExternalLinkValue("position", "pos-mstr", accounts, positions)).toEqual({
      valueCents: 400_000,
      scope: "household",
      clampedNegative: false,
      asOf: null,
    });
  });

  it("clamps negative balances to 0 and flags it", () => {
    expect(resolveExternalLinkValue("account", "acc-dispo", accounts, positions)).toEqual({
      valueCents: 0,
      scope: "household",
      clampedNegative: true,
      asOf: null,
    });
  });

  it("handles a 0-cent account", () => {
    expect(resolveExternalLinkValue("account", "acc-leer", accounts, positions)).toEqual({
      valueCents: 0,
      scope: "household",
      clampedNegative: false,
      asOf: null,
    });
  });

  it("returns null for unknown account, unknown position and position without account", () => {
    expect(resolveExternalLinkValue("account", "nope", accounts, positions)).toBeNull();
    expect(resolveExternalLinkValue("position", "nope", accounts, positions)).toBeNull();
    expect(resolveExternalLinkValue("position", "pos-waise", accounts, positions)).toBeNull();
  });

  it("throws RangeError on overflow and non-integer values", () => {
    expect(() =>
      resolveExternalLinkValue(
        "account",
        "x",
        [{ id: "x", scope: "household", balanceCents: Number.MAX_SAFE_INTEGER, holdingsValueCents: 1 }],
        [],
      ),
    ).toThrow(RangeError);
    expect(() =>
      resolveExternalLinkValue(
        "account",
        "x",
        [{ id: "x", scope: "household", balanceCents: 10.5, holdingsValueCents: 0 }],
        [],
      ),
    ).toThrow(RangeError);
    expect(() =>
      resolveExternalLinkValue(
        "position",
        "p",
        [{ id: "a", scope: "household", balanceCents: 0, holdingsValueCents: 0 }],
        [{ id: "p", accountId: "a", marketValueCents: 1.5 }],
      ),
    ).toThrow(RangeError);
  });
});

describe("computePotSyncPlan", () => {
  it("ignores virtual pots and plans only linked ones (mixed)", () => {
    const plan = computePotSyncPlan({
      pots: [
        pot("virtual-1", null, null, 50_000),
        pot("linked-acc", "account", "acc-giro", 100_000),
        pot("virtual-2", null, null, 0),
        pot("linked-pos", "position", "pos-mstr", 400_000),
      ],
      accounts,
      positions,
    });

    expect(plan.map((o) => o.potId)).toEqual(["linked-acc", "linked-pos"]);
    expect(plan[0]).toEqual({
      potId: "linked-acc",
      status: "updated",
      previousCents: 100_000,
      nextCents: 250_000,
      scope: "household",
      clampedNegative: false,
      asOf: null,
    });
    expect(plan[1]).toEqual({
      potId: "linked-pos",
      status: "unchanged",
      currentCents: 400_000,
      scope: "household",
      clampedNegative: false,
      asOf: null,
    });
  });

  it("reports link_missing for unknown targets and keeps the stand", () => {
    const plan = computePotSyncPlan({
      pots: [
        pot("a", "account", "gone", 12_345),
        pot("b", "position", "gone-too", 1),
        pot("c", "position", "pos-waise", 2),
      ],
      accounts,
      positions,
    });
    expect(plan).toEqual([
      { potId: "a", status: "link_missing", currentCents: 12_345 },
      { potId: "b", status: "link_missing", currentCents: 1 },
      { potId: "c", status: "link_missing", currentCents: 2 },
    ]);
  });

  it("marks all links missing when snapshot lists are empty", () => {
    const plan = computePotSyncPlan({
      pots: [pot("a", "account", "acc-giro", 5), pot("b", "position", "pos-mstr", 6)],
      accounts: [],
      positions: [],
    });
    expect(plan.every((o) => o.status === "link_missing")).toBe(true);
  });

  it("clamps overdraft to 0 and reports clampedNegative", () => {
    const [outcome] = computePotSyncPlan({
      pots: [pot("a", "account", "acc-dispo", 700)],
      accounts,
      positions,
    });
    expect(outcome).toMatchObject({
      status: "updated",
      previousCents: 700,
      nextCents: 0,
      clampedNegative: true,
    });
  });

  it("reports clampedNegative on unchanged overdrawn accounts (0 stand on negative balance)", () => {
    const [outcome] = computePotSyncPlan({
      pots: [pot("a", "account", "acc-dispo", 0)],
      accounts,
      positions,
    });
    expect(outcome).toMatchObject({ status: "unchanged", clampedNegative: true });
  });

  it("reports unchanged for a 0-cent pot on a 0-cent account", () => {
    const [outcome] = computePotSyncPlan({
      pots: [pot("a", "account", "acc-leer", 0)],
      accounts,
      positions,
    });
    expect(outcome).toMatchObject({ status: "unchanged", currentCents: 0 });
  });

  it("returns an empty plan without linked pots", () => {
    expect(computePotSyncPlan({ pots: [pot("v", null, null)], accounts, positions })).toEqual([]);
  });

  it("throws RangeError on duplicate link refs and float pot stands", () => {
    expect(() =>
      computePotSyncPlan({
        pots: [pot("a", "account", "acc-giro"), pot("b", "account", "acc-giro")],
        accounts,
        positions,
      }),
    ).toThrow(RangeError);
    expect(() =>
      computePotSyncPlan({
        pots: [pot("a", "account", "acc-giro", 1.5)],
        accounts,
        positions,
      }),
    ).toThrow(RangeError);
  });

  it("allows the same ref for different kinds", () => {
    expect(() =>
      computePotSyncPlan({
        pots: [pot("a", "account", "same"), pot("b", "position", "same")],
        accounts: [],
        positions: [],
      }),
    ).not.toThrow();
  });
});

describe("buildPotLinkOptions", () => {
  it("lists accounts and positions with clamped values and skips orphan positions", () => {
    const options = buildPotLinkOptions(
      [
        { id: "a1", name: "Muster-Depot", type: "brokerage", scope: "household", balanceCents: 100, holdingsValueCents: 900 },
        { id: "a2", name: "Muster Giro", type: "checking", scope: "household", balanceCents: -5, holdingsValueCents: 0 },
      ],
      [
        { id: "p1", accountId: "a1", name: "Muster-ETF", assetClass: "etf", marketValueCents: 900 },
        { id: "p2", accountId: "zz", name: "Waise", assetClass: "etf", marketValueCents: 1 },
      ],
    );
    expect(options.map((o) => [o.kind, o.ref, o.valueCents])).toEqual([
      ["account", "a1", 1_000],
      ["account", "a2", 0],
      ["position", "p1", 900],
    ]);
    expect(options[2]?.detail).toBe("Muster-Depot");
    expect(options.every((o) => !("scope" in o))).toBe(true);
  });

  it("offers only household accounts and their positions", () => {
    const options = buildPotLinkOptions(
      [
        { id: "acc-hh-1", name: "Muster Haushalt", type: "checking", scope: "household", balanceCents: 100, holdingsValueCents: 0 },
        { id: "acc-pr-1", name: "Muster Privat", type: "brokerage", scope: "personal", balanceCents: 0, holdingsValueCents: 900 },
      ],
      [
        { id: "pos-hh-1", accountId: "acc-hh-1", name: "Muster-Fonds", assetClass: "etf", marketValueCents: 50 },
        { id: "pos-pr-1", accountId: "acc-pr-1", name: "Muster-ETF", assetClass: "etf", marketValueCents: 900 },
      ],
    );
    expect(options.map((o) => o.ref)).toEqual(["acc-hh-1", "pos-hh-1"]);
  });

  it("returns [] for empty input", () => {
    expect(buildPotLinkOptions([], [])).toEqual([]);
  });
});

describe("findAccountPositionOverlap / computePotSyncPlan overlap guard", () => {
  it("detects an account link together with a position of that account (either order)", () => {
    const expected = { accountRef: "acc-depot", positionRef: "pos-mstr" };
    expect(
      findAccountPositionOverlap(
        [{ kind: "account", ref: "acc-depot" }, { kind: "position", ref: "pos-mstr" }],
        positions,
      ),
    ).toEqual(expected);
    expect(
      findAccountPositionOverlap(
        [{ kind: "position", ref: "pos-mstr" }, { kind: "account", ref: "acc-depot" }],
        positions,
      ),
    ).toEqual(expected);
  });

  it("allows a position of another account, a lone account or a lone position", () => {
    expect(
      findAccountPositionOverlap(
        [{ kind: "account", ref: "acc-giro" }, { kind: "position", ref: "pos-mstr" }],
        positions,
      ),
    ).toBeNull();
    expect(findAccountPositionOverlap([{ kind: "account", ref: "acc-depot" }], positions)).toBeNull();
    expect(findAccountPositionOverlap([{ kind: "position", ref: "pos-mstr" }], positions)).toBeNull();
    expect(findAccountPositionOverlap([], positions)).toBeNull();
    // unknown position cannot overlap
    expect(
      findAccountPositionOverlap(
        [{ kind: "account", ref: "acc-depot" }, { kind: "position", ref: "unbekannt" }],
        positions,
      ),
    ).toBeNull();
  });

  it("marks the position pot as link_conflict instead of throwing, other pots sync normally", () => {
    const plan = computePotSyncPlan({
      pots: [
        pot("acc", "account", "acc-depot", 1),
        pot("pos", "position", "pos-mstr", 2),
        pot("other", "account", "acc-giro", 3),
      ],
      accounts,
      positions,
    });
    expect(plan.map((o) => [o.potId, o.status])).toEqual([
      ["acc", "updated"],
      ["pos", "link_conflict"],
      ["other", "updated"],
    ]);
    expect(plan[1]).toEqual({ potId: "pos", status: "link_conflict", currentCents: 2 });
  });
});

describe("asOf (freshness of the calibrated stand)", () => {
  const datedAccounts: ExternalAccountInput[] = [
    { id: "acc-a", scope: "household", balanceCents: 100, holdingsValueCents: 0, balanceAsOf: "2026-11-17T06:00:00.000Z" },
    { id: "acc-b", scope: "household", balanceCents: 100, holdingsValueCents: 0 },
  ];
  const datedPositions: ExternalPositionInput[] = [
    { id: "p-1", accountId: "acc-a", marketValueCents: 5, lastPriceAt: "2026-11-17T09:00:00.000Z" },
    { id: "p-2", accountId: "acc-a", marketValueCents: 5, lastPriceAt: null },
  ];

  it("uses balanceAsOf for accounts, lastPriceAt (else account asOf) for positions, null if unknown", () => {
    expect(resolveExternalLinkValue("account", "acc-a", datedAccounts, datedPositions)?.asOf).toBe("2026-11-17T06:00:00.000Z");
    expect(resolveExternalLinkValue("account", "acc-b", datedAccounts, datedPositions)?.asOf).toBeNull();
    expect(resolveExternalLinkValue("position", "p-1", datedAccounts, datedPositions)?.asOf).toBe("2026-11-17T09:00:00.000Z");
    expect(resolveExternalLinkValue("position", "p-2", datedAccounts, datedPositions)?.asOf).toBe("2026-11-17T06:00:00.000Z");
  });

  it("passes asOf through the sync plan for updated and unchanged outcomes", () => {
    const plan = computePotSyncPlan({
      pots: [pot("a", "account", "acc-a", 1), pot("b", "account", "acc-b", 100)],
      accounts: datedAccounts,
      positions: datedPositions,
    });
    expect(plan[0]).toMatchObject({ status: "updated", asOf: "2026-11-17T06:00:00.000Z" });
    expect(plan[1]).toMatchObject({ status: "unchanged", asOf: null });
  });
});

describe("applyPendingTransfers", () => {
  it("adds pending cents without mutating input and leaves other pots untouched", () => {
    const input = [
      { id: "a", currentCents: 100 },
      { id: "b", currentCents: 5 },
    ];
    const result = applyPendingTransfers(input, new Map([["a", 40]]));
    expect(result).toEqual([
      { id: "a", currentCents: 140 },
      { id: "b", currentCents: 5 },
    ]);
    expect(input[0]?.currentCents).toBe(100);
  });

  it("throws RangeError on overflow or float pending amounts", () => {
    expect(() =>
      applyPendingTransfers([{ id: "a", currentCents: Number.MAX_SAFE_INTEGER }], new Map([["a", 1]])),
    ).toThrow(RangeError);
    expect(() => applyPendingTransfers([{ id: "a", currentCents: 1 }], new Map([["a", 0.5]]))).toThrow(
      RangeError,
    );
  });

  it("prevents a second suggestion from overshooting the target before the next sync", () => {
    const base: DomainPot = {
      id: "linked",
      name: "Muster-Tagesgeld",
      priority: 1,
      currentCents: 800_000,
      targetCents: 1_000_000,
      ruleType: "fill_to_target",
    };
    const first = calculateWaterfallSuggestion([base], 150_000, { mode: "one_time" });
    expect(first.suggestions[0]?.allocatedCents).toBe(150_000);

    const pending = new Map([["linked", first.suggestions[0]!.allocatedCents]]);
    const second = calculateWaterfallSuggestion(applyPendingTransfers([base], pending), 150_000, {
      mode: "one_time",
    });
    expect(second.suggestions[0]?.allocatedCents).toBe(50_000);
    expect(
      base.currentCents + first.totalAllocatedCents + second.totalAllocatedCents,
    ).toBeLessThanOrEqual(1_000_000);
  });
});

describe("buildPotLinkOptions flags", () => {
  it("flags overdrawn accounts and exposes accountId for positions", () => {
    const options = buildPotLinkOptions(
      [
        { id: "a1", name: "Dispo Giro", type: "checking", scope: "household", balanceCents: -100, holdingsValueCents: 0 },
        { id: "a2", name: "Muster-Depot", type: "brokerage", scope: "household", balanceCents: 0, holdingsValueCents: 50 },
      ],
      [{ id: "p1", accountId: "a2", name: "Muster-ETF", assetClass: "etf", marketValueCents: 50 }],
    );
    expect(options.map((o) => [o.ref, o.clampedNegative, o.accountId])).toEqual([
      ["a1", true, null],
      ["a2", false, null],
      ["p1", false, "a2"],
    ]);
  });
});

describe("computePotSyncPlan out of scope", () => {
  const accounts: ExternalAccountInput[] = [
    { id: "acc-hh-1", scope: "household", balanceCents: 10_000, holdingsValueCents: 0 },
    { id: "acc-pr-1", scope: "personal", balanceCents: 99_000, holdingsValueCents: 0 },
    { id: "acc-pr-2", scope: "personal", balanceCents: 1_000, holdingsValueCents: 5_000 },
  ];
  const positions: ExternalPositionInput[] = [
    { id: "pos-pr-1", accountId: "acc-pr-1", marketValueCents: 5_000 },
    { id: "pos-pr-2", accountId: "acc-pr-2", marketValueCents: 5_000 },
  ];
  const mk = (
    id: string,
    kind: "account" | "position",
    ref: string,
    currentCents = 1,
    externalLinkScope: "personal" | "household" | null = null,
  ) => ({
    id,
    currentCents,
    externalLinkKind: kind,
    externalLinkRef: ref,
    externalLinkScope,
  });

  it("syncs a household account with scope household", () => {
    const [outcome] = computePotSyncPlan({
      pots: [mk("a", "account", "acc-hh-1")],
      accounts,
      positions,
    });
    expect(outcome).toMatchObject({ status: "updated", scope: "household", nextCents: 10_000 });
  });

  it("marks personal accounts and positions of personal accounts as out of scope without changing the stand", () => {
    const outcomes = computePotSyncPlan({
      pots: [mk("a", "account", "acc-pr-1", 123), mk("b", "position", "pos-pr-2", 45)],
      accounts,
      positions,
    });
    expect(outcomes).toEqual([
      { potId: "a", status: "link_out_of_scope", currentCents: 123 },
      { potId: "b", status: "link_out_of_scope", currentCents: 45 },
    ]);
  });

  it("uses the stored scope as fallback when the target is gone", () => {
    const outcomes = computePotSyncPlan({
      pots: [
        mk("a", "account", "gone-1", 7, "personal"),
        mk("b", "account", "gone-2", 8, null),
        mk("c", "account", "gone-3", 9, "household"),
      ],
      accounts: [],
      positions: [],
    });
    expect(outcomes.map((o) => o.status)).toEqual([
      "link_out_of_scope",
      "link_missing",
      "link_missing",
    ]);
  });

  it("prefers link_conflict over out of scope", () => {
    const outcomes = computePotSyncPlan({
      pots: [mk("a", "account", "acc-pr-1"), mk("b", "position", "pos-pr-1")],
      accounts,
      positions,
    });
    expect(outcomes.map((o) => o.status)).toEqual(["link_out_of_scope", "link_conflict"]);
  });

  it("still throws on duplicate links", () => {
    expect(() =>
      computePotSyncPlan({
        pots: [mk("a", "account", "acc-pr-1"), mk("b", "account", "acc-pr-1")],
        accounts,
        positions,
      }),
    ).toThrow(RangeError);
  });
});
