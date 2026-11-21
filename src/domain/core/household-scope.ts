import type { ExternalScope } from "@/domain/allocation/pot-sync";

export const HOUSEHOLD_SCOPE: ExternalScope = "household";

export function isHouseholdScope(scope: ExternalScope): boolean {
  return scope === HOUSEHOLD_SCOPE;
}

/**
 * Behält nur Konten mit scope = household und nur Positionen, deren Konto
 * darin enthalten ist. Positionen mit unbekanntem Konto fallen weg.
 * Reihenfolge der Eingaben bleibt erhalten; Eingaben werden nicht mutiert.
 */
export function selectHouseholdHoldings<
  A extends { id: string; scope: ExternalScope },
  P extends { accountId: string },
>(
  accounts: readonly A[],
  positions: readonly P[],
): { accounts: A[]; positions: P[] } {
  const householdAccounts = accounts.filter((a) => isHouseholdScope(a.scope));
  const ids = new Set(householdAccounts.map((a) => a.id));
  return {
    accounts: householdAccounts,
    positions: positions.filter((p) => ids.has(p.accountId)),
  };
}
