/**
 * Read plugin config whose fields may be live.
 *
 * Fields declared with `.volatile()` reach the plugin as live values with a
 * `get()` (that is how DSH's Plugins page edits them without a restart), while
 * unit tests and older hosts pass plain values. Resolve both the same way, once
 * per tool call, so a change saved on the settings page applies to the next call.
 */

/** A live config value, as cosmokit's volatile wrapper exposes it. */
interface Live {
  get(): unknown
}

const isLive = (value: unknown): value is Live =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && typeof (value as { get?: unknown }).get === 'function'

/**
 * Snapshot a config object, reading every live field's current value.
 * @param config - the config the plugin was applied with.
 * @returns a plain object with the same keys.
 */
export function resolveConfig<T extends object>(config: T): T {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(config)) out[key] = isLive(value) ? value.get() : value
  return out as T
}
