# dsh-protect-tests

[English](README.md) | 中文

让智能体"把测试改到能通过"，有时它真的照做了，只是方式不对。失败的测试被加上 `.skip`，断言被注释掉，`expect(total).toBe(42)` 变成 `expect(total).toBeDefined()`。测试全绿了，bug 还在。

这个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件会在每次修改测试文件之前，对比改动前后的内容。如果改动让测试检查的东西变少了，这次修改会被拒绝，并告诉模型它做了什么（提示是英文的，模型能看懂）：

```
dsh-protect-tests blocked this change to src/sum.test.ts because it makes the tests check less:
- replaces specific assertions with existence/truthiness checks (0 → 1): `expect(sum(1, 2)).toBeDefined()`
Tests should keep failing until the code is fixed. Fix the implementation instead, or make
the test more accurate without weakening it. If the test itself is wrong (the requirement
changed, or it tested a bug), tell the user which test you are changing and why, then
repeat the identical call once to confirm.
```

## 安装

```sh
dsh plugin --profile web add dsh-protect-tests
```

这里用的是 `web` 配置（profile），也就是用 `dsh web` 打开的浏览器界面。如果你用别的方式运行 DSH，就换成 `headless`（脚本和 CI）或 `acp`（编辑器集成）。每个配置有自己的插件列表，你用到哪个就装到哪个。装好就生效。卸载用 `dsh plugin --profile web remove dsh-protect-tests`。

### 从源码安装

想试本地改动的话，打个包再装：

```sh
git clone https://github.com/acus9345/dsh-protect-tests
cd dsh-protect-tests
npm install
npm pack
dsh plugin --profile web add ./dsh-protect-tests-0.2.0.tgz
```

## 它能发现什么

- **新加的跳过。** `it.skip`、`test.only`、`xit`、`xdescribe`、`@pytest.mark.skip` / `xfail`、`@unittest.skip`、`t.Skip()`、`@Disabled`、`#[ignore]`，以及 xUnit、RSpec、PHPUnit 和 XCTest 里对应的写法。
- **测试或断言变少。** 删掉一个测试用例，或者一次修改删掉两个及以上的断言。两个阈值都可以调。
- **永远不会失败的断言。** `expect(true).toBe(true)`、`assert True`、`assertEquals(x, x)`、`assert!(true)`。
- **被注释掉的断言。**
- **吞掉失败。** 把断言包进空的 `catch {}` 或 `except AssertionError: pass`。
- **更弱的断言。** 把具体的检查换成 `toBeDefined()`、`toBeTruthy()`、`assert.ok(x)`、`is not None` 之类。
- **删除测试文件。** 在命令行里用 `rm`、`git rm` 或 `unlink` 删测试文件或测试目录。
- **永远不会失败的测试脚本。** 把 `package.json` 里的 `"test"` 改成 `echo`、`exit 0`、`... || true`，或者加上 `--passWithNoTests`。

在 Windows 上，PowerShell 的删除命令（`Remove-Item`、`del`、`rd`）也算。

测试文件按名字识别：`*.test.*`、`*.spec.*`、`*_test.*`、`test_*.py`、`*Test.java`、`conftest.py`，以及 `tests/`、`__tests__/`、`spec/`、`e2e/` 下的所有文件等等。这个列表可以改。

正常的测试工作不受影响。加测试、加断言、改名、重构准备代码、修测试名里的错别字，都会直接放行。有些重构看起来像是"变少了"，其实不是，也会放行。比如把五个差不多的测试合并成一个 `test.each` / `@pytest.mark.parametrize` / `t.Run` 表，或者把三个 `toBe` 合成一个 `toEqual({...})` 或 `expectUser(...)` 这样的辅助函数。

## 测试确实写错了怎么办

这种情况确实有：需求变了，或者测试断言的正是那个 bug。这时会让模型先告诉你它要改哪个测试、为什么改，再把同样的调用原样重发一次来确认，第二次会放行。所以它不会把正当的修改彻底卡死，只是不让削弱测试的改动悄悄溜过去。如果你想自己审批，用 `mode: ask`。

## 它抓不到什么

它靠的是模式匹配，不理解含义。如果模型把 `toBe(4)` 改成 `toBe(5)` 去迎合一个错误的结果，看起来就是普通修改，会放行。把测试逻辑改写到不再覆盖那个 bug，也会放行。它能挡住偷懒的捷径（实际上大多数都是这种），但代替不了你自己看 diff。

## 设置

最简单的办法：在 DSH 侧边栏打开 **插件**，点 **dsh-protect-tests**，改好后点 **保存**。下一次工具调用就生效，不用重启。

或者在 `~/.dsh/profiles/<profile>/cordis.patch.yml` 里加一行这样的配置（只影响一个配置），或者加到 `~/.dsh/cordis.patch.yml`（影响所有配置）。没写的项保持默认值。

```yaml
- id: protect-tests
  config:
    mode: deny                  # 或 `ask`，改为弹出审批
    testFiles: ['*.test.*', '**/tests/**', '!tests/fixtures/**']   # 会替换默认列表
    minAssertionsRemoved: 2
    minTestsRemoved: 1
    disabledSignals: []         # skip, fewer-assertions, fewer-tests, trivial-assert,
                                # commented-assert, swallowed-failure, weaker-assert
    guardDeletes: true          # 检查 rm / git rm 删除测试文件
    guardTestScript: true       # 检查 package.json 里的 "test"
    allowIdenticalRetry: true   # false：拒绝后不能再重试通过
    shellTools: [bash, pwsh]    # Windows 上 DSH 用的 shell 是 pwsh
```

## 开发

```sh
npm install
npm test           # 检测逻辑的单元测试
npm run test:e2e   # 用脚本模拟的本地模型跑真实的 dsh，不需要 API Key
```

安装测试会执行 `dsh plugin add`，需要 PATH 里有 `pnpm`。

MIT 许可。作者 [acus9345](https://github.com/acus9345)。欢迎在 issues 里报 bug 或提想法。
