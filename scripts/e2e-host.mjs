// 不装进 DSH、也不重启，就直接把 host 半端拉起来验一遍。
// 用途：改完 index.js / lib/*.mjs 之后，想确认「工具注册对不对、HTTP 路由通不通、
// 真跑一轮能不能出报告」，又不想为此重启整个应用。
//
//   node scripts/e2e-host.mjs            # 只看工具 + 状态 + 三条 HTTP 路由
//   node scripts/e2e-host.mjs --run      # 再真跑一轮（会真的开浏览器、花几分钟）
//   node scripts/e2e-host.mjs --route    # 只打 HTTP 路由
//
// 家目录默认 ~/.dsh（可用 DOUYIN_DUTY_HOME_ROOT 覆盖，注意它下面是 douyin-duty/）。

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.env.DOUYIN_DUTY_HOME_ROOT || join(process.env.DSH_HOME || join(homedir(), '.dsh'))
const SELF = new URL('../index.js', import.meta.url)
const wantRun = process.argv.includes('--run')
const onlyRoute = process.argv.includes('--route')

const tools = new Map()
let route = null
const logs = []
const logger = {
  info: (m) => { logs.push(m); console.log('[log]', m) },
  warn: (m) => { logs.push(m); console.log('[warn]', m) },
  error: (m) => { logs.push(m); console.log('[err]', m) },
}

const mod = await import(pathToFileURL(SELF.pathname.replace(/^\/(?=[A-Za-z]:)/, '')).href)

const ctx = {
  logger,
  // 真 host 里这是个函数：get('dshHomePath')('douyin-duty') → <DSH_HOME>/douyin-duty
  get: (k) => (k === 'dshHomePath' ? (...seg) => join(ROOT, ...seg) : undefined),
  effect: () => {},
  tools: { register: (t) => { tools.set(t.name, t); return t } },
  webServer: { register: (fn) => { route = fn } },
  settings: { describe: () => ({}), update: (p) => p },
}

mod.apply(ctx, {})

const names = [...tools.keys()]
const expect = [
  'dy_whoami', 'dy_search', 'dy_video', 'dy_comments', 'dy_user',
  'dy_user_posts', 'dy_chrome', 'dy_comment', 'dy_status', 'dy_run', 'dy_config',
]
const missing = expect.filter((n) => !names.includes(n))
console.log(`\n工具 ${names.length} 个：${names.join(' / ')}`)
if (missing.length) {
  console.log(`✗ 少了：${missing.join(', ')}`)
  process.exitCode = 1
} else {
  console.log('✓ 11 个工具齐了')
}

if (!onlyRoute) {
  const st = await tools.get('dy_status').execute({}, {})
  console.log('\n状态：', JSON.stringify(st, null, 2).slice(0, 900))
}

// ---- HTTP 路由（设置页用的那几个）----
if (!route) {
  console.log('\n✗ 没拿到 webServer 路由')
  process.exitCode = 1
} else {
  const call = (method, url) => new Promise((resolve) => {
    const chunks = []
    const res = {
      statusCode: 0,
      headers: {},
      setHeader(k, v) { this.headers[k] = v },
      // 少这个就会静默出不来结果 —— 假 res 最容易漏的一处
      writeHead(code, hdrs) { this.statusCode = code; Object.assign(this.headers, hdrs || {}) },
      end(s) { chunks.push(s ?? ''); resolve({ status: this.statusCode, body: chunks.join('') }) },
      write(s) { chunks.push(s) },
    }
    const req = { method, url, headers: {}, on: (e, fn) => { if (e === 'end') fn() } }
    route(req, res)
    setTimeout(() => resolve({ status: res.statusCode, body: chunks.join('') || '(no response)' }), 8000)
  })

  console.log('\n--- HTTP 路由 ---')
  for (const [m, u] of [
    ['GET', '/api/douyin-duty/status'],
    ['GET', '/api/douyin-duty/config'],
    ['GET', '/api/douyin-duty/report'],
  ]) {
    const r = await call(m, u)
    const ok = r.status === 200
    console.log(`${ok ? '✓' : '✗'} ${m} ${u} → ${r.status}  ${String(r.body).slice(0, 180)}`)
    if (!ok) process.exitCode = 1
  }
}

if (wantRun) {
  console.log('\n=== dy_run（真跑一轮）===')
  const r = await tools.get('dy_run').execute({}, {})
  console.log(JSON.stringify(r).slice(0, 1500))
  const outFile = join(ROOT, 'douyin-duty', 'out', new Date().toISOString().slice(0, 10) + '.md')
  console.log(existsSync(outFile) ? `✓ 报告在 ${outFile}` : `· 报告还没出现（${outFile}）`)
}

process.exit(process.exitCode || 0)