/**
 * Columns Manager
 *
 * Manages parallel reactive arrays for each schema column.
 * This is the heart of the Father State Pattern - each field
 * gets its own array, indexed by the registry.
 */

import { signal, type WritableSignal } from '@rlabs-inc/signals'
import type { SchemaDefinition, SchemaToRecord, ParsedColumnType, ParsedSchema } from './types'
import { DEFAULT_VALUES } from './constants'

// =============================================================================
// Schema Parsing
// =============================================================================

/**
 * Parse a column type string into structured info
 */
export function parseColumnType(type: string): ParsedColumnType {
  if (type === 'string') return { baseType: 'string' }
  if (type === 'number') return { baseType: 'number' }
  if (type === 'boolean') return { baseType: 'boolean' }
  if (type === 'timestamp') return { baseType: 'timestamp' }
  if (type === 'string[]') return { baseType: 'array', arrayType: 'string' }
  if (type === 'number[]') return { baseType: 'array', arrayType: 'number' }

  // Vector type: vector:384
  const vectorMatch = type.match(/^vector:(\d+)$/)
  if (vectorMatch) {
    return {
      baseType: 'vector',
      vectorDimensions: parseInt(vectorMatch[1], 10),
    }
  }

  throw new Error(`Unknown column type: ${type}`)
}

/**
 * Get default value for a column type
 */
export function getDefaultValue(type: string): unknown {
  const parsed = parseColumnType(type)

  switch (parsed.baseType) {
    case 'string':
      return DEFAULT_VALUES.string
    case 'number':
    case 'timestamp':
      return DEFAULT_VALUES.number
    case 'boolean':
      return DEFAULT_VALUES.boolean
    case 'array':
      return parsed.arrayType === 'string'
        ? [...DEFAULT_VALUES['string[]']]
        : [...DEFAULT_VALUES['number[]']]
    case 'vector':
      return DEFAULT_VALUES.vector
    default:
      return null
  }
}

/**
 * Parse a schema definition into structured info
 */
export function parseSchema<S extends SchemaDefinition>(definition: S): ParsedSchema<S> {
  const columns = Object.keys(definition) as (keyof S)[]
  const vectorColumns: (keyof S)[] = []
  const parsedTypes = new Map<keyof S, ParsedColumnType>()

  for (const col of columns) {
    const parsed = parseColumnType(definition[col] as string)
    parsedTypes.set(col, parsed)

    if (parsed.baseType === 'vector') {
      vectorColumns.push(col)
    }
  }

  return {
    definition,
    columns,
    vectorColumns,
    parsedTypes,
  }
}

// =============================================================================
// Columns Manager
// =============================================================================

export interface ColumnsManager<S extends SchemaDefinition> {
  /** Get the parsed schema */
  readonly schema: ParsedSchema<S>

  /** Get a raw column array (reactive signal) */
  getColumn<K extends keyof S>(name: K): WritableSignal<unknown[]>

  /** Get a value from a column at an index */
  get<K extends keyof S>(column: K, index: number): SchemaToRecord<S>[K]

  /** Set a value in a column at an index */
  set<K extends keyof S>(column: K, index: number, value: SchemaToRecord<S>[K]): void

  /** Get all column values for an index as a record */
  getRecord(index: number): SchemaToRecord<S>

  /** Set all column values for an index from a record */
  setRecord(index: number, record: Partial<SchemaToRecord<S>>): void

  /** Clear all values at an index (reset to defaults) */
  clearAt(index: number): void

  /** Reset all columns (for testing/cleanup) */
  reset(): void
}

/**
 * Create a columns manager for a schema
 *
 * Each column is a reactive signal containing an array.
 * Fine-grained updates: modifying arr[i] triggers only effects reading that index.
 */
export function createColumns<S extends SchemaDefinition>(
  definition: S
): ColumnsManager<S> {
  const schema = parseSchema(definition)

  // Create a reactive array for each column
  const columns = new Map<keyof S, WritableSignal<unknown[]>>()

  for (const col of schema.columns) {
    columns.set(col, signal<unknown[]>([]))
  }

  const manager: ColumnsManager<S> = {
    schema,

    getColumn<K extends keyof S>(name: K): WritableSignal<unknown[]> {
      const col = columns.get(name)
      if (!col) {
        throw new Error(`Unknown column: ${String(name)}`)
      }
      return col
    },

    get<K extends keyof S>(column: K, index: number): SchemaToRecord<S>[K] {
      const col = columns.get(column)
      if (!col) {
        throw new Error(`Unknown column: ${String(column)}`)
      }
      return col.value[index] as SchemaToRecord<S>[K]
    },

    set<K extends keyof S>(column: K, index: number, value: SchemaToRecord<S>[K]): void {
      const col = columns.get(column)
      if (!col) {
        throw new Error(`Unknown column: ${String(column)}`)
      }

      // Convert number arrays to Float32Array for vector columns
      const parsed = schema.parsedTypes.get(column)
      if (parsed?.baseType === 'vector' && Array.isArray(value)) {
        value = new Float32Array(value as number[]) as SchemaToRecord<S>[K]
      }

      // Ensure array is large enough
      const arr = col.value
      while (arr.length <= index) {
        arr.push(getDefaultValue(definition[column] as string))
      }

      // Set the value - triggers reactivity
      arr[index] = value
      // Force signal update for fine-grained tracking
      col.value = arr
    },

    getRecord(index: number): SchemaToRecord<S> {
      const record = {} as SchemaToRecord<S>

      for (const col of schema.columns) {
        record[col] = manager.get(col, index)
      }

      return record
    },

    setRecord(index: number, record: Partial<SchemaToRecord<S>>): void {
      for (const col of schema.columns) {
        if (col in record) {
          manager.set(col, index, record[col] as SchemaToRecord<S>[keyof S])
        } else {
          // Set default value for missing columns
          const defaultValue = getDefaultValue(definition[col] as string)
          manager.set(col, index, defaultValue as SchemaToRecord<S>[keyof S])
        }
      }
    },

    clearAt(index: number): void {
      for (const col of schema.columns) {
        const defaultValue = getDefaultValue(definition[col] as string)
        manager.set(col, index, defaultValue as SchemaToRecord<S>[keyof S])
      }
    },

    reset(): void {
      for (const col of schema.columns) {
        const colSignal = columns.get(col)
        if (colSignal) {
          colSignal.value = []
        }
      }
    },
  }

  return manager
}
