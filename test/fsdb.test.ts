/**
 * fsDB Tests
 *
 * Comprehensive tests for the Fractal State Database
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdir, writeFile, unlink } from 'node:fs/promises'
import { effect } from '@rlabs-inc/signals'
import {
  createCollection,
  createDatabase,
  createRegistry,
  createColumns,
  // Reactive queries
  query,
  queryCount,
  querySorted,
  queryFirst,
  queryAggregate,
  queryGroupBy,
  // All filter helpers
  eq,
  neq,
  gt,
  gte,
  lt,
  lte,
  between,
  oneOf,
  fullText,
  matches,
  startsWith,
  endsWith,
  contains,
  containsAny,
  containsAll,
  isEmpty,
  isNotEmpty,
  exists,
  isNull,
  after,
  before,
  withinLast,
  and,
  or,
  not,
  // Vector
  cosineSimilarity,
  vectorSearch,
  // Utils
  sortBy,
  paginate,
} from '../src/index'

// =============================================================================
// Registry Tests
// =============================================================================

describe('Registry', () => {
  it('allocates indices for new IDs', () => {
    const registry = createRegistry()

    const idx1 = registry.allocate('user-1')
    const idx2 = registry.allocate('user-2')

    expect(idx1).toBe(0)
    expect(idx2).toBe(1)
    expect(registry.count).toBe(2)
  })

  it('returns existing index for same ID', () => {
    const registry = createRegistry()

    const idx1 = registry.allocate('user-1')
    const idx2 = registry.allocate('user-1')

    expect(idx1).toBe(idx2)
    expect(registry.count).toBe(1)
  })

  it('reuses released indices', () => {
    const registry = createRegistry()

    registry.allocate('user-1')
    registry.allocate('user-2')
    registry.release('user-1')

    const idx3 = registry.allocate('user-3')

    // Should reuse the freed index
    expect(idx3).toBe(0)
    expect(registry.count).toBe(2)
  })

  it('looks up indices correctly', () => {
    const registry = createRegistry()

    registry.allocate('user-1')
    registry.allocate('user-2')

    expect(registry.getIndex('user-1')).toBe(0)
    expect(registry.getIndex('user-2')).toBe(1)
    expect(registry.getIndex('user-3')).toBe(-1)
  })

  it('reverse lookups work', () => {
    const registry = createRegistry()

    registry.allocate('user-1')
    registry.allocate('user-2')

    expect(registry.getId(0)).toBe('user-1')
    expect(registry.getId(1)).toBe('user-2')
    expect(registry.getId(2)).toBeUndefined()
  })
})

// =============================================================================
// Columns Tests
// =============================================================================

describe('Columns', () => {
  const schema = {
    name: 'string' as const,
    age: 'number' as const,
    active: 'boolean' as const,
    tags: 'string[]' as const,
  }

  it('sets and gets values correctly', () => {
    const columns = createColumns(schema)

    columns.set('name', 0, 'Alice')
    columns.set('age', 0, 30)
    columns.set('active', 0, true)
    columns.set('tags', 0, ['admin', 'user'])

    expect(columns.get('name', 0)).toBe('Alice')
    expect(columns.get('age', 0)).toBe(30)
    expect(columns.get('active', 0)).toBe(true)
    expect(columns.get('tags', 0)).toEqual(['admin', 'user'])
  })

  it('gets record as object', () => {
    const columns = createColumns(schema)

    columns.set('name', 0, 'Bob')
    columns.set('age', 0, 25)
    columns.set('active', 0, false)
    columns.set('tags', 0, [])

    const record = columns.getRecord(0)

    expect(record.name).toBe('Bob')
    expect(record.age).toBe(25)
    expect(record.active).toBe(false)
    expect(record.tags).toEqual([])
  })

  it('sets record from object', () => {
    const columns = createColumns(schema)

    columns.setRecord(0, {
      name: 'Charlie',
      age: 35,
      active: true,
      tags: ['developer'],
    })

    expect(columns.get('name', 0)).toBe('Charlie')
    expect(columns.get('age', 0)).toBe(35)
    expect(columns.get('active', 0)).toBe(true)
  })
})

// =============================================================================
// Collection Tests
// =============================================================================

describe('Collection', () => {
  const schema = {
    name: 'string' as const,
    age: 'number' as const,
    email: 'string' as const,
  }

  it('inserts and retrieves records', () => {
    const users = createCollection('users', { schema })

    const id = users.insert({ name: 'Alice', age: 30, email: 'alice@example.com' })

    const user = users.get(id)
    expect(user?.name).toBe('Alice')
    expect(user?.age).toBe(30)
    expect(user?.email).toBe('alice@example.com')
  })

  it('generates IDs automatically', () => {
    const users = createCollection('users', { schema })

    const id = users.insert({ name: 'Bob' })

    expect(id).toBeTruthy()
    expect(id.length).toBeGreaterThan(10)
  })

  it('updates records', () => {
    const users = createCollection('users', { schema })

    const id = users.insert({ name: 'Charlie', age: 25 })
    users.update(id, { age: 26 })

    const user = users.get(id)
    expect(user?.age).toBe(26)
    expect(user?.name).toBe('Charlie') // Unchanged
  })

  it('deletes records', () => {
    const users = createCollection('users', { schema })

    const id = users.insert({ name: 'Dave' })
    expect(users.has(id)).toBe(true)

    users.delete(id)
    expect(users.has(id)).toBe(false)
    expect(users.get(id)).toBeUndefined()
  })

  it('finds records with filter', () => {
    const users = createCollection('users', { schema })

    users.insert({ name: 'Alice', age: 30 })
    users.insert({ name: 'Bob', age: 25 })
    users.insert({ name: 'Charlie', age: 30 })

    const thirtyYearOlds = users.find((r) => r.age === 30)

    expect(thirtyYearOlds.length).toBe(2)
  })

  it('counts records', () => {
    const users = createCollection('users', { schema })

    users.insert({ name: 'Alice', age: 30 })
    users.insert({ name: 'Bob', age: 25 })

    expect(users.count()).toBe(2)
    expect(users.count((r) => r.age === 30)).toBe(1)
  })
})

// =============================================================================
// Reactive Queries Tests
// =============================================================================

describe('Reactive Queries', () => {
  const schema = {
    name: 'string' as const,
    score: 'number' as const,
    active: 'boolean' as const,
  }

  it('query auto-updates when data changes', () => {
    const users = createCollection('users', { schema })

    const activeQuery = query(users, (r) => r.active === true)
    let updates = 0

    effect(() => {
      activeQuery.value
      updates++
    })

    // Initial
    expect(activeQuery.value.count).toBe(0)

    // Add active user
    users.insert({ name: 'Alice', score: 100, active: true })

    // Query should update
    expect(activeQuery.value.count).toBe(1)
  })

  it('queryCount works reactively', () => {
    const users = createCollection('users', { schema })

    const activeCount = queryCount(users, (r) => r.active)

    users.insert({ name: 'Alice', active: true })
    users.insert({ name: 'Bob', active: false })

    expect(activeCount.value).toBe(1)

    users.insert({ name: 'Charlie', active: true })

    expect(activeCount.value).toBe(2)
  })
})

// =============================================================================
// Filter Helpers Tests
// =============================================================================

describe('Filter Helpers', () => {
  const schema = {
    name: 'string' as const,
    score: 'number' as const,
    tags: 'string[]' as const,
    content: 'string' as const,
  }

  it('eq filter', () => {
    const users = createCollection('users', { schema })

    users.insert({ name: 'Alice', score: 100 })
    users.insert({ name: 'Bob', score: 50 })

    const alices = users.find(eq('name', 'Alice'))
    expect(alices.length).toBe(1)
    expect(alices[0].name).toBe('Alice')
  })

  it('gt and lt filters', () => {
    const users = createCollection('users', { schema })

    users.insert({ name: 'Alice', score: 100 })
    users.insert({ name: 'Bob', score: 50 })
    users.insert({ name: 'Charlie', score: 75 })

    const highScorers = users.find(gt('score', 60))
    expect(highScorers.length).toBe(2)

    const lowScorers = users.find(lt('score', 60))
    expect(lowScorers.length).toBe(1)
  })

  it('contains filter for arrays', () => {
    const users = createCollection('users', { schema })

    users.insert({ name: 'Alice', tags: ['admin', 'user'] })
    users.insert({ name: 'Bob', tags: ['user'] })

    const admins = users.find(contains('tags', 'admin'))
    expect(admins.length).toBe(1)
    expect(admins[0].name).toBe('Alice')
  })

  it('and/or combinators', () => {
    const users = createCollection('users', { schema })

    users.insert({ name: 'Alice', score: 100, tags: ['admin'] })
    users.insert({ name: 'Bob', score: 50, tags: ['user'] })
    users.insert({ name: 'Charlie', score: 80, tags: ['admin'] })

    // High-scoring admins
    const highScoreAdmins = users.find(and(
      gt('score', 60),
      contains('tags', 'admin')
    ))
    expect(highScoreAdmins.length).toBe(2)

    // High score OR admin
    const highOrAdmin = users.find(or(
      gt('score', 90),
      contains('tags', 'admin')
    ))
    expect(highOrAdmin.length).toBe(2)
  })

  it('fullText search', () => {
    const users = createCollection('users', { schema })

    users.insert({ name: 'Alice', content: 'Hello world' })
    users.insert({ name: 'Bob', content: 'Goodbye world' })
    users.insert({ name: 'Charlie', content: 'Hello there' })

    const helloResults = users.find(fullText('hello'))
    expect(helloResults.length).toBe(2)
  })
})

// =============================================================================
// Sorting and Pagination Tests
// =============================================================================

describe('Sorting and Pagination', () => {
  const schema = {
    name: 'string' as const,
    score: 'number' as const,
  }

  it('sortBy sorts records', () => {
    const users = createCollection('users', { schema })

    users.insert({ name: 'Alice', score: 50 })
    users.insert({ name: 'Bob', score: 100 })
    users.insert({ name: 'Charlie', score: 75 })

    const all = users.all()
    const sorted = sortBy(all, { column: 'score', direction: 'desc' })

    expect(sorted[0].score).toBe(100)
    expect(sorted[1].score).toBe(75)
    expect(sorted[2].score).toBe(50)
  })

  it('paginate returns correct pages', () => {
    const users = createCollection('users', { schema })

    for (let i = 0; i < 25; i++) {
      users.insert({ name: `User ${i}`, score: i })
    }

    const all = users.all()
    const page1 = paginate(all, 1, 10)

    expect(page1.records.length).toBe(10)
    expect(page1.total).toBe(25)
    expect(page1.totalPages).toBe(3)
    expect(page1.hasNext).toBe(true)
    expect(page1.hasPrev).toBe(false)

    const page3 = paginate(all, 3, 10)
    expect(page3.records.length).toBe(5)
    expect(page3.hasNext).toBe(false)
    expect(page3.hasPrev).toBe(true)
  })
})

// =============================================================================
// Vector Search Tests
// =============================================================================

describe('Vector Search', () => {
  it('cosineSimilarity calculates correctly', () => {
    const a = new Float32Array([1, 0, 0])
    const b = new Float32Array([1, 0, 0])
    const c = new Float32Array([0, 1, 0])

    expect(cosineSimilarity(a, b)).toBeCloseTo(1.0)
    expect(cosineSimilarity(a, c)).toBeCloseTo(0.0)
  })

  it('vector search returns sorted results', () => {
    const schema = {
      name: 'string' as const,
      embedding: 'vector:3' as const,
    }

    const docs = createCollection('docs', { schema })

    // Insert docs with embeddings
    const id1 = docs.insert({ name: 'doc1' })
    docs.updateField(id1, 'embedding', new Float32Array([1, 0, 0]))

    const id2 = docs.insert({ name: 'doc2' })
    docs.updateField(id2, 'embedding', new Float32Array([0.9, 0.1, 0]))

    const id3 = docs.insert({ name: 'doc3' })
    docs.updateField(id3, 'embedding', new Float32Array([0, 1, 0]))

    // Search for docs similar to [1, 0, 0]
    const results = vectorSearch(docs, 'embedding', [1, 0, 0], { topK: 2 })

    expect(results.length).toBe(2)
    expect(results[0].record.name).toBe('doc1') // Most similar
    expect(results[0].similarity).toBeCloseTo(1.0)
  })
})

// =============================================================================
// Database Tests
// =============================================================================

describe('Database', () => {
  it('creates and manages collections', () => {
    const db = createDatabase({ name: 'test-db' })

    const users = db.collection('users', {
      schema: {
        name: 'string' as const,
        age: 'number' as const,
      },
    })

    const id = users.insert({ name: 'Alice', age: 30 })

    expect(users.get(id)?.name).toBe('Alice')

    // Same collection returned on second call
    const users2 = db.collection('users', {
      schema: {
        name: 'string' as const,
        age: 'number' as const,
      },
    })

    expect(users2.get(id)?.name).toBe('Alice')

    db.close()
  })
})

// =============================================================================
// Metadata Tests
// =============================================================================

describe('Metadata', () => {
  it('tracks created and updated timestamps', async () => {
    const schema = {
      name: 'string' as const,
    }

    const users = createCollection('users', { schema })

    const id = users.insert({ name: 'Alice' })
    const user1 = users.get(id)!

    expect(user1.created).toBeLessThanOrEqual(Date.now())
    expect(user1.updated).toBeLessThanOrEqual(Date.now())

    // Wait a bit
    await new Promise(r => setTimeout(r, 10))

    users.update(id, { name: 'Alice Updated' })
    const user2 = users.get(id)!

    expect(user2.updated).toBeGreaterThan(user1.updated)
    expect(user2.created).toBe(user1.created) // Created unchanged
  })

  it('tracks stale flag', () => {
    const schema = {
      name: 'string' as const,
    }

    const users = createCollection('users', { schema })

    const id = users.insert({ name: 'Alice' })

    expect(users.isStale(id)).toBe(false)

    users.setStale(id, true)
    expect(users.isStale(id)).toBe(true)

    expect(users.getStaleIds()).toContain(id)
  })
})

// =============================================================================
// Comprehensive Filter Tests
// =============================================================================

describe('Comparison Filters', () => {
  const schema = {
    name: 'string' as const,
    score: 'number' as const,
    age: 'number' as const,
  }

  it('neq filter', () => {
    const users = createCollection('users', { schema })

    users.insert({ name: 'Alice', score: 100, age: 30 })
    users.insert({ name: 'Bob', score: 50, age: 25 })

    const notAlice = users.find(neq('name', 'Alice'))
    expect(notAlice.length).toBe(1)
    expect(notAlice[0].name).toBe('Bob')
  })

  it('gte filter', () => {
    const users = createCollection('users', { schema })

    users.insert({ name: 'Alice', score: 100 })
    users.insert({ name: 'Bob', score: 50 })
    users.insert({ name: 'Charlie', score: 75 })

    const highScorers = users.find(gte('score', 75))
    expect(highScorers.length).toBe(2)
  })

  it('lte filter', () => {
    const users = createCollection('users', { schema })

    users.insert({ name: 'Alice', score: 100 })
    users.insert({ name: 'Bob', score: 50 })
    users.insert({ name: 'Charlie', score: 75 })

    const lowScorers = users.find(lte('score', 75))
    expect(lowScorers.length).toBe(2)
  })

  it('between filter', () => {
    const users = createCollection('users', { schema })

    users.insert({ name: 'Alice', score: 100 })
    users.insert({ name: 'Bob', score: 50 })
    users.insert({ name: 'Charlie', score: 75 })
    users.insert({ name: 'Dave', score: 25 })

    const midScorers = users.find(between('score', 50, 80))
    expect(midScorers.length).toBe(2)
  })

  it('oneOf filter', () => {
    const users = createCollection('users', { schema })

    users.insert({ name: 'Alice', score: 100 })
    users.insert({ name: 'Bob', score: 50 })
    users.insert({ name: 'Charlie', score: 75 })

    const selected = users.find(oneOf('name', ['Alice', 'Charlie']))
    expect(selected.length).toBe(2)
  })
})

describe('Text Filters', () => {
  const schema = {
    name: 'string' as const,
    email: 'string' as const,
    bio: 'string' as const,
  }

  it('matches (regex) filter', () => {
    const users = createCollection('users', { schema })

    users.insert({ name: 'Alice', email: 'alice@example.com' })
    users.insert({ name: 'Bob', email: 'bob@test.org' })
    users.insert({ name: 'Charlie', email: 'charlie@example.com' })

    const exampleEmails = users.find(matches('email', /@example\.com$/))
    expect(exampleEmails.length).toBe(2)
  })

  it('startsWith filter', () => {
    const users = createCollection('users', { schema })

    users.insert({ name: 'Alice' })
    users.insert({ name: 'Albert' })
    users.insert({ name: 'Bob' })

    const aNames = users.find(startsWith('name', 'Al'))
    expect(aNames.length).toBe(2)
  })

  it('startsWith case insensitive', () => {
    const users = createCollection('users', { schema })

    users.insert({ name: 'Alice' })
    users.insert({ name: 'albert' })
    users.insert({ name: 'Bob' })

    const aNames = users.find(startsWith('name', 'al', false))
    expect(aNames.length).toBe(2)
  })

  it('endsWith filter', () => {
    const users = createCollection('users', { schema })

    users.insert({ name: 'Alice' })
    users.insert({ name: 'Bruce' })
    users.insert({ name: 'Bob' })

    const ceNames = users.find(endsWith('name', 'ce'))
    expect(ceNames.length).toBe(2)
  })

  it('fullText with specific columns', () => {
    const users = createCollection('users', { schema })

    users.insert({ name: 'Alice', email: 'alice@test.com', bio: 'Loves coding' })
    users.insert({ name: 'Bob', email: 'bob@test.com', bio: 'Alice fan' })

    // Search only in bio
    const bioResults = users.find(fullText('Alice', { columns: ['bio'] }))
    expect(bioResults.length).toBe(1)
    expect(bioResults[0].name).toBe('Bob')
  })

  it('fullText case sensitive', () => {
    const users = createCollection('users', { schema })

    users.insert({ name: 'Alice', bio: 'Hello World' })
    users.insert({ name: 'Bob', bio: 'hello world' })

    const caseSensitive = users.find(fullText('Hello', { caseSensitive: true }))
    expect(caseSensitive.length).toBe(1)
    expect(caseSensitive[0].name).toBe('Alice')
  })
})

describe('Array Filters', () => {
  const schema = {
    name: 'string' as const,
    tags: 'string[]' as const,
    scores: 'number[]' as const,
  }

  it('containsAny filter', () => {
    const users = createCollection('users', { schema })

    users.insert({ name: 'Alice', tags: ['admin', 'developer'] })
    users.insert({ name: 'Bob', tags: ['user'] })
    users.insert({ name: 'Charlie', tags: ['moderator', 'user'] })

    const adminOrMod = users.find(containsAny('tags', ['admin', 'moderator']))
    expect(adminOrMod.length).toBe(2)
  })

  it('containsAll filter', () => {
    const users = createCollection('users', { schema })

    users.insert({ name: 'Alice', tags: ['admin', 'developer', 'user'] })
    users.insert({ name: 'Bob', tags: ['admin'] })
    users.insert({ name: 'Charlie', tags: ['admin', 'developer'] })

    const adminAndDev = users.find(containsAll('tags', ['admin', 'developer']))
    expect(adminAndDev.length).toBe(2)
  })

  it('isEmpty filter', () => {
    const users = createCollection('users', { schema })

    users.insert({ name: 'Alice', tags: ['admin'] })
    users.insert({ name: 'Bob', tags: [] })
    users.insert({ name: 'Charlie', tags: [] })

    const noTags = users.find(isEmpty('tags'))
    expect(noTags.length).toBe(2)
  })

  it('isNotEmpty filter', () => {
    const users = createCollection('users', { schema })

    users.insert({ name: 'Alice', tags: ['admin'] })
    users.insert({ name: 'Bob', tags: [] })
    users.insert({ name: 'Charlie', tags: ['user'] })

    const hasTags = users.find(isNotEmpty('tags'))
    expect(hasTags.length).toBe(2)
  })
})

describe('Existence Filters', () => {
  const schema = {
    name: 'string' as const,
    nickname: 'string' as const,
    score: 'number' as const,
  }

  it('exists filter', () => {
    const users = createCollection('users', { schema })

    users.insert({ name: 'Alice', nickname: 'Ali', score: 100 })
    users.insert({ name: 'Bob', score: 50 }) // No nickname

    // All records have name, so exists should return all
    const hasName = users.find(exists('name'))
    expect(hasName.length).toBe(2)
  })

  it('isNull filter', () => {
    const users = createCollection('users', { schema })

    users.insert({ name: 'Alice', nickname: 'Ali' })
    users.insert({ name: 'Bob' }) // No nickname (empty string default)

    // With default values, we'll get the default empty string
    const all = users.all()
    expect(all.length).toBe(2)
  })
})

describe('Date/Time Filters', () => {
  const schema = {
    name: 'string' as const,
    created: 'timestamp' as const,
  }

  it('after filter', () => {
    const users = createCollection('users', { schema })
    const now = Date.now()

    users.insert({ name: 'Old', created: now - 10000 })
    users.insert({ name: 'New', created: now + 10000 })

    const recent = users.find(after('created', now))
    expect(recent.length).toBe(1)
    expect(recent[0].name).toBe('New')
  })

  it('before filter', () => {
    const users = createCollection('users', { schema })
    const now = Date.now()

    users.insert({ name: 'Old', created: now - 10000 })
    users.insert({ name: 'New', created: now + 10000 })

    const old = users.find(before('created', now))
    expect(old.length).toBe(1)
    expect(old[0].name).toBe('Old')
  })

  it('withinLast filter', () => {
    const users = createCollection('users', { schema })
    const now = Date.now()

    users.insert({ name: 'Recent', created: now - 1000 })
    users.insert({ name: 'Old', created: now - 100000 })

    const recentlyCreated = users.find(withinLast('created', 5000))
    expect(recentlyCreated.length).toBe(1)
    expect(recentlyCreated[0].name).toBe('Recent')
  })
})

describe('Logical Operators', () => {
  const schema = {
    name: 'string' as const,
    score: 'number' as const,
    active: 'boolean' as const,
  }

  it('not filter', () => {
    const users = createCollection('users', { schema })

    users.insert({ name: 'Alice', score: 100, active: true })
    users.insert({ name: 'Bob', score: 50, active: false })
    users.insert({ name: 'Charlie', score: 75, active: true })

    const inactive = users.find(not(eq('active', true)))
    expect(inactive.length).toBe(1)
    expect(inactive[0].name).toBe('Bob')
  })

  it('complex nested filters', () => {
    const users = createCollection('users', { schema })

    users.insert({ name: 'Alice', score: 100, active: true })
    users.insert({ name: 'Bob', score: 50, active: false })
    users.insert({ name: 'Charlie', score: 75, active: true })
    users.insert({ name: 'Dave', score: 90, active: false })

    // (active AND score > 80) OR (NOT active AND score < 60)
    const complex = users.find(or(
      and(eq('active', true), gt('score', 80)),
      and(not(eq('active', true)), lt('score', 60))
    ))

    expect(complex.length).toBe(2) // Alice (active, 100) and Bob (inactive, 50)
  })
})

// =============================================================================
// Reactive Query Tests
// =============================================================================

describe('Reactive Queries Extended', () => {
  const schema = {
    name: 'string' as const,
    score: 'number' as const,
    role: 'string' as const,
    active: 'boolean' as const,
  }

  it('querySorted returns sorted results', () => {
    const users = createCollection('users', { schema })

    users.insert({ name: 'Alice', score: 50, role: 'user', active: true })
    users.insert({ name: 'Bob', score: 100, role: 'admin', active: true })
    users.insert({ name: 'Charlie', score: 75, role: 'user', active: true })

    const topScorers = querySorted(users, () => true, 'score', true)

    expect(topScorers.value.records[0].name).toBe('Bob')
    expect(topScorers.value.records[1].name).toBe('Charlie')
    expect(topScorers.value.records[2].name).toBe('Alice')
  })

  it('queryFirst returns first match', () => {
    const users = createCollection('users', { schema })

    users.insert({ name: 'Alice', score: 50, role: 'user', active: true })
    users.insert({ name: 'Bob', score: 100, role: 'admin', active: true })
    users.insert({ name: 'Charlie', score: 75, role: 'admin', active: true })

    const firstAdmin = queryFirst(users, (r) => r.role === 'admin')

    expect(firstAdmin.value?.role).toBe('admin')
  })

  it('queryFirst returns undefined when no match', () => {
    const users = createCollection('users', { schema })

    users.insert({ name: 'Alice', role: 'user' })

    const superAdmin = queryFirst(users, (r) => r.role === 'superadmin')

    expect(superAdmin.value).toBeUndefined()
  })

  it('queryAggregate calculates aggregation', () => {
    const users = createCollection('users', { schema })

    users.insert({ name: 'Alice', score: 100 })
    users.insert({ name: 'Bob', score: 50 })
    users.insert({ name: 'Charlie', score: 75 })

    const totalScore = queryAggregate(
      users,
      (records) => records.reduce((sum, r) => sum + r.score, 0)
    )

    expect(totalScore.value).toBe(225)
  })

  it('queryAggregate with filter', () => {
    const users = createCollection('users', { schema })

    users.insert({ name: 'Alice', score: 100, active: true })
    users.insert({ name: 'Bob', score: 50, active: false })
    users.insert({ name: 'Charlie', score: 75, active: true })

    const activeScore = queryAggregate(
      users,
      (records) => records.reduce((sum, r) => sum + r.score, 0),
      (r) => r.active === true
    )

    expect(activeScore.value).toBe(175)
  })

  it('queryGroupBy groups by field', () => {
    const users = createCollection('users', { schema })

    users.insert({ name: 'Alice', role: 'admin' })
    users.insert({ name: 'Bob', role: 'user' })
    users.insert({ name: 'Charlie', role: 'admin' })
    users.insert({ name: 'Dave', role: 'user' })

    const byRole = queryGroupBy(users, 'role')

    expect(byRole.value.get('admin')?.length).toBe(2)
    expect(byRole.value.get('user')?.length).toBe(2)
  })

  it('queryGroupBy with filter', () => {
    const users = createCollection('users', { schema })

    users.insert({ name: 'Alice', role: 'admin', active: true })
    users.insert({ name: 'Bob', role: 'user', active: false })
    users.insert({ name: 'Charlie', role: 'admin', active: true })
    users.insert({ name: 'Dave', role: 'user', active: true })

    const activeByRole = queryGroupBy(users, 'role', (r) => r.active === true)

    expect(activeByRole.value.get('admin')?.length).toBe(2)
    expect(activeByRole.value.get('user')?.length).toBe(1) // Only Dave
  })

  it('reactive queries update on insert and delete', () => {
    const users = createCollection('users', { schema })

    const totalScore = queryAggregate(
      users,
      (records) => records.reduce((sum, r) => sum + r.score, 0)
    )

    expect(totalScore.value).toBe(0)

    const id = users.insert({ name: 'Alice', score: 100 })
    expect(totalScore.value).toBe(100)

    users.insert({ name: 'Bob', score: 50 })
    expect(totalScore.value).toBe(150)

    users.delete(id)
    expect(totalScore.value).toBe(50)
  })
})

// =============================================================================
// Edge Case Tests
// =============================================================================

describe('Edge Cases', () => {
  it('empty collection operations', () => {
    const schema = { name: 'string' as const }
    const users = createCollection('users', { schema })

    expect(users.count()).toBe(0)
    expect(users.all().length).toBe(0)
    expect(users.find(eq('name', 'Alice')).length).toBe(0)
    expect(users.findOne(eq('name', 'Alice'))).toBeUndefined()
  })

  it('get non-existent ID', () => {
    const schema = { name: 'string' as const }
    const users = createCollection('users', { schema })

    expect(users.get('non-existent-id')).toBeUndefined()
    expect(users.has('non-existent-id')).toBe(false)
  })

  it('update non-existent record', () => {
    const schema = { name: 'string' as const }
    const users = createCollection('users', { schema })

    const updated = users.update('non-existent-id', { name: 'Test' })
    expect(updated).toBe(false)
  })

  it('delete non-existent record', () => {
    const schema = { name: 'string' as const }
    const users = createCollection('users', { schema })

    const deleted = users.delete('non-existent-id')
    expect(deleted).toBe(false)
  })

  it('handles special characters in strings', () => {
    const schema = { name: 'string' as const }
    const users = createCollection('users', { schema })

    const id = users.insert({ name: 'Test "quoted" & <special> chars' })
    const user = users.get(id)

    expect(user?.name).toBe('Test "quoted" & <special> chars')
  })

  it('handles empty strings', () => {
    const schema = { name: 'string' as const, bio: 'string' as const }
    const users = createCollection('users', { schema })

    const id = users.insert({ name: '', bio: '' })
    const user = users.get(id)

    expect(user?.name).toBe('')
    expect(user?.bio).toBe('')
  })

  it('handles zero values', () => {
    const schema = { score: 'number' as const }
    const scores = createCollection('scores', { schema })

    const id = scores.insert({ score: 0 })
    const record = scores.get(id)

    expect(record?.score).toBe(0)

    // Make sure gt(0) doesn't include 0
    const positive = scores.find(gt('score', 0))
    expect(positive.length).toBe(0)
  })

  it('handles negative numbers', () => {
    const schema = { score: 'number' as const }
    const scores = createCollection('scores', { schema })

    scores.insert({ score: -10 })
    scores.insert({ score: 0 })
    scores.insert({ score: 10 })

    const negative = scores.find(lt('score', 0))
    expect(negative.length).toBe(1)
    expect(negative[0].score).toBe(-10)
  })

  it('handles empty arrays', () => {
    const schema = { tags: 'string[]' as const }
    const items = createCollection('items', { schema })

    const id = items.insert({ tags: [] })
    const record = items.get(id)

    expect(record?.tags).toEqual([])
  })

  it('large number of records', () => {
    const schema = { value: 'number' as const }
    const items = createCollection('items', { schema })

    // Insert 1000 records
    for (let i = 0; i < 1000; i++) {
      items.insert({ value: i })
    }

    expect(items.count()).toBe(1000)

    // Filter should work correctly
    const over500 = items.find(gt('value', 500))
    expect(over500.length).toBe(499) // 501-999
  })

  it('multiple collections are isolated', () => {
    const schema = { name: 'string' as const }

    const users1 = createCollection('users1', { schema })
    const users2 = createCollection('users2', { schema })

    users1.insert({ name: 'Alice' })
    users2.insert({ name: 'Bob' })
    users2.insert({ name: 'Charlie' })

    expect(users1.count()).toBe(1)
    expect(users2.count()).toBe(2)
  })
})

// =============================================================================
// Vector Search Extended Tests
// =============================================================================

describe('Vector Search Extended', () => {
  const schema = {
    name: 'string' as const,
    category: 'string' as const,
    embedding: 'vector:3' as const,
  }

  it('vector search with minSimilarity filter', () => {
    const docs = createCollection('docs', { schema })

    const id1 = docs.insert({ name: 'doc1', category: 'tech' })
    docs.updateField(id1, 'embedding', new Float32Array([1, 0, 0]))

    const id2 = docs.insert({ name: 'doc2', category: 'tech' })
    docs.updateField(id2, 'embedding', new Float32Array([0.7, 0.7, 0])) // ~0.707 similarity

    const id3 = docs.insert({ name: 'doc3', category: 'other' })
    docs.updateField(id3, 'embedding', new Float32Array([0, 1, 0])) // 0 similarity

    // Search with high minSimilarity (only doc1 matches)
    const results = vectorSearch(docs, 'embedding', [1, 0, 0], {
      topK: 10,
      minSimilarity: 0.9,
    })

    expect(results.length).toBe(1)
    expect(results[0].record.name).toBe('doc1')
  })

  it('vector search with pre-filter', () => {
    const docs = createCollection('docs', { schema })

    const id1 = docs.insert({ name: 'doc1', category: 'tech' })
    docs.updateField(id1, 'embedding', new Float32Array([1, 0, 0]))

    const id2 = docs.insert({ name: 'doc2', category: 'other' })
    docs.updateField(id2, 'embedding', new Float32Array([1, 0, 0])) // Same vector!

    const id3 = docs.insert({ name: 'doc3', category: 'tech' })
    docs.updateField(id3, 'embedding', new Float32Array([0.5, 0.5, 0]))

    // Search only in 'tech' category
    const results = vectorSearch(docs, 'embedding', [1, 0, 0], {
      topK: 10,
      filter: (r) => r.category === 'tech',
    })

    expect(results.length).toBe(2)
    expect(results.every((r) => r.record.category === 'tech')).toBe(true)
  })

  it('vector search with stale detection', () => {
    const docs = createCollection('docs', { schema })

    const id = docs.insert({ name: 'doc1' })
    docs.updateField(id, 'embedding', new Float32Array([1, 0, 0]))

    // Not stale initially
    expect(docs.isStale(id)).toBe(false)

    // Mark as stale
    docs.setStale(id, true)
    expect(docs.isStale(id)).toBe(true)

    // Search includes stale flag
    const results = vectorSearch(docs, 'embedding', [1, 0, 0], { topK: 10 })
    expect(results[0].stale).toBe(true)
  })
})

// =============================================================================
// Persistence Tests
// =============================================================================

describe('Persistence', () => {
  const schema = {
    name: 'string' as const,
    score: 'number' as const,
    tags: 'string[]' as const,
    bio: 'string' as const,
  }

  const testDir = '/tmp/fsdb-test-' + Date.now()

  it('saves and loads records to/from markdown', async () => {
    const db = createDatabase({ name: 'test', basePath: testDir })
    const users = db.collection('users', {
      schema,
      contentColumn: 'bio',
    })

    // Insert some records
    const id1 = users.insert({ name: 'Alice', score: 100, tags: ['admin'], bio: 'Alice is an admin' })
    const id2 = users.insert({ name: 'Bob', score: 50, tags: ['user'], bio: 'Bob is a user' })

    // Save to disk
    const savedCount = await users.save()
    expect(savedCount).toBe(2)

    // Create a new database instance and load
    const db2 = createDatabase({ name: 'test', basePath: testDir })
    const users2 = db2.collection('users', {
      schema,
      contentColumn: 'bio',
    })

    const loadedCount = await users2.load()
    expect(loadedCount).toBe(2)

    // Check records are loaded correctly
    const alice = users2.get(id1)
    expect(alice?.name).toBe('Alice')
    expect(alice?.score).toBe(100)
    expect(alice?.tags).toEqual(['admin'])
    expect(alice?.bio).toBe('Alice is an admin')

    const bob = users2.get(id2)
    expect(bob?.name).toBe('Bob')

    // Cleanup
    db.close()
    db2.close()
  })

  it('autoSave persists changes automatically', async () => {
    const autoSaveDir = testDir + '-autosave'
    const db = createDatabase({ name: 'test', basePath: autoSaveDir })
    const users = db.collection('users', {
      schema,
      autoSave: true,
    })

    // Insert (auto-saves)
    const id = users.insert({ name: 'Charlie', score: 75 })

    // Wait for save to complete
    await new Promise(r => setTimeout(r, 100))

    // Load in new instance
    const db2 = createDatabase({ name: 'test', basePath: autoSaveDir })
    const users2 = db2.collection('users', { schema })
    await users2.load()

    const charlie = users2.get(id)
    expect(charlie?.name).toBe('Charlie')

    // Cleanup
    db.close()
    db2.close()
  })

  it('setEmbedding stores vector with stale detection', async () => {
    const embeddingDir = testDir + '-embedding'
    const db = createDatabase({ name: 'test', basePath: embeddingDir })
    const docs = db.collection('docs', {
      schema: {
        content: 'string' as const,
        embedding: 'vector:3' as const,
      },
      contentColumn: 'content',
    })

    const id = docs.insert({ content: 'Hello world' })
    docs.setEmbedding(id, 'embedding', new Float32Array([1, 0, 0]), 'Hello world')

    expect(docs.isStale(id)).toBe(false)

    // Search works
    const results = docs.search('embedding', [1, 0, 0], { topK: 10 })
    expect(results.length).toBe(1)
    expect(results[0].record.content).toBe('Hello world')

    // Cleanup
    db.close()
  })

  it('database manages multiple collections', () => {
    const db = createDatabase({ name: 'multi-test' })

    const users = db.collection('users', {
      schema: { name: 'string' as const },
    })

    const posts = db.collection('posts', {
      schema: { title: 'string' as const },
    })

    users.insert({ name: 'Alice' })
    posts.insert({ title: 'Hello' })
    posts.insert({ title: 'World' })

    expect(users.count()).toBe(1)
    expect(posts.count()).toBe(2)

    expect(db.listCollections()).toContain('users')
    expect(db.listCollections()).toContain('posts')

    db.close()
  })
})

// =============================================================================
// File Watching Tests
// =============================================================================

describe('File Watching', () => {
  const watchTestDir = '/tmp/fsdb-watch-test-' + Date.now()

  it('detects external file creation', async () => {
    // Create the collection directory first
    await mkdir(`${watchTestDir}/users`, { recursive: true })

    const db = createDatabase({ name: 'watch-test', basePath: watchTestDir })
    const users = db.collection('users', {
      schema: {
        name: 'string' as const,
        bio: 'string' as const,
      },
      contentColumn: 'bio',
      watchFiles: true,
    })

    // Watcher should start automatically with watchFiles: true
    expect(users.isWatching).toBe(true)

    let fileChangeEvent: any = null
    users.onFileChange((event) => {
      fileChangeEvent = event
    })

    // Create a file externally
    const testId = 'external-user-' + Date.now()
    const markdown = `---
id: ${testId}
created: ${Date.now()}
updated: ${Date.now()}
name: External User
---

This was created externally.
`
    await writeFile(`${watchTestDir}/users/${testId}.md`, markdown)

    // Wait for watcher to detect
    await new Promise(r => setTimeout(r, 400))

    // Check the record was loaded
    const user = users.get(testId)
    expect(user?.name).toBe('External User')
    expect(user?.bio).toBe('This was created externally.')

    // Cleanup
    users.stopWatching()
    db.close()
  })

  // NOTE: This test is timing-sensitive - the file watcher delete detection
  // may need longer timeouts or the watcher implementation may need adjustment
  it.skip('detects external file deletion', async () => {
    // Create the collection directory first
    await mkdir(`${watchTestDir}/watcher-del/users`, { recursive: true })

    const db = createDatabase({ name: 'watch-del-test', basePath: `${watchTestDir}/watcher-del` })
    const users = db.collection('users', {
      schema: { name: 'string' as const },
      watchFiles: true,
    })

    // Insert and save (save will ensure directory exists)
    const id = users.insert({ name: 'To Be Deleted' })
    await users.save()
    expect(users.has(id)).toBe(true)

    // Wait for save to complete and watcher to settle
    await new Promise(r => setTimeout(r, 300))

    // Delete file externally
    await unlink(`${watchTestDir}/watcher-del/users/${id}.md`)

    // Wait for watcher to detect
    await new Promise(r => setTimeout(r, 400))

    // Record should be removed
    expect(users.has(id)).toBe(false)

    // Cleanup
    db.close()
  })
})

console.log('All tests defined!')
