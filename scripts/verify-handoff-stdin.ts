/**
 * verify-handoff-stdin — /restart | /update 交接时，父进程必须"只分离、不销毁"
 * 自己的 stdin。
 *
 * pty 的 termios 是每设备的，替换进程继承的就是同一份：销毁 TTY 流会让 Node
 * 把父进程保存的 cooked/ECHO 模式写回去，踩掉子进程的 raw 模式。此后终端把
 * 鼠标上报当输入回显（`^[[<…M` 出现在输入框那一行），键入也要等换行才送达。
 * 现场实测（WSL + Windows Terminal，看门狗第 15 拍）：
 *   destroy → 子进程看到 ECHO-ON(cooked)；detach → 保持 no-echo(raw)。
 *
 * 用法:node --import tsx/esm scripts/verify-handoff-stdin.ts
 */
import { readFileSync } from 'node:fs'

import { detachHandoffStdin } from '../src/update.js'

let failures = 0
function check(name: string, ok: boolean, extra = ''): void {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? `  (${extra})` : ''}`)
  if (!ok) failures++
}

type FakeStdin = Pick<NodeJS.ReadStream, 'removeAllListeners' | 'pause' | 'unref'> & {
  calls: string[]
  liveListeners: Set<string>
}

/** 假 console 流:记录调用；destroy 一旦被调用即为缺陷（回显 bug 的根因）。 */
function fakeStdin(): FakeStdin {
  const calls: string[] = []
  const liveListeners = new Set(['readable', 'data'])
  return {
    calls,
    liveListeners,
    removeAllListeners(event: string) {
      calls.push(`removeAllListeners:${event}`)
      liveListeners.delete(event)
      return this
    },
    pause() {
      calls.push('pause')
      return this
    },
    unref() {
      calls.push('unref')
      return this
    },
  }
}

const stdin = fakeStdin()
detachHandoffStdin(stdin as unknown as NodeJS.ReadStream)

check('readable 监听已摘除', !stdin.liveListeners.has('readable'))
check('data 监听已摘除', !stdin.liveListeners.has('data'))
check('流已 pause', stdin.calls.includes('pause'))
check('流已 unref', stdin.calls.includes('unref'))
check(
  '没有 destroy（销毁会把 cooked/ECHO 写回，踩掉替换进程的 raw）',
  !stdin.calls.some(call => call.startsWith('destroy')),
  stdin.calls.join(','),
)

// 交接路径本身:看门狗只能走 detachHandoffStdin，不能再出现 stream.destroy()。
const source = readFileSync(new URL('../src/update.ts', import.meta.url), 'utf8')
check('src/update.ts 交接路径不再销毁 stdin', !/\bstdin\.destroy\(\)/.test(source))
check('看门狗走 detachHandoffStdin', /detachHandoffStdin\(stdin\)/.test(source))

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
