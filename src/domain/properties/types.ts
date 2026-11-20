export const PROPERTY_TYPES = [
  "etw",
  "efh",
  "dhh",
  "rh",
  "reh",
  "mfh",
  "bungalow",
  "villa",
  "sonstiges",
] as const;

export type PropertyType = (typeof PROPERTY_TYPES)[number];
