import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canonicalJson } from '../src/shared/files.ts'

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
