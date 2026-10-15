# dsh-protect-tests

Tell an agent "make the tests pass" and sometimes it does exactly that, just not the way you meant. A failing test gets `.skip`. An assertion gets commented out. `expect(total).toBe(42)` turns into `expect(total).toBeDefined()`. The run goes green and the bug is still there.

This [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin looks at every edit to a test file before it's applied, comparing the old text with the new. If the change makes the tests check less, the edit is refused and the model is told what it did:

```
dsh-protect-tests blocked this change to src/sum.test.ts because it makes the tests check less:
- replaces specific assertions with existence/truthiness checks (0 → 1): `expect(sum(1, 2)).toBeDefined()`
Tests should keep failing until the code is fixed. Fix the implementation instead, or make
the test more accurate without weakening it. If the test itself is wrong (the requirement
changed, or it tested a bug), tell the user which test you are changing and why, then
repeat the identical call once to confirm.
```

## Install

```sh
dsh plugin --profile tui add dsh-protect-tests
```

Use your own profile name in place of `tui`. It's on as soon as it's installed. Remove it with `dsh plugin --profile tui remove dsh-protect-tests`.

### From a clone

Before the package is on npm, or to try local changes, build a tarball and install that:

```sh
git clone https://github.com/acus9345/dsh-protect-tests
cd dsh-protect-tests
npm install
npm pack
dsh plugin --profile tui add ./dsh-protect-tests-0.1.0.tgz
```

## What it notices

- **New skips.** `it.skip`, `test.only`, `xit`, `xdescribe`, `@pytest.mark.skip` / `xfail`, `@unittest.skip`, `t.Skip()`, `@Disabled`, `#[ignore]`, and the equivalents in xUnit, RSpec, PHPUnit and XCTest.
- **Fewer tests or assertions.** Removing a test case, or removing two or more assertions in one edit. Both thresholds are configurable.
- **Assertions that can't fail.** `expect(true).toBe(true)`, `assert True`, `assertEquals(x, x)`, `assert!(true)`.
- **Commented-out assertions.**
- **Swallowed failures.** Wrapping assertions in an empty `catch {}` or `except AssertionError: pass`.
- **Weaker assertions.** Swapping a specific check for `toBeDefined()`, `toBeTruthy()`, `is not None` and the like.
- **Deleted test files.** `rm`, `git rm` or `unlink` on a test file or test folder from the shell.
- **A test script that can't fail.** Changing `"test"` in `package.json` to `echo`, `exit 0`, `... || true`, or adding `--passWithNoTests`.

Test files are found by name: `*.test.*`, `*.spec.*`, `*_test.*`, `test_*.py`, `*Test.java`, `conftest.py`, anything under `tests/`, `__tests__/`, `spec/` or `e2e/`, and so on. You can change the list.

Normal test work isn't affected. Adding tests, adding assertions, renaming, refactoring setup code and fixing a typo in a test name all go through without a word. Refactors that look like losses on paper also go through, for example folding five near-identical tests into one `test.each` / `@pytest.mark.parametrize` / `t.Run` table, or merging three `toBe` checks into one `toEqual({...})` or a helper like `expectUser(...)`.

## When the test really is wrong

Sometimes it is. The requirement changed, or the test was asserting the bug. In that case the model is asked to tell you which test it's changing and why, then repeat the same call once to confirm. The repeat goes through. So the guard never fully blocks legitimate work. It just won't let a weakened test slip past without being mentioned in the conversation. If you'd rather approve these yourself, use `mode: ask`.

## What it won't catch

It works on patterns, not on meaning. If the model changes `toBe(4)` to `toBe(5)` to match a wrong result, that looks like an ordinary edit and gets through. Rewriting the logic of a test so it no longer exercises the bug also gets through. It covers the lazy shortcuts, which turn out to be most of them, but it's no substitute for reading the diff.

## Settings

Add a row like this to `~/.dsh/profiles/<profile>/cordis.patch.yml`, or to `~/.dsh/cordis.patch.yml` for every profile. Keys you leave out keep their defaults.

```yaml
- id: protect-tests
  config:
    mode: deny                  # or `ask` for an approval prompt
    testFiles: ['*.test.*', '**/tests/**', '!tests/fixtures/**']   # replaces the default list
    minAssertionsRemoved: 2
    minTestsRemoved: 1
    disabledSignals: []         # skip, fewer-assertions, fewer-tests, trivial-assert,
                                # commented-assert, swallowed-failure, weaker-assert
    guardDeletes: true          # watch rm / git rm of test files
    guardTestScript: true       # watch package.json "test"
    allowIdenticalRetry: true   # false: a refusal is final
    shellTools: [bash]
```

## Development

```sh
npm install
npm test           # detector unit tests
npm run test:e2e   # real dsh runs against a scripted local model, no API key needed
```

The install test runs `dsh plugin add`, which needs `pnpm` on your PATH.

MIT licensed. Written by [acus9345](https://github.com/acus9345). Bug reports and ideas are welcome in the issues.
