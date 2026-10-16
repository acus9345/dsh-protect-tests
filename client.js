// Settings page for DSH's sidebar Plugins page (the browser half of this plugin).
// Plain JavaScript in DSH's client module format, so it ships without a bundler.
// The top part describes this plugin's fields; the bottom part is the same in
// all six dsh-* plugins.
window.__ModuleLoader__.load({
  id: 'dsh-protect-tests',
  factory: (require) => {
    const module = { exports: {} }
    const { jsx, jsxs } = require('react/jsx-runtime')
    const P = require('@deepseek-ai/dsh-client-ui-primitives')

    // ---- This plugin ------------------------------------------------------

    const PACKAGE = 'dsh-protect-tests'
    const ENTRY = 'protect-tests'

    const SIGNALS = ['skip', 'fewer-assertions', 'fewer-tests', 'trivial-assert', 'commented-assert', 'swallowed-failure', 'weaker-assert']

    const FIELDS = [
      { kind: 'choice', field: 'mode', options: ['deny', 'ask'], fallback: 'deny' },
      { kind: 'flags', field: 'disabledSignals', options: SIGNALS, inverted: true },
      { kind: 'switch', field: 'guardDeletes', fallback: true },
      { kind: 'switch', field: 'guardTestScript', fallback: true },
      { kind: 'switch', field: 'allowIdenticalRetry', fallback: true },
      { kind: 'number', field: 'minAssertionsRemoved' },
      { kind: 'number', field: 'minTestsRemoved' },
      { kind: 'lines', field: 'testFiles' },
      { kind: 'words', field: 'shellTools' },
    ]

    const COPY = {
      en: {
        summary: 'Blocks edits that make tests check less.',
        mode_label: 'When a change weakens tests',
        mode_hint: 'Block tells the model what it did and to fix the code instead. Ask shows you an approval prompt.',
        mode_deny: 'Block it',
        mode_ask: 'Ask me',
        disabledSignals_label: 'What counts as weakening a test',
        disabledSignals_hint: 'Untick anything you want to allow.',
        'disabledSignals_skip': 'Adding skip, only or xfail',
        'disabledSignals_fewer-assertions': 'Removing assertions',
        'disabledSignals_fewer-tests': 'Removing test cases',
        'disabledSignals_trivial-assert': 'Assertions that can never fail, like expect(true)',
        'disabledSignals_commented-assert': 'Commenting assertions out',
        'disabledSignals_swallowed-failure': 'Swallowing failures with an empty catch',
        'disabledSignals_weaker-assert': 'Weaker checks, like toBeDefined() or assert.ok(x)',
        guardDeletes_label: 'Block deleting test files from the shell',
        guardTestScript_label: 'Block test scripts that can never fail',
        guardTestScript_hint: 'For example "test": "echo ok" or "jest || true" in package.json.',
        allowIdenticalRetry_label: 'Let the model confirm by repeating the call',
        allowIdenticalRetry_hint: 'After it explains why, the model can send the same edit once more to get it through.',
        minAssertionsRemoved_label: 'Assertions removed before it counts',
        minAssertionsRemoved_hint: 'Leave blank for the default (2).',
        minTestsRemoved_label: 'Test cases removed before it counts',
        minTestsRemoved_hint: 'Leave blank for the default (1).',
        testFiles_label: 'Which files are tests',
        testFiles_hint: 'One glob per line, relative to the workspace. Start a line with ! to exclude.',
        shellTools_label: 'Shell tools to watch',
        shellTools_hint: 'Tool names, separated by commas. On Windows the shell tool is pwsh.',
      },
      zh: {
        summary: '阻止让测试检查变少的修改。',
        mode_label: '发现削弱测试的修改时',
        mode_hint: '阻止：告诉模型它改了什么，并让它去修代码。询问：弹出审批让你决定。',
        mode_deny: '阻止',
        mode_ask: '询问我',
        disabledSignals_label: '哪些算削弱测试',
        disabledSignals_hint: '取消勾选你想放行的项。',
        'disabledSignals_skip': '添加 skip、only 或 xfail',
        'disabledSignals_fewer-assertions': '删除断言',
        'disabledSignals_fewer-tests': '删除测试用例',
        'disabledSignals_trivial-assert': '永远不会失败的断言，例如 expect(true)',
        'disabledSignals_commented-assert': '把断言注释掉',
        'disabledSignals_swallowed-failure': '用空 catch 吞掉失败',
        'disabledSignals_weaker-assert': '更弱的检查，例如 toBeDefined() 或 assert.ok(x)',
        guardDeletes_label: '阻止通过命令行删除测试文件',
        guardTestScript_label: '阻止永远不会失败的测试脚本',
        guardTestScript_hint: '例如 package.json 里的 "test": "echo ok" 或 "jest || true"。',
        allowIdenticalRetry_label: '允许模型原样重试一次来确认',
        allowIdenticalRetry_hint: '模型说明原因后，可以把同样的修改再发一次让它通过。',
        minAssertionsRemoved_label: '删除多少个断言才算',
        minAssertionsRemoved_hint: '留空使用默认值（2）。',
        minTestsRemoved_label: '删除多少个测试用例才算',
        minTestsRemoved_hint: '留空使用默认值（1）。',
        testFiles_label: '哪些文件是测试',
        testFiles_hint: '每行一个 glob，相对于工作区。以 ! 开头表示排除。',
        shellTools_label: '要检查的 shell 工具',
        shellTools_hint: '工具名，用逗号分隔。Windows 上 shell 工具是 pwsh。',
      },
    }

    // ---- Shared page (identical in every dsh-* plugin) ---------------------

    const FORM_COPY = {
      en: { unavailable: 'This plugin is not loaded, so it cannot be configured right now.', readOnly: 'This deployment stores settings read-only.', saveFailed: 'DSH did not accept these values; they were left for you to correct.', save: 'Save', saving: 'Saving…', overridden: 'Changed', reset: 'Reset to default', invalid: 'Enter a number, or leave blank for the default.' },
      zh: { unavailable: '该插件当前未加载，暂时无法配置。', readOnly: '本部署的设置为只读。', saveFailed: 'DSH 没有接受这些值，已保留供你修改。', save: '保存', saving: '保存中…', overridden: '已修改', reset: '恢复默认', invalid: '请填数字；留空表示使用默认值。' },
    }
    const NS = `plugin.${PACKAGE}`

    /** Text <-> config value conversions for each kind of control. */
    const SPECS = {
      choice: (f) => ({ field: f.field, format: (v) => (typeof v === 'string' ? v : f.fallback), parse: (t) => (f.options.includes(t) ? { kind: 'set', value: t } : undefined) }),
      switch: (f) => ({ field: f.field, format: (v) => String(typeof v === 'boolean' ? v : f.fallback), parse: (t) => (t === 'true' || t === 'false' ? { kind: 'set', value: t === 'true' } : undefined) }),
      number: (f) => P.settingsNumberField(f.field),
      lines: (f) => ({ field: f.field, format: (v) => (Array.isArray(v) ? v.join('\n') : ''), parse: (t) => ({ kind: 'set', value: t.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) }) }),
      words: (f) => ({ field: f.field, format: (v) => (Array.isArray(v) ? v.join(', ') : ''), parse: (t) => ({ kind: 'set', value: t.split(/[\s,]+/).filter(Boolean) }) }),
      flags: (f) => ({ field: f.field, format: (v) => (Array.isArray(v) ? [...v].sort().join(',') : ''), parse: (t) => ({ kind: 'set', value: t ? t.split(',') : [] }) }),
      pairs: (f) => ({
        field: f.field,
        format: (v) => (v !== null && typeof v === 'object' && !Array.isArray(v) ? Object.entries(v).map(([k, val]) => `${k} = ${val}`).join('\n') : ''),
        parse: (t) => ({ kind: 'set', value: Object.fromEntries(t.split(/\r?\n/).map((line) => { const i = line.indexOf('='); return i < 0 ? [line.trim(), ''] : [line.slice(0, i).trim(), line.slice(i + 1).trim()] }).filter(([k]) => k)) }),
      }),
    }

    // Same look as DSH's own settings fields (primitives' fields.module.css).
    const S = {
      field: { display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 0' },
      divider: { borderTop: '0.5px solid var(--dsw-alias-border-l2)' },
      head: { display: 'flex', alignItems: 'center', gap: 8 },
      label: { flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500, lineHeight: 1.5, color: 'var(--dsw-alias-label-primary)' },
      hint: { margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)' },
      reset: { border: 'none', background: 'none', padding: 0, font: 'inherit', fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer' },
      badges: { display: 'inline-flex', alignItems: 'center', gap: 8 },
      textarea: { minHeight: 96, padding: '8px 12px', border: '0.5px solid var(--dsw-alias-border-l4)', borderRadius: 'var(--dsw-radius-md)', background: 'var(--dsw-alias-bg-layer-3)', font: 'inherit', fontFamily: 'var(--dsw-font-mono, ui-monospace, monospace)', fontSize: 12, lineHeight: 1.6, color: 'var(--dsw-alias-label-primary)', resize: 'vertical' },
      flags: { display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 2 },
    }

    function Head({ id, label, state, form, t }) {
      return jsxs('div', {
        style: S.head,
        children: [
          jsx('label', { style: S.label, htmlFor: id, children: label }),
          state.overridden ? jsxs('span', { style: S.badges, children: [jsx(P.Tag, { tone: 'neutral', children: t('overridden') }), jsx('button', { type: 'button', style: S.reset, disabled: form.disabled, onClick: () => form.resetField(form.fieldName), children: t('reset') })] }) : null,
        ],
      })
    }

    function Field({ f, state, props, disabled, first, t, ft }) {
      const id = `${PACKAGE}-${f.field}`
      const label = t(`${f.field}_label`)
      const hintKey = `${f.field}_hint`
      const hintText = t(hintKey)
      const hint = typeof hintText === 'string' && hintText !== hintKey ? hintText : ''
      const edit = (text) => props.edit(f.field, text)
      const wrap = (control) => jsxs('div', {
        style: first ? S.field : { ...S.field, ...S.divider },
        children: [jsx(Head, { id, label, state, t: ft, form: { disabled, resetField: props.resetField, fieldName: f.field } }), control, hint ? jsx('p', { style: S.hint, children: hint }) : null],
      })
      switch (f.kind) {
        case 'number':
        case 'words':
          return jsx('div', {
            style: first ? undefined : S.divider,
            children: jsx(P.SettingsValueField, { id, label, hint, overriddenLabel: ft('overridden'), resetLabel: ft('reset'), invalidLabel: ft('invalid'), numeric: f.kind === 'number', disabled, ...state, onEdit: edit, onReset: () => props.resetField(f.field) }),
          })
        case 'choice':
          return wrap(jsx('div', { children: jsx(P.SegmentedControl, { id, label, value: state.text, disabled, options: f.options.map((o) => ({ value: o, label: t(`${f.field}_${o}`) })), onChange: edit }) }))
        case 'switch':
          return wrap(jsx('div', { children: jsx(P.Switch, { label, checked: state.text === 'true', disabled, onChange: (next) => edit(String(next)) }) }))
        case 'lines':
        case 'pairs':
          return wrap(jsx('textarea', { id, style: S.textarea, spellCheck: false, value: state.text, disabled, onChange: (e) => edit(e.target.value) }))
        case 'flags': {
          const set = new Set(state.text ? state.text.split(',') : [])
          return wrap(jsx('div', {
            style: S.flags,
            children: f.options.map((o) => jsx(P.Checkbox, {
              label: t(`${f.field}_${o}`),
              checked: f.inverted ? !set.has(o) : set.has(o),
              disabled,
              onChange: (checked) => {
                const on = f.inverted ? !checked : checked
                if (on) set.add(o)
                else set.delete(o)
                edit([...set].sort().join(','))
              },
            }, o)),
          }))
        }
        default:
          return null
      }
    }

    function Page(props) {
      const { t } = props
      const ft = (key) => t(`form_${key}`)
      const state = props.usePage((snapshot) => snapshot)
      if (props.view === 'summary') return t('summary')
      const disabled = !state.writable
      return jsx(P.SettingsForm, {
        labels: { unavailable: ft('unavailable'), readOnly: ft('readOnly'), saveFailed: ft('saveFailed'), save: ft('save'), saving: ft('saving') },
        state,
        onSave: props.save,
        onDiscard: props.discard,
        children: FIELDS.map((f, i) => jsx(Field, { f, state: state.fields[f.field], props, disabled, first: i === 0, t, ft }, f.field)),
      })
    }

    const inject = ['slots', 'locale', 'configForms']

    function apply(ctx) {
      const dictionary = (lang) => ({ ...COPY[lang], ...Object.fromEntries(Object.entries(FORM_COPY[lang]).map(([k, v]) => [`form_${k}`, v])) })
      ctx.effect(() => ctx.locale.register(NS, { en: dictionary('en'), zh: dictionary('zh') }), `${PACKAGE}: dictionaries`)
      const form = new P.SettingsFormModel(ctx.configForms.get(ENTRY), FIELDS.map((f) => SPECS[f.kind](f)))
      const store = form.bind(() => ({ ...form.shell(), fields: Object.fromEntries(FIELDS.map((f) => [f.field, form.field(f.field)])) }))
      ctx.effect(() => () => form.dispose(), `${PACKAGE}: form`)
      ctx.effect(() => ctx.configForms.whileServed([ENTRY], () => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
        name: 'plugins.bundle.config',
        key: PACKAGE,
        locale: NS,
        inject: () => ({ hooks: { page: store }, ...form.actions() }),
      }, Page))), `${PACKAGE}: settings page`)
    }

    module.exports.inject = inject
    module.exports.apply = apply
    return module.exports
  },
})
