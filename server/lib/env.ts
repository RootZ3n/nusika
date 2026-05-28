/**
 * Environment variable helper with backward-compatibility aliases.
 *
 * During the Magister -> Nusika rename, all MAGISTER_* env vars were
 * renamed to NUSIKA_*. This helper checks the new name first and falls
 * back to the legacy name so existing deployments keep working.
 */

/**
 * Read NUSIKA_<suffix>, falling back to MAGISTER_<suffix>.
 * Returns `defaultValue` (or undefined) when neither is set.
 */
export function nenv(suffix: string, defaultValue?: string): string | undefined {
  return process.env[`NUSIKA_${suffix}`] ?? process.env[`MAGISTER_${suffix}`] ?? defaultValue;
}
