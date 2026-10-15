import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectTamper, detectTestScriptTamper } from '../src/detect.ts'
import { deletedPaths } from '../src/index.ts'

const opts = { minAssertionsRemoved: 2, minTestsRemoved: 1 }
const kinds = (oldText: string, newText: string) => detectTamper(oldText, newText, opts).map(s => s.kind)

const jsOld = `describe('sum', () => {
  it('adds', () => {
    expect(sum(1, 2)).toBe(3)
    expect(sum(-1, 1)).toBe(0)
  })
  it('handles floats', () => {
    expect(sum(0.1, 0.2)).toBeCloseTo(0.3)
  })
})`

test('adding .skip is flagged', () => {
  assert.deepEqual(kinds(jsOld, jsOld.replace("it('handles floats'", "it.skip('handles floats'")), ['skip'])
})

test('xit and .only are flagged', () => {
  assert.ok(kinds(jsOld, jsOld.replace("it('adds'", "xit('adds'")).includes('skip'))
  assert.ok(kinds(jsOld, jsOld.replace("it('adds'", "it.only('adds'")).includes('skip'))
})

test('deleting assertions is flagged', () => {
  const weaker = jsOld.replace("    expect(sum(1, 2)).toBe(3)\n    expect(sum(-1, 1)).toBe(0)\n", '')
  assert.ok(kinds(jsOld, weaker).includes('fewer-assertions'))
})

test('deleting a test case is flagged', () => {
  const fewer = jsOld.replace(/  it\('handles floats'[\s\S]*?\n  \}\)\n/, '')
  assert.ok(kinds(jsOld, fewer).includes('fewer-tests'))
})

test('commenting out an assertion is flagged', () => {
  assert.ok(kinds(jsOld, jsOld.replace('    expect(sum(1, 2)).toBe(3)', '    // expect(sum(1, 2)).toBe(3)')).includes('commented-assert'))
})

test('trivial assertions are flagged', () => {
  assert.ok(kinds(jsOld, jsOld.replace('expect(sum(1, 2)).toBe(3)', 'expect(true).toBe(true)')).includes('trivial-assert'))
  assert.ok(kinds('def test_a():\n    assert add(1, 2) == 3\n', 'def test_a():\n    assert True\n').includes('trivial-assert'))
})

test('weakening to toBeDefined is flagged', () => {
  assert.ok(kinds(jsOld, jsOld.replace('expect(sum(1, 2)).toBe(3)', 'expect(sum(1, 2)).toBeDefined()')).includes('weaker-assert'))
})

test('swallowing failures is flagged', () => {
  const py = 'def test_a():\n    assert add(1, 2) == 3\n'
  const swallowed = 'def test_a():\n    try:\n        assert add(1, 2) == 3\n    except AssertionError: pass\n'
  assert.ok(kinds(py, swallowed).includes('swallowed-failure'))
})

test('python skip markers are flagged', () => {
  const py = 'def test_a():\n    assert add(1, 2) == 3\n'
  assert.ok(kinds(py, '@pytest.mark.skip(reason="flaky")\n' + py).includes('skip'))
  assert.ok(kinds(py, py.replace('    assert', '    pytest.skip("later")\n    assert')).includes('skip'))
})

test('go t.Skip is flagged', () => {
  const go = 'func TestAdd(t *testing.T) {\n\tif Add(1, 2) != 3 {\n\t\tt.Errorf("bad")\n\t}\n}\n'
  assert.ok(kinds(go, go.replace('{\n\tif', '{\n\tt.Skip("todo")\n\tif')).includes('skip'))
})

test('honest edits pass', () => {
  // Changing an expected value, adding a test, renaming, adding assertions.
  assert.deepEqual(kinds(jsOld, jsOld.replace('toBe(3)', 'toBe(4)')), [])
  assert.deepEqual(kinds(jsOld, jsOld + "\nit('negatives', () => { expect(sum(-1, -1)).toBe(-2) })"), [])
  assert.deepEqual(kinds(jsOld, jsOld.replace("'adds'", "'adds two numbers'")), [])
  assert.deepEqual(kinds('', jsOld), [])
  // Merging two expects into one toEqual loses one assertion: below threshold.
  assert.deepEqual(kinds("expect(a).toBe(1)\nexpect(b).toBe(2)", 'expect([a, b]).toEqual([1, 2])'), [])
})

test('test script neutering is detected', () => {
  assert.ok(detectTestScriptTamper('{"scripts":{"test":"vitest run"}}', '{"scripts":{"test":"echo ok"}}'))
  assert.ok(detectTestScriptTamper('{"scripts":{"test":"jest"}}', '{"scripts":{"test":"jest || true"}}'))
  assert.ok(detectTestScriptTamper('{"scripts":{"test":"jest"}}', '{"scripts":{"test":"jest --passWithNoTests"}}'))
  assert.equal(detectTestScriptTamper('{"scripts":{"test":"jest"}}', '{"scripts":{"test":"vitest run"}}'), undefined)
  assert.equal(detectTestScriptTamper('{"name":"x"}', '{"name":"y"}'), undefined)
})

test('deletedPaths finds rm targets', () => {
  assert.deepEqual(deletedPaths('rm -f src/a.test.ts && npm test'), ['src/a.test.ts'])
  assert.deepEqual(deletedPaths('git rm -r tests/'), ['tests/'])
  assert.deepEqual(deletedPaths('echo hi'), [])
})

const opts = { minAssertionsRemoved: 2, minTestsRemoved: 1 }

test('honest refactors pass: table-driven tests, merged checks, helpers', () => {
  const two = "test('adds 1', () => {\n  expect(sum(1, 1)).toBe(2)\n})\ntest('adds 2', () => {\n  expect(sum(2, 2)).toBe(4)\n})\n"
  assert.deepEqual(detectTamper(two, "test.each([[1, 2], [2, 4]])('adds %i', (a, want) => {\n  expect(sum(a, a)).toBe(want)\n})\n", opts), [])
  assert.deepEqual(detectTamper('def test_one():\n    assert f(1) == 1\n\ndef test_two():\n    assert f(2) == 2\n', "@pytest.mark.parametrize('n', [1, 2])\ndef test_f(n):\n    assert f(n) == n\n", opts), [])
  const three = "test('p', () => {\n  expect(p.x).toBe(1)\n  expect(p.y).toBe(2)\n  expect(p.z).toBe(3)\n})\n"
  assert.deepEqual(detectTamper(three, "test('p', () => {\n  expect(p).toEqual({ x: 1, y: 2, z: 3 })\n})\n", opts), [])
  assert.deepEqual(detectTamper(three, "test('p', () => {\n  expectPoint(p, 1, 2, 3)\n})\n", opts), [])
})

test('dropping checks without a structural replacement is still caught', () => {
  const three = "test('r', () => {\n  expect(res.body.id).toBe(7)\n  expect(res.body.name).toBe('a')\n  expect(res.status).toBe(200)\n})\n"
  const kinds = detectTamper(three, "test('r', () => {\n  expect(res.ok).toBe(true)\n})\n", opts).map(s => s.kind)
  assert.ok(kinds.includes('fewer-assertions'), kinds.join())
})
