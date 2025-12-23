/**
 * fsDB Constants
 */

/** Default values for column types */
export const DEFAULT_VALUES = {
  string: '',
  number: 0,
  boolean: false,
  timestamp: 0,
  'string[]': [] as string[],
  'number[]': [] as number[],
  vector: null as Float32Array | null,
} as const

/** File watcher debounce time in ms */
export const WATCHER_DEBOUNCE_MS = 100

/** Time to wait after save before allowing file watcher to process (prevents loops) */
export const SAVE_GRACE_PERIOD_MS = 200

/** Default page size for pagination */
export const DEFAULT_PAGE_SIZE = 20

/** Maximum iterations for stale detection loop */
export const MAX_STALE_CHECK_ITERATIONS = 10000
