#!/usr/bin/env node
/**
 * Regression #882: full argv -> launcher -> app args -> targets + submission.
 * Run after build: node scripts/verify-startup-argv.mjs
 *
 * Runs the real bin (including its two-hop delegation) under an isolated HOME.
 * The downstream stub uses Commander's DSH --profile/pass-through grammar and
 * the real cmdline provider, then executes the compiled plugin's startup
 * selection/submission statements with a recording channel. This is a bounded
 * argv integration check, not a full Cordis/TTY/model-session boot.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

const root = fileURLToPath(new URL('../', import.meta.url))
const bin = join(root, 'bin/dsh-tui.js')
const self = fileURLToPath(import.meta.url)
const probeMode = process.env.DSH_TUI_ARGV_PROBE === '1'

if (probeMode) {
  if (process.argv[2] === '--version') {
    console.log('dsh argv fixture')
    process.exit(0)
  }
  const fromWeb = createRequire(import.meta.resolve('@deepseek-ai/dsh-web-app/package.json'))
  const { Command } = fromWeb('commander')
  const { provideCmdline } = fromWeb('@deepseek-ai/dsh-cmdline')
  // DSH owns --profile and the first --; everything passed through belongs
  // to the app. In particular, simply slicing argv after --profile is wrong.
  const program = new Command()
    .helpOption(false).allowUnknownOption().passThroughOptions().enablePositionalOptions()
    .option('--profile <name>').argument('[args...]')
    .parse(process.argv.slice(2), { from: 'user' })
  assert.equal(program.opts().profile, 'dsh-tui')
  const ctx = { provide(name, value) { this[name] = value } }
  provideCmdline(ctx, { args: program.args, exit: code => process.exit(code) })
  if (process.env.DSH_TUI_ARGV_SHAPE === 'args') ctx.cmdlineArgs = { args: program.args }

  const { initialPromptFromCmdlineArgs } = await import('../lib/types/dsh-adapter/plugin.js')
  const { resumeTargetFromArgv } = await import('../lib/types/sessionHistory.js')
  const { default: ts } = await import('typescript')
  const code = readFileSync(join(root, 'lib/types/dsh-adapter/plugin.js'), 'utf8')
  const source = ts.createSourceFile('plugin.js', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const apply = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'apply')
  assert.ok(apply?.body, 'compiled plugin apply exists')
  const declarations = new Map()
  for (const statement of apply.body.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      declarations.set(declaration.name.getText(source), statement.getText(source))
    }
  }
  const names = ['cmdline', 'cmdlineArgs', 'requestedWorkspace', 'launchSessionId', 'submitChannel', 'initialPrompt']
  const startup = names.map(name => {
    assert.ok(declarations.has(name), `compiled startup declaration: ${name}`)
    return declarations.get(name)
  })
  const submit = apply.body.statements.find(node => ts.isIfStatement(node) && node.expression.getText(source) === 'initialPrompt')
  assert.ok(submit, 'compiled initial prompt submission branch exists')
  const submitted = []
  const scope = {
    ctx, process, initialPromptFromCmdlineArgs, resumeTargetFromArgv,
    config: {
      sessionId: process.env.DSH_TUI_RESUME_SESSION,
      workspace: process.env.DSH_TUI_WORKSPACE_TARGET,
    },
    shadow: false,
    channel: { submit: text => submitted.push(text) },
  }
  runInNewContext([
    ...startup, submit.getText(source),
    'globalThis.targets = { session: launchSessionId ?? null, workspace: requestedWorkspace ?? null }',
  ].join('\n'), scope)
  console.log(JSON.stringify({
    ...scope.targets, submitted,
    resumeEnv: process.env.DSH_TUI_RESUME_SESSION ?? null,
    workspaceEnv: process.env.DSH_TUI_WORKSPACE_TARGET ?? null,
  }))
  process.exit(0)
}

const temp = mkdtempSync(join(tmpdir(), 'dsh-tui-argv-'))
let failures = 0
let checks = 0
try {
  const stubDir = join(temp, 'bin')
  const dshHome = join(temp, '.dsh')
  const profilePackage = join(dshHome, 'profiles/dsh-tui/node_modules/@deepseek-harness-tui/dsh-tui')
  const workspace = join(temp, 'literal workspace')
  for (const dir of [stubDir, join(profilePackage, 'bin'), join(temp, '.dsh-tui'), workspace]) {
    mkdirSync(dir, { recursive: true })
  }
  const { name, version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  writeFileSync(join(profilePackage, 'package.json'), JSON.stringify({ name, version, type: 'module' }))
  copyFileSync(bin, join(profilePackage, 'bin/dsh-tui.js'))
  writeFileSync(join(temp, '.dsh-tui/resume.txt'), 'remembered-session')
  const isWin = process.platform === 'win32'
  const quoteSh = value => `'${value.replaceAll("'", "'\\''")}'`
  writeFileSync(join(stubDir, 'dsh'), `#!/bin/sh\nexec ${quoteSh(process.execPath)} ${quoteSh(self)} "$@"\n`, { mode: 0o755 })
  if (isWin) {
    writeFileSync(join(stubDir, 'dsh.cmd'), `@echo off\r\n"${process.execPath}" "${self}" %*\r\n@exit /b %errorlevel%\r\n`)
  }
  const env = {
    PATH: [stubDir, dirname(process.execPath), ...(isWin ? ['C:\\Windows\\System32', 'C:\\Windows'] : ['/usr/bin', '/bin'])].join(delimiter),
    ...(isWin ? { SystemRoot: process.env.SystemRoot, ComSpec: process.env.ComSpec, PATHEXT: process.env.PATHEXT } : {}),
    HOME: temp, USERPROFILE: temp, DSH_HOME: dshHome,
    DSH_TUI_ARGV_PROBE: '1', NODE_OPTIONS: '--no-deprecation',
  }
  const cases = [
    ...[
      ['--resume=sid-1'], ['--resume', 'sid-1'], ['-c'], ['--continue'],
      ['.'], [workspace], ['ssh://sandbox/workspace'],
      ['--host', 'example'], ['--profile', 'not-the-profile'], ['--', '--resume=sid-1'],
    ].map(literal => ({ name: `literal ${literal.join(' ')}`, argv: ['--', ...literal], prompt: literal.join(' ') })),
    { name: 'prefix prompt', argv: ['explain', '--', '--resume=sid-1'], prompt: 'explain --resume=sid-1' },
    { name: 'explicit resume before separator', argv: ['--resume', 'real-session', '--', '--resume=literal'], session: 'real-session', prompt: '--resume=literal' },
    { name: 'bare resume before separator', argv: ['--resume', '--', '--continue'], session: 'remembered-session', prompt: '--continue' },
    { name: 'continue before separator', argv: ['-c', '--', '--resume=literal'], session: 'remembered-session', prompt: '--resume=literal' },
    { name: 'long continue before separator', argv: ['--continue', '--', '--resume=literal'], session: 'remembered-session', prompt: '--resume=literal' },
    { name: 'ordinary resume', argv: ['--resume=real-session'], session: 'real-session', prompt: '' },
    { name: 'Web startup flags', argv: ['--host', '127.0.0.1', '--port', '3099', '--trusted-host', 'a:1', 'b:2'], prompt: '' },
    { name: 'separator only', argv: ['--'], prompt: '' },
    { name: 'explicit workspace before separator', argv: [workspace, '--', '--resume=literal', '.'], workspace, prompt: '--resume=literal .', binOnly: true },
  ]
  for (const route of ['bin', 'delegated-bin', 'direct-profile']) {
    for (const shape of ['get', 'args']) {
      for (const test of cases) {
        if (test.binOnly && route === 'direct-profile') continue
        const direct = route === 'direct-profile'
        // The explicit outer -- belongs to DSH, the inner one (in test.argv)
        // belongs to the app. Real options after just the outer -- must work.
        const argv = direct ? [self, '--profile', 'dsh-tui', '--', ...test.argv] : [bin, ...test.argv]
        const result = spawnSync(process.execPath, argv, {
          cwd: temp, encoding: 'utf8', timeout: 15000,
          env: { ...env, DSH_TUI_ARGV_SHAPE: shape, ...(route === 'bin' ? { DSH_TUI_NO_DELEGATE: '1' } : {}) },
        })
        const label = `${route}/${shape}: ${test.name}`
        checks += 1
        try {
          assert.equal(result.error, undefined)
          assert.equal(result.status, 0, result.stderr)
          assert.deepEqual(JSON.parse(result.stdout), {
            session: test.session ?? null,
            workspace: test.workspace ?? null,
            submitted: test.prompt ? [test.prompt] : [],
            resumeEnv: direct ? null : test.session ?? null,
            workspaceEnv: test.workspace ?? null,
          })
          console.log(`PASS: ${label}`)
        } catch (error) {
          failures += 1
          console.error(`FAIL: ${label}\n${error.message}`)
        }
      }
    }
  }
} finally {
  rmSync(temp, { recursive: true, force: true })
}
console.log(`verify-startup-argv: ${checks - failures}/${checks} passed`)
if (failures > 0) process.exit(1)
