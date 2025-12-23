/**
 * fsDB Type Definitions
 *
 * Core types for the Fractal State Database
 */

// =============================================================================
// Schema Types
// =============================================================================

/** Supported column types */
export type ColumnType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'timestamp'
  | 'string[]'
  | 'number[]'
  | `vector:${number}`

/** Schema definition - maps field names to column types */
export type SchemaDefinition = Record<string, ColumnType>

/** Convert a column type to its TypeScript type */
export type ColumnTypeToTS<T extends ColumnType> =
  T extends 'string' ? string :
  T extends 'number' ? number :
  T extends 'boolean' ? boolean :
  T extends 'timestamp' ? number :
  T extends 'string[]' ? string[] :
  T extends 'number[]' ? number[] :
  T extends `vector:${number}` ? Float32Array | null :
  never

/** Convert a schema definition to a record type */
export type SchemaToRecord<S extends SchemaDefinition> = {
  [K in keyof S]: ColumnTypeToTS<S[K]>
}

/** Record with metadata */
export type RecordWithMeta<S extends SchemaDefinition> = SchemaToRecord<S> & {
  id: string
  created: number
  updated: number
  stale: boolean
}

/** Partial record for inserts/updates */
export type PartialRecord<S extends SchemaDefinition> = Partial<SchemaToRecord<S>> & {
  id?: string
}

// =============================================================================
// Parsed Schema Info
// =============================================================================

export interface ParsedColumnType {
  baseType: 'string' | 'number' | 'boolean' | 'timestamp' | 'array' | 'vector'
  arrayType?: 'string' | 'number'
  vectorDimensions?: number
}

export interface ParsedSchema<S extends SchemaDefinition> {
  definition: S
  columns: (keyof S)[]
  vectorColumns: (keyof S)[]
  parsedTypes: Map<keyof S, ParsedColumnType>
}

// =============================================================================
// Collection Options
// =============================================================================

export interface CollectionOptions<S extends SchemaDefinition> {
  /** Schema defining the columns */
  schema: S

  /** Which column contains the main content (stored as markdown body) */
  contentColumn?: keyof S

  /** Storage path - local folder or ~/.fsdb/[name] */
  path?: string

  /** Auto-save changes to disk */
  autoSave?: boolean

  /** Watch files for external changes */
  watchFiles?: boolean

  /** Callback when external file changes are detected */
  onExternalChange?: (event: FileChangeEvent<S>) => void | Promise<void>
}

// =============================================================================
// Database Options
// =============================================================================

export interface DatabaseOptions {
  /** Database name (used for path generation) */
  name?: string

  /**
   * Use project-local storage instead of global ~/.fsdb/
   * - false (default): ~/.fsdb/[name]/[collection]/
   * - true: ./.fsdb/[name]/[collection]/
   */
  local?: boolean

  /**
   * Custom base path - overrides both local and global defaults
   * If set, collections will be stored at [basePath]/[collection]/
   */
  basePath?: string
}

// =============================================================================
// File Change Events
// =============================================================================

export interface FileChangeEvent<S extends SchemaDefinition> {
  type: 'create' | 'update' | 'delete'
  id: string
  filename: string
  filepath: string
  record?: RecordWithMeta<S>
  stale: boolean
}

// =============================================================================
// Query Types
// =============================================================================

export type FilterFn<S extends SchemaDefinition> = (record: SchemaToRecord<S>, index: number) => boolean

export interface QueryResult<S extends SchemaDefinition> {
  indices: number[]
  records: RecordWithMeta<S>[]
  count: number
}

export interface PaginatedResult<S extends SchemaDefinition> {
  records: RecordWithMeta<S>[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  hasNext: boolean
  hasPrev: boolean
}

export interface SortOption<S extends SchemaDefinition> {
  column: keyof S
  direction: 'asc' | 'desc'
}

// =============================================================================
// Vector Search Types
// =============================================================================

export interface VectorSearchOptions<S extends SchemaDefinition> {
  /** Number of top results to return */
  topK?: number

  /** Minimum similarity threshold (0-1) */
  minSimilarity?: number

  /** Pre-filter records before vector search */
  filter?: FilterFn<S>
}

export interface VectorSearchResult<S extends SchemaDefinition> {
  record: RecordWithMeta<S>
  similarity: number
  stale: boolean
}
