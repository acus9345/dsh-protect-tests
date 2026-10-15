/**
 * Helpers shared by the file-edit guards: extract the target path and new
 * text from the built-in edit tools, resolve it against the session
 * workspace, and read the current file content.
 */
import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'

/** What a file-mutating tool call intends to do. */
export interface FileMutation {
  /** Path as the model wrote it. */
  path: string
  /** `write`/`create` replaces the whole file; `edit` replaces a span. */
  kind: 'write' | 'edit'
  /** New text being introduced (whole file for writes, replacement for edits). */
  newText: string
  /** Text being replaced (edits only). */
  oldText?: string
}

/**
 * Recognise the built-in mutation tools: `write`, `edit`, and `str_replace_editor`.
 * @param exec - the pending tool execution.
 * @returns the mutation, or undefined for any other call.
 */
export function fileMutation(exec: Pick<ToolExecution, 'name' | 'arguments'>): FileMutation | undefined {
  const a = exec.arguments as Record<string, unknown> | null
  if (a === null || typeof a !== 'object') return undefined
  const str = (k: string): string | undefined => (typeof a[k] === 'string' ? a[k] as string : undefined)
  if (exec.name === 'write') {
    const path = str('file_path')
    const content = str('content')
    return path !== undefined && content !== undefined ? { path, kind: 'write', newText: content } : undefined
  }
  if (exec.name === 'edit') {
    const path = str('file_path')
    const next = str('new_string')
    return path !== undefined && next !== undefined ? { path, kind: 'edit', newText: next, oldText: str('old_string') ?? '' } : undefined
  }
  if (exec.name === 'str_replace_editor') {
    const path = str('path')
    const command = str('command')
    if (path === undefined) return undefined
    if (command === 'create' && str('file_text') !== undefined) return { path, kind: 'write', newText: str('file_text')! }
    if (command === 'str_replace' && str('new_str') !== undefined) return { path, kind: 'edit', newText: str('new_str')!, oldText: str('old_str') ?? '' }
    if (command === 'insert' && str('new_str') !== undefined) return { path, kind: 'edit', newText: str('new_str')!, oldText: '' }
  }
  return undefined
}

/**
 * The session workspace for a call.
 * @param exec - the tool execution.
 * @returns the session cwd, falling back to the process cwd.
 */
export function workspaceOf(exec: Pick<ToolExecution, 'agent'>): string {
  return exec.agent?.session.header.cwd ?? process.cwd()
}

/**
 * Resolve a model path to absolute and workspace-relative forms.
 * @param path - path from the tool arguments.
 * @param workspace - session workspace directory.
 * @returns absolute path and POSIX relative path (`../` prefixed when outside).
 */
export function resolvePath(path: string, workspace: string): { absolute: string; relative: string } {
  const absolute = isAbsolute(path) ? path : resolve(workspace, path)
  return { absolute, relative: relative(workspace, absolute).split(sep).join('/') }
}

/**
 * Read a text file if it exists and is small enough.
 * @param absolute - absolute path.
 * @param maxBytes - size cap; larger files return undefined.
 * @returns the content, or undefined when absent, too large, or unreadable.
 */
export async function readExisting(absolute: string, maxBytes: number): Promise<string | undefined> {
  try {
    const info = await stat(absolute)
    if (!info.isFile() || info.size > maxBytes) return undefined
    const text = await readFile(absolute, 'utf8')
    return text.includes('\u0000') ? undefined : text
  } catch {
    // Absent or unreadable files have no prior content to compare against.
    return undefined
  }
}

/**
 * Serialize a value with object keys sorted, so two tool calls with the same
 * arguments in a different key order produce the same text. Used to recognise
 * an identical retry: models often resend an edit with its keys reordered.
 * @param value - JSON-compatible value (tool arguments).
 * @returns canonical JSON text.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v)
}
