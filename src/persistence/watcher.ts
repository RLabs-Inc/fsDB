/**
 * File Watcher
 *
 * Watch a directory for markdown file changes.
 * Uses Node's fs.watch with debouncing.
 */

import { watch, type FSWatcher } from 'fs'
import { signal } from '@rlabs-inc/signals'
import type { SchemaDefinition, RecordWithMeta, FileChangeEvent } from '../core/types'
import { WATCHER_DEBOUNCE_MS, SAVE_GRACE_PERIOD_MS } from '../core/constants'
import { filenameToId, loadFromMarkdown } from './markdown'

export interface FileWatcher<S extends SchemaDefinition> {
  /** Start watching */
  start(): void

  /** Stop watching */
  stop(): void

  /** Is currently watching */
  readonly isWatching: boolean

  /** Register a callback for file changes */
  onChange(callback: (event: FileChangeEvent<S>) => void | Promise<void>): () => void

  /** Mark a file as being saved (prevents reload loop) */
  markSaving(id: string): void

  /** Clear saving mark */
  clearSaving(id: string): void
}

export interface WatcherOptions<S extends SchemaDefinition> {
  /** Directory to watch */
  dirpath: string

  /** Schema for parsing files */
  schema: S

  /** Content column */
  contentColumn?: keyof S

  /** Debounce time in ms */
  debounceMs?: number

  /** Callback to check if embedding is stale */
  isStaleCallback?: (id: string, content: string) => boolean
}

/**
 * Create a file watcher
 */
export function createFileWatcher<S extends SchemaDefinition>(
  options: WatcherOptions<S>
): FileWatcher<S> {
  const {
    dirpath,
    schema,
    contentColumn,
    debounceMs = WATCHER_DEBOUNCE_MS,
  } = options

  const _isWatching = signal(false)
  const _callbacks = new Set<(event: FileChangeEvent<S>) => void | Promise<void>>()
  const _savingIds = new Set<string>()
  const _knownFiles = new Set<string>()
  const _pendingChanges = new Map<string, ReturnType<typeof setTimeout>>()

  let _watcher: FSWatcher | null = null

  // Process a file change after debounce
  async function processChange(filename: string) {
    if (!filename.endsWith('.md')) return

    const id = filenameToId(filename)
    const filepath = `${dirpath}/${filename}`

    // Check if we're saving this file (prevent loop)
    if (_savingIds.has(id)) {
      return
    }

    // Check if file exists
    const file = Bun.file(filepath)
    const exists = await file.exists()

    let event: FileChangeEvent<S>

    if (!exists) {
      // File was deleted
      if (!_knownFiles.has(filename)) return // Never knew about it

      _knownFiles.delete(filename)
      event = {
        type: 'delete',
        id,
        filename,
        filepath,
        stale: false,
      }
    } else {
      // File was created or updated
      const isNew = !_knownFiles.has(filename)
      _knownFiles.add(filename)

      const result = await loadFromMarkdown(filepath, schema, contentColumn)
      if (!result) return

      // Check if stale
      let stale = false
      if (options.isStaleCallback && contentColumn) {
        const content = result.record[contentColumn as keyof typeof result.record] as string
        if (content) {
          stale = options.isStaleCallback(id, content)
        }
      }

      event = {
        type: isNew ? 'create' : 'update',
        id,
        filename,
        filepath,
        record: result.record as RecordWithMeta<S>,
        stale,
      }
    }

    // Notify callbacks
    for (const callback of _callbacks) {
      try {
        await callback(event)
      } catch (err) {
        console.error('File watcher callback error:', err)
      }
    }
  }

  // Debounced change handler
  function handleChange(filename: string) {
    // Clear any pending timeout for this file
    const existing = _pendingChanges.get(filename)
    if (existing) {
      clearTimeout(existing)
    }

    // Set new debounced timeout
    const timeout = setTimeout(() => {
      _pendingChanges.delete(filename)
      processChange(filename)
    }, debounceMs)

    _pendingChanges.set(filename, timeout)
  }

  const watcher: FileWatcher<S> = {
    start() {
      if (_isWatching.value) return

      try {
        // Scan for existing files first
        const glob = new Bun.Glob('*.md')
        for (const filename of glob.scanSync({ cwd: dirpath })) {
          _knownFiles.add(filename)
        }

        // Start watching with Node's fs.watch
        _watcher = watch(dirpath, { recursive: false }, (eventType, filename) => {
          if (filename && filename.endsWith('.md')) {
            handleChange(filename)
          }
        })

        _isWatching.value = true
      } catch (err) {
        console.error('Failed to start file watcher:', err)
      }
    },

    stop() {
      if (!_isWatching.value) return

      // Clear pending changes
      for (const timeout of _pendingChanges.values()) {
        clearTimeout(timeout)
      }
      _pendingChanges.clear()

      // Stop watcher
      if (_watcher) {
        _watcher.close()
        _watcher = null
      }

      _isWatching.value = false
    },

    get isWatching() {
      return _isWatching.value
    },

    onChange(callback) {
      _callbacks.add(callback)
      return () => _callbacks.delete(callback)
    },

    markSaving(id: string) {
      _savingIds.add(id)
    },

    clearSaving(id: string) {
      // Clear after grace period to avoid race conditions
      setTimeout(() => {
        _savingIds.delete(id)
      }, SAVE_GRACE_PERIOD_MS)
    },
  }

  return watcher
}
