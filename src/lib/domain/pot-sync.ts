import { isHouseholdScope, selectHouseholdHoldings } from "./household-scope";
import { assertSafeInteger } from "./money";

export type ExternalLinkKind = "account" | "position";
export type ExternalScope = "personal" | "household";

export interface PotLinkState {
  id: string;
  currentCents: number;
  externalLinkKind: ExternalLinkKind | null;
  externalLinkRef: string | null;
  /** Last stored scope of the link target (fallback when the target is gone). */
  externalLinkScope?: ExternalScope | null;
}

export interface ExternalAccountInput {
  id: string;
  scope: ExternalScope;
  balanceCents: number;
  holdingsValueCents: number;
  /** Freshness of the balance in finanz_cockpit (ISO), if known. */
  balanceAsOf?: string | null;
}

export interface ExternalPositionInput {
  id: string;
  accountId: string;
  marketValueCents: number;
  /** Freshness of the price (ISO), if known. */
  lastPriceAt?: string | null;
}

export type PotSyncOutcome =
  | {
      potId: string;
      status: "updated";
      previousCents: number;
      nextCents: number;
      scope: ExternalScope;
      clampedNegative: boolean;
      asOf: string | null;
    }
  | {
      potId: string;
      status: "unchanged";
      currentCents: number;
      scope: ExternalScope;
      clampedNegative: boolean;
      asOf: string | null;
    }
  | { potId: string; status: "link_missing"; currentCents: number }
  /** Account and one of its positions are both linked (value would count twice). */
  | { potId: string; status: "link_conflict"; currentCents: number }
  /** Link target lies outside the household (scope personal): not counted, not synced. */
  | { potId: string; status: "link_out_of_scope"; currentCents: number };

export interface ResolvedExternalLinkValue {
  valueCents: number;
  scope: ExternalScope;
  clampedNegative: boolean;
  /**
   * Age of the underlying data in finanz_cockpit (account `balanceAsOf`, for
   * positions `lastPriceAt` or the account's `balanceAsOf`); `null` if unknown.
   */
  asOf: string | null;
}

/**
 * Resolves the current value of an external account or position.
 * Accounts yield `balanceCents + holdingsValueCents`; positions yield their
 * market value (scope inherited from the owning account). Negative totals
 * (overdraft) are clamped to 0. Returns `null` when the target is missing.
 */
export function resolveExternalLinkValue(
  kind: ExternalLinkKind,
  ref: string,
  accounts: readonly ExternalAccountInput[],
  positions: readonly ExternalPositionInput[],
): ResolvedExternalLinkValue | null {
  if (kind === "account") {
    const account = accounts.find((a) => a.id === ref);
    if (!account) {
      return null;
    }
    const total = assertSafeInteger(
      assertSafeInteger(account.balanceCents, `account(${ref}).balanceCents`) +
        assertSafeInteger(
          account.holdingsValueCents,
          `account(${ref}).holdingsValueCents`,
        ),
      `account(${ref}) total`,
    );
    return {
      valueCents: Math.max(0, total),
      scope: account.scope,
      clampedNegative: total < 0,
      asOf: account.balanceAsOf ?? null,
    };
  }

  const position = positions.find((p) => p.id === ref);
  if (!position) {
    return null;
  }
  const account = accounts.find((a) => a.id === position.accountId);
  if (!account) {
    return null;
  }
  const value = assertSafeInteger(
    position.marketValueCents,
    `position(${ref}).marketValueCents`,
  );
  return {
    valueCents: Math.max(0, value),
    scope: account.scope,
    clampedNegative: value < 0,
    asOf: position.lastPriceAt ?? account.balanceAsOf ?? null,
  };
}

export interface LinkOverlap {
  accountRef: string;
  positionRef: string;
}

/**
 * Finds a link set in which an account is linked as a whole while one of its
 * positions is linked as well. The position's market value is already part of
 * the account value (`balanceCents + holdingsValueCents`), so both links would
 * count the same money twice.
 */
export function findAccountPositionOverlap(
  links: readonly { kind: ExternalLinkKind; ref: string }[],
  positions: readonly ExternalPositionInput[],
): LinkOverlap | null {
  const linkedAccounts = new Set(
    links.filter((l) => l.kind === "account").map((l) => l.ref),
  );
  if (linkedAccounts.size === 0) {
    return null;
  }
  const positionById = new Map(positions.map((p) => [p.id, p]));
  for (const link of links) {
    if (link.kind !== "position") {
      continue;
    }
    const position = positionById.get(link.ref);
    if (position && linkedAccounts.has(position.accountId)) {
      return { accountRef: position.accountId, positionRef: position.id };
    }
  }
  return null;
}

/**
 * Adds not yet executed transfers (journal entries newer than the last sync)
 * to the calibrated stand, so the waterfall does not suggest them twice.
 * Calculation only - nothing is persisted.
 */
export function applyPendingTransfers<T extends { id: string; currentCents: number }>(
  pots: readonly T[],
  pendingCentsByPotId: ReadonlyMap<string, number>,
): T[] {
  return pots.map((pot) => {
    const pending = pendingCentsByPotId.get(pot.id) ?? 0;
    if (pending === 0) {
      return { ...pot };
    }
    return {
      ...pot,
      currentCents: assertSafeInteger(
        assertSafeInteger(pot.currentCents, `pot(${pot.id}).currentCents`) +
          assertSafeInteger(pending, `pot(${pot.id}).pendingCents`),
        `pot(${pot.id}) effective stand`,
      ),
    };
  });
}

/**
 * Computes the sync plan for externally linked pots. Virtual (unlinked) pots
 * are never part of the result.
 */
export function computePotSyncPlan(input: {
  pots: readonly PotLinkState[];
  accounts: readonly ExternalAccountInput[];
  positions: readonly ExternalPositionInput[];
}): PotSyncOutcome[] {
  const seen = new Set<string>();
  const outcomes: PotSyncOutcome[] = [];

  // Overlaps can arise later (a position moves into a linked account). They
  // must not break the whole sync: mark the position pots as conflicting.
  const linkedAccountRefs = new Set(
    input.pots.flatMap((p) =>
      p.externalLinkKind === "account" && p.externalLinkRef !== null
        ? [p.externalLinkRef]
        : [],
    ),
  );
  const positionById = new Map(input.positions.map((p) => [p.id, p]));

  for (const pot of input.pots) {
    if (pot.externalLinkKind === null || pot.externalLinkRef === null) {
      continue;
    }

    const key = `${pot.externalLinkKind}:${pot.externalLinkRef}`;
    if (seen.has(key)) {
      throw new RangeError(`Duplicate external link: ${key}`);
    }
    seen.add(key);

    const currentCents = assertSafeInteger(
      pot.currentCents,
      `pot(${pot.id}).currentCents`,
    );
    if (pot.externalLinkKind === "position") {
      const position = positionById.get(pot.externalLinkRef);
      if (position && linkedAccountRefs.has(position.accountId)) {
        outcomes.push({ potId: pot.id, status: "link_conflict", currentCents });
        continue;
      }
    }

    const resolved = resolveExternalLinkValue(
      pot.externalLinkKind,
      pot.externalLinkRef,
      input.accounts,
      input.positions,
    );

    if (resolved === null) {
      outcomes.push({
        potId: pot.id,
        status:
          pot.externalLinkScope === "personal"
            ? "link_out_of_scope"
            : "link_missing",
        currentCents,
      });
      continue;
    }

    if (!isHouseholdScope(resolved.scope)) {
      outcomes.push({ potId: pot.id, status: "link_out_of_scope", currentCents });
      continue;
    }

    if (resolved.valueCents === currentCents) {
      outcomes.push({
        potId: pot.id,
        status: "unchanged",
        currentCents,
        scope: resolved.scope,
        clampedNegative: resolved.clampedNegative,
        asOf: resolved.asOf,
      });
      continue;
    }

    outcomes.push({
      potId: pot.id,
      status: "updated",
      previousCents: currentCents,
      nextCents: resolved.valueCents,
      scope: resolved.scope,
      clampedNegative: resolved.clampedNegative,
      asOf: resolved.asOf,
    });
  }

  return outcomes;
}

export interface LinkOptionAccountSource {
  id: string;
  name: string;
  type: string;
  scope: ExternalScope;
  balanceCents: number;
  holdingsValueCents: number;
}

export interface LinkOptionPositionSource {
  id: string;
  accountId: string;
  name: string;
  assetClass: string;
  marketValueCents: number;
}

export interface PotLinkOption {
  kind: ExternalLinkKind;
  ref: string;
  label: string;
  /** Account type (accounts) or account name (positions). */
  detail: string;
  valueCents: number;
  /** True when the account is overdrawn (value clamped to 0). */
  clampedNegative: boolean;
  /** Account id for positions (null for accounts). */
  accountId: string | null;
}

/**
 * Builds the selectable link targets for the pot modal from a snapshot.
 * Values follow the same rules as the sync (negative totals clamp to 0).
 */
export function buildPotLinkOptions(
  allAccounts: readonly LinkOptionAccountSource[],
  allPositions: readonly LinkOptionPositionSource[],
): PotLinkOption[] {
  const { accounts, positions } = selectHouseholdHoldings(
    allAccounts,
    allPositions,
  );
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const options: PotLinkOption[] = accounts.map((account) => {
    const total = assertSafeInteger(
      account.balanceCents + account.holdingsValueCents,
      `account(${account.id}) total`,
    );
    return {
      kind: "account",
      ref: account.id,
      label: account.name,
      detail: account.type,
      valueCents: Math.max(0, total),
      clampedNegative: total < 0,
      accountId: null,
    };
  });

  for (const position of positions) {
    const account = accountById.get(position.accountId);
    if (!account) {
      continue;
    }
    options.push({
      kind: "position",
      ref: position.id,
      label: position.name,
      detail: account.name,
      valueCents: assertSafeInteger(
        position.marketValueCents,
        `position(${position.id}).marketValueCents`,
      ),
      clampedNegative: false,
      accountId: position.accountId,
    });
  }

  return options;
}
