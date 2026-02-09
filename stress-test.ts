/**
 * fsDB Stress Test Suite
 *
 * Systematically probes every edge case to find where fsDB breaks,
 * corrupts data, or loses records.
 *
 * Categories:
 *   1. Race Conditions (async ordering, ghost files)
 *   2. YAML Roundtrip Fidelity (data that doesn't survive serialize/deserialize)
 *   3. Filename Safety (ID collisions, special chars)
 *   4. Persistence Model (load behavior, corrupt files)
 *   5. Scale & Memory (large datasets, fragmentation)
 *
 * Run with: bun stress-test.ts
 */

import { createCollection, createPersistentCollection } from './src/index'
import { rmSync, mkdirSync, readdirSync, writeFileSync, readFileSync } from 'fs'
import { parseMarkdown, generateMarkdown, idToFilename } from './src/persistence/markdown'

const BASE_DIR = '/tmp/fsdb-stress'
let passed = 0
let failed = 0
let warnings = 0
const failures: string[] = []
const warningList: string[] = []

function cleanup(subdir?: string) {
  const dir = subdir ? `${BASE_DIR}/${subdir}` : BASE_DIR
  try { rmSync(dir, { recursive: true }) } catch {}
  mkdirSync(dir, { recursive: true })
}

function pass(name: string) {
  passed++
  console.log(`  \x1b[32mPASS\x1b[0m  ${name}`)
}

function fail(name: string, detail: string) {
  failed++
  const msg = `${name}: ${detail}`
  failures.push(msg)
  console.log(`  \x1b[31mFAIL\x1b[0m  ${name}`)
  console.log(`        ${detail}`)
}

function warn(name: string, detail: string) {
  warnings++
  warningList.push(`${name}: ${detail}`)
  console.log(`  \x1b[33mWARN\x1b[0m  ${name}`)
  console.log(`        ${detail}`)
}

function assert(condition: boolean, name: string, detail: string) {
  if (condition) pass(name)
  else fail(name, detail)
}

function countFiles(dir: string): number {
  try { return readdirSync(dir).filter(f => f.endsWith('.md')).length } catch { return 0 }
}

console.log('\n  fsDB Stress Test Suite\n')
console.log('='.repeat(70))

// =============================================================================
// 1. RACE CONDITIONS
// =============================================================================

console.log('\n--- 1. RACE CONDITIONS ---\n')

// 1a. Ghost files: insert + immediate delete with autoSave
{
  cleanup('race-ghost')
  const dir = `${BASE_DIR}/race-ghost`

  const coll = createPersistentCollection('ghost-test', {
    schema: { name: 'string' as const },
    path: dir,
    autoSave: true,
  })

  const id = coll.insert({ name: 'ghost' })
  coll.delete(id) // immediate delete before save can complete

  // Wait for any async I/O to settle
  await Bun.sleep(500)

  const filesOnDisk = countFiles(dir)
  const inMemory = coll.has(id)

  if (filesOnDisk > 0 && !inMemory) {
    fail('1a. Ghost file after insert+delete',
      `Record deleted from memory but ${filesOnDisk} file(s) remain on disk`)
  } else if (filesOnDisk === 0 && !inMemory) {
    pass('1a. Ghost file after insert+delete')
  } else {
    warn('1a. Ghost file after insert+delete',
      `files=${filesOnDisk}, inMemory=${inMemory}`)
  }

  coll.close()
}

// 1b. Ghost files: batch - insert N records, delete all immediately
{
  cleanup('race-ghost-batch')
  const dir = `${BASE_DIR}/race-ghost-batch`

  const coll = createPersistentCollection('ghost-batch', {
    schema: { name: 'string' as const },
    path: dir,
    autoSave: true,
  })

  const ids: string[] = []
  for (let i = 0; i < 50; i++) {
    ids.push(coll.insert({ name: `record-${i}` }))
  }
  // Delete all immediately
  for (const id of ids) coll.delete(id)

  await Bun.sleep(1000)

  const filesOnDisk = countFiles(dir)
  const inMemory = coll.count()

  if (filesOnDisk > 0) {
    fail('1b. Ghost files after batch insert+delete',
      `${filesOnDisk} ghost file(s) on disk, ${inMemory} in memory`)
  } else {
    pass('1b. Ghost files after batch insert+delete')
  }

  coll.close()
}

// 1c. Rapid updates to same record - does the last write win?
{
  cleanup('race-rapid-update')
  const dir = `${BASE_DIR}/race-rapid-update`

  const coll = createPersistentCollection('rapid-update', {
    schema: { counter: 'number' as const },
    path: dir,
    autoSave: true,
  })

  const id = coll.insert({ counter: 0 })

  // Fire 100 rapid updates
  for (let i = 1; i <= 100; i++) {
    coll.updateField(id, 'counter', i)
  }

  // Wait for all writes to settle
  await Bun.sleep(1000)

  // In-memory should be 100
  const memValue = coll.get(id)?.counter

  // Reload from disk to check what actually persisted
  const coll2 = createPersistentCollection('rapid-update-verify', {
    schema: { counter: 'number' as const },
    path: dir,
    autoSave: false,
  })
  await coll2.load()
  const diskValue = coll2.get(id)?.counter

  if (memValue === 100 && diskValue === 100) {
    pass('1c. Rapid updates - last write wins')
  } else {
    fail('1c. Rapid updates - last write wins',
      `memory=${memValue}, disk=${diskValue}, expected=100`)
  }

  coll.close()
  coll2.close()
}

// 1d. Insert with custom ID that already exists
{
  const coll = createCollection('dup-id', {
    schema: { name: 'string' as const },
  })

  coll.insert({ id: 'same-id', name: 'first' } as any)
  coll.insert({ id: 'same-id', name: 'second' } as any)

  const record = coll.get('same-id')
  const count = coll.count()

  // Registry.allocate returns existing index for duplicate ID,
  // so the second insert overwrites the first silently
  if (count === 1 && record?.name === 'second') {
    warn('1d. Duplicate ID insert',
      `Silently overwrites first record (count=${count}, name=${record?.name}). No error thrown.`)
  } else if (count === 1 && record?.name === 'first') {
    warn('1d. Duplicate ID insert',
      `Second insert ignored silently (count=${count}, name=${record?.name})`)
  } else {
    fail('1d. Duplicate ID insert',
      `Unexpected: count=${count}, name=${record?.name}`)
  }
}

// 1e. Delete during save() - call save(), then delete mid-save
{
  cleanup('race-delete-during-save')
  const dir = `${BASE_DIR}/race-delete-during-save`

  const coll = createPersistentCollection('delete-during-save', {
    schema: { name: 'string' as const, data: 'string' as const },
    path: dir,
    autoSave: false,
  })

  const ids: string[] = []
  for (let i = 0; i < 100; i++) {
    ids.push(coll.insert({ name: `record-${i}`, data: 'x'.repeat(500) }))
  }

  // Start save (doesn't await)
  const savePromise = coll.save()

  // Delete half the records while save is running
  for (let i = 0; i < 50; i++) {
    coll.delete(ids[i])
  }

  await savePromise
  await Bun.sleep(500)

  // Check disk state
  const filesOnDisk = countFiles(dir)
  const inMemory = coll.count()

  // We expect: 50 in memory. On disk could be 50-100 (save may have captured some before delete)
  // The real question: if we reload, do we get ONLY valid records?
  const verify = createPersistentCollection('verify-delete-save', {
    schema: { name: 'string' as const, data: 'string' as const },
    path: dir,
    autoSave: false,
  })
  await verify.load()

  if (verify.count() > inMemory) {
    warn('1e. Delete during save()',
      `Disk has ${filesOnDisk} files, memory has ${inMemory} records, reload gets ${verify.count()} records. Ghost files exist.`)
  } else {
    pass('1e. Delete during save()')
  }

  coll.close()
  verify.close()
}

// =============================================================================
// 2. YAML ROUNDTRIP FIDELITY
// =============================================================================

console.log('\n--- 2. YAML ROUNDTRIP FIDELITY ---\n')

// Helper: test if a value survives insert -> save -> load
async function testRoundtrip(
  testName: string,
  schema: Record<string, string>,
  input: Record<string, unknown>,
  expectField: string,
  expectValue: unknown,
  compareFn?: (a: unknown, b: unknown) => boolean
) {
  cleanup('roundtrip')
  const dir = `${BASE_DIR}/roundtrip`

  const writer = createPersistentCollection('rt-write', {
    schema: schema as any,
    path: dir,
    autoSave: false,
  })

  const id = writer.insert(input as any)
  await writer.save()
  writer.close()

  const reader = createPersistentCollection('rt-read', {
    schema: schema as any,
    path: dir,
    autoSave: false,
  })
  await reader.load()

  const loaded = reader.get(id)
  const loadedValue = loaded?.[expectField as keyof typeof loaded]

  const compare = compareFn || ((a: unknown, b: unknown) => a === b)

  if (loaded && compare(loadedValue, expectValue)) {
    pass(testName)
  } else {
    fail(testName,
      `wrote ${JSON.stringify(expectValue)}, loaded ${JSON.stringify(loadedValue)}`)
  }

  reader.close()
}

// 2a. Empty string
await testRoundtrip(
  '2a. Empty string roundtrip',
  { name: 'string' },
  { name: '' },
  'name', ''
)

// 2b. String "true" (should not become boolean)
await testRoundtrip(
  '2b. String "true" roundtrip',
  { val: 'string' },
  { val: 'true' },
  'val', 'true'
)

// 2c. String "false"
await testRoundtrip(
  '2c. String "false" roundtrip',
  { val: 'string' },
  { val: 'false' },
  'val', 'false'
)

// 2d. String "null"
await testRoundtrip(
  '2d. String "null" roundtrip',
  { val: 'string' },
  { val: 'null' },
  'val', 'null'
)

// 2e. String "123" (should not become number)
await testRoundtrip(
  '2e. String "123" roundtrip',
  { val: 'string' },
  { val: '123' },
  'val', '123'
)

// 2f. String with colons
await testRoundtrip(
  '2f. String with colons',
  { val: 'string' },
  { val: 'key: value: nested: deep' },
  'val', 'key: value: nested: deep'
)

// 2g. String with newlines
await testRoundtrip(
  '2g. String with newlines',
  { val: 'string' },
  { val: 'line1\nline2\nline3' },
  'val', 'line1\nline2\nline3'
)

// 2h. String starting with ---
await testRoundtrip(
  '2h. String starting with "---"',
  { val: 'string' },
  { val: '---\nfake frontmatter\n---' },
  'val', '---\nfake frontmatter\n---'
)

// 2i. NaN number
await testRoundtrip(
  '2i. NaN number roundtrip',
  { val: 'number' },
  { val: NaN },
  'val', NaN,
  (a, b) => (typeof a === 'number' && isNaN(a as number)) && (typeof b === 'number' && isNaN(b as number))
)

// 2j. Infinity number
await testRoundtrip(
  '2j. Infinity number roundtrip',
  { val: 'number' },
  { val: Infinity },
  'val', Infinity
)

// 2k. Negative zero
await testRoundtrip(
  '2k. Negative zero roundtrip',
  { val: 'number' },
  { val: -0 },
  'val', -0,
  (a, b) => Object.is(a, b)
)

// 2l. Very large integer (beyond safe integer)
await testRoundtrip(
  '2l. Large integer roundtrip',
  { val: 'number' },
  { val: Number.MAX_SAFE_INTEGER + 1 },
  'val', Number.MAX_SAFE_INTEGER + 1
)

// 2m. String with quotes
await testRoundtrip(
  '2m. String with quotes',
  { val: 'string' },
  { val: 'He said "hello" and \'goodbye\'' },
  'val', 'He said "hello" and \'goodbye\''
)

// 2n. String with hash (YAML comment)
await testRoundtrip(
  '2n. String with hash (comment char)',
  { val: 'string' },
  { val: 'color #ff0000 is red' },
  'val', 'color #ff0000 is red'
)

// 2o. Boolean true
await testRoundtrip(
  '2o. Boolean true roundtrip',
  { val: 'boolean' },
  { val: true },
  'val', true
)

// 2p. Number 0 (falsy)
await testRoundtrip(
  '2p. Number 0 roundtrip',
  { val: 'number' },
  { val: 0 },
  'val', 0
)

// 2q. Content column with --- in body
{
  cleanup('roundtrip-content')
  const dir = `${BASE_DIR}/roundtrip-content`

  const writer = createPersistentCollection('content-test', {
    schema: { title: 'string' as const, body: 'string' as const },
    path: dir,
    autoSave: false,
    contentColumn: 'body' as any,
  })

  const body = 'First paragraph\n\n---\n\nSecond paragraph after HR'
  const id = writer.insert({ title: 'test', body } as any)
  await writer.save()
  writer.close()

  const reader = createPersistentCollection('content-read', {
    schema: { title: 'string' as const, body: 'string' as const },
    path: dir,
    autoSave: false,
    contentColumn: 'body' as any,
  })
  await reader.load()
  const loaded = reader.get(id)

  assert(
    loaded?.body === body,
    '2q. Content body with --- (HR)',
    `wrote ${JSON.stringify(body)}, loaded ${JSON.stringify(loaded?.body)}`
  )

  reader.close()
}

// 2r. String array roundtrip
await testRoundtrip(
  '2r. String array roundtrip',
  { tags: 'string[]' },
  { tags: ['hello', 'world', 'with spaces'] },
  'tags', ['hello', 'world', 'with spaces'],
  (a, b) => JSON.stringify(a) === JSON.stringify(b)
)

// 2s. Empty array roundtrip
await testRoundtrip(
  '2s. Empty array roundtrip',
  { tags: 'string[]' },
  { tags: [] },
  'tags', [],
  (a, b) => JSON.stringify(a) === JSON.stringify(b)
)

// =============================================================================
// 3. FILENAME SAFETY
// =============================================================================

console.log('\n--- 3. FILENAME SAFETY ---\n')

// 3a. ID collision via sanitization
{
  const id1 = 'test<1>'
  const id2 = 'test_1_'
  const fn1 = idToFilename(id1)
  const fn2 = idToFilename(id2)

  if (fn1 === fn2) {
    fail('3a. ID filename collision',
      `"${id1}" and "${id2}" both map to "${fn1}"`)
  } else {
    pass('3a. ID filename collision')
  }
}

// 3b. IDs that produce same filename after sanitization
{
  const collisions: [string, string][] = [
    ['a<b', 'a_b'],
    ['a>b', 'a_b'],
    ['a:b', 'a_b'],
    ['a"b', 'a_b'],
    ['a|b', 'a_b'],
    ['a?b', 'a_b'],
    ['a*b', 'a_b'],
  ]

  const seen = new Map<string, string>()
  let collisionCount = 0

  for (const [id] of collisions) {
    const fn = idToFilename(id)
    const existing = seen.get(fn)
    if (existing) {
      collisionCount++
    }
    seen.set(fn, id)
  }

  if (collisionCount > 0) {
    fail('3b. Multiple IDs with same filename',
      `${collisionCount} collision(s) among special-char IDs`)
  } else {
    pass('3b. Multiple IDs with same filename')
  }
}

// 3c. Very long ID
{
  cleanup('long-id')
  const dir = `${BASE_DIR}/long-id`

  const coll = createPersistentCollection('long-id', {
    schema: { val: 'string' as const },
    path: dir,
    autoSave: false,
  })

  const longId = 'x'.repeat(300) // Exceeds most FS filename limits
  let errored = false

  try {
    coll.insert({ id: longId, val: 'test' } as any)
    await coll.save()
  } catch (e) {
    errored = true
  }

  const files = countFiles(dir)

  if (errored) {
    warn('3c. Very long ID (300 chars)',
      'Insert or save threw an error')
  } else if (files === 0) {
    warn('3c. Very long ID (300 chars)',
      'Saved silently but no file on disk')
  } else {
    pass('3c. Very long ID (300 chars)')
  }

  coll.close()
}

// 3d. ID with path traversal attempt
{
  cleanup('path-traversal')
  const dir = `${BASE_DIR}/path-traversal`

  const coll = createPersistentCollection('path-traversal', {
    schema: { val: 'string' as const },
    path: dir,
    autoSave: false,
  })

  // These IDs, if not sanitized, could write outside the collection directory
  const dangerousIds = [
    '../../../etc/passwd',
    '..\\..\\windows\\system32',
    'normal/../../../escape',
  ]

  for (const id of dangerousIds) {
    coll.insert({ id, val: 'pwned' } as any)
  }

  await coll.save()
  await Bun.sleep(200)

  // Check: files should ONLY be in the target directory (no actual path traversal).
  // The '/' and '\' in IDs get percent-encoded, so files stay in-dir.
  // Filenames may contain '..' as literal chars (from the ID) - that's fine.
  const files = readdirSync(dir).filter(f => f.endsWith('.md'))
  const allInDir = files.length === dangerousIds.length

  // Verify no files escaped to parent directories
  let escaped = false
  try {
    const parentFiles = readdirSync(`${BASE_DIR}`)
    if (parentFiles.includes('etc') || parentFiles.includes('windows')) {
      escaped = true
    }
  } catch {}

  assert(allInDir && !escaped, '3d. Path traversal in IDs',
    escaped ? 'Files escaped to parent directory!' : `Expected ${dangerousIds.length} files in dir, got ${files.length}`)

  coll.close()
}

// =============================================================================
// 4. PERSISTENCE MODEL
// =============================================================================

console.log('\n--- 4. PERSISTENCE MODEL ---\n')

// 4a. Load on non-empty collection (should it merge? overwrite? error?)
{
  cleanup('load-nonempty')
  const dir = `${BASE_DIR}/load-nonempty`

  // First: create and save 5 records
  const writer = createPersistentCollection('load-1', {
    schema: { name: 'string' as const },
    path: dir,
    autoSave: false,
  })

  for (let i = 0; i < 5; i++) {
    writer.insert({ name: `disk-${i}` })
  }
  await writer.save()
  writer.close()

  // Second: create collection with 3 in-memory records, then load
  const coll = createPersistentCollection('load-2', {
    schema: { name: 'string' as const },
    path: dir,
    autoSave: false,
  })

  for (let i = 0; i < 3; i++) {
    coll.insert({ name: `memory-${i}` })
  }

  const beforeLoad = coll.count()
  await coll.load()
  const afterLoad = coll.count()

  if (afterLoad === 5) {
    warn('4a. Load on non-empty collection',
      `Before load: ${beforeLoad}, after: ${afterLoad}. Memory records silently discarded.`)
  } else if (afterLoad === 8) {
    warn('4a. Load on non-empty collection',
      `Before load: ${beforeLoad}, after: ${afterLoad}. Records merged (potential duplicates).`)
  } else {
    warn('4a. Load on non-empty collection',
      `Before: ${beforeLoad}, after: ${afterLoad}. Unexpected count.`)
  }

  coll.close()
}

// 4b. Corrupt file on disk (malformed YAML)
{
  cleanup('corrupt')
  const dir = `${BASE_DIR}/corrupt`

  // Write a valid file
  const coll = createPersistentCollection('corrupt-test', {
    schema: { name: 'string' as const },
    path: dir,
    autoSave: false,
  })

  const id = coll.insert({ name: 'valid' })
  await coll.save()
  coll.close()

  // Corrupt the file
  const filename = idToFilename(id)
  writeFileSync(`${dir}/${filename}`, 'THIS IS NOT VALID MARKDOWN FRONTMATTER\n{{{garbage}}}')

  // Also add a truncated file
  writeFileSync(`${dir}/truncated.md`, '---\nid: truncated\nname: ')

  // And a completely empty file
  writeFileSync(`${dir}/empty.md`, '')

  // And a file with no id
  writeFileSync(`${dir}/no-id.md`, '---\nname: orphan\n---\n')

  // Try to load
  const reader = createPersistentCollection('corrupt-read', {
    schema: { name: 'string' as const },
    path: dir,
    autoSave: false,
  })

  let loadError = false
  let loaded = 0
  try {
    loaded = await reader.load()
  } catch (e) {
    loadError = true
  }

  if (loadError) {
    fail('4b. Corrupt files on disk',
      'load() threw an exception instead of skipping bad files')
  } else {
    pass('4b. Corrupt files on disk')
    console.log(`        (Loaded ${loaded} valid records, skipped ${4 - loaded} corrupt)`)
  }

  reader.close()
}

// 4c. Two files with same ID in frontmatter
{
  cleanup('dup-files')
  const dir = `${BASE_DIR}/dup-files`

  writeFileSync(`${dir}/file-a.md`, '---\nid: same-id\nname: from-file-a\n---\n')
  writeFileSync(`${dir}/file-b.md`, '---\nid: same-id\nname: from-file-b\n---\n')

  const coll = createPersistentCollection('dup-files', {
    schema: { name: 'string' as const },
    path: dir,
    autoSave: false,
  })
  await coll.load()

  const record = coll.get('same-id')
  const count = coll.count()

  warn('4c. Two files with same ID',
    `count=${count}, name="${record?.name}". Second file silently ${record?.name === 'from-file-b' ? 'overwrote' : 'was ignored by'} first.`)

  coll.close()
}

// 4d. File modified externally while collection is loaded
{
  cleanup('external-mod')
  const dir = `${BASE_DIR}/external-mod`

  const coll = createPersistentCollection('ext-mod', {
    schema: { name: 'string' as const, score: 'number' as const },
    path: dir,
    autoSave: false,
    watchFiles: true,
  })

  const id = coll.insert({ name: 'original', score: 10 })
  await coll.save()

  // Modify the file externally
  const filename = idToFilename(id)
  const filepath = `${dir}/${filename}`
  const content = readFileSync(filepath, 'utf-8')
  writeFileSync(filepath, content.replace('score: 10', 'score: 999'))

  // Wait for watcher to pick it up
  await Bun.sleep(500)

  const record = coll.get(id)
  if (record?.score === 999) {
    pass('4d. External file modification detected')
  } else if (record?.score === 10) {
    warn('4d. External file modification detected',
      `Watcher did not pick up change (still score=${record?.score})`)
  } else {
    warn('4d. External file modification detected',
      `Unexpected score=${record?.score}`)
  }

  coll.close()
}

// 4e. save() is sequential - not parallel
{
  cleanup('save-sequential')
  const dir = `${BASE_DIR}/save-sequential`

  const coll = createPersistentCollection('save-seq', {
    schema: { val: 'string' as const },
    path: dir,
    autoSave: false,
  })

  for (let i = 0; i < 500; i++) {
    coll.insert({ val: `record-${i}` })
  }

  const start = Bun.nanoseconds()
  await coll.save()
  const seqMs = (Bun.nanoseconds() - start) / 1_000_000

  // Check all files landed
  const files = countFiles(dir)
  assert(files === 500, '4e. save() writes all records',
    `Expected 500 files, got ${files}`)

  console.log(`        (Sequential save of 500 records: ${seqMs.toFixed(1)}ms)`)

  coll.close()
}

// 4f. Metadata preservation (created/updated timestamps survive roundtrip)
{
  cleanup('metadata')
  const dir = `${BASE_DIR}/metadata`

  const writer = createPersistentCollection('meta-write', {
    schema: { name: 'string' as const },
    path: dir,
    autoSave: false,
  })

  const id = writer.insert({ name: 'timestamped' })
  const original = writer.get(id)!
  const originalCreated = original.created
  const originalUpdated = original.updated

  // Wait a bit then update
  await Bun.sleep(50)
  writer.updateField(id, 'name', 'updated-name')
  const afterUpdate = writer.get(id)!

  await writer.save()
  writer.close()

  // Reload
  const reader = createPersistentCollection('meta-read', {
    schema: { name: 'string' as const },
    path: dir,
    autoSave: false,
  })
  await reader.load()
  const loaded = reader.get(id)!

  const createdPreserved = loaded.created === originalCreated
  const updatedPreserved = loaded.updated === afterUpdate.updated
  const createdBeforeUpdated = loaded.created <= loaded.updated

  if (createdPreserved && updatedPreserved && createdBeforeUpdated) {
    pass('4f. Metadata timestamps survive roundtrip')
  } else {
    fail('4f. Metadata timestamps survive roundtrip',
      `created: ${originalCreated}→${loaded.created} (${createdPreserved ? 'ok' : 'CHANGED'}), ` +
      `updated: ${afterUpdate.updated}→${loaded.updated} (${updatedPreserved ? 'ok' : 'CHANGED'})`)
  }

  reader.close()
}

// =============================================================================
// 5. SCALE & MEMORY
// =============================================================================

console.log('\n--- 5. SCALE & MEMORY ---\n')

// 5a. Insert-delete cycles (index reuse, array fragmentation)
{
  const coll = createCollection('fragmentation', {
    schema: { name: 'string' as const, val: 'number' as const },
  })

  // Insert 1000, delete all, insert 1000 again - 3 times
  for (let cycle = 0; cycle < 3; cycle++) {
    const ids: string[] = []
    for (let i = 0; i < 1000; i++) {
      ids.push(coll.insert({ name: `cycle${cycle}-${i}`, val: i }))
    }
    for (const id of ids) coll.delete(id)
  }

  // Now insert 1000 final records
  const finalIds: string[] = []
  for (let i = 0; i < 1000; i++) {
    finalIds.push(coll.insert({ name: `final-${i}`, val: i }))
  }

  // Verify all 1000 are correct
  let allCorrect = true
  for (let i = 0; i < 1000; i++) {
    const record = coll.get(finalIds[i])
    if (!record || record.name !== `final-${i}` || record.val !== i) {
      allCorrect = false
      break
    }
  }

  assert(allCorrect, '5a. Index reuse after delete cycles',
    'Some records corrupted after insert/delete cycling')

  // Check index reuse efficiency
  const maxIndex = coll.registry.nextIndex
  if (maxIndex <= 1000) {
    console.log(`        (Indices reused efficiently: max index = ${maxIndex})`)
  } else {
    warn('5a-note', `Max index grew to ${maxIndex} despite reuse (expected ≤ 1000)`)
  }
}

// 5b. Large record count (10K in-memory)
{
  const coll = createCollection('scale-10k', {
    schema: {
      name: 'string' as const,
      age: 'number' as const,
      email: 'string' as const,
      score: 'number' as const,
      active: 'boolean' as const,
    },
  })

  const start = Bun.nanoseconds()
  const ids: string[] = []
  for (let i = 0; i < 10000; i++) {
    ids.push(coll.insert({
      name: `User ${i}`,
      age: 20 + (i % 60),
      email: `user${i}@test.com`,
      score: Math.random() * 100,
      active: i % 3 !== 0,
    }))
  }
  const insertMs = (Bun.nanoseconds() - start) / 1_000_000

  // Verify random access
  let readCorrect = true
  for (let i = 0; i < 100; i++) {
    const idx = Math.floor(Math.random() * 10000)
    const record = coll.get(ids[idx])
    if (!record || record.name !== `User ${idx}`) {
      readCorrect = false
      break
    }
  }

  assert(readCorrect, '5b. 10K records random access',
    'Random access returned wrong data')

  console.log(`        (10K inserts: ${insertMs.toFixed(1)}ms, count: ${coll.count()})`)
}

// 5c. Large persist roundtrip (5K records)
{
  cleanup('scale-persist')
  const dir = `${BASE_DIR}/scale-persist`

  const writer = createPersistentCollection('scale-5k', {
    schema: {
      name: 'string' as const,
      age: 'number' as const,
      data: 'string' as const,
    },
    path: dir,
    autoSave: false,
  })

  const ids: string[] = []
  for (let i = 0; i < 5000; i++) {
    ids.push(writer.insert({
      name: `Record ${i}`,
      age: i,
      data: `payload-${i}-${'x'.repeat(50)}`,
    }))
  }

  const saveStart = Bun.nanoseconds()
  await writer.save()
  const saveMs = (Bun.nanoseconds() - saveStart) / 1_000_000
  writer.close()

  // Reload
  const reader = createPersistentCollection('scale-5k-read', {
    schema: { name: 'string' as const, age: 'number' as const, data: 'string' as const },
    path: dir,
    autoSave: false,
  })

  const loadStart = Bun.nanoseconds()
  const loaded = await reader.load()
  const loadMs = (Bun.nanoseconds() - loadStart) / 1_000_000

  // Verify integrity
  let integrityOk = true
  let mismatchIndex = -1
  for (let i = 0; i < 5000; i++) {
    const record = reader.get(ids[i])
    if (!record || record.name !== `Record ${i}` || record.age !== i) {
      integrityOk = false
      mismatchIndex = i
      break
    }
  }

  assert(integrityOk && loaded === 5000,
    '5c. 5K records persist roundtrip',
    `loaded=${loaded}, integrity=${integrityOk}${mismatchIndex >= 0 ? ` (first mismatch at ${mismatchIndex})` : ''}`)

  console.log(`        (save: ${saveMs.toFixed(0)}ms, load: ${loadMs.toFixed(0)}ms)`)

  reader.close()
}

// 5d. Concurrent autoSave storm - 1000 inserts as fast as possible
{
  cleanup('autosave-storm')
  const dir = `${BASE_DIR}/autosave-storm`

  const coll = createPersistentCollection('storm', {
    schema: { idx: 'number' as const },
    path: dir,
    autoSave: true,
  })

  const ids: string[] = []
  for (let i = 0; i < 1000; i++) {
    ids.push(coll.insert({ idx: i }))
  }

  // Wait for all writes
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    if (countFiles(dir) >= 1000) break
    await Bun.sleep(10)
  }

  const filesOnDisk = countFiles(dir)
  assert(filesOnDisk === 1000,
    '5d. autoSave storm (1000 concurrent writes)',
    `Only ${filesOnDisk}/1000 files landed on disk`)

  coll.close()
}

// =============================================================================
// 6. EDGE CASES
// =============================================================================

console.log('\n--- 6. EDGE CASES ---\n')

// 6a. Insert with no data (all defaults)
{
  const coll = createCollection('defaults', {
    schema: { name: 'string' as const, age: 'number' as const, active: 'boolean' as const },
  })

  const id = coll.insert({} as any)
  const record = coll.get(id)

  assert(
    record !== undefined && record.name === '' && record.age === 0 && record.active === false,
    '6a. Insert with empty data (defaults)',
    `Got: name=${record?.name}, age=${record?.age}, active=${record?.active}`
  )
}

// 6b. Update non-existent record
{
  const coll = createCollection('no-exist', {
    schema: { name: 'string' as const },
  })

  const result = coll.update('fake-id', { name: 'test' })
  assert(result === false, '6b. Update non-existent record returns false',
    `Expected false, got ${result}`)
}

// 6c. Delete non-existent record
{
  const coll = createCollection('no-exist-del', {
    schema: { name: 'string' as const },
  })

  const result = coll.delete('fake-id')
  assert(result === false, '6c. Delete non-existent record returns false',
    `Expected false, got ${result}`)
}

// 6d. Get from empty collection
{
  const coll = createCollection('empty', {
    schema: { name: 'string' as const },
  })

  const record = coll.get('any-id')
  const all = coll.all()
  const count = coll.count()

  assert(record === undefined && all.length === 0 && count === 0,
    '6d. Operations on empty collection',
    `get=${record}, all.length=${all.length}, count=${count}`)
}

// 6e. Very large string field
{
  const coll = createCollection('large-string', {
    schema: { data: 'string' as const },
  })

  const bigString = 'A'.repeat(1_000_000) // 1MB string
  const id = coll.insert({ data: bigString })
  const record = coll.get(id)

  assert(record?.data.length === 1_000_000,
    '6e. 1MB string field',
    `Expected length 1000000, got ${record?.data.length}`)
}

// 6f. Special unicode characters
await testRoundtrip(
  '6f. Unicode string roundtrip',
  { val: 'string' },
  { val: 'Hello 🌍 世界 مرحبا Привет 日本語' },
  'val', 'Hello 🌍 世界 مرحبا Привет 日本語'
)

// 6g. Concurrent save() calls
{
  cleanup('concurrent-save')
  const dir = `${BASE_DIR}/concurrent-save`

  const coll = createPersistentCollection('concurrent', {
    schema: { name: 'string' as const },
    path: dir,
    autoSave: false,
  })

  for (let i = 0; i < 100; i++) {
    coll.insert({ name: `record-${i}` })
  }

  // Fire multiple saves concurrently
  const results = await Promise.all([
    coll.save(),
    coll.save(),
    coll.save(),
  ])

  const files = countFiles(dir)
  assert(files === 100,
    '6g. Concurrent save() calls',
    `Expected 100 files, got ${files}. Results: ${results.join(', ')}`)

  coll.close()
}

// =============================================================================
// SUMMARY
// =============================================================================

console.log('\n' + '='.repeat(70))
console.log(`\n  RESULTS: ${passed} passed, ${failed} failed, ${warnings} warnings\n`)

if (failures.length > 0) {
  console.log('  FAILURES:')
  for (const f of failures) {
    console.log(`    \x1b[31m- ${f}\x1b[0m`)
  }
  console.log()
}

if (warningList.length > 0) {
  console.log('  WARNINGS (potential issues):')
  for (const w of warningList) {
    console.log(`    \x1b[33m- ${w}\x1b[0m`)
  }
  console.log()
}

console.log('='.repeat(70) + '\n')

// Cleanup
try { rmSync(BASE_DIR, { recursive: true }) } catch {}
