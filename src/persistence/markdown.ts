/**
 * Markdown Persistence
 *
 * Parse and generate markdown files with YAML frontmatter.
 * Uses Bun file APIs for fast I/O.
 */

import type { SchemaDefinition, SchemaToRecord, RecordWithMeta } from '../core/types'
import { parseColumnType } from '../core/columns'

// =============================================================================
// Filename Utilities
// =============================================================================

/** Convert an ID to a safe filename */
export function idToFilename(id: string): string {
  // Replace unsafe characters with underscores
  return id.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') + '.md'
}

/** Extract ID from a filename */
export function filenameToId(filename: string): string {
  return filename.replace(/\.md$/, '')
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

  // Quoted string
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
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
    return String(value)
  }

  if (Array.isArray(value)) {
    return JSON.stringify(value)
  }

  if (value instanceof Float32Array) {
    return JSON.stringify(Array.from(value))
  }

  if (typeof value === 'string') {
    // Quote if contains special chars
    if (value.includes(':') || value.includes('#') || value.includes('\n') ||
        value.startsWith('"') || value.startsWith("'") ||
        value === 'true' || value === 'false' || value === 'null') {
      return JSON.stringify(value)
    }
    return value
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
    const file = Bun.file(filepath)
    if (!(await file.exists())) {
      return null
    }

    const text = await file.text()
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

        // Convert arrays to Float32Array for vector columns
        const parsed = parseColumnType(schema[key] as string)
        if (parsed.baseType === 'vector' && Array.isArray(value)) {
          value = new Float32Array(value as number[])
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
    await Bun.write(filepath, markdown)
    return true
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
    const glob = new Bun.Glob('*.md')
    const files = glob.scanSync({ cwd: dirpath })

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
