/**
 * dsh-protect-tests: catches an agent making tests pass by testing less.
 *
 * Runs on `tools/pre-execute`. For edits to test files it compares old and
 * new text and blocks changes that add skips, drop assertions or test
 * cases, add assertions that cannot fail, comment assertions out, or swallow
 * failures. It also blocks `rm` of test files and `package.json` test
 * scripts that can no longer fail. The model is told what it changed and
 * asked to fix the code instead; an identical retry confirms an intentional
 * change, and the reason makes it say why.
 *
 * @module dsh-protect-tests
 */
import { createHash } from 'node:crypto'
import { basename } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import { detectTamper, detectTestScriptTamper, SIGNAL_KINDS, type Signal, type SignalKind } from './detect.ts'
import { fileMutation, readExisting, resolvePath, workspaceOf } from './shared/files.ts'
import { matchesAny } from './shared/glob.ts'

export { detectTamper, detectTestScriptTamper, SIGNAL_KINDS } from './detect.ts'
export type { Signal, SignalKind, TamperOptions } from './detect.ts'

export const name = 'protect-tests'

/** Default globs that identify test files across common ecosystems. */
export const DEFAULT_TEST_GLOBS: readonly string[] = [
  '*.test.*', '*.spec.*', '*_test.*', '*_spec.*', 'test_*.py', '*Test.java', '*Tests.java', '*Test.kt', '*Tests.cs', '*Test.php', '*Tests.swift',
  '**/__tests__/**', '**/tests/**', '**/test/**', '**/spec/**', '**/e2e/**', 'conftest.py',
]

/** Plugin configuration. */
export interface Config {
  mode: 'deny' | 'ask'
  /** Globs (workspace-relative) for test files; `!pattern` excludes. */
  testFiles: string[]
  /** Fewest assertions an edit must remove before it is reported. */
  minAssertionsRemoved: number
  /** Fewest test cases an edit must remove before it is reported. */
  minTestsRemoved: number
  /** Signals to ignore. */
  disabledSignals: SignalKind[]
  /** Block `rm`/`git rm` of test files from the shell. */
  guardDeletes: boolean
  /** Block `package.json` test scripts that cannot fail. */
  guardTestScript: boolean
  /** Let an identical retry through as a confirmation. */
  allowIdenticalRetry: boolean
  /** Shell tool names checked for deletes. */
  shellTools: string[]
  maxFileBytes: number
}

export const Config: Schema<Config> = Schema.object({
  mode: Schema.union(['deny', 'ask']).default('deny'),
  testFiles: Schema.array(Schema.string()).default([...DEFAULT_TEST_GLOBS]),
  minAssertionsRemoved: Schema.natural().min(1).default(2),
  minTestsRemoved: Schema.natural().min(1).default(1),
  disabledSignals: Schema.array(Schema.union([...SIGNAL_KINDS])).default([]),
  guardDeletes: Schema.boolean().default(true),
  guardTestScript: Schema.boolean().default(true),
  allowIdenticalRetry: Schema.boolean().default(true),
  shellTools: Schema.array(Schema.string()).default(['bash']),
  maxFileBytes: Schema.natural().default(2_000_000),
}) as Schema<Config>

const FOOTER_RETRY = 'If the test itself is wrong (the requirement changed, or it tested a bug), tell the user which test you are changing and why, then repeat the identical call once to confirm.'

/**
 * Render the model-facing reason.
 * @param target - path or command being blocked.
 * @param signals - what was detected.
 * @param retryAllowed - whether an identical retry is accepted.
 * @returns the denial text.
 */
export function denialText(target: string, signals: readonly Signal[], retryAllowed: boolean): string {
  const lines = signals.map(s => `- ${s.detail}${s.examples.length > 0 ? `: ${s.examples.map(e => `\`${e}\``).join(', ')}` : ''}`).join('\n')
  return `dsh-protect-tests blocked this change to ${target} because it makes the tests check less:\n${lines}\n`
    + 'Tests should keep failing until the code is fixed. Fix the implementation instead, or make the test more accurate without weakening it. '
    + (retryAllowed ? FOOTER_RETRY : 'If the test really must change, ask the user first.')
}

/** Paths an `rm`/`git rm`/`unlink` command would delete. */
export function deletedPaths(command: string): string[] {
  const out: string[] = []
  const re = /(?:^|[;&|(]\s*|\s(?:sudo|xargs)\s+)(?:git\s+rm|rm|unlink|trash|shred)\s+([^;&|)\n]+)/g
  for (const m of command.matchAll(re)) {
    for (const word of m[1]!.trim().split(/\s+/)) {
      const w = word.replace(/^['"]|['"]$/g, '')
      if (w.length === 0 || w.startsWith('-') || w === '--' || /^[<>]/.test(w)) continue
      out.push(w)
    }
  }
  return out
}

export function apply(ctx: Context, config: Config): void {
  const pending = new Set<string>()
  const remember = (key: string): void => {
    pending.add(key)
    if (pending.size > 200) pending.delete(pending.values().next().value!)
  }
  const isTestFile = (rel: string): boolean => !rel.startsWith('../') && matchesAny(rel, config.testFiles)
  const shellTools = new Set(config.shellTools)

  const decide = (key: string, target: string, signals: Signal[], next: () => Promise<PreToolDecision>): Promise<PreToolDecision> | PreToolDecision => {
    if (signals.length === 0) return next()
    const text = denialText(target, signals, config.allowIdenticalRetry)
    if (config.mode === 'ask') {
      return { kind: 'ask', reason: text, displayReason: { en: `This change weakens tests in ${target}: ${signals.map(s => s.detail).join('; ')}.` } }
    }
    if (config.allowIdenticalRetry) remember(key)
    return { kind: 'deny', reason: text }
  }

  ctx.on('tools/pre-execute', async (exec: ToolExecution, next: () => Promise<PreToolDecision>) => {
    const key = createHash('sha256').update(`${exec.name}\0${JSON.stringify(exec.arguments)}\0${workspaceOf(exec)}`).digest('hex')
    if (config.allowIdenticalRetry && pending.delete(key)) return next()

    if (shellTools.has(exec.name) && config.guardDeletes) {
      const command = (exec.arguments as { command?: unknown } | null)?.command
      if (typeof command !== 'string') return next()
      const workspace = workspaceOf(exec)
      const hits = deletedPaths(command).map(p => resolvePath(p, workspace).relative).filter(rel => isTestFile(rel) || isTestFile(`${rel}/x.test.js`) || /(^|\/)(tests?|__tests__|spec)$/.test(rel))
      if (hits.length === 0) return next()
      return decide(key, `\`${command}\``, [{ kind: 'fewer-tests', detail: `deletes test files: ${hits.slice(0, 5).join(', ')}`, examples: [] }], next)
    }

    const mutation = fileMutation(exec)
    if (mutation === undefined) return next()
    const { absolute, relative } = resolvePath(mutation.path, workspaceOf(exec))
    const previous = mutation.kind === 'write' ? (await readExisting(absolute, config.maxFileBytes)) ?? '' : mutation.oldText ?? ''

    if (config.guardTestScript && basename(relative) === 'package.json') {
      // Edits carry only a span; compare the span or the whole manifest.
      const signal = detectTestScriptTamper(previous, mutation.newText)
      return decide(key, relative, signal === undefined ? [] : [signal], next)
    }
    if (!isTestFile(relative)) return next()
    const signals = detectTamper(previous, mutation.newText, {
      minAssertionsRemoved: config.minAssertionsRemoved,
      minTestsRemoved: config.minTestsRemoved,
      disabledSignals: config.disabledSignals,
    })
    return decide(key, relative, signals, next)
  })
}
