/**
 * Keyless end-to-end harness for the plugins in this repository.
 *
 * Boots the real `dsh` launcher in headless mode with an isolated DSH_HOME and
 * a temporary workspace. The plugin is either inserted from `lib/` with a
 * `--patch` overlay, or packed and installed with `dsh plugin add` the way a
 * user would install it. The model is a local Anthropic-Messages SSE server that replays a
 * scripted list of turns, so tests need no API key and are deterministic.
 */
import { execFile, spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
// Run dsh's JS entry with this Node, so the helper works the same on Windows (no .cmd shims).
const dshEntry = join(repoRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const windows = process.platform === 'win32'
/** The shell tool DSH offers on this platform: `pwsh` on Windows, `bash` elsewhere. */
export const shellTool = windows ? 'pwsh' : 'bash'

/** One scripted model response: a single tool call, or final text. */
export type ScriptedTurn =
  | { tool: string; input: Record<string, unknown> }
  | { text: string }

/** A captured `/v1/messages` request body. */
export interface CapturedRequest {
  system?: unknown
  messages: Array<{ role: string; content: unknown }>
  tools?: Array<{ name: string }>
}

/** One parsed `dsh headless --json` event. */
export type RunEvent = Record<string, unknown> & { type: string }

/** Result of one headless run. */
export interface RunResult {
  events: RunEvent[]
  requests: CapturedRequest[]
  stderr: string
  exitCode: number | null
  workspace: string
  /** Contents of `readAfter` files after the run (undefined when missing). */
  filesAfter: Record<string, string | undefined>
  /** Tool results in order, as `{ tool, status, result }`. */
  toolResults: Array<{ tool: string; status: string; result: string }>
}

/** Options for {@link runDsh}. */
export interface RunOptions {
  /** Absolute path of each plugin entry to insert, with its row id and config. */
  plugins?: Array<{ id: string; entry: string; config?: Record<string, unknown> }>
  /** Pack this repository and install it into the headless profile with `dsh plugin add`. */
  installed?: boolean
  /** Contents of `$DSH_HOME/cordis.patch.yml`, the user's own override layer. */
  homePatch?: string
  /** Model turns, consumed one per model request; a trailing text turn is appended when missing. */
  script: ScriptedTurn[]
  /** Files to create in the workspace before the run (relative path → content). */
  files?: Record<string, string>
  /** Task text sent to the agent. */
  task?: string
  /** Overall timeout in milliseconds. */
  timeoutMs?: number
  /** Workspace files to read back after the run (relative paths). */
  readAfter?: string[]
}

function sse(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

function writeTurn(res: ServerResponse, turn: ScriptedTurn, n: number): void {
  // One connection per request: some VPN and firewall drivers stall reused loopback connections.
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'close' })
  sse(res, 'message_start', {
    type: 'message_start',
    message: {
      id: `msg_${n}`, type: 'message', role: 'assistant', model: 'deepseek-chat', content: [],
      stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 },
    },
  })
  if ('tool' in turn) {
    sse(res, 'content_block_start', {
      type: 'content_block_start', index: 0,
      content_block: { type: 'tool_use', id: `toolu_${n}`, name: turn.tool, input: {} },
    })
    sse(res, 'content_block_delta', {
      type: 'content_block_delta', index: 0,
      delta: { type: 'input_json_delta', partial_json: JSON.stringify(turn.input) },
    })
  } else {
    sse(res, 'content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    sse(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: turn.text } })
  }
  sse(res, 'content_block_stop', { type: 'content_block_stop', index: 0 })
  sse(res, 'message_delta', {
    type: 'message_delta',
    delta: { stop_reason: 'tool' in turn ? 'tool_use' : 'end_turn', stop_sequence: null },
    usage: { output_tokens: 5 },
  })
  sse(res, 'message_stop', { type: 'message_stop' })
  res.end()
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

/** Start the scripted model server. */
export async function startScriptedModel(script: ScriptedTurn[]): Promise<{
  baseURL: string
  requests: CapturedRequest[]
  close(): Promise<void>
}> {
  const turns = [...script]
  if (turns.length === 0 || 'tool' in turns[turns.length - 1]!) turns.push({ text: 'done' })
  const requests: CapturedRequest[] = []
  let served = 0
  const server = createServer((req, res) => {
    void (async () => {
      if (req.method !== 'POST' || !req.url?.endsWith('/messages')) {
        res.writeHead(404, { connection: 'close' }).end()
        return
      }
      const body = JSON.parse(await readBody(req)) as CapturedRequest & { stream?: boolean }
      requests.push(body)
      // Auxiliary requests (titles, summaries) get plain text and do not consume the script.
      const isMain = Array.isArray(body.tools) && body.tools.length > 0
      const turn = isMain ? (turns[served++] ?? { text: 'done' }) : { text: 'ok' }
      writeTurn(res, turn, requests.length)
    })().catch((error: unknown) => {
      res.writeHead(500).end(String(error))
    })
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const { port } = server.address() as AddressInfo
  return {
    baseURL: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () => new Promise<void>(r => { server.closeAllConnections(); server.close(() => r()) }),
  }
}

function yamlValue(value: unknown): string {
  return JSON.stringify(value)
}

/**
 * Run one headless task with the given plugins inserted.
 * @param options - plugins, scripted model turns, workspace files, and task.
 * @returns parsed events, captured model requests, and tool results.
 */
export async function runDsh(options: RunOptions): Promise<RunResult> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-e2e-'))
  const home = join(root, 'home')
  const workspace = join(root, 'ws')
  await mkdir(home, { recursive: true })
  await mkdir(workspace, { recursive: true })
  for (const [rel, content] of Object.entries(options.files ?? {})) {
    const path = join(workspace, rel)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content)
  }
  const env = { ...process.env, DSH_HOME: home }
  if (options.installed === true) {
    await run(process.execPath, [dshEntry, 'plugin', '--profile', 'headless', 'add', await packed()], { cwd: repoRoot, env })
  }
  if (options.homePatch !== undefined) await writeFile(join(home, 'cordis.patch.yml'), options.homePatch)
  const rows = (options.plugins ?? []).map(p => [
    `    - id: ${p.id}`,
    `      name: ${yamlValue(p.entry)}`,
    ...(p.config === undefined ? [] : [`      config: ${yamlValue(p.config)}`]),
  ].join('\n'))
  const patchArgs: string[] = []
  if (rows.length > 0) {
    const patch = join(root, 'overlay.yml')
    await writeFile(patch, `- insert:\n${rows.join('\n')}\n`)
    patchArgs.push('--patch', patch)
  }
  // Tests are written against `bash`; on Windows the same calls go to `pwsh`, the shell DSH offers there.
  const script = windows ? options.script.map(t => ('tool' in t && t.tool === 'bash' ? { ...t, tool: 'pwsh' } : t)) : options.script
  const model = await startScriptedModel(script)
  try {
    const child = spawn(process.execPath, [dshEntry, 'headless', ...patchArgs, '--json', options.task ?? 'do the task'], {
      cwd: workspace,
      env: {
        ...env,
        DEEPSEEK_BASE_URL: model.baseURL,
        DEEPSEEK_API_KEY: 'test-key',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
    const timeout = setTimeout(() => child.kill('SIGKILL'), options.timeoutMs ?? 90_000)
    const exitCode = await new Promise<number | null>(r => child.on('close', code => r(code)))
    clearTimeout(timeout)
    const events = stdout.split('\n').filter(l => l.trim().startsWith('{')).map(l => JSON.parse(l) as RunEvent)
    const calls = new Map<string, string>()
    const toolResults: RunResult['toolResults'] = []
    for (const e of events) {
      if (e.type === 'tool_call') calls.set(String(e.callId), String(e.tool))
      if (e.type === 'tool_result') {
        const result = typeof e.result === 'string' ? e.result : JSON.stringify(e.result ?? e.error ?? '')
        toolResults.push({ tool: calls.get(String(e.callId)) ?? '?', status: String(e.status), result })
      }
    }
    const filesAfter: Record<string, string | undefined> = {}
    for (const rel of options.readAfter ?? []) {
      filesAfter[rel] = await readFile(join(workspace, rel), 'utf8').catch(() => undefined)
    }
    return { events, requests: model.requests, stderr, exitCode, workspace, toolResults, filesAfter }
  } finally {
    await model.close()
    if (process.env.KEEP_E2E !== '1') await rm(root, { recursive: true, force: true }).catch(() => undefined)
  }
}

/** Absolute path of this plugin's built entry. */
export const pluginEntry = join(repoRoot, 'lib', 'index.js')

function run(cmd: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }): Promise<string> {
  return new Promise((done, fail) => {
    // npm is a .cmd shim on Windows, which only runs through a shell.
    execFile(cmd, args, { ...options, maxBuffer: 16 * 1024 * 1024, shell: windows && cmd === 'npm' }, (error, stdout, stderr) => {
      if (error !== null) fail(new Error(`${cmd} ${args.join(' ')} failed:\n${stdout}\n${stderr}`))
      else done(stdout)
    })
  })
}

let tarball: Promise<string> | undefined
/** Pack the repository once per test process (expects `lib/` to be built). */
function packed(): Promise<string> {
  tarball ??= (async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-'))
    const out = await run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', dir], { cwd: repoRoot, env: process.env })
    // npm 10 prints an array; npm 12 prints an object keyed by package name.
    const parsed = JSON.parse(out) as Array<{ filename: string }> | Record<string, { filename: string }>
    const { filename } = (Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0])!
    return join(dir, filename)
  })()
  return tarball
}

/** Flatten every text block the model received in its last request. */
export function lastRequestText(result: RunResult): string {
  const last = result.requests.filter(r => Array.isArray(r.tools) && r.tools.length > 0).at(-1)
  return JSON.stringify(last ?? {})
}
