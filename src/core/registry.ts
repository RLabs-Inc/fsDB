/**
 * FatherState Registry
 *
 * The central index manager for the Father State Pattern.
 * Manages ID-to-index mappings with O(1) lookups and index reuse.
 *
 * Uses reactive primitives from @rlabs-inc/signals for fine-grained reactivity.
 */

import { ReactiveMap, ReactiveSet, signal } from '@rlabs-inc/signals'

export interface Registry {
  /** Map from record ID to array index */
  readonly idToIndex: ReactiveMap<string, number>

  /** Map from array index to record ID */
  readonly indexToId: ReactiveMap<number, string>

  /** Set of currently allocated indices */
  readonly allocatedIndices: ReactiveSet<number>

  /** Array of free indices available for reuse */
  readonly freeIndices: number[]

  /** Next index to allocate if no free indices */
  nextIndex: number

  /** Allocate an index for an ID (reuses free indices) */
  allocate(id: string): number

  /** Release an index, returning it to the free pool */
  release(id: string): boolean

  /** Get index for an ID (returns -1 if not found) */
  getIndex(id: string): number

  /** Get ID for an index (returns undefined if not found) */
  getId(index: number): string | undefined

  /** Check if a record exists */
  has(id: string): boolean

  /** Get all record IDs */
  getAllIds(): string[]

  /** Get all allocated indices */
  getAllIndices(): number[]

  /** Get count of records */
  readonly count: number

  /** Reset the registry (for testing/cleanup) */
  reset(): void
}

/**
 * Create a new FatherState registry instance
 *
 * Each registry is independent - no global state.
 */
export function createRegistry(): Registry {
  const idToIndex = new ReactiveMap<string, number>()
  const indexToId = new ReactiveMap<number, string>()
  const allocatedIndices = new ReactiveSet<number>()
  const freeIndices: number[] = []

  // Use a signal for nextIndex so it's reactive
  const _nextIndex = signal(0)

  const registry: Registry = {
    idToIndex,
    indexToId,
    allocatedIndices,
    freeIndices,

    get nextIndex() {
      return _nextIndex.value
    },

    set nextIndex(value: number) {
      _nextIndex.value = value
    },

    allocate(id: string): number {
      // Check if ID already has an index
      const existingIndex = idToIndex.get(id)
      if (existingIndex !== undefined) {
        return existingIndex
      }

      // Get index from free pool or allocate new one
      let index: number
      if (freeIndices.length > 0) {
        index = freeIndices.pop()!
      } else {
        index = _nextIndex.value
        _nextIndex.value++
      }

      // Store mappings
      idToIndex.set(id, index)
      indexToId.set(index, id)
      allocatedIndices.add(index)

      return index
    },

    release(id: string): boolean {
      const index = idToIndex.get(id)
      if (index === undefined) {
        return false
      }

      // Clear mappings
      idToIndex.delete(id)
      indexToId.delete(index)
      allocatedIndices.delete(index)

      // Return index to free pool
      freeIndices.push(index)

      return true
    },

    getIndex(id: string): number {
      return idToIndex.get(id) ?? -1
    },

    getId(index: number): string | undefined {
      return indexToId.get(index)
    },

    has(id: string): boolean {
      return idToIndex.has(id)
    },

    getAllIds(): string[] {
      return Array.from(idToIndex.keys())
    },

    getAllIndices(): number[] {
      return Array.from(allocatedIndices)
    },

    get count(): number {
      return idToIndex.size
    },

    reset(): void {
      idToIndex.clear()
      indexToId.clear()
      allocatedIndices.clear()
      freeIndices.length = 0
      _nextIndex.value = 0
    },
  }

  return registry
}

/**
 * Generate a unique ID
 *
 * Format: timestamp-random (e.g., "1703289600000-a1b2c3")
 */
export function generateId(): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 8)
  return `${timestamp}-${random}`
}
