/**
 * Markdown Persistence
 *
 * Parse and generate markdown files with YAML frontmatter.
 * Uses Bun file APIs when available, falls back to Node.js fs/promises.
 */

import type { SchemaDefinition, SchemaToRecord, RecordWithMeta } from '../core/types'
import { parseColumnType } from '../core/columns'

// =============================================================================
// Runtime Detection & File I/O Helpers
// =============================================================================

/** Check if running in Bun runtime */
const isBun = typeof Bun !== 'undefined'

/** Read file contents as text */
async function readFileText(filepath: string): Promise<string | null> {
  if (isBun) {
    const file = Bun.file(filepath)
    if (!(await file.exists())) return null
    return await file.text()
  } else {
    const fs = await import('fs/promises')
    try {
      return await fs.readFile(filepath, 'utf-8')
    } catch {
      return null
    }
  }
}

/** Write content to file */
async function writeFile(filepath: string, content: string): Promise<boolean> {
  if (isBun) {
    await Bun.write(filepath, content)
    return true
  } else {
    const fs = await import('fs/promises')
    await fs.writeFile(filepath, content, 'utf-8')
    return true
  }
}

/** List markdown files in directory */
function listMarkdownFiles(dirpath: string): string[] {
  if (isBun) {
    const glob = new Bun.Glob('*.md')
    return Array.from(glob.scanSync({ cwd: dirpath }))
  } else {
    // Node.js fallback - synchronous readdir
    const fs = require('fs')
    try {
      const files = fs.readdirSync(dirpath) as string[]
      return files.filter((f: string) => f.endsWith('.md'))
    } catch {
      return []
    }
  }
}

// =============================================================================
// Filename Utilities
// =============================================================================

/** Convert an ID to a safe filename (reversible via percent-encoding) */
export function idToFilename(id: string): string {
  // Percent-encode any character that isn't safe for filenames.
  // Safe chars: alphanumeric, hyphen, underscore, dot (but not leading dot).
  // This is reversible - filenameToId can decode back to the original ID.
  const encoded = id.replace(/[^a-zA-Z0-9\-_.]/g, (char) => {
    const code = char.charCodeAt(0)
    if (code > 0xff) {
      // Multi-byte: encode as %uXXXX
      return `%u${code.toString(16).padStart(4, '0')}`
    }
    return `%${code.toString(16).padStart(2, '0')}`
  })
  // Prevent hidden files (leading dot)
  const safe = encoded.startsWith('.') ? `%2e${encoded.slice(1)}` : encoded
  return safe + '.md'
}

/** Extract ID from a filename (decodes percent-encoding) */
export function filenameToId(filename: string): string {
  const withoutExt = filename.replace(/\.md$/, '')
  // Decode %uXXXX (multi-byte) and %XX (single-byte) sequences
  return withoutExt.replace(/%u([0-9a-fA-F]{4})|%([0-9a-fA-F]{2})/g, (_, quad, pair) => {
    return String.fromCharCode(parseInt(quad || pair, 16))
  })
}

// =============================================================================
// YAML Frontmatter Parsing
// =============================================================================

interface ParsedMarkdown {
  frontmatter: Record<string, unknown>
  content: string
}

/**
 * Parse a markdown file with YAML frontmatter
 *
 * Format:
 * ---
 * key: value
 * ---
 * Content here
 */
export function parseMarkdown(text: string): ParsedMarkdown {
  const frontmatter: Record<string, unknown> = {}
  let content = ''

  // Check for frontmatter
  if (!text.startsWith('---')) {
    return { frontmatter, content: text.trim() }
  }

  // Find end of frontmatter
  const endIndex = text.indexOf('\n---', 3)
  if (endIndex === -1) {
    return { frontmatter, content: text.trim() }
  }

  // Parse frontmatter (simple YAML-like parsing)
  const yamlText = text.slice(4, endIndex)
  const lines = yamlText.split('\n')

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const colonIndex = trimmed.indexOf(':')
    if (colonIndex === -1) continue

    const key = trimmed.slice(0, colonIndex).trim()
    let value = trimmed.slice(colonIndex + 1).trim()

    // Parse value
    frontmatter[key] = parseYamlValue(value)
  }

  // Extract content (after frontmatter)
  content = text.slice(endIndex + 4).trim()

  return { frontmatter, content }
}

/**
 * Parse a YAML value (simple implementation)
 */
function parseYamlValue(value: string): unknown {
  // Null
  if (value === 'null' || value === '~' || value === '') {
    return null
  }

  // Boolean
  if (value === 'true') return true
  if (value === 'false') return false

  // Special number values
  if (value === '.nan' || value === 'NaN') return NaN
  if (value === '.inf' || value === 'Infinity') return Infinity
  if (value === '-.inf' || value === '-Infinity') return -Infinity
  if (value === '-0.0' || value === '-0') return -0

  // Number
  if (/^-?\d+$/.test(value)) {
    return parseInt(value, 10)
  }
  if (/^-?\d+\.\d+$/.test(value)) {
    return parseFloat(value)
  }

  // Array (JSON format)
  if (value.startsWith('[') && value.endsWith(']')) {
    try {
      return JSON.parse(value)
    } catch {
      return value
    }
  }

  // Double-quoted string: use JSON.parse to properly handle escape sequences
  // (newlines, tabs, unicode, nested quotes)
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value)
    } catch {
      return value.slice(1, -1)
    }
  }

  // Single-quoted string (no escape sequences)
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1)
  }

  return value
}

// =============================================================================
// YAML Generation
// =============================================================================

/**
 * Convert a value to YAML format
 */
function toYamlValue(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null'
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }

  if (typeof value === 'number') {
    if (Number.isNaN(value)) return '.nan'
    if (value === Infinity) return '.inf'
    if (value === -Infinity) return '-.inf'
    if (Object.is(value, -0)) return '-0.0'
    return String(value)
  }

  if (Array.isArray(value)) {
    return JSON.stringify(value)
  }

  if (value instanceof Float32Array) {
    return JSON.stringify(Array.from(value))
  }

  if (typeof value === 'string') {
    // Always JSON.stringify strings to prevent ambiguity:
    // - empty string "" won't become null
    // - "123" won't become number
    // - "true"/"false"/"null" won't become boolean/null
    // - newlines get properly escaped
    // - colons, hashes, quotes all handled
    return JSON.stringify(value)
  }

  return JSON.stringify(value)
}

/**
 * Generate markdown with YAML frontmatter
 */
export function generateMarkdown<S extends SchemaDefinition>(
  record: RecordWithMeta<S>,
  schema: S,
  contentColumn?: keyof S
): string {
  const lines: string[] = ['---']

  // Always include id and timestamps
  lines.push(`id: ${toYamlValue(record.id)}`)
  lines.push(`created: ${record.created}`)
  lines.push(`updated: ${record.updated}`)

  // Add all schema columns (except content column)
  for (const key of Object.keys(schema) as (keyof S)[]) {
    if (key === contentColumn) continue

    const value = record[key as keyof RecordWithMeta<S>]
    lines.push(`${String(key)}: ${toYamlValue(value)}`)
  }

  lines.push('---')
  lines.push('')

  // Add content if there's a content column
  if (contentColumn) {
    const content = record[contentColumn as keyof RecordWithMeta<S>]
    if (typeof content === 'string') {
      lines.push(content)
    }
  }

  return lines.join('\n')
}

// =============================================================================
// File Operations (Bun APIs)
// =============================================================================

/**
 * Load a record from a markdown file
 */
export async function loadFromMarkdown<S extends SchemaDefinition>(
  filepath: string,
  schema: S,
  contentColumn?: keyof S
): Promise<{ id: string; record: Partial<RecordWithMeta<S>> } | null> {
  try {
    const text = await readFileText(filepath)
    if (text === null) {
      return null
    }

    const { frontmatter, content } = parseMarkdown(text)

    const id = frontmatter.id as string
    if (!id) {
      // Try to get ID from filename
      const filename = filepath.split('/').pop() || ''
      return null
    }

    const record: Partial<RecordWithMeta<S>> = {
      id,
      created: (frontmatter.created as number) || Date.now(),
      updated: (frontmatter.updated as number) || Date.now(),
      stale: false,
    } as Partial<RecordWithMeta<S>>

    // Load schema columns
    for (const key of Object.keys(schema) as (keyof S)[]) {
      if (key === contentColumn) {
        // Content comes from body
        (record as Record<string, unknown>)[key as string] = content
      } else if (key in frontmatter) {
        let value = frontmatter[key as string]

        // Coerce value to match schema type (safety net for legacy/hand-edited files)
        const parsed = parseColumnType(schema[key] as string)
        if (parsed.baseType === 'vector' && Array.isArray(value)) {
          value = new Float32Array(value as number[])
        } else if (parsed.baseType === 'string' && typeof value !== 'string') {
          value = value === null ? '' : String(value)
        } else if (parsed.baseType === 'number' && typeof value !== 'number') {
          value = Number(value) || 0
        } else if (parsed.baseType === 'boolean' && typeof value !== 'boolean') {
          value = value === 'true' || value === true
        }

        (record as Record<string, unknown>)[key as string] = value
      }
    }

    return { id, record }
  } catch {
    return null
  }
}

/**
 * Save a record to a markdown file
 */
export async function saveToMarkdown<S extends SchemaDefinition>(
  filepath: string,
  record: RecordWithMeta<S>,
  schema: S,
  contentColumn?: keyof S
): Promise<boolean> {
  try {
    const markdown = generateMarkdown(record, schema, contentColumn)
    return await writeFile(filepath, markdown)
  } catch {
    return false
  }
}

/**
 * Load all records from a directory
 */
export async function loadFromDirectory<S extends SchemaDefinition>(
  dirpath: string,
  schema: S,
  contentColumn?: keyof S
): Promise<{ id: string; record: Partial<RecordWithMeta<S>> }[]> {
  const results: { id: string; record: Partial<RecordWithMeta<S>> }[] = []

  try {
    const files = listMarkdownFiles(dirpath)

    for (const filename of files) {
      const filepath = `${dirpath}/${filename}`
      const result = await loadFromMarkdown(filepath, schema, contentColumn)
      if (result) {
        results.push(result)
      }
    }
  } catch {
    // Directory might not exist yet
  }

  return results
}

/**
 * Delete a markdown file
 */
export async function deleteMarkdownFile(filepath: string): Promise<boolean> {
  try {
    const fs = await import('fs/promises')
    await fs.unlink(filepath)
    return true
  } catch {
    return false
  }
}

/**
 * Ensure a directory exists
 */
export async function ensureDirectory(dirpath: string): Promise<void> {
  const fs = await import('fs/promises')
  await fs.mkdir(dirpath, { recursive: true })
}
