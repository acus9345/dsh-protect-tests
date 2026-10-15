/**
 * Detection of edits that weaken tests.
 *
 * Compares the text being replaced with the new text and reports signals
 * that the change makes tests pass by testing less: new skip markers,
 * fewer assertions or test cases, trivially true assertions, commented-out
 * assertions, and swallowed assertion failures. It is language-agnostic and
 * pattern based, so it is tuned toward signals that rarely appear in honest
 * edits.
 */

/** Signal kinds; usable in `disabledSignals`. */
export type SignalKind = 'skip' | 'fewer-assertions' | 'fewer-tests' | 'trivial-assert' | 'commented-assert' | 'swallowed-failure' | 'weaker-assert'

/** All signal kinds. */
export const SIGNAL_KINDS: readonly SignalKind[] = ['skip', 'fewer-assertions', 'fewer-tests', 'trivial-assert', 'commented-assert', 'swallowed-failure', 'weaker-assert']

/** One reason the edit looks like it weakens tests. */
export interface Signal {
  kind: SignalKind
  /** Human-readable detail, e.g. "assertions 7 → 3". */
  detail: string
  /** Example lines from the new text, when relevant. */
  examples: string[]
}

const SKIP = [
  /\b(?:it|test|describe|context|suite|bench)\.(?:skip|only|todo|fails)\s*\(/,
  /\b(?:xit|xtest|xdescribe|xcontext|xspecify)\s*\(/,
  /@pytest\.mark\.(?:skip|skipif|xfail)\b/,
  /\bpytest\.(?:skip|xfail)\s*\(/,
  /@unittest\.(?:skip|skipIf|skipUnless|expectedFailure)\b/,
  /\bself\.skipTest\s*\(/,
  /\bt\.Skip(?:f|Now)?\s*\(/,
  /@(?:Disabled|Ignore)\b/,
  /#\[ignore\]/,
  /\[(?:Ignore|Explicit)(?:\(|\])/,
  /\[(?:Fact|Theory)\s*\([^)]*Skip\s*=/,
  /\bskip\s*\(\s*['"]/,
  /\bpending\s*\(?\s*['"]/,
  /\bmarkTestSkipped\s*\(/,
  /\bXCTSkip(?:If|Unless)?\b/,
]

const ASSERT = /\b(?:expect|assert\w*|assume\w*|should|must|require\.\w+|t\.(?:Error|Errorf|Fatal|Fatalf|Fail|FailNow)|XCTAssert\w*|assert_\w+!?|Assert\.\w+|Assertions\.\w+|verify|check)\s*\(|\bassert\s+[^=\s]|\.should\.|\.to\.(?:be|equal|eql|have|include|deep|throw)\b|\bexpect\s*\{|\bassert!\s*\(|\b(?:expect|assert|check|verify)[A-Z]\w*\s*\(/g

const TEST_DECL = /(?:^|[^.\w])x?(?:it|test|specify|scenario)(?:\.(?:skip|only|todo|fails|concurrent|sequential))?\s*\(\s*['"`]|^\s*(?:async\s+)?def\s+test_?\w*\s*\(|^\s*func\s+Test\w*\s*\(|@Test\b|#\[(?:tokio::)?test\]|\[(?:Fact|Theory|Test|TestMethod|TestCase)\b|^\s*it\s+['"]|^\s*(?:public\s+)?(?:void|fun)\s+test\w*\s*\(/gm

/** Table-driven tests: one declaration that runs many cases. */
const PARAMETRIZED = /\b(?:it|test|describe)\.each\s*[([`]|@pytest\.mark\.parametrize\b|\bt\.Run\s*\(|@ParameterizedTest\b|\[(?:Theory|TestCase|DataRow|InlineData)\b|@TestCase\b|#\[case\b|\bwhere:\s*$/gm

/** Assertions that check many values at once: whole-object matchers, snapshots, custom helpers. */
const STRUCTURAL = /\.(?:toEqual|toStrictEqual|toMatchObject|toMatchSnapshot|toMatchInlineSnapshot|toHaveProperty)\s*\(|\.to\.(?:deep|eql)\b|\b(?:deepEqual|deepStrictEqual|assertDictEqual|assertListEqual|assertCountEqual|assert_eq!|assert_matches!)\s*\(|\bassert(?:Equal|Equals)?\s*\(?.*[,=]=?\s*[[{(]|\bassert\s+.+==\s*[[{(]|\b(?:expect|assert|check|verify)[A-Z]\w*\s*\(/

const TRIVIAL = [
  /expect\s*\(\s*(true|false|1|0|null|undefined|'[^']*'|"[^"]*")\s*\)\s*\.\s*(?:toBe|toEqual|toStrictEqual|to\.equal|to\.be\.(?:true|false))\s*\(\s*\1\s*\)/,
  /expect\s*\(\s*true\s*\)\s*\.\s*(?:toBeTruthy|toBe\(true\))\s*\(?\)?/,
  /expect\s*\(\s*true\s*\)\.to\.be\.true/,
  /^\s*assert\s+(?:True|1|not\s+False)\s*(?:,|$|#)/,
  /^\s*assert\s+(\w+)\s*==\s*\1\s*(?:$|#)/,
  /assert(?:True|_)?\s*\(\s*(?:true|True|1)\s*\)/,
  /assert(?:Equal|Equals|_eq!?)\s*\(\s*(\w+|'[^']*'|"[^"]*")\s*,\s*\1\s*\)/,
  /self\.assertTrue\(\s*True\s*\)/,
  /assert!\s*\(\s*true\s*\)/,
]

const WEAK = /\.(?:toBeDefined|toBeTruthy|not\.toBeNull|not\.toBeUndefined|toBeInstanceOf\(Object\))\s*\(\s*\)|\bassert(?:IsNotNone|NotNull|Truthy)\s*\(|\bassert\s+\w+(?:\.\w+)*\s+is\s+not\s+None\b/g

const COMMENTED_ASSERT = /^\s*(?:\/\/+|#+|--|\/\*+)\s*(?:await\s+)?(?:expect\s*\(|assert\w*[\s(]|self\.assert\w*\(|t\.(?:Error|Fatal)|XCTAssert|assert_eq!|Assert\.)/

const SWALLOW = [
  /except\s+(?:AssertionError|Exception|BaseException)\s*(?:as\s+\w+\s*)?:\s*(?:pass|\.\.\.|return)\b/,
  /except\s*:\s*(?:pass|\.\.\.)/,
  /catch\s*(?:\(\s*\w*\s*(?::\s*\w+)?\s*\))?\s*\{\s*\}/,
  /catch\s*\(\s*(?:e|err|error|_)\s*\)\s*\{\s*(?:\/\/[^\n]*)?\s*(?:return;?)?\s*\}/,
  /\.catch\s*\(\s*\(\s*\)\s*=>\s*(?:\{\s*\}|undefined|null)\s*\)/,
  /rescue\s+(?:StandardError|Exception|RSpec::Expectations::ExpectationNotMetError)?\s*(?:=>\s*\w+)?\s*(?:;|\n)\s*(?:nil|end)\b/,
  /recover\s*\(\s*\)/,
]

const count = (text: string, re: RegExp): number => {
  re.lastIndex = 0
  return (text.match(re) ?? []).length
}

const linesMatching = (text: string, tests: Array<(line: string) => boolean>): string[] =>
  text.split(/\r?\n/).filter(line => tests.some(t => t(line))).map(l => l.trim())

/** Remove comment lines so commented-out code does not count as live assertions. */
const liveCode = (text: string): string =>
  text.split(/\r?\n/).filter(line => !/^\s*(?:\/\/|#(?!\[)|--|\*|\/\*)/.test(line)).join('\n')

/** New occurrences of lines matching `tests`, counting duplicates. */
function newLines(oldText: string, newText: string, tests: Array<(line: string) => boolean>): string[] {
  const before = new Map<string, number>()
  for (const l of linesMatching(oldText, tests)) before.set(l, (before.get(l) ?? 0) + 1)
  const out: string[] = []
  for (const l of linesMatching(newText, tests)) {
    const n = before.get(l) ?? 0
    if (n > 0) before.set(l, n - 1)
    else out.push(l)
  }
  return out
}

/** Thresholds for the count-based signals. */
export interface TamperOptions {
  /** Report fewer-assertions only when at least this many assertions disappear. */
  minAssertionsRemoved: number
  /** Report fewer-tests only when at least this many test cases disappear. */
  minTestsRemoved: number
  /** Signals to skip. */
  disabledSignals?: readonly SignalKind[]
}

/**
 * Analyse one change to a test file.
 * @param oldText - text being replaced (whole file for writes, `old_string` for edits; '' for new files).
 * @param newText - replacement text.
 * @param options - thresholds and disabled signals.
 * @returns the signals found; empty when the change looks honest.
 */
export function detectTamper(oldText: string, newText: string, options: TamperOptions): Signal[] {
  const off = new Set(options.disabledSignals ?? [])
  const signals: Signal[] = []
  const add = (s: Signal): void => {
    if (!off.has(s.kind)) signals.push(s)
  }
  const skips = newLines(oldText, newText, SKIP.map(re => (l: string) => re.test(l)))
  if (skips.length > 0) add({ kind: 'skip', detail: `adds ${skips.length} skip/only/xfail marker${skips.length === 1 ? '' : 's'}`, examples: skips.slice(0, 3) })

  const oldLive = liveCode(oldText)
  const newLive = liveCode(newText)
  const assertsBefore = count(oldLive, ASSERT)
  const assertsAfter = count(newLive, ASSERT)
  const testsBefore = count(oldLive, TEST_DECL)
  const testsAfter = count(newLive, TEST_DECL)
  // Folding several tests into one table-driven test is a refactor, not a loss.
  const parametrizedAdded = count(newLive, PARAMETRIZED) > count(oldLive, PARAMETRIZED)
  if (testsBefore - testsAfter >= options.minTestsRemoved && !parametrizedAdded) {
    add({ kind: 'fewer-tests', detail: `test cases ${testsBefore} → ${testsAfter}`, examples: [] })
  }
  const removed = assertsBefore - assertsAfter
  // Merging checks into one structural assertion or a helper adds a new assertion line; plain deletion adds none.
  const addedAsserts = newLines(oldLive, newLive, [(l: string) => STRUCTURAL.test(l)]).length
  if ((removed >= options.minAssertionsRemoved && addedAsserts === 0 && !parametrizedAdded) || (assertsBefore > 0 && assertsAfter === 0 && testsAfter > 0)) {
    add({ kind: 'fewer-assertions', detail: `assertions ${assertsBefore} → ${assertsAfter}`, examples: [] })
  }

  const trivial = newLines(oldText, newText, TRIVIAL.map(re => (l: string) => re.test(l)))
  if (trivial.length > 0) add({ kind: 'trivial-assert', detail: `adds ${trivial.length} assertion${trivial.length === 1 ? '' : 's'} that can never fail`, examples: trivial.slice(0, 3) })

  const commented = newLines(oldText, newText, [(l: string) => COMMENTED_ASSERT.test(l)])
  if (commented.length > 0) add({ kind: 'commented-assert', detail: `comments out ${commented.length} assertion${commented.length === 1 ? '' : 's'}`, examples: commented.slice(0, 3) })

  const swallowBefore = SWALLOW.reduce((n, re) => n + (oldText.match(new RegExp(re.source, 'g')) ?? []).length, 0)
  const swallowAfter = SWALLOW.reduce((n, re) => n + (newText.match(new RegExp(re.source, 'g')) ?? []).length, 0)
  if (swallowAfter > swallowBefore) {
    const examples = SWALLOW.flatMap(re => newText.match(new RegExp(re.source, 'g')) ?? []).slice(0, 2).map(s => s.replace(/\s+/g, ' ').trim())
    add({ kind: 'swallowed-failure', detail: 'adds an empty catch/except that can hide assertion failures', examples })
  }

  const weakBefore = count(oldLive, WEAK)
  const weakAfter = count(newLive, WEAK)
  if (weakAfter > weakBefore && assertsAfter <= assertsBefore) {
    const examples = newLines(oldText, newText, [(l: string) => { WEAK.lastIndex = 0; return WEAK.test(l) }]).slice(0, 3)
    add({ kind: 'weaker-assert', detail: `replaces specific assertions with existence/truthiness checks (${weakBefore} → ${weakAfter})`, examples })
  }
  return signals
}

/**
 * Detect `package.json` changes that neuter the test script.
 * @param oldText - previous manifest text ('' when new).
 * @param newText - new manifest text.
 * @returns a signal when `scripts.test` became a no-op or stopped failing.
 */
export function detectTestScriptTamper(oldText: string, newText: string): Signal | undefined {
  const testScript = (text: string): string | undefined => {
    const m = /"test"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(text)
    return m?.[1]
  }
  const before = testScript(oldText)
  const after = testScript(newText)
  if (after === undefined || after === before) return undefined
  const noop = /^\s*(?:echo\b[^|&;]*|true|exit 0|:)\s*$/.test(after) || /\|\|\s*(?:true|exit 0|:)\s*$/.test(after) || /--passWithNoTests|--pass-with-no-tests|--bail=0|-k\s+["']?not\b/.test(after) && !(before ?? '').includes(after.match(/--passWithNoTests|--pass-with-no-tests|-k\s+["']?not\b/)?.[0] ?? '\u0000')
  if (!noop) return undefined
  return { kind: 'skip', detail: `changes the test script from ${JSON.stringify(before ?? '')} to ${JSON.stringify(after)}, which cannot fail`, examples: [] }
}
