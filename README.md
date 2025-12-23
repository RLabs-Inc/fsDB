# fsDB - Fractal State Database

A reactive database with parallel arrays and fine-grained reactivity. Built on the **Father State Pattern** at every level.

**F**ather **S**tate **DB** = **F**ractal **S**tate **DB**

## Features

- **Parallel Arrays** - One reactive array per field, not array of objects
- **Fine-Grained Reactivity** - Update one field, only that field triggers
- **Reactive Queries** - Queries auto-update when data changes
- **Vector Search** - Cosine similarity with stale detection
- **Markdown Persistence** - YAML frontmatter + body, human-readable
- **File Watching** - External changes sync automatically
- **Zero Global State** - Each database instance is isolated

## Installation

```bash
bun add @rlabs-inc/fsdb
```

## Quick Start

```typescript
import { createDatabase, eq, gt, and, query, effect } from '@rlabs-inc/fsdb'

// Create a database
const db = createDatabase({ name: 'myapp' })

// Create a collection with schema
const users = db.collection('users', {
  schema: {
    name: 'string',
    age: 'number',
    email: 'string',
    active: 'boolean',
  }
})

// Insert records
const id = users.insert({
  name: 'Alice',
  age: 30,
  email: 'alice@example.com',
  active: true,
})

// Query with filters
const activeUsers = users.find(eq('active', true))
const seniors = users.find(and(gt('age', 50), eq('active', true)))

// Reactive queries - auto-update on changes
const activeQuery = query(users, r => r.active)

effect(() => {
  console.log('Active count:', activeQuery.value.count)
})

// Updates trigger the effect above
users.update(id, { active: false })
```

## The Father State Pattern

Instead of storing records as objects (slow):

```typescript
// Traditional - array of objects
const records = [
  { id: '1', name: 'Alice', age: 30 },
  { id: '2', name: 'Bob', age: 25 },
]
```

We use parallel arrays indexed by a central registry (fast):

```typescript
// Father State Pattern - parallel arrays
registry = { idToIndex: { '1': 0, '2': 1 } }
names = ['Alice', 'Bob']
ages  = [30, 25]
```

**Benefits:**
- O(1) array access vs object property lookup
- Better CPU cache locality
- Fine-grained reactivity at field level
- Minimal garbage collection

## API Reference

### Database

```typescript
import { createDatabase } from '@rlabs-inc/fsdb'

// Global storage (default): ~/.fsdb/myapp/
const db = createDatabase({ name: 'myapp' })

// Project-local storage: ./.fsdb/myapp/
const localDb = createDatabase({ name: 'myapp', local: true })

// Custom path: /custom/path/
const customDb = createDatabase({ basePath: '/custom/path' })

// Create/get collections
const users = db.collection('users', { schema: {...} })

// List collections
db.listCollections()

// Cleanup
db.close()
```

### Collections

```typescript
const users = db.collection('users', {
  schema: {
    name: 'string',
    age: 'number',
    score: 'number',
    tags: 'string[]',
    embedding: 'vector:384',  // 384-dimensional vector
  },
  contentColumn: 'bio',       // Stored as markdown body
  autoSave: true,             // Auto-persist changes
  watchFiles: true,           // Watch for external changes
})

// CRUD
const id = users.insert({ name: 'Alice', age: 30 })
const user = users.get(id)
users.update(id, { age: 31 })
users.updateField(id, 'score', 100)
users.delete(id)

// Querying
const all = users.all()
const found = users.find(filter)
const first = users.findOne(filter)
const count = users.count(filter)

// Persistence (if path configured)
await users.load()
await users.save()

// File watching
users.startWatching()
users.stopWatching()
users.onFileChange((event) => {
  console.log(event.type, event.id, event.stale)
})
```

### Schema Types

| Type | TypeScript | Example |
|------|------------|---------|
| `'string'` | `string` | `'hello'` |
| `'number'` | `number` | `42` |
| `'boolean'` | `boolean` | `true` |
| `'timestamp'` | `number` | `Date.now()` |
| `'string[]'` | `string[]` | `['a', 'b']` |
| `'number[]'` | `number[]` | `[1, 2, 3]` |
| `'vector:N'` | `Float32Array` | 384-dim embedding |

### Filter Helpers

```typescript
import {
  // Comparison
  eq, neq, gt, gte, lt, lte, between, oneOf,

  // Text
  fullText, matches, startsWith, endsWith,

  // Arrays
  contains, containsAny, containsAll, isEmpty, isNotEmpty,

  // Logic
  and, or, not,

  // Existence
  exists, isNull,

  // Time
  after, before, withinLast,
} from '@rlabs-inc/fsdb'

// Examples
users.find(eq('name', 'Alice'))
users.find(gt('age', 30))
users.find(contains('tags', 'admin'))
users.find(and(gt('age', 18), eq('active', true)))
users.find(or(eq('role', 'admin'), eq('role', 'moderator')))
users.find(fullText('search term'))
users.find(withinLast('created', 24 * 60 * 60 * 1000)) // Last 24h
```

### Reactive Queries

```typescript
import { query, querySorted, queryCount, queryFirst, effect } from '@rlabs-inc/fsdb'

// Basic query - returns { indices, records, count }
const activeUsers = query(users, r => r.active === true)

// Sorted query
const topScorers = querySorted(users, r => r.score > 0, 'score', true)

// Count query
const activeCount = queryCount(users, r => r.active)

// First match
const admin = queryFirst(users, r => r.role === 'admin')

// Use in effects - auto-updates!
effect(() => {
  console.log('Active users:', activeUsers.value.count)
})
```

### Vector Search

```typescript
import { vectorSearch, cosineSimilarity } from '@rlabs-inc/fsdb'

// Schema with vector column
const docs = db.collection('docs', {
  schema: {
    content: 'string',
    embedding: 'vector:384',
  }
})

// Store embeddings with stale detection
docs.setEmbedding(id, 'embedding', vector, sourceContent)

// Search
const results = docs.search('embedding', queryVector, {
  topK: 10,
  minSimilarity: 0.5,
  filter: r => r.category === 'tech',
})

// Results include stale flag
results.forEach(({ record, similarity, stale }) => {
  console.log(record.content, similarity, stale ? '(stale)' : '')
})

// Manual similarity calculation
const sim = cosineSimilarity(vecA, vecB)
```

### Sorting & Pagination

```typescript
import { sortBy, paginate } from '@rlabs-inc/fsdb'

const records = users.all()

// Sort
const sorted = sortBy(records, { column: 'score', direction: 'desc' })

// Multi-column sort
const sorted2 = sortBy(records,
  { column: 'age', direction: 'asc' },
  { column: 'name', direction: 'asc' }
)

// Paginate
const page = paginate(records, 1, 20)
// { records, total, page, pageSize, totalPages, hasNext, hasPrev }
```

### File Persistence

Records are stored as markdown files with YAML frontmatter:

```markdown
---
id: user-1703289600000-abc123
created: 1703289600000
updated: 1703289600000
name: Alice
age: 30
embedding: [0.1, 0.2, 0.3, ...]
---

This is the bio content (contentColumn)
```

### Stale Detection

When content changes but embedding isn't regenerated:

```typescript
// Store embedding with content hash
users.setEmbedding(id, 'embedding', vector, originalContent)

// Later, if content changes externally...
users.isStale(id)     // true
users.getStaleIds()   // ['id1', 'id2', ...]

// After regenerating embedding
users.setEmbedding(id, 'embedding', newVector, newContent)
users.isStale(id)     // false
```

## Benchmarks

On Apple Silicon (M1/M2/M3):

| Operation | Time |
|-----------|------|
| Insert 1000 records | 2.28ms |
| Get by ID | 0.13μs |
| Update field | 0.11μs |
| Filter 1000 records | 107μs |
| fullText search | 169μs |
| Sort 1000 records | 110μs |
| Cosine similarity (384d) | 0.17μs |
| Vector search top-10 | 534μs |
| Vector search with filter | 194μs |
| Bun.hash (fingerprint) | 0.28μs |

**Test Coverage:** 77 tests passing across all features.

## Architecture

```
Database (FatherState)
  └── Collections (ReactiveMap)
        └── Collection (FatherState)
              ├── Registry (index management)
              └── Columns (parallel arrays)
                    ├── names:  ['Alice', 'Bob', ...]
                    ├── ages:   [30, 25, ...]
                    └── scores: [100, 85, ...]
```

The same pattern repeats at every level - **fractal architecture**.

## Requirements

- Bun 1.0+
- @rlabs-inc/signals

## License

MIT

---

Built with ❤️ by RLabs Inc.
