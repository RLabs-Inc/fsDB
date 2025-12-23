/**
 * Collection
 *
 * A reactive collection using the Father State Pattern.
 * Combines the registry (index management) with columns (parallel arrays).
 *
 * This is where the fractal pattern lives - each collection is a FatherState.
 */

import { signal, derived, type WritableSignal, type DerivedSignal } from '@rlabs-inc/signals'
import { createRegistry, generateId, type Registry } from './registry'
import { createColumns, type ColumnsManager } from './columns'
import type {
  SchemaDefinition,
  SchemaToRecord,
  RecordWithMeta,
  PartialRecord,
  CollectionOptions,
  FilterFn,
  QueryResult,
} from './types'

// =============================================================================
// Metadata Arrays
// =============================================================================

interface MetadataArrays {
  created: WritableSignal<number[]>
  updated: WritableSignal<number[]>
  stale: WritableSignal<boolean[]>
}

function createMetadataArrays(): MetadataArrays {
  return {
    created: signal<number[]>([]),
    updated: signal<number[]>([]),
    stale: signal<boolean[]>([]),
  }
}

// =============================================================================
// Collection Interface
// =============================================================================

export interface Collection<S extends SchemaDefinition> {
  /** Collection name */
  readonly name: string

  /** The schema definition */
  readonly schema: S

  /** Content column (stored as markdown body) */
  readonly contentColumn: keyof S | undefined

  /** Access to the registry */
  readonly registry: Registry

  /** Access to the columns manager */
  readonly columns: ColumnsManager<S>

  // ===========================================================================
  // CRUD Operations
  // ===========================================================================

  /** Insert a record, returns the ID */
  insert(data: PartialRecord<S>): string

  /** Insert multiple records, returns array of IDs */
  insertMany(records: PartialRecord<S>[]): string[]

  /** Get a record by ID */
  get(id: string): RecordWithMeta<S> | undefined

  /** Get all records */
  all(): RecordWithMeta<S>[]

  /** Find records matching a filter */
  find(filter: FilterFn<S>): RecordWithMeta<S>[]

  /** Find first record matching a filter */
  findOne(filter: FilterFn<S>): RecordWithMeta<S> | undefined

  /** Update a record by ID */
  update(id: string, data: Partial<SchemaToRecord<S>>): boolean

  /** Update a specific field of a record */
  updateField<K extends keyof S>(id: string, field: K, value: SchemaToRecord<S>[K]): boolean

  /** Update multiple records matching a filter */
  updateMany(filter: FilterFn<S>, data: Partial<SchemaToRecord<S>>): number

  /** Delete a record by ID */
  delete(id: string): boolean

  /** Delete multiple records matching a filter */
  deleteMany(filter: FilterFn<S>): number

  /** Count records (optionally filtered) */
  count(filter?: FilterFn<S>): number

  // ===========================================================================
  // Reactivity
  // ===========================================================================

  /** Get a reactive count */
  readonly reactiveCount: DerivedSignal<number>

  // ===========================================================================
  // Low-Level Access
  // ===========================================================================

  /** Get record by array index (not ID) */
  getByIndex(index: number): RecordWithMeta<S> | undefined

  /** Get all allocated indices */
  getIndices(): number[]

  /** Check if record exists */
  has(id: string): boolean

  // ===========================================================================
  // Metadata
  // ===========================================================================

  /** Check if a record's embedding is stale */
  isStale(id: string): boolean

  /** Get all IDs with stale embeddings */
  getStaleIds(): string[]

  /** Manually set stale flag */
  setStale(id: string, stale: boolean): void

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /** Clear all data */
  clear(): void
}

// =============================================================================
// Create Collection
// =============================================================================

export function createCollection<S extends SchemaDefinition>(
  name: string,
  options: CollectionOptions<S>
): Collection<S> {
  const { schema, contentColumn } = options

  // Core Father State components
  const registry = createRegistry()
  const columns = createColumns(schema)
  const metadata = createMetadataArrays()

  // Helper to build a record with metadata from an index
  function buildRecord(index: number): RecordWithMeta<S> {
    const id = registry.getId(index)
    if (!id) throw new Error(`No ID for index ${index}`)

    const data = columns.getRecord(index)

    return {
      ...data,
      id,
      created: metadata.created.value[index] ?? 0,
      updated: metadata.updated.value[index] ?? 0,
      stale: metadata.stale.value[index] ?? false,
    }
  }

  // Helper to set metadata at an index
  function setMetadataAt(index: number, created: number, updated: number, stale: boolean) {
    const createdArr = metadata.created.value
    const updatedArr = metadata.updated.value
    const staleArr = metadata.stale.value

    // Ensure arrays are large enough
    while (createdArr.length <= index) createdArr.push(0)
    while (updatedArr.length <= index) updatedArr.push(0)
    while (staleArr.length <= index) staleArr.push(false)

    createdArr[index] = created
    updatedArr[index] = updated
    staleArr[index] = stale

    // Trigger reactivity
    metadata.created.value = createdArr
    metadata.updated.value = updatedArr
    metadata.stale.value = staleArr
  }

  const collection: Collection<S> = {
    name,
    schema,
    contentColumn,
    registry,
    columns,

    // =========================================================================
    // CRUD
    // =========================================================================

    insert(data: PartialRecord<S>): string {
      const id = data.id ?? generateId()
      const index = registry.allocate(id)
      const now = Date.now()

      // Set column data
      columns.setRecord(index, data as Partial<SchemaToRecord<S>>)

      // Set metadata
      setMetadataAt(index, now, now, false)

      return id
    },

    insertMany(records: PartialRecord<S>[]): string[] {
      return records.map((record) => collection.insert(record))
    },

    get(id: string): RecordWithMeta<S> | undefined {
      const index = registry.getIndex(id)
      if (index === -1) return undefined
      return buildRecord(index)
    },

    all(): RecordWithMeta<S>[] {
      const indices = registry.getAllIndices()
      return indices.map((index) => buildRecord(index))
    },

    find(filter: FilterFn<S>): RecordWithMeta<S>[] {
      const results: RecordWithMeta<S>[] = []
      const indices = registry.getAllIndices()

      for (const index of indices) {
        const data = columns.getRecord(index)
        if (filter(data, index)) {
          results.push(buildRecord(index))
        }
      }

      return results
    },

    findOne(filter: FilterFn<S>): RecordWithMeta<S> | undefined {
      const indices = registry.getAllIndices()

      for (const index of indices) {
        const data = columns.getRecord(index)
        if (filter(data, index)) {
          return buildRecord(index)
        }
      }

      return undefined
    },

    update(id: string, data: Partial<SchemaToRecord<S>>): boolean {
      const index = registry.getIndex(id)
      if (index === -1) return false

      // Update only provided fields
      for (const key of Object.keys(data) as (keyof S)[]) {
        columns.set(key, index, data[key] as SchemaToRecord<S>[keyof S])
      }

      // Update timestamp
      const updatedArr = metadata.updated.value
      updatedArr[index] = Date.now()
      metadata.updated.value = updatedArr

      return true
    },

    updateField<K extends keyof S>(id: string, field: K, value: SchemaToRecord<S>[K]): boolean {
      const index = registry.getIndex(id)
      if (index === -1) return false

      columns.set(field, index, value)

      // Update timestamp
      const updatedArr = metadata.updated.value
      updatedArr[index] = Date.now()
      metadata.updated.value = updatedArr

      return true
    },

    updateMany(filter: FilterFn<S>, data: Partial<SchemaToRecord<S>>): number {
      let count = 0
      const indices = registry.getAllIndices()
      const now = Date.now()

      for (const index of indices) {
        const record = columns.getRecord(index)
        if (filter(record, index)) {
          for (const key of Object.keys(data) as (keyof S)[]) {
            columns.set(key, index, data[key] as SchemaToRecord<S>[keyof S])
          }

          const updatedArr = metadata.updated.value
          updatedArr[index] = now
          metadata.updated.value = updatedArr

          count++
        }
      }

      return count
    },

    delete(id: string): boolean {
      const index = registry.getIndex(id)
      if (index === -1) return false

      // Clear column data
      columns.clearAt(index)

      // Clear metadata
      const createdArr = metadata.created.value
      const updatedArr = metadata.updated.value
      const staleArr = metadata.stale.value

      if (index < createdArr.length) createdArr[index] = 0
      if (index < updatedArr.length) updatedArr[index] = 0
      if (index < staleArr.length) staleArr[index] = false

      metadata.created.value = createdArr
      metadata.updated.value = updatedArr
      metadata.stale.value = staleArr

      // Release index
      registry.release(id)

      return true
    },

    deleteMany(filter: FilterFn<S>): number {
      const toDelete: string[] = []
      const indices = registry.getAllIndices()

      for (const index of indices) {
        const data = columns.getRecord(index)
        if (filter(data, index)) {
          const id = registry.getId(index)
          if (id) toDelete.push(id)
        }
      }

      for (const id of toDelete) {
        collection.delete(id)
      }

      return toDelete.length
    },

    count(filter?: FilterFn<S>): number {
      if (!filter) {
        return registry.count
      }

      let count = 0
      const indices = registry.getAllIndices()

      for (const index of indices) {
        const data = columns.getRecord(index)
        if (filter(data, index)) count++
      }

      return count
    },

    // =========================================================================
    // Reactivity
    // =========================================================================

    reactiveCount: derived(() => registry.count),

    // =========================================================================
    // Low-Level Access
    // =========================================================================

    getByIndex(index: number): RecordWithMeta<S> | undefined {
      if (!registry.allocatedIndices.has(index)) return undefined
      return buildRecord(index)
    },

    getIndices(): number[] {
      return registry.getAllIndices()
    },

    has(id: string): boolean {
      return registry.has(id)
    },

    // =========================================================================
    // Metadata
    // =========================================================================

    isStale(id: string): boolean {
      const index = registry.getIndex(id)
      if (index === -1) return false
      return metadata.stale.value[index] ?? false
    },

    getStaleIds(): string[] {
      const ids: string[] = []
      const staleArr = metadata.stale.value

      for (const index of registry.getAllIndices()) {
        if (staleArr[index]) {
          const id = registry.getId(index)
          if (id) ids.push(id)
        }
      }

      return ids
    },

    setStale(id: string, stale: boolean): void {
      const index = registry.getIndex(id)
      if (index === -1) return

      const staleArr = metadata.stale.value
      while (staleArr.length <= index) staleArr.push(false)
      staleArr[index] = stale
      metadata.stale.value = staleArr
    },

    // =========================================================================
    // Lifecycle
    // =========================================================================

    clear(): void {
      registry.reset()
      columns.reset()
      metadata.created.value = []
      metadata.updated.value = []
      metadata.stale.value = []
    },
  }

  return collection
}
