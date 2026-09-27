/**
 * 女仆娘立绘 + "求 star" 开屏弹窗回归：
 *   A. channel 语义：`dsh-tui.whaleGirl` 默认关、显式开、setWhaleGirl
 *      只在变化时通知；
 *   B. 头部渲染（真实 LogoHeader）：立绘**最优先**走终端图像协议
 *      （Kitty/Sixel）；夹具终端没有图形能力 → maid 档必须回落到
 *      **字符画女仆娘**（专属色在、文字列在、阶梯契约不动）；
 *      whale:false 时艺术整列不画；发行资产能解出方形 RGBA（sharp
 *      缺席时显式跳过）；
 *   C. 弹窗（挂真实 Chat + fake channel）：99h 档开屏弹一次（标题/正文/
 *      两颗按钮/▸ 光标/**会动的**回落鲸鱼），标语行让位（「已陪你」不出
 *      现），账本记到下一档；连按两次 Enter 只触发一次 star 动作（去重）；
 *   D. Esc 关闭后不抢键（后续 ↓/Enter 落回输入框，不再触发按钮）；
 *      ↓ 可把 ▸ 移到「在浏览器中打开」，Enter 走 open 动作；
 *   E. 非历史档（24h）不弹窗、不记账；
 *   F. 回合进行中（working）不弹窗、**不记账**——留给下一次启动。
 * 运行：node --import tsx/esm scripts/verify-whale-girl.tsx
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.FORCE_COLOR = '3'
process.env.DSH_TUI_LANG = 'zh'
// HOME/USERPROFILE 指到空夹具目录：DATA_DIR（~/.dsh-tui）不碰真实数据，
// LogoV2 的 recordLaunch 也落在夹具里；弹窗判定的账本目录另用
// starPrompt.dir 逐 case 注入（一进程多 case，互不串档）。
const fixtureHome = mkdtempSync(join(tmpdir(), 'verify-whale-girl-'))
process.env.HOME = fixtureHome
process.env.USERPROFILE = fixtureHome

const [
  { PassThrough, Writable },
  React,
  { render, ThemeProvider },
  { Chat },
  { LogoHeader },
  { createChannel },
  { QuestionStore },
  { POINTER },
  { settle, settled, sleep },
] = await Promise.all([
  import('node:stream'),
  import('react'),
  import('../src/ui.js'),
  import('../src/screens/Chat.js'),
  import('../src/components/MessageList.js'),
  import('../src/dsh-adapter/channel.js'),
  import('../src/dsh-adapter/questions.js'),
  import('../src/terminal-utils/figures.js'),
  import('./lib/term-test.mjs'),
])

let failures = 0
let checks = 0
function check(name: string, ok: boolean, extra = ''): void {
  checks += 1
  if (ok) console.log(`  ✓ ${name}`)
  else {
    failures++
    console.error(`  ✗ ${name}${extra ? `  (${extra})` : ''}`)
  }
}

class FakeStdout extends Writable {
  columns: number
  rows = 30
  isTTY = true
  frames: string[] = []
  constructor(columns: number) {
    super()
    this.columns = columns
  }
  _write(chunk: unknown, _encoding: BufferEncoding, callback: () => void) {
    this.frames.push(String(chunk))
    callback()
  }
}

class FakeStderr extends Writable {
  isTTY = true
  _write(_chunk: unknown, _encoding: BufferEncoding, callback: () => void) {
    callback()
  }
}

class FakeStdin extends PassThrough {
  isTTY = true
  setRawMode() { return this }
  ref() { return this }
  unref() { return this }
}

const plainText = (frames: readonly string[]) => frames
  .join('')
  .replace(/\x1b\[(\d+)C/g, (_, n) => ' '.repeat(Number(n)))
  .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
  .replace(/\x1b\]9;[^\x07]*\x07/g, '')

// 夹具终端没有图形协议（TerminalImagesContext 默认关）：maid 档在夹具里
// 必然回落到字符画女仆娘（半块精灵的专属色互证），弹窗回落到会动的像素
// 鲸鱼（描边色）——这正是要钉住的回落契约。真图优先级由 B6 的资产面覆盖。
const MAID_HAIR = '\x1b[38;2;43;56;120m'
const MAID_WHITE = '\x1b[38;2;253;253;253m'
const WHALE_OUTLINE = '\x1b[38;2;20;38;96m'

// ── A. channel 语义 ─────────────────────────────────────────────────────────
function makeChannel(options = {}) {
  const handlers = new Map()
  const ctx = {
    on(event: string, handler: () => void) {
      handlers.set(event, handler)
      return () => handlers.delete(event)
    },
    get() { return undefined },
    logger: { warn() {} },
  }
  const agent = {
    id: 'a1',
    status: 'idle',
    session: { id: 's1', seq: 0, events: [] },
    ctx: { on: () => () => {} },
    followup() {},
    steer() {},
  }
  return createChannel(ctx, agent, {
    model: 'deepseek-chat',
    cwd: '/tmp',
    provider: 'deepseek',
    activity: false,
    ...options,
  })
}

{
  const channel = makeChannel() as { whaleGirl: boolean; setWhaleGirl(v: boolean): void; subscribe(fn: () => void): () => void }
  check('A1 channel defaults whaleGirl to off', channel.whaleGirl === false)
  check('A2 channel preserves an explicit whaleGirl=true', (makeChannel({ whaleGirl: true }) as { whaleGirl: boolean }).whaleGirl === true)
  let notified = 0
  channel.subscribe(() => { notified += 1 })
  channel.setWhaleGirl(true)
  check('A3 setWhaleGirl(true) updates and notifies once', channel.whaleGirl === true && notified === 1)
  channel.setWhaleGirl(true)
  check('A4 repeated setWhaleGirl(true) is a no-op', notified === 1)
  channel.setWhaleGirl(false)
  check('A5 setWhaleGirl(false) toggles back', channel.whaleGirl === false && notified === 2)
}

// ── B. 头部渲染（真实 LogoHeader） ──────────────────────────────────────────
async function renderHeader(props: Record<string, unknown>, expect?: (plain: string) => boolean) {
  const stdout = new FakeStdout(typeof props.columns === 'number' ? props.columns as number : 120)
  const { columns, ...logoProps } = props
  const instance = await render(
    React.createElement(ThemeProvider, { theme: 'dark' }, React.createElement(LogoHeader, logoProps)),
    { stdout, stderr: new FakeStderr(), stdin: new FakeStdin(), exitOnCtrlC: false, patchConsole: false },
  )
  const ready = expect ?? ((plain: string) => plain.includes('dsh-TUI') && plain.includes('whale-model-probe'))
  await settle(() => ready(plainText(stdout.frames)))
  const raw = stdout.frames.join('')
  await instance.unmount()
  return { raw, plain: plainText(stdout.frames) }
}

{
  const bothFit = await renderHeader({
    columns: 120, model: 'whale-model-probe', cwd: '/whale/cwd', whaleGirl: true,
  }, plain => plain.includes('dsh-TUI'))
  check('B1 maid mode without terminal graphics falls back to the character-art maid',
    bothFit.raw.includes(MAID_HAIR) && bothFit.raw.includes(MAID_WHITE) && !bothFit.raw.includes(WHALE_OUTLINE), 'maid colors / whale outline')
  check('B2 maid fallback keeps the text column', bothFit.plain.includes('dsh-TUI') && bothFit.plain.includes('whale-model-probe'))

  const defaultArt = await renderHeader({ columns: 120, model: 'whale-model-probe', cwd: '/whale/cwd' })
  check('B3 default stays the pixel whale', defaultArt.raw.includes(WHALE_OUTLINE) && !defaultArt.raw.includes(MAID_HAIR))

  const artOff = await renderHeader({ columns: 120, model: 'whale-model-probe', cwd: '/whale/cwd', whaleGirl: true, whale: false })
  check('B4 whale:false drops the art entirely (text-only header)', !artOff.raw.includes(MAID_HAIR) && !artOff.raw.includes(WHALE_OUTLINE) && artOff.plain.includes('dsh-TUI'))

  const whaleOnly = await renderHeader({
    columns: 48, model: 'whale-model-probe', cwd: '/whale/cwd', whaleGirl: true,
  }, plain => !plain.includes('dsh-TUI'))
  check('B5 whale-only tier keeps the ladder contract in maid mode',
    whaleOnly.raw.includes(MAID_HAIR) && !whaleOnly.plain.includes('dsh-TUI') && !whaleOnly.plain.includes('whale-model-probe'))

  // 真图数据面：资产可解出 RGBA（sharp 缺席时显式跳过，不判失败——
  // sharp 本就是可选依赖，缺它时 UI 的回落路径已由 B1 覆盖）。
  const { loadMaidPortrait } = await import('../src/components/maidPortrait.js')
  const portrait = await loadMaidPortrait()
  if (portrait === undefined) console.log('  - B6 skipped: maid asset or sharp unavailable')
  else check('B6 the shipped portrait decodes to RGBA and trims its transparent margins',
    portrait.width > 0 && portrait.height > 0
    && portrait.data.byteLength === portrait.width * portrait.height * 4
    && (portrait.width < 464 || portrait.height < 464))
}

// ── C–F. 弹窗（挂真实 Chat） ────────────────────────────────────────────────
const HOUR_MS = 3_600_000
function seedUsage(dir: string, stats: { launches: number; totalMs: number; celebrated: number }): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'usage.json'), JSON.stringify(stats))
}
const readCelebrated = (dir: string): number =>
  (JSON.parse(readFileSync(join(dir, 'usage.json'), 'utf8')) as { celebrated: number }).celebrated

function makeChatChannel(working = false) {
  // smoke.tsx 形状的 fake channel：Chat 只读它渲染要用的面。
  return {
    version: 0,
    whaleIdle: false,
    rows: [],
    status: 'idle' as const,
    sessionTitle: 'probe',
    agentId: 'probe',
    model: 'deepseek-v4-flash',
    provider: 'deepseek',
    tokens: { input: 0, output: 0 },
    cwd: 'C:/code/demo-project',
    displayCwd: 'C:/code/demo-project',
    gitBranch: 'main',
    working,
    spinnerMode: 'requesting' as const,
    mode: { plan: false },
    responseChars: 0,
    activeToolCount: 0,
    turnStart: 0,
    lastUserText: '',
    pending: [],
    notifications: [],
    contextSegments: { system: 0, prompt: 0, assistant: 0, thinking: 0, tools: 0 },
    subscribe: () => () => {},
    submit() {},
    steer() {},
    cancel() {},
    clear() {},
    notify() {},
    listModels: () => Promise.resolve([]),
    listSessions: () => [],
    setResumeTarget: () => {},
  }
}

interface ChatHandle {
  stdout: FakeStdout
  stdin: FakeStdin
  plain: () => string
  since: (mark: number) => string
  mark: () => number
  unmount: () => Promise<void>
}

async function mountChat(starPrompt: { dir: string; onStar?: () => void; onOpen?: () => void } | null, working = false): Promise<ChatHandle> {
  const stdout = new FakeStdout(100)
  stdout.rows = 28
  const stdin = new FakeStdin()
  const instance = await render(
    <Chat channel={makeChatChannel(working) as never} questionStore={new QuestionStore()} starPrompt={starPrompt} />,
    { stdout, stdin, stderr: new FakeStderr(), exitOnCtrlC: false, patchConsole: false },
  )
  return {
    stdout,
    stdin,
    plain: () => plainText(stdout.frames),
    mark: () => stdout.frames.length,
    since: (m: number) => plainText(stdout.frames.slice(m)),
    unmount: async () => { await instance.unmount() },
  }
}

const modalShown = (text: string) => text.includes('不知不觉') && text.includes('给 dshTUI 一个 Star')

// C：99h 弹一次；Enter 走 star → 庆祝 → 自己收场；双击 Enter 只算一次；记账落档。
{
  const dir = join(fixtureHome, 'case-c')
  seedUsage(dir, { launches: 1, totalMs: 99 * HOUR_MS + 60_000, celebrated: 2 })
  const starCalls: string[] = []
  const chat = await mountChat({
    dir,
    onStar: () => { starCalls.push('star'); return { kind: 'starred' } },
    onOpen: () => { starCalls.push('open') },
  })
  check('C1 the 99h milestone opens the modal once', await settled(() => modalShown(chat.plain()), { timeoutMs: 5000 }))
  const plain = chat.plain()
  check('C2 title rides the card border', plain.includes('已经陪你 99 小时了') && plain.includes('╭'))
  check('C3 both actions and the Esc hint render',
    plain.includes('在浏览器中打开 GitHub') && plain.includes('Esc 以后再说'))
  check('C4 selection pointer starts on the star row', plain.includes(`${POINTER} 给 dshTUI 一个 Star`))
  check('C5 the modal carries the pixel whale while graphics are off', chat.stdout.frames.join('').includes(WHALE_OUTLINE))
  check('C6 the passive star line yields to the modal', !plain.includes('已陪你'))
  check('C7 the milestone is marked as asked exactly one tier up', readCelebrated(dir) === 3)
  await sleep(300) // 固定窗:pacing 弹窗画出来≠useInput 已订阅（passive effect 晚于绘制一拍），发键前等订阅就绪

  const mark = chat.mark()
  // 跨 tick 的两次 Enter：第一次触发 star（卡进 working，第二次 Enter
  // 在 working/庆祝态不再触发），两种时序下动作都恰好一次。（同 tick 写入
  // "\r\r" 会被合并成一条多字符粘贴事件，key.return 为假，不拿来当用例。）
  chat.stdin.write('\r')
  await new Promise<void>(resolve => setImmediate(resolve))
  chat.stdin.write('\r')
  check('C8 a double Enter fires the star action once', await settled(() => chat.since(mark).includes('收到，谢谢'), { timeoutMs: 5000 })
    && starCalls.length === 1 && starCalls[0] === 'star', `calls=${starCalls.join(',')}`)
  check('C9 a successful star celebrates instead of closing silently',
    chat.since(mark).includes('收到，谢谢') && chat.since(mark).includes('点亮了 dshTUI'))
  // 庆祝自己收场（3.4s）——收场后按键落回输入框，不再触发任何按钮。
  const mark2 = chat.mark()
  await settle(() => !chat.since(mark2).includes('收到，谢谢'), { timeoutMs: 6000 })
  check('C9b the celebration closes itself', !chat.since(mark2).includes('收到，谢谢'))
  chat.stdin.write('\u001b[B')
  await sleep(250) // 固定窗:pacing 按键步间节奏：↓ 与 Enter 必须是两条独立事件，不能合成粘贴
  chat.stdin.write('\r')
  await sleep(400) // 固定窗:探针 关闭后的按键不得再触发动作——"无新调用"没有可轮询锚点，只能等观察窗再断言不变
  check('C10 keys after close reach the composer, not the dead modal', starCalls.length === 1 && !chat.since(mark2).includes('在浏览器中打开 GitHub'))
  await chat.unmount()
}

// D：Esc 关闭；↓ 把指针移到第二个动作，Enter 走 open 动作。
{
  const dir = join(fixtureHome, 'case-d')
  seedUsage(dir, { launches: 1, totalMs: 99 * HOUR_MS + 60_000, celebrated: 2 })
  const calls: string[] = []
  const chat = await mountChat({ dir, onStar: () => { calls.push('star'); return { kind: 'starred' } }, onOpen: () => { calls.push('open') } })
  check('D1 the modal opens again on a fresh ledger', await settled(() => modalShown(chat.plain()), { timeoutMs: 5000 }))
  await sleep(300) // 固定窗:pacing 同 C：画出来≠已订阅，发键前等订阅就绪
  const mark = chat.mark()
  chat.stdin.write('\u001b')
  await settle(() => chat.stdout.frames.length > mark && !chat.since(mark).includes('在浏览器中打开 GitHub'))
  check('D2 Esc closes the modal', !chat.since(mark).includes('在浏览器中打开 GitHub'))
  chat.stdin.write('\u001b[B')
  await sleep(250) // 固定窗:pacing 按键步间节奏：↓ 与 Enter 保持两条独立事件
  chat.stdin.write('\r')
  await sleep(400) // 固定窗:探针 Esc 关闭后的按键不得触发任何动作——无锚点的不变式只能等观察窗
  check('D3 keys after Esc-close do not fire any action', calls.length === 0, `calls=${calls.join(',')}`)
  await chat.unmount()

  const dir2 = join(fixtureHome, 'case-d2')
  seedUsage(dir2, { launches: 1, totalMs: 99 * HOUR_MS + 60_000, celebrated: 2 })
  const chat2 = await mountChat({ dir: dir2, onStar: () => { calls.push('star'); return { kind: 'starred' } }, onOpen: () => { calls.push('open') } })
  check('D4 the modal opens on the second fresh ledger', await settled(() => modalShown(chat2.plain()), { timeoutMs: 5000 }))
  await sleep(300) // 固定窗:pacing 同上，发键前等 useInput 订阅就绪
  const mark2 = chat2.mark()
  chat2.stdin.write('\u001b[B')
  await settle(() => chat2.since(mark2).includes(`${POINTER} 在浏览器中打开 GitHub`))
  check('D5 ↓ moves the pointer onto the browser action', chat2.since(mark2).includes(`${POINTER} 在浏览器中打开 GitHub`))
  // Enter 前另起 mark：↓ 的重绘帧里本来就带着弹窗正文，累计窗口从它
  // 之后起算，"关闭"才成立（与 C9/D2 同一模式）。
  chat2.stdin.write('\r')
  const mark3 = chat2.mark()
  await settle(() => chat2.stdout.frames.length > mark3)
  check('D6 Enter on the browser action fires open and closes', calls.length === 1 && calls[0] === 'open' && !chat2.since(mark3).includes('在浏览器中打开 GitHub'))
  await chat2.unmount()
}

// G：star 失败时卡片留在屏幕上说明原因，浏览器那条路仍可用。
{
  const dir = join(fixtureHome, 'case-g')
  seedUsage(dir, { launches: 1, totalMs: 99 * HOUR_MS + 60_000, celebrated: 2 })
  const chat = await mountChat({
    dir,
    onStar: () => ({ kind: 'failed', detail: 'boom-403', url: 'https://example.test/repo' }),
    onOpen: () => {},
  })
  check('G1 the modal opens', await settled(() => modalShown(chat.plain()), { timeoutMs: 5000 }))
  await sleep(300) // 固定窗:pacing 同 C：画出来≠已订阅，发键前等订阅就绪
  chat.stdin.write('\r')
  // 错误文案在 48 列里会折行，断言只用不会被折开的短片段。
  check('G2 a failed star keeps the card open with the reason',
    await settled(() => chat.plain().includes('没成功') && chat.plain().includes('boom-403'), { timeoutMs: 5000 }))
  check('G3 the failure view keeps the browser escape hatch', chat.plain().includes('在浏览器中打开 GitHub'))
  chat.stdin.write('\u001b')
  await sleep(300) // 固定窗:pacing Esc 关闭后确认重绘
  await chat.unmount()
}

// E：非历史档（24h）不弹窗。
{
  const dir = join(fixtureHome, 'case-e')
  seedUsage(dir, { launches: 1, totalMs: 24 * HOUR_MS + 60_000, celebrated: 0 })
  const chat = await mountChat({ dir })
  await sleep(1500) // 固定窗:探针 非历史档不得弹窗——"不出现"没有可轮询锚点，观察窗须盖过 700ms 的弹窗延迟
  check('E1 a non-historic milestone never opens the modal', !chat.plain().includes('不知不觉'))
  check('E2 a non-historic milestone leaves the ledger untouched', readCelebrated(dir) === 0)
  await chat.unmount()
}

// F：回合进行中不弹、不记账（留给下一次启动）。
{
  const dir = join(fixtureHome, 'case-f')
  seedUsage(dir, { launches: 1, totalMs: 99 * HOUR_MS + 60_000, celebrated: 2 })
  const chat = await mountChat({ dir }, true)
  await sleep(1500) // 固定窗:探针 忙时启动不得弹窗——同上，观察窗盖过 700ms 弹窗延迟
  check('F1 a busy startup never opens the modal', !chat.plain().includes('不知不觉'))
  check('F2 a busy startup does not mark the milestone', readCelebrated(dir) === 2)
  await chat.unmount()
}

rmSync(fixtureHome, { recursive: true, force: true })
if (failures > 0) {
  console.error(`\n${failures} of ${checks} whale-girl checks FAILED.`)
  process.exit(1)
}
console.log(`\nAll ${checks} whale-girl checks passed.`)
