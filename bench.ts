/**
 * fsDB Benchmarks
 *
 * Run with: bun bench.ts
 */

import {
  createCollection,
  createDatabase,
  createRegistry,
  cosineSimilarity,
  vectorSearch,
  query,
  queryCount,
  eq,
  gt,
  and,
  fullText,
  sortBy,
} from './src/index'

// =============================================================================
// Helpers
// =============================================================================

function bench(name: string, fn: () => void, iterations = 1000): void {
  // Warmup
  for (let i = 0; i < 100; i++) fn()

  const start = Bun.nanoseconds()
  for (let i = 0; i < iterations; i++) fn()
  const end = Bun.nanoseconds()

  const totalMs = (end - start) / 1_000_000
  const perOpUs = ((end - start) / iterations) / 1000

  console.log(`${name}: ${perOpUs.toFixed(2)}μs/op (${totalMs.toFixed(2)}ms total for ${iterations} ops)`)
}

function generateVector(dimensions: number): Float32Array {
  const vec = new Float32Array(dimensions)
  for (let i = 0; i < dimensions; i++) {
    vec[i] = Math.random()
  }
  return vec
}

console.log('\n🚀 fsDB Benchmarks\n')
console.log('='.repeat(60))

// =============================================================================
// Registry Benchmarks
// =============================================================================

console.log('\n📋 Registry Operations\n')

const registry = createRegistry()

bench('allocate (new ID)', () => {
  registry.allocate(`id-${Math.random()}`)
}, 10000)

// Pre-populate for lookup tests
for (let i = 0; i < 10000; i++) {
  registry.allocate(`lookup-${i}`)
}

bench('getIndex (existing)', () => {
  registry.getIndex('lookup-5000')
}, 100000)

bench('getId (reverse lookup)', () => {
  registry.getId(5000)
}, 100000)

// =============================================================================
// Collection CRUD Benchmarks
// =============================================================================

console.log('\n📦 Collection CRUD\n')

const schema = {
  name: 'string' as const,
  age: 'number' as const,
  email: 'string' as const,
  score: 'number' as const,
  active: 'boolean' as const,
  tags: 'string[]' as const,
}

const users = createCollection('users', { schema })

// Insert benchmark
const insertStart = Bun.nanoseconds()
for (let i = 0; i < 1000; i++) {
  users.insert({
    name: `User ${i}`,
    age: 20 + (i % 50),
    email: `user${i}@example.com`,
    score: Math.random() * 100,
    active: i % 2 === 0,
    tags: ['tag1', 'tag2'],
  })
}
const insertEnd = Bun.nanoseconds()
console.log(`Insert 1000 records: ${((insertEnd - insertStart) / 1_000_000).toFixed(2)}ms`)

// Get by ID
const allRecords = users.all()
const sampleId = allRecords[500].id

bench('get by ID', () => {
  users.get(sampleId)
}, 100000)

// Update
bench('update single field', () => {
  users.updateField(sampleId, 'score', Math.random() * 100)
}, 10000)

// =============================================================================
// Query Benchmarks
// =============================================================================

console.log('\n🔍 Queries\n')

bench('find with eq filter', () => {
  users.find(eq('active', true))
}, 1000)

bench('find with gt filter', () => {
  users.find(gt('score', 50))
}, 1000)

bench('find with and(eq, gt)', () => {
  users.find(and(eq('active', true), gt('score', 50)))
}, 1000)

bench('count with filter', () => {
  users.count(r => r.age > 30)
}, 1000)

bench('fullText search', () => {
  users.find(fullText('User 5'))
}, 1000)

// =============================================================================
// Sorting Benchmarks
// =============================================================================

console.log('\n📊 Sorting\n')

const allUsers = users.all()

bench('sortBy (1000 records, single column)', () => {
  sortBy(allUsers, { column: 'score', direction: 'desc' })
}, 1000)

bench('sortBy (1000 records, two columns)', () => {
  sortBy(allUsers, { column: 'age', direction: 'asc' }, { column: 'score', direction: 'desc' })
}, 1000)

// =============================================================================
// Reactive Query Benchmarks
// =============================================================================

console.log('\n⚡ Reactive Queries\n')

const activeQuery = query(users, r => r.active === true)

bench('reactive query access (.value)', () => {
  activeQuery.value
}, 10000)

const countQuery = queryCount(users, r => r.score > 50)

bench('reactive count access (.value)', () => {
  countQuery.value
}, 10000)

// =============================================================================
// Vector Benchmarks
// =============================================================================

console.log('\n🧮 Vector Operations\n')

const vec384a = generateVector(384)
const vec384b = generateVector(384)

bench('cosineSimilarity (384 dimensions)', () => {
  cosineSimilarity(vec384a, vec384b)
}, 100000)

const vec1536a = generateVector(1536)
const vec1536b = generateVector(1536)

bench('cosineSimilarity (1536 dimensions)', () => {
  cosineSimilarity(vec1536a, vec1536b)
}, 100000)

// Vector search setup
const vectorSchema = {
  content: 'string' as const,
  embedding: 'vector:384' as const,
}

const docs = createCollection('docs', { schema: vectorSchema })

// Insert docs with embeddings
for (let i = 0; i < 1000; i++) {
  const id = docs.insert({ content: `Document ${i}` })
  docs.updateField(id, 'embedding', generateVector(384))
}

const queryVec = generateVector(384)

bench('vectorSearch top-10 (1000 docs, 384d)', () => {
  vectorSearch(docs, 'embedding', queryVec, { topK: 10 })
}, 100)

bench('vectorSearch top-10 with filter (1000 docs, 384d)', () => {
  vectorSearch(docs, 'embedding', queryVec, {
    topK: 10,
    filter: (r) => r.content.includes('5'),
  })
}, 100)

// =============================================================================
// Hashing Benchmark
// =============================================================================

console.log('\n🔐 Hashing\n')

const content = 'This is some sample content for hashing benchmarks. ' .repeat(100)

bench('Bun.hash (content fingerprint)', () => {
  Bun.hash(content)
}, 100000)

// =============================================================================
// Summary
// =============================================================================

console.log('\n' + '='.repeat(60))
console.log('✅ Benchmarks complete!')
console.log('='.repeat(60) + '\n')
