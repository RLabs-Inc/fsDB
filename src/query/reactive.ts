/**
 * Reactive Queries
 *
 * Queries that automatically re-evaluate when underlying data changes.
 * Built on derived() from @rlabs-inc/signals.
 */

import { derived, type DerivedSignal } from '@rlabs-inc/signals'
import type { Collection } from '../core/collection'
import type {
  SchemaDefinition,
  SchemaToRecord,
  RecordWithMeta,
  FilterFn,
  QueryResult,
  SortOption,
} from '../core/types'

// =============================================================================
// Reactive Query Builders
// =============================================================================

/**
 * Create a reactive query that auto-updates when data changes
 *
 * @example
 * const activeUsers = query(users, (r) => r.active === true)
 * effect(() => {
 *   console.log('Active users:', activeUsers.value.count)
 * })
 */
export function query<S extends SchemaDefinition>(
  collection: Collection<S>,
  filter: FilterFn<S>
): DerivedSignal<QueryResult<S>> {
  return derived(() => {
    const indices: number[] = []
    const records: RecordWithMeta<S>[] = []

    for (const index of collection.getIndices()) {
      const data = collection.columns.getRecord(index)
      if (filter(data, index)) {
        indices.push(index)
        const record = collection.getByIndex(index)
        if (record) records.push(record)
      }
    }

    return { indices, records, count: records.length }
  })
}

/**
 * Create a reactive sorted query
 *
 * @example
 * const topUsers = querySorted(users, (r) => r.score > 100, 'score', true)
 */
export function querySorted<S extends SchemaDefinition>(
  collection: Collection<S>,
  filter: FilterFn<S>,
  sortBy: keyof S | SortOption<S>[],
  descending = false
): DerivedSignal<QueryResult<S>> {
  return derived(() => {
    const result = query(collection, filter).value

    // Build sort options
    const sortOptions: SortOption<S>[] = Array.isArray(sortBy)
      ? sortBy
      : [{ column: sortBy, direction: descending ? 'desc' : 'asc' }]

    // Sort records
    const sorted = [...result.records].sort((a, b) => {
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

    // Rebuild indices to match sorted order
    const sortedIndices = sorted.map((r) => collection.registry.getIndex(r.id))

    return { indices: sortedIndices, records: sorted, count: sorted.length }
  })
}

/**
 * Create a reactive query that returns only the first match
 *
 * @example
 * const admin = queryFirst(users, (r) => r.role === 'admin')
 */
export function queryFirst<S extends SchemaDefinition>(
  collection: Collection<S>,
  filter: FilterFn<S>
): DerivedSignal<RecordWithMeta<S> | undefined> {
  return derived(() => {
    for (const index of collection.getIndices()) {
      const data = collection.columns.getRecord(index)
      if (filter(data, index)) {
        return collection.getByIndex(index)
      }
    }
    return undefined
  })
}

/**
 * Create a reactive count query
 *
 * @example
 * const activeCount = queryCount(users, (r) => r.active)
 */
export function queryCount<S extends SchemaDefinition>(
  collection: Collection<S>,
  filter: FilterFn<S>
): DerivedSignal<number> {
  return derived(() => {
    let count = 0
    for (const index of collection.getIndices()) {
      const data = collection.columns.getRecord(index)
      if (filter(data, index)) count++
    }
    return count
  })
}

/**
 * Create a reactive aggregation query
 *
 * @example
 * const totalScore = queryAggregate(users, (records) =>
 *   records.reduce((sum, r) => sum + r.score, 0)
 * )
 */
export function queryAggregate<S extends SchemaDefinition, T>(
  collection: Collection<S>,
  aggregator: (records: SchemaToRecord<S>[]) => T,
  filter?: FilterFn<S>
): DerivedSignal<T> {
  return derived(() => {
    const records: SchemaToRecord<S>[] = []

    for (const index of collection.getIndices()) {
      const data = collection.columns.getRecord(index)
      if (!filter || filter(data, index)) {
        records.push(data)
      }
    }

    return aggregator(records)
  })
}

/**
 * Create a reactive query that groups records by a field
 *
 * @example
 * const byRole = queryGroupBy(users, 'role')
 * // { admin: [...], user: [...], guest: [...] }
 */
export function queryGroupBy<S extends SchemaDefinition, K extends keyof S>(
  collection: Collection<S>,
  field: K,
  filter?: FilterFn<S>
): DerivedSignal<Map<SchemaToRecord<S>[K], RecordWithMeta<S>[]>> {
  return derived(() => {
    const groups = new Map<SchemaToRecord<S>[K], RecordWithMeta<S>[]>()

    for (const index of collection.getIndices()) {
      const data = collection.columns.getRecord(index)
      if (filter && !filter(data, index)) continue

      const key = data[field]
      const record = collection.getByIndex(index)
      if (!record) continue

      const group = groups.get(key)
      if (group) {
        group.push(record)
      } else {
        groups.set(key, [record])
      }
    }

    return groups
  })
}
