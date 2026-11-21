export function isDevMode(
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env.NODE_ENV === "production") return false;
  return env.CORUSCANT_DEV_MODE?.trim().toLowerCase() !== "false";
}
