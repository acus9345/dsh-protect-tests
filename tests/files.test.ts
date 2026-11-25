import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import { apply, DEFAULT_TEST_GLOBS } from '../src/index.ts'
import { canonicalJson, fileMutation } from '../src/shared/files.ts'
import { matchesAny } from '../src/shared/glob.ts'

test('canonicalJson ignores key order, so a reordered retry counts as identical', () => {
  // Seen in the desktop app: the retry of a blocked edit came back with its keys in a different order.
  const first = { file_path: 'db/query.sql.go', old_string: 'a', new_string: 'b' }
  const retry = { file_path: 'db/query.sql.go', new_string: 'b', old_string: 'a' }
  assert.equal(canonicalJson(first), canonicalJson(retry))
  assert.equal(canonicalJson({ b: { y: 1, x: [2, { d: 1, c: 2 }] }, a: null }), canonicalJson({ a: null, b: { x: [2, { c: 2, d: 1 }], y: 1 } }))
})

test('canonicalJson still tells different calls apart', () => {
  assert.notEqual(canonicalJson({ new_string: 'b' }), canonicalJson({ new_string: 'c' }))
  assert.notEqual(canonicalJson({ x: [1, 2] }), canonicalJson({ x: [2, 1] }))
})

test('fileMutation recognises str_replace_editor str_replace when new_str is omitted', () => {
  assert.deepEqual(
    fileMutation({ name: 'str_replace_editor', arguments: { command: 'str_replace', path: '/ws/a.test.ts', old_str: 'expect(1).toBe(1)' } }),
    { path: '/ws/a.test.ts', kind: 'edit', newText: '', oldText: 'expect(1).toBe(1)' },
  )
})

test('matchesAny tolerates malformed or blank globs without throwing', () => {
  assert.equal(matchesAny('src/a.py', ['', '   ', '!', '*.{ts,js', '[z-a]']), false)
  assert.equal(matchesAny('src/a.test.ts', [' *.test.* ']), true)
  assert.equal(matchesAny('dist/__dir_probe__', ['*.test.*', '**/tests/**']), false)
  assert.equal(matchesAny('tests/__dir_probe__', ['*.test.*', '**/tests/**']), true)
})

function makeGate(cwd: string) {
  let handler: ((exec: ToolExecution, next: () => Promise<PreToolDecision>) => Promise<PreToolDecision>) | undefined
  const ctx = { on: (_ev: string, fn: typeof handler) => { handler = fn } } as unknown as Context
  apply(ctx, {
    mode: 'deny',
    testFiles: [...DEFAULT_TEST_GLOBS],
    minAssertionsRemoved: 2,
    minTestsRemoved: 1,
    disabledSignals: [],
    guardDeletes: true,
    guardTestScript: true,
    allowIdenticalRetry: true,
    shellTools: ['bash', 'pwsh'],
    maxFileBytes: 2_000_000,
  })
  return (name: string, args: Record<string, unknown>) =>
    handler!({ name, arguments: args, agent: { session: { header: { cwd } } } } as unknown as ToolExecution, async () => ({ kind: 'allow' }))
}

test('apply allows non-test deletes, handles str_replace deletions, and blocks workdir test deletes and $-containing package.json edits', async () => {
  const ws = await mkdtemp(join(tmpdir(), 'dsh-protect-unit-'))
  try {
    await writeFile(join(ws, 'package.json'), '{"scripts":{"test":"vitest run"}}\n')
    const run = makeGate(ws)
    assert.equal((await run('bash', { command: 'rm src/helper.ts' })).kind, 'allow')
    assert.equal((await run('bash', { command: 'rm -rf dist' })).kind, 'allow')
    assert.equal((await run('bash', { command: 'rm unit.ts', workdir: 'tests' })).kind, 'deny')
    assert.equal((await run('bash', { command: 'rm -rf tests' })).kind, 'deny')
    assert.equal((await run('bash', { command: 'rm a.test.ts', workdir: '/tmp/outside-ws' })).kind, 'allow')
    if (process.platform === 'win32') {
      const otherDrive = ws[0]!.toUpperCase() === 'D' ? 'C:\\outside\\a.test.ts' : 'D:\\outside\\a.test.ts'
      assert.equal((await run('bash', { command: `Remove-Item ${otherDrive}` })).kind, 'allow')
    }
    const strReplace = await run('str_replace_editor', {
      command: 'str_replace',
      path: join(ws, 'a.test.ts'),
      old_str: 'expect(1).toBe(1)\nexpect(2).toBe(2)',
    })
    assert.equal(strReplace.kind, 'deny')
    const pkgEdit = await run('edit', {
      file_path: 'package.json',
      old_string: '"vitest run"',
      new_string: '"echo $$"',
    })
    assert.equal(pkgEdit.kind, 'deny')
  } finally {
    await rm(ws, { recursive: true, force: true })
  }
})
