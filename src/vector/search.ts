/**
 * Vector Search
 *
 * Cosine similarity search with optimized Float32Array operations.
 * Includes stale embedding detection via content hashing.
 */

import { ReactiveMap, signal } from '@rlabs-inc/signals'
import type { Collection } from '../core/collection'
import type {
  SchemaDefinition,
  RecordWithMeta,
  VectorSearchOptions,
  VectorSearchResult,
} from '../core/types'

// =============================================================================
// Vector Utilities
// =============================================================================

/**
 * Convert a number array to Float32Array
 */
export function toFloat32Array(arr: number[] | Float32Array): Float32Array {
  if (arr instanceof Float32Array) return arr
  return new Float32Array(arr)
}

/**
 * Normalize a vector to unit length (in-place)
 */
export function normalizeVector(vec: Float32Array): Float32Array {
  let sum = 0
  for (let i = 0; i < vec.length; i++) {
    sum += vec[i] * vec[i]
  }
  const norm = Math.sqrt(sum)
  if (norm > 0) {
    for (let i = 0; i < vec.length; i++) {
      vec[i] /= norm
    }
  }
  return vec
}

/**
 * Calculate cosine similarity between two vectors
 *
 * Returns a value between -1 and 1 (1 = identical direction)
 */
export function cosineSimilarity(
  a: Float32Array | number[],
  b: Float32Array | number[]
): number {
  const vecA = a instanceof Float32Array ? a : new Float32Array(a)
  const vecB = b instanceof Float32Array ? b : new Float32Array(b)

  if (vecA.length !== vecB.length) {
    throw new Error(`Vector dimension mismatch: ${vecA.length} vs ${vecB.length}`)
  }

  let dot = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i]
    normA += vecA[i] * vecA[i]
    normB += vecB[i] * vecB[i]
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  if (denom === 0) return 0

  return dot / denom
}

/**
 * Batch cosine similarity with pre-computed norms
 *
 * More efficient when searching against many vectors
 */
export function batchCosineSimilarity(
  query: Float32Array,
  vectors: Float32Array[],
  indices: number[],
  topK: number
): { index: number; similarity: number }[] {
  // Pre-compute query norm
  let queryNorm = 0
  for (let i = 0; i < query.length; i++) {
    queryNorm += query[i] * query[i]
  }
  queryNorm = Math.sqrt(queryNorm)

  if (queryNorm === 0) return []

  // Calculate similarities
  const results: { index: number; similarity: number }[] = []

  for (let i = 0; i < vectors.length; i++) {
    const vec = vectors[i]
    if (!vec) continue

    let dot = 0
    let vecNorm = 0

    for (let j = 0; j < query.length; j++) {
      dot += query[j] * vec[j]
      vecNorm += vec[j] * vec[j]
    }

    vecNorm = Math.sqrt(vecNorm)
    if (vecNorm === 0) continue

    const similarity = dot / (queryNorm * vecNorm)
    results.push({ index: indices[i], similarity })
  }

  // Sort by similarity (descending) and take top K
  results.sort((a, b) => b.similarity - a.similarity)
  return results.slice(0, topK)
}

// =============================================================================
// Stale Detection via Content Hashing
// =============================================================================

export interface EmbeddingManager {
  /** Store an embedding with its source content hash */
  setEmbedding(id: string, column: string, content: string): void

  /** Check if an embedding is stale (content changed) */
  isStale(id: string, column: string, currentContent: string): boolean

  /** Get the stored hash for an embedding */
  getHash(id: string, column: string): bigint | undefined

  /** Clear hash for a record */
  clearHash(id: string, column: string): void

  /** Clear all hashes */
  reset(): void
}

/**
 * Create an embedding manager for stale detection
 *
 * Uses Bun.hash() for ultra-fast content fingerprinting
 */
export function createEmbeddingManager(): EmbeddingManager {
  // Map: id -> Map<column, hash>
  const hashes = new ReactiveMap<string, Map<string, bigint>>()

  return {
    setEmbedding(id: string, column: string, content: string): void {
      const hash = BigInt(Bun.hash(content))
      let columnHashes = hashes.get(id)
      if (!columnHashes) {
        columnHashes = new Map()
        hashes.set(id, columnHashes)
      }
      columnHashes.set(column, hash)
    },

    isStale(id: string, column: string, currentContent: string): boolean {
      const columnHashes = hashes.get(id)
      if (!columnHashes) return false // No embedding = not stale

      const storedHash = columnHashes.get(column)
      if (storedHash === undefined) return false

      const currentHash = BigInt(Bun.hash(currentContent))
      return storedHash !== currentHash
    },

    getHash(id: string, column: string): bigint | undefined {
      return hashes.get(id)?.get(column)
    },

    clearHash(id: string, column: string): void {
      const columnHashes = hashes.get(id)
      if (columnHashes) {
        columnHashes.delete(column)
        if (columnHashes.size === 0) {
          hashes.delete(id)
        }
      }
    },

    reset(): void {
      hashes.clear()
    },
  }
}

// =============================================================================
// Vector Search on Collection
// =============================================================================

/**
 * Perform vector similarity search on a collection
 *
 * Optimized for performance:
 * - Minimal record reconstruction
 * - Filter uses raw column data, not full records
 * - Only top-K results get full record reconstruction
 */
export function vectorSearch<S extends SchemaDefinition>(
  collection: Collection<S>,
  vectorColumn: keyof S,
  queryVector: Float32Array | number[],
  options: VectorSearchOptions<S> = {}
): VectorSearchResult<S>[] {
  const { topK = 10, minSimilarity = 0, filter } = options

  const query = toFloat32Array(queryVector)

  // Gather vectors - use raw column access for speed
  const vectors: Float32Array[] = []
  const vectorIndices: number[] = []

  for (const index of collection.getIndices()) {
    // Apply pre-filter using raw column data (no full record construction)
    if (filter) {
      const data = collection.columns.getRecord(index)
      if (!filter(data, index)) continue
    }

    // Direct column access for vector
    const vec = collection.columns.get(vectorColumn, index) as Float32Array | null
    if (vec) {
      vectors.push(vec)
      vectorIndices.push(index)
    }
  }

  // Batch similarity search
  const topResults = batchCosineSimilarity(query, vectors, vectorIndices, topK)

  // Only construct full records for top-K results
  const results: VectorSearchResult<S>[] = []

  for (const { index, similarity } of topResults) {
    if (similarity < minSimilarity) continue

    const record = collection.getByIndex(index)
    if (!record) continue

    results.push({
      record,
      similarity,
      stale: collection.isStale(record.id),
    })
  }

  return results
}
