/**
 * fsDB - Fractal State Database
 *
 * A reactive database with parallel arrays and fine-grained reactivity.
 * Built on the Father State pattern at every level.
 *
 * @packageDocumentation
 */

// =============================================================================
// Core Types
// =============================================================================

export type {
  // Schema types
  ColumnType,
  SchemaDefinition,
  ColumnTypeToTS,
  SchemaToRecord,
  RecordWithMeta,
  PartialRecord,
  ParsedColumnType,
  ParsedSchema,

  // Options
  CollectionOptions,
  DatabaseOptions,

  // Events
  FileChangeEvent,

  // Query types
  FilterFn,
  QueryResult,
  PaginatedResult,
  SortOption,

  // Vector types
  VectorSearchOptions,
  VectorSearchResult,
} from './core/types'

// =============================================================================
// Database & Collections
// =============================================================================

export {
  createDatabase,
  fsDB,
  createPersistentCollection,
  type Database,
  type PersistentCollection,
} from './core/database'

export {
  createCollection,
  type Collection,
} from './core/collection'

// =============================================================================
// Registry & Columns (Low-level access)
// =============================================================================

export {
  createRegistry,
  generateId,
  type Registry,
} from './core/registry'

export {
  createColumns,
  parseColumnType,
  parseSchema,
  getDefaultValue,
  type ColumnsManager,
} from './core/columns'

// =============================================================================
// Reactive Queries
// =============================================================================

export {
  query,
  querySorted,
  queryFirst,
  queryCount,
  queryAggregate,
  queryGroupBy,
} from './query/reactive'

// =============================================================================
// Filters
// =============================================================================

export {
  // Comparison
  eq,
  neq,
  gt,
  gte,
  lt,
  lte,
  between,
  oneOf,

  // Text search
  fullText,
  matches,
  startsWith,
  endsWith,

  // Array
  contains,
  containsAny,
  containsAll,
  isEmpty,
  isNotEmpty,

  // Existence
  exists,
  isNull,

  // Date/time
  after,
  before,
  withinLast,

  // Logic
  and,
  or,
  not,

  // Utilities
  sortBy,
  paginate,
} from './query/filters'

// =============================================================================
// Vector Search
// =============================================================================

export {
  vectorSearch,
  cosineSimilarity,
  batchCosineSimilarity,
  normalizeVector,
  toFloat32Array,
  createEmbeddingManager,
  type EmbeddingManager,
} from './vector/search'

// =============================================================================
// Persistence
// =============================================================================

export {
  parseMarkdown,
  generateMarkdown,
  loadFromMarkdown,
  saveToMarkdown,
  loadFromDirectory,
  deleteMarkdownFile,
  ensureDirectory,
  idToFilename,
  filenameToId,
} from './persistence/markdown'

export {
  createFileWatcher,
  type FileWatcher,
  type WatcherOptions,
} from './persistence/watcher'

// =============================================================================
// Constants
// =============================================================================

export {
  DEFAULT_VALUES,
  WATCHER_DEBOUNCE_MS,
  SAVE_GRACE_PERIOD_MS,
  DEFAULT_PAGE_SIZE,
} from './core/constants'
