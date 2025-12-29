/**
 * Database
 *
 * The top level of the fractal - manages collections.
 * Each database is a FatherState at the macro level.
 */

import { ReactiveMap } from '@rlabs-inc/signals'
import { createCollection, type Collection } from './collection'
import type { SchemaDefinition, CollectionOptions, DatabaseOptions, RecordWithMeta, FileChangeEvent } from './types'
import {
  ensureDirectory,
  idToFilename,
  loadFromDirectory,
  saveToMarkdown,
  deleteMarkdownFile,
} from '../persistence/markdown'
import { createFileWatcher, type FileWatcher } from '../persistence/watcher'
import { createEmbeddingManager, type EmbeddingManager, vectorSearch } from '../vector/search'
import type { VectorSearchOptions, VectorSearchResult } from './types'

// =============================================================================
// Persistent Collection (Collection + File I/O + Watching)
// =============================================================================

export interface PersistentCollection<S extends SchemaDefinition> extends Collection<S> {
  /** Load all records from disk */
  load(): Promise<number>

  /** Save all records to disk */
  save(): Promise<number>

  /** Start file watching */
  startWatching(): void

  /** Stop file watching */
  stopWatching(): void

  /** Is currently watching */
  readonly isWatching: boolean

  /** Register callback for file changes */
  onFileChange(callback: (event: FileChangeEvent<S>) => void | Promise<void>): () => void

  /** Set embedding with content hash for stale detection */
  setEmbedding(id: string, column: keyof S, embedding: Float32Array | number[], sourceContent: string): void

  /** Vector similarity search */
  search(column: keyof S, queryVector: Float32Array | number[], options?: VectorSearchOptions<S>): VectorSearchResult<S>[]

  /** Close the collection (stop watching, cleanup) */
  close(): void
}

/**
 * Create a persistent collection with file I/O and watching
 */
export function createPersistentCollection<S extends SchemaDefinition>(
  name: string,
  options: CollectionOptions<S> & { path: string }
): PersistentCollection<S> {
  const baseCollection = createCollection(name, options)
  const { path, schema, contentColumn, autoSave = false, watchFiles = false, onExternalChange } = options

  const embeddingManager = createEmbeddingManager()
  let fileWatcher: FileWatcher<S> | null = null

  // Track files being saved to prevent reload loops
  const savingIds = new Set<string>()

  // Helper to get filepath for a record
  function getFilepath(id: string): string {
    return `${path}/${idToFilename(id)}`
  }

  // Helper to save a single record
  async function saveRecord(id: string): Promise<boolean> {
    const record = baseCollection.get(id)
    if (!record) return false

    savingIds.add(id)
    if (fileWatcher) fileWatcher.markSaving(id)

    const success = await saveToMarkdown(getFilepath(id), record, schema, contentColumn)

    setTimeout(() => {
      savingIds.delete(id)
      if (fileWatcher) fileWatcher.clearSaving(id)
    }, 200)

    return success
  }

  // Helper to delete a file
  async function deleteFile(id: string): Promise<boolean> {
    return await deleteMarkdownFile(getFilepath(id))
  }

  // Check if content has changed (for stale detection)
  function isContentStale(id: string, content: string): boolean {
    // Check all vector columns
    for (const col of baseCollection.columns.schema.vectorColumns) {
      if (embeddingManager.isStale(id, String(col), content)) {
        return true
      }
    }
    return false
  }

  // Wrap base collection methods to add persistence
  const persistentCollection: PersistentCollection<S> = {
    // Pass through all base collection properties
    name: baseCollection.name,
    schema: baseCollection.schema,
    contentColumn: baseCollection.contentColumn,
    registry: baseCollection.registry,
    columns: baseCollection.columns,
    reactiveCount: baseCollection.reactiveCount,

    // CRUD with auto-save
    insert(data) {
      const id = baseCollection.insert(data)
      if (autoSave) saveRecord(id)
      return id
    },

    insertMany(records) {
      const ids = baseCollection.insertMany(records)
      if (autoSave) {
        for (const id of ids) saveRecord(id)
      }
      return ids
    },

    get: baseCollection.get.bind(baseCollection),
    all: baseCollection.all.bind(baseCollection),
    find: baseCollection.find.bind(baseCollection),
    findOne: baseCollection.findOne.bind(baseCollection),

    update(id, data) {
      const success = baseCollection.update(id, data)
      if (success && autoSave) saveRecord(id)
      return success
    },

    updateField(id, field, value) {
      const success = baseCollection.updateField(id, field, value)
      if (success && autoSave) saveRecord(id)
      return success
    },

    updateMany(filter, data) {
      const count = baseCollection.updateMany(filter, data)
      // Auto-save updated records
      if (count > 0 && autoSave) {
        const updated = baseCollection.find(filter)
        for (const record of updated) saveRecord(record.id)
      }
      return count
    },

    delete(id) {
      const success = baseCollection.delete(id)
      if (success && autoSave) deleteFile(id)
      embeddingManager.clearHash(id, '*') // Clear all hashes for this id
      return success
    },

    deleteMany(filter) {
      const toDelete = baseCollection.find(filter).map(r => r.id)
      const count = baseCollection.deleteMany(filter)
      if (autoSave) {
        for (const id of toDelete) deleteFile(id)
      }
      for (const id of toDelete) {
        embeddingManager.clearHash(id, '*')
      }
      return count
    },

    count: baseCollection.count.bind(baseCollection),
    getByIndex: baseCollection.getByIndex.bind(baseCollection),
    getIndices: baseCollection.getIndices.bind(baseCollection),
    has: baseCollection.has.bind(baseCollection),
    isStale: baseCollection.isStale.bind(baseCollection),
    getStaleIds: baseCollection.getStaleIds.bind(baseCollection),
    setStale: baseCollection.setStale.bind(baseCollection),
    setMetadata: baseCollection.setMetadata.bind(baseCollection),

    clear() {
      baseCollection.clear()
      embeddingManager.reset()
    },

    // Persistence
    async load() {
      await ensureDirectory(path)
      const loaded = await loadFromDirectory(path, schema, contentColumn)

      for (const { id, record } of loaded) {
        // Allocate index and set data
        const index = baseCollection.registry.allocate(id)
        baseCollection.columns.setRecord(index, record as any)

        // Set metadata from loaded record
        const created = (record as any).created ?? Date.now()
        const updated = (record as any).updated ?? created
        const stale = (record as any).stale ?? false
        baseCollection.setMetadata(id, created, updated, stale)

        // Check if content is stale (embedding out of sync)
        if (contentColumn) {
          const content = record[contentColumn as keyof typeof record] as string
          if (content && isContentStale(id, content)) {
            baseCollection.setStale(id, true)
          }
        }
      }

      return loaded.length
    },

    async save() {
      await ensureDirectory(path)
      const records = baseCollection.all()

      for (const record of records) {
        await saveRecord(record.id)
      }

      return records.length
    },

    startWatching() {
      if (fileWatcher) return

      fileWatcher = createFileWatcher({
        dirpath: path,
        schema,
        contentColumn,
        isStaleCallback: contentColumn
          ? (id, content) => isContentStale(id, content)
          : undefined,
      })

      // Handle file changes
      fileWatcher.onChange(async (event) => {
        // Skip if we're saving this file
        if (savingIds.has(event.id)) return

        if (event.type === 'delete') {
          baseCollection.delete(event.id)
        } else if (event.record) {
          const exists = baseCollection.has(event.id)

          if (exists) {
            // Update existing record
            baseCollection.update(event.id, event.record as any)
          } else {
            // Insert new record
            baseCollection.insert({ ...event.record, id: event.id } as any)
          }

          // Mark stale if needed
          if (event.stale) {
            baseCollection.setStale(event.id, true)
          }
        }

        // Call user callback
        if (onExternalChange) {
          await onExternalChange(event)
        }
      })

      fileWatcher.start()
    },

    stopWatching() {
      if (fileWatcher) {
        fileWatcher.stop()
        fileWatcher = null
      }
    },

    get isWatching() {
      return fileWatcher?.isWatching ?? false
    },

    onFileChange(callback) {
      if (!fileWatcher) {
        // Auto-start watching if needed
        persistentCollection.startWatching()
      }
      return fileWatcher!.onChange(callback)
    },

    setEmbedding(id, column, embedding, sourceContent) {
      // Store the embedding
      const vec = embedding instanceof Float32Array
        ? embedding
        : new Float32Array(embedding)

      baseCollection.updateField(id, column, vec as any)

      // Store content hash for stale detection
      embeddingManager.setEmbedding(id, String(column), sourceContent)

      // Clear stale flag
      baseCollection.setStale(id, false)

      // Auto-save if enabled
      if (autoSave) saveRecord(id)
    },

    search(column, queryVector, options) {
      return vectorSearch(baseCollection, column, queryVector, options)
    },

    close() {
      persistentCollection.stopWatching()
      baseCollection.clear()
      embeddingManager.reset()
    },
  }

  // Start watching if configured
  if (watchFiles) {
    persistentCollection.startWatching()
  }

  return persistentCollection
}

// =============================================================================
// Database Class
// =============================================================================

export interface Database {
  /** Database name */
  readonly name: string

  /** Base path for collections */
  readonly basePath: string

  /** Get or create a collection */
  collection<S extends SchemaDefinition>(
    name: string,
    options: Omit<CollectionOptions<S>, 'path'>
  ): PersistentCollection<S>

  /** Get an existing collection */
  getCollection<S extends SchemaDefinition>(name: string): PersistentCollection<S> | undefined

  /** List all collection names */
  listCollections(): string[]

  /** Close all collections */
  close(): void
}

/**
 * Create a database instance
 */
export function createDatabase(options: DatabaseOptions = {}): Database {
  const name = options.name ?? 'default'

  // Determine base path:
  // 1. Custom basePath takes priority
  // 2. local: true → ./.fsdb/[name]
  // 3. Default → ~/.fsdb/[name]
  let basePath: string
  if (options.basePath) {
    basePath = options.basePath
  } else if (options.local) {
    basePath = `${process.cwd()}/.fsdb/${name}`
  } else {
    const home = typeof Bun !== 'undefined' ? Bun.env.HOME : process.env.HOME
    basePath = `${home}/.fsdb/${name}`
  }

  const collections = new ReactiveMap<string, PersistentCollection<any>>()

  return {
    name,
    basePath,

    collection<S extends SchemaDefinition>(
      collectionName: string,
      collectionOptions: Omit<CollectionOptions<S>, 'path'>
    ): PersistentCollection<S> {
      // Check if collection already exists
      const existing = collections.get(collectionName)
      if (existing) {
        return existing as PersistentCollection<S>
      }

      // Create new collection
      const path = `${basePath}/${collectionName}`
      const collection = createPersistentCollection(collectionName, {
        ...collectionOptions,
        path,
      })

      collections.set(collectionName, collection)
      return collection
    },

    getCollection<S extends SchemaDefinition>(collectionName: string): PersistentCollection<S> | undefined {
      return collections.get(collectionName) as PersistentCollection<S> | undefined
    },

    listCollections(): string[] {
      return Array.from(collections.keys())
    },

    close(): void {
      for (const collection of collections.values()) {
        collection.close()
      }
      collections.clear()
    },
  }
}

// Also export fsDB as an alias
export { createDatabase as fsDB }
