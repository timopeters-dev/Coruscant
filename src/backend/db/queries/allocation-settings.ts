import { inArray } from "drizzle-orm";
import { getDb } from "@/backend/db/connection";
import { nowIso } from "@/backend/db/helpers";
import { appMeta } from "@/backend/db/schema";
import {
  allocationSettingsSchema, type AllocationSettings, variableExpenseBasisSchema,
} from "@/validation/external";

export interface AllocationSettingsState extends AllocationSettings {
  includePropertyItems: boolean;
}

/** Ablage in `app_meta` als Schlüssel/Wert-Paare. */
const META_KEYS = {
  variableBasis: "allocation_variable_basis",
  includeContractItems: "allocation_include_contract_items",
  includePropertyItems: "allocation_include_property_items",
} as const;

/** Früherer Schlüssel für `includeContractItems`; wird nur noch gelesen. */
const LEGACY_INCLUDE_CONTRACTS_KEY = "allocation_include_contracts_mode_b";

export const DEFAULT_ALLOCATION_SETTINGS: AllocationSettingsState = {
  variableBasis: "budget",
  includeContractItems: false,
  includePropertyItems: true,
};

const parseBool = (raw: string | undefined, fallback: boolean) => (raw === "true" ? true : raw === "false" ? false : fallback);

export function getAllocationSettings(): AllocationSettingsState {
  const rows = getDb()
    .select()
    .from(appMeta)
    .where(inArray(appMeta.key, [...Object.values(META_KEYS), LEGACY_INCLUDE_CONTRACTS_KEY]))
    .all();
  const meta = new Map(rows.map((r) => [r.key, r.value]));
  const basis = variableExpenseBasisSchema.safeParse(meta.get(META_KEYS.variableBasis));
  return {
    variableBasis: basis.success ? basis.data : DEFAULT_ALLOCATION_SETTINGS.variableBasis,
    includeContractItems: parseBool(
      meta.get(META_KEYS.includeContractItems) ?? meta.get(LEGACY_INCLUDE_CONTRACTS_KEY),
      DEFAULT_ALLOCATION_SETTINGS.includeContractItems,
    ),
    includePropertyItems: parseBool(meta.get(META_KEYS.includePropertyItems), DEFAULT_ALLOCATION_SETTINGS.includePropertyItems),
  };
}

export function saveAllocationSettings(patch: Partial<AllocationSettingsState>): AllocationSettingsState {
  const current = getAllocationSettings();
  const next: AllocationSettingsState = {
    ...allocationSettingsSchema.parse({
      variableBasis: patch.variableBasis ?? current.variableBasis,
      includeContractItems: patch.includeContractItems ?? current.includeContractItems,
    }),
    includePropertyItems: Boolean(patch.includePropertyItems ?? current.includePropertyItems),
  };

  const now = nowIso();
  getDb().transaction((tx) => {
    for (const [field, key] of Object.entries(META_KEYS) as [keyof AllocationSettingsState, string][]) {
      const value = String(next[field]);
      tx.insert(appMeta).values({ key, value, updatedAt: now }).onConflictDoUpdate({ target: appMeta.key, set: { value, updatedAt: now } }).run();
    }
  });
  return next;
}
