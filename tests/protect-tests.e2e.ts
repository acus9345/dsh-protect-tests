import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pluginEntry, runDsh } from './helpers/dsh.ts'

const plugin = { id: 'protect-tests', entry: pluginEntry }
const spec = "import { sum } from './sum'\n\ntest('adds', () => {\n  expect(sum(1, 2)).toBe(3)\n})\n"

test('skipping a failing test is blocked; fixing the code is not', async () => {
  const run = await runDsh({
    plugins: [plugin],
    files: { 'src/sum.test.ts': spec, 'src/sum.ts': 'export const sum = (a: number, b: number) => a - b\n' },
    readAfter: ['src/sum.test.ts', 'src/sum.ts'],
    script: [
      { tool: 'read', input: { file_path: 'src/sum.test.ts' } },
      { tool: 'edit', input: { file_path: 'src/sum.test.ts', old_string: "test('adds'", new_string: "test.skip('adds'" } },
      { tool: 'read', input: { file_path: 'src/sum.ts' } },
      { tool: 'edit', input: { file_path: 'src/sum.ts', old_string: 'a - b', new_string: 'a + b' } },
    ],
  })
  assert.equal(run.exitCode, 0, run.stderr)
  assert.match(run.toolResults[1]!.result, /protect-tests blocked this change to src\/sum\.test\.ts/)
  assert.match(run.toolResults[1]!.result, /skip/)
  assert.equal(run.toolResults[3]!.status, 'completed')
  assert.equal(run.filesAfter['src/sum.test.ts'], spec)
  assert.match(run.filesAfter['src/sum.ts']!, /a \+ b/)
})

test('deleting a test file from the shell is blocked', async () => {
  const run = await runDsh({
    plugins: [plugin],
    files: { 'src/sum.test.ts': spec },
    readAfter: ['src/sum.test.ts'],
    script: [{ tool: 'bash', input: { description: 'Delete test', command: 'rm src/sum.test.ts' } }],
  })
  assert.equal(run.exitCode, 0, run.stderr)
  assert.match(run.toolResults[0]!.result, /deletes test files: src\/sum\.test\.ts/)
  assert.equal(run.filesAfter['src/sum.test.ts'], spec)
})

test('works when installed with `dsh plugin add`', async () => {
  const run = await runDsh({
    installed: true,
    files: { 'src/sum.test.ts': spec },
    script: [{ tool: 'bash', input: { description: 'Delete test', command: 'rm src/sum.test.ts' } }],
  })
  assert.equal(run.exitCode, 0, run.stderr)
  assert.match(run.toolResults[0]!.result, /protect-tests blocked/)
})
