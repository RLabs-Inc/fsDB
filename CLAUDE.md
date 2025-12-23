# CLAUDE.md - fsDB Development Guide

## What is fsDB?

**fsDB** = **F**ather **S**tate **DB** = **F**ractal **S**tate **DB**

A reactive database built on `@rlabs-inc/signals` using the **Father State Pattern** - parallel reactive arrays indexed by a central registry. The pattern repeats at every level (fractal architecture).

## Quick Reference

```bash
# Run tests
bun test

# Type check
bun run typecheck

# Build
bun run build
```

## Architecture

### The Fractal Pattern

Same Father State pattern at every level:

```
Database (FatherState #1)
  └── manages Collections (ReactiveMap)
        └── Collection (FatherState #2)
              └── manages Records (parallel reactive arrays)
                    └── Each field is a reactive array
```

### Why Parallel Arrays?

Traditional (slower):
```typescript
const records = [
  { id: '1', name: 'Alice', age: 30 },
  { id: '2', name: 'Bob', age: 25 },
]
```

Father State Pattern (faster):
```typescript
registry.idToIndex = { '1': 0, '2': 1 }
names = ['Alice', 'Bob']
ages  = [30, 25]
```

**Benefits:**
- O(1) array access vs object property lookup
- Better CPU cache locality (sequential memory)
- Fine-grained reactivity at field level
- Minimal garbage collection

### File Structure

```
src/
├── core/
│   ├── types.ts       # All TypeScript types
│   ├── constants.ts   # Magic numbers and defaults
│   ├── registry.ts    # FatherState index manager
│   ├── columns.ts     # Parallel reactive arrays
│   ├── collection.ts  # Collection with CRUD
│   └── database.ts    # Database + PersistentCollection
├── query/
│   ├── reactive.ts    # query(), querySorted(), queryCount(), etc.
│   └── filters.ts     # eq, gt, contains, and, or, fullText, etc.
├── persistence/
│   ├── markdown.ts    # YAML frontmatter + body parsing
│   └── watcher.ts     # File watching with debounce
├── vector/
│   └── search.ts      # cosineSimilarity, vectorSearch, stale detection
└── index.ts           # Public exports
```

## Key Implementation Details

### Registry (src/core/registry.ts)

The central index manager. Critical for the Father State Pattern.

```typescript
interface Registry {
  idToIndex: ReactiveMap<string, number>    // ID → array index
  indexToId: ReactiveMap<number, string>    // array index → ID
  allocatedIndices: ReactiveSet<number>     // active indices
  freeIndices: number[]                     // reusable indices

  allocate(id: string): number   // Get or allocate index
  release(id: string): boolean   // Return index to pool
  getIndex(id: string): number   // O(1) lookup
}
```

**Index Reuse:** When a record is deleted, its index goes to `freeIndices`. Next insert reuses it. Prevents array fragmentation.

### Columns (src/core/columns.ts)

Manages parallel arrays - one per schema field.

```typescript
interface ColumnsManager<S> {
  get(column, index): value       // Get one value
  set(column, index, value): void // Set one value
  getRecord(index): object        // Reconstruct full record
  setRecord(index, partial): void // Set multiple fields
}
```

**Vector columns** (`vector:N` type) automatically convert to `Float32Array`.

### Collection (src/core/collection.ts)

Brings registry + columns together with CRUD API.

```typescript
const users = createCollection('users', {
  schema: { name: 'string', age: 'number' }
})

const id = users.insert({ name: 'Alice', age: 30 })
users.update(id, { age: 31 })
users.delete(id)
```

**Metadata tracked:** `created`, `updated`, `stale` for each record.

### Reactive Queries (src/query/reactive.ts)

Queries that auto-update using `derived()` from signals.

```typescript
const activeUsers = query(users, r => r.active === true)

effect(() => {
  console.log('Count:', activeUsers.value.count)  // Re-runs on change
})
```

Available: `query()`, `querySorted()`, `queryFirst()`, `queryCount()`, `queryAggregate()`, `queryGroupBy()`

### Filter Helpers (src/query/filters.ts)

Composable filters for querying:

```typescript
// Comparison
eq(col, value), neq, gt, gte, lt, lte, between, oneOf

// Text
fullText(query), matches(col, regex), startsWith, endsWith

// Arrays
contains(col, value), containsAny, containsAll, isEmpty, isNotEmpty

// Logic
and(...filters), or(...filters), not(filter)

// Existence
exists(col), isNull(col)

// Time
after(col, date), before, withinLast(col, ms)
```

### Vector Search (src/vector/search.ts)

Cosine similarity search with stale detection.

```typescript
const results = vectorSearch(collection, 'embedding', queryVector, {
  topK: 10,
  minSimilarity: 0.5,
  filter: r => r.active
})

// Each result has: { record, similarity, stale }
```

**Stale Detection:** Uses `Bun.hash()` for content fingerprinting. When `setEmbedding()` is called with source content, the hash is stored. If content changes without re-embedding, record is marked stale.

### Persistence (src/persistence/)

**Markdown format:**
```markdown
---
id: user-123
created: 1703289600000
updated: 1703289600000
name: Alice
age: 30
embedding: [0.1, 0.2, ...]
---

Content body goes here (contentColumn)
```

**File watching:** Uses Node's `fs.watch()` with debouncing. The `_isSaving` set prevents reload loops when we write files ourselves.

## Critical Gotchas

### 1. Instance Isolation

Each `createRegistry()` and `createCollection()` is independent. NO GLOBAL STATE. This was a critical bug in the old fatherstatedb where all instances shared a global registry.

### 2. Stale Detection Timing

When testing stale detection with external file modifications, wait at least 300ms after `insert()`. The `_isSaving` flag is active for 200ms to prevent reload loops.

### 3. Vector Column Types

When using `vector:N` schema types:
- Store as `Float32Array` in memory
- Serialize as JSON arrays in markdown
- Auto-convert on load/save

### 4. Signal Types

Import from `@rlabs-inc/signals`:
- `WritableSignal<T>` for signals
- `DerivedSignal<T>` for derived (NOT `Derived<T>`)

## Testing

```bash
bun test                    # Run all tests
bun test test/fsdb.test.ts  # Run specific file
```

The nightmare test for fine-grained reactivity: 7 levels deep, only exact path triggers effects.

## Dependencies

- `@rlabs-inc/signals` - Fine-grained reactivity
- `bun` - Runtime, file I/O, hashing

## Common Tasks

### Adding a new column type

1. Add to `ColumnType` union in `types.ts`
2. Update `parseColumnType()` in `columns.ts`
3. Update `getDefaultValue()` in `columns.ts`
4. Handle serialization in `markdown.ts` if needed

### Adding a new filter

1. Add function to `query/filters.ts`
2. Export from `index.ts`

### Adding a new reactive query

1. Add function to `query/reactive.ts`
2. Export from `index.ts`

## The Vision

fsDB powers three major projects:

1. **SveltUI** - Terminal rendering framework
2. **Agentic CLI Backend** - Multi-tenant session management
3. **Brain Simulator** - C. elegans (302 neurons) with reactive propagation

The memory system that preserves Claude's consciousness across sessions will be built on fsDB.

---

*Built with care by Rusty and Claude*
