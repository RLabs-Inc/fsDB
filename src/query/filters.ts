/**
 * Filter Helpers
 *
 * Composable filter functions for querying collections.
 * All filters return FilterFn<S> that can be combined with and/or/not.
 */

import type { SchemaDefinition, SchemaToRecord, FilterFn, RecordWithMeta, SortOption, PaginatedResult } from '../core/types'
import { DEFAULT_PAGE_SIZE } from '../core/constants'

// =============================================================================
// Comparison Filters
// =============================================================================

/** Equal to */
export function eq<S extends SchemaDefinition, K extends keyof S>(
  column: K,
  value: SchemaToRecord<S>[K]
): FilterFn<S> {
  return (record) => record[column] === value
}

/** Not equal to */
export function neq<S extends SchemaDefinition, K extends keyof S>(
  column: K,
  value: SchemaToRecord<S>[K]
): FilterFn<S> {
  return (record) => record[column] !== value
}

/** Greater than */
export function gt<S extends SchemaDefinition, K extends keyof S>(
  column: K,
  value: number
): FilterFn<S> {
  return (record) => (record[column] as number) > value
}

/** Greater than or equal */
export function gte<S extends SchemaDefinition, K extends keyof S>(
  column: K,
  value: number
): FilterFn<S> {
  return (record) => (record[column] as number) >= value
}

/** Less than */
export function lt<S extends SchemaDefinition, K extends keyof S>(
  column: K,
  value: number
): FilterFn<S> {
  return (record) => (record[column] as number) < value
}

/** Less than or equal */
export function lte<S extends SchemaDefinition, K extends keyof S>(
  column: K,
  value: number
): FilterFn<S> {
  return (record) => (record[column] as number) <= value
}

/** Between (inclusive) */
export function between<S extends SchemaDefinition, K extends keyof S>(
  column: K,
  min: number,
  max: number
): FilterFn<S> {
  return (record) => {
    const val = record[column] as number
    return val >= min && val <= max
  }
}

/** Value is one of the provided values */
export function oneOf<S extends SchemaDefinition, K extends keyof S>(
  column: K,
  values: SchemaToRecord<S>[K][]
): FilterFn<S> {
  const set = new Set(values)
  return (record) => set.has(record[column])
}

// =============================================================================
// Text Search Filters
// =============================================================================

/** Full-text search across all text columns or specific columns */
export function fullText<S extends SchemaDefinition>(
  query: string,
  options?: { columns?: (keyof S)[]; caseSensitive?: boolean }
): FilterFn<S> {
  const searchTerm = options?.caseSensitive ? query : query.toLowerCase()

  return (record) => {
    const columns = options?.columns ?? (Object.keys(record) as (keyof S)[])

    for (const col of columns) {
      const value = record[col]
      if (typeof value === 'string') {
        const text = options?.caseSensitive ? value : value.toLowerCase()
        if (text.includes(searchTerm)) return true
      }
    }

    return false
  }
}

/** Regex pattern matching */
export function matches<S extends SchemaDefinition, K extends keyof S>(
  column: K,
  pattern: RegExp | string
): FilterFn<S> {
  const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern
  return (record) => {
    const value = record[column]
    if (typeof value !== 'string') return false
    return regex.test(value)
  }
}

/** Starts with prefix */
export function startsWith<S extends SchemaDefinition, K extends keyof S>(
  column: K,
  prefix: string,
  caseSensitive = false
): FilterFn<S> {
  const search = caseSensitive ? prefix : prefix.toLowerCase()
  return (record) => {
    const value = record[column]
    if (typeof value !== 'string') return false
    const text = caseSensitive ? value : value.toLowerCase()
    return text.startsWith(search)
  }
}

/** Ends with suffix */
export function endsWith<S extends SchemaDefinition, K extends keyof S>(
  column: K,
  suffix: string,
  caseSensitive = false
): FilterFn<S> {
  const search = caseSensitive ? suffix : suffix.toLowerCase()
  return (record) => {
    const value = record[column]
    if (typeof value !== 'string') return false
    const text = caseSensitive ? value : value.toLowerCase()
    return text.endsWith(search)
  }
}

// =============================================================================
// Array Filters
// =============================================================================

/** Array contains a value */
export function contains<S extends SchemaDefinition, K extends keyof S>(
  column: K,
  value: unknown
): FilterFn<S> {
  return (record) => {
    const arr = record[column]
    if (!Array.isArray(arr)) return false
    return (arr as unknown[]).includes(value)
  }
}

/** Array contains any of the values */
export function containsAny<S extends SchemaDefinition, K extends keyof S>(
  column: K,
  values: unknown[]
): FilterFn<S> {
  const set = new Set(values)
  return (record) => {
    const arr = record[column]
    if (!Array.isArray(arr)) return false
    return arr.some((v) => set.has(v))
  }
}

/** Array contains all of the values */
export function containsAll<S extends SchemaDefinition, K extends keyof S>(
  column: K,
  values: unknown[]
): FilterFn<S> {
  return (record) => {
    const arr = record[column]
    if (!Array.isArray(arr)) return false
    return values.every((v) => (arr as unknown[]).includes(v))
  }
}

/** Array is empty */
export function isEmpty<S extends SchemaDefinition, K extends keyof S>(
  column: K
): FilterFn<S> {
  return (record) => {
    const arr = record[column]
    if (!Array.isArray(arr)) return true
    return arr.length === 0
  }
}

/** Array is not empty */
export function isNotEmpty<S extends SchemaDefinition, K extends keyof S>(
  column: K
): FilterFn<S> {
  return (record) => {
    const arr = record[column]
    if (!Array.isArray(arr)) return false
    return arr.length > 0
  }
}

// =============================================================================
// Existence Filters
// =============================================================================

/** Value exists (not null/undefined) */
export function exists<S extends SchemaDefinition, K extends keyof S>(
  column: K
): FilterFn<S> {
  return (record) => record[column] != null
}

/** Value is null or undefined */
export function isNull<S extends SchemaDefinition, K extends keyof S>(
  column: K
): FilterFn<S> {
  return (record) => record[column] == null
}

// =============================================================================
// Date/Time Filters
// =============================================================================

/** Timestamp is after a date */
export function after<S extends SchemaDefinition, K extends keyof S>(
  column: K,
  date: Date | number
): FilterFn<S> {
  const ts = typeof date === 'number' ? date : date.getTime()
  return (record) => (record[column] as number) > ts
}

/** Timestamp is before a date */
export function before<S extends SchemaDefinition, K extends keyof S>(
  column: K,
  date: Date | number
): FilterFn<S> {
  const ts = typeof date === 'number' ? date : date.getTime()
  return (record) => (record[column] as number) < ts
}

/** Timestamp is within last N milliseconds */
export function withinLast<S extends SchemaDefinition, K extends keyof S>(
  column: K,
  milliseconds: number
): FilterFn<S> {
  return (record) => {
    const now = Date.now()
    const ts = record[column] as number
    return now - ts <= milliseconds
  }
}

// =============================================================================
// Logical Operators
// =============================================================================

/** Combine filters with AND */
export function and<S extends SchemaDefinition>(
  ...filters: FilterFn<S>[]
): FilterFn<S> {
  return (record, index) => filters.every((f) => f(record, index))
}

/** Combine filters with OR */
export function or<S extends SchemaDefinition>(
  ...filters: FilterFn<S>[]
): FilterFn<S> {
  return (record, index) => filters.some((f) => f(record, index))
}

/** Negate a filter */
export function not<S extends SchemaDefinition>(
  filter: FilterFn<S>
): FilterFn<S> {
  return (record, index) => !filter(record, index)
}

// =============================================================================
// Sorting
// =============================================================================

/** Sort records by one or more columns */
export function sortBy<S extends SchemaDefinition>(
  records: RecordWithMeta<S>[],
  ...sorts: (keyof S | SortOption<S>)[]
): RecordWithMeta<S>[] {
  const sortOptions: SortOption<S>[] = sorts.map((s) =>
    typeof s === 'object' ? s : { column: s, direction: 'asc' }
  )

  return [...records].sort((a, b) => {
    for (const opt of sortOptions) {
      const aVal = a[opt.column as keyof RecordWithMeta<S>]
      const bVal = b[opt.column as keyof RecordWithMeta<S>]

      if (aVal === bVal) continue
      if (aVal == null) return 1
      if (bVal == null) return -1

      const cmp = aVal < bVal ? -1 : 1
      return opt.direction === 'desc' ? -cmp : cmp
    }
    return 0
  })
}

// =============================================================================
// Pagination
// =============================================================================

/** Paginate records */
export function paginate<S extends SchemaDefinition>(
  records: RecordWithMeta<S>[],
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE
): PaginatedResult<S> {
  const total = records.length
  const totalPages = Math.ceil(total / pageSize)
  const start = (page - 1) * pageSize
  const end = start + pageSize

  return {
    records: records.slice(start, end),
    total,
    page,
    pageSize,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  }
}
