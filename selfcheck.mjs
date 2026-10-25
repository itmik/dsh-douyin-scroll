/**
 * selfcheck.mjs —— 不装进宿主也能跑的自检
 * ============================================================================
 * 跑法：node selfcheck.mjs
 *
 * 它做的事（全部离线，不碰网络、不碰浏览器）：
 *   1. 用假 ctx 把 index.js 的 apply() 跑一遍（tools.register / webServer.register /
 *      settings.describe 都做成桩），确认模块能加载、schema 能建、工具能注册。
 *   2. 用假 window 把 client.js 的自注册跑一遍，确认 factory 不炸、Panel 能渲染成元素树。
 *   3. 检查家目录模板文件（prompts/duty.md、profile-template）都在。
 *
 * ⚠️ 注意：这里**不启动浏览器**。真正要验抖音数据的活，用 `dy_status` / `dy_search` 在宿主里试。
 * ============================================================================
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
let pass = 0
let fail = 0
const ok = (name, extra) => { pass++; console.log(`  ✓ ${name}${extra ? ' — ' + extra : ''}`) }
const bad = (name, why) => { fail++; console.log(`  ✗ ${name} — ${why}`) }

const tmpHome = mkdtempSync(join(tmpdir(), 'douyin-selfcheck-'))

// ── 1. host 半端 ─────────────────────────────────────────────────────────
console.log('\n[1/3] host 半端（index.js）')
try {
  const mod = await import(pathToFileURL(join(here, 'index.js')).href)
  ok('模块能 import', `name=${mod.name}`)
  if (mod.name !== 'douyin-scroll') bad('导出 name', `期望 douyin-scroll，实际 ${mod.name}`)
  else ok('导出 name')
  const wantInject = ['webServer', 'tools', 'settings']
  const gotInject = Array.isArray(mod.inject) ? mod.inject : []
  if (wantInject.every((k) => gotInject.includes(k))) ok('inject 齐全', gotInject.join(','))
  else bad('inject', `期望含 ${wantInject.join(',')}，实际 ${gotInject.join(',') || '(空)'}`)
  if (!mod.Config) bad('导出 Config', '没有 Config ⇒ 设置页读不到 schema')
  else ok('导出 Config')

  // 假 ctx
  const registered = []
  const routes = []
  const effects = []
  const ctx = {
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    get: (k) => (k === 'dshHomePath' ? () => tmpHome : undefined),
    effect: (fn) => { effects.push(fn) },
    tools: { register: (t) => { registered.push(t); return t } },
    webServer: { register: (spec) => { routes.push(spec) } },
    settings: { describe: () => ({}), update: () => {} },
  }
  mod.apply(ctx, {})
  // effect 可能是「登记清理函数」（0 参）也可能是「立即执行的注册回调」——两种都跑一遍，
  // 宿主里前者收 teardown、后者做挂载（抄 bili 的写法就是后者）。
  let ranEffects = 0
  for (const fn of effects) { if (typeof fn === 'function') { try { fn() } catch { /* 清理回调没有副作用可跑 */ } ranEffects++ } }
  ok('apply() 没抛异常', `注册了 ${registered.length} 个工具、${routes.length} 条路由（跑了 ${ranEffects} 个 effect）`)

  // 路由形状：宿主认 {kind:'prefix', path, handler}（抄 bili 2.0.4+）
  const prefix = routes.find((r) => r && typeof r === 'object' && r.kind === 'prefix' && r.path === '/api/douyin-duty')
  if (prefix && typeof prefix.handler === 'function') {
    ok('HTTP 路由是 prefix 形状', 'handler 存在')
    // 直接打一遍 handler，不碰网络：假 req/res（带 writeHead，sendJson 需要它）
    const mkRes = () => {
      const chunks = []
      return {
        statusCode: 0, headers: {},
        setHeader(k, v) { this.headers[k] = v },
        writeHead(c, h) { this.statusCode = c; Object.assign(this.headers, h || {}) },
        end(s) { chunks.push(s ?? ''); this._body = chunks.join('') },
        write(s) { chunks.push(s) },
      }
    }
    const hit = async (url, method = 'GET', headers = {}) => {
      const res = mkRes()
      await prefix.handler({ method, url, headers, on: () => {} }, res)
      return { code: res.statusCode, body: res._body || '' }
    }
    const st = await hit('/api/douyin-duty/status')
    if (st.code === 200 && st.body.startsWith('{"ok":true')) ok('handler: GET /status → 200', st.body.slice(0, 40))
    else bad('handler: GET /status', `${st.code} ${st.body.slice(0, 120)}`)
    const unk = await hit('/api/douyin-duty/no-such-route')
    if (unk.code === 404) ok('handler: 未知路径 → 404')
    else bad('handler: 未知路径', `期望 404，实际 ${unk.code}`)
    const x = await hit('/api/douyin-duty/status', 'GET', { host: '127.0.0.1:3108', origin: 'http://evil.local:9999' })
    if (x.code === 403) ok('handler: 跨源请求 → 403（同源栅栏）')
    else bad('handler: 跨源请求', `期望 403，实际 ${x.code}`)
  } else {
    bad('HTTP 路由形状', '没找到 {kind:prefix, path:/api/douyin-duty, handler}（路由表挂不上 ⇒ 宿主回 401）')
  }

  const names = registered.map((t) => t.name)
  const want = [
    'dy_whoami', 'dy_search', 'dy_video', 'dy_comments', 'dy_user',
    'dy_user_posts', 'dy_chrome', 'dy_comment', 'dy_status', 'dy_run', 'dy_config',
  ]
  const missing = want.filter((n) => !names.includes(n))
  if (missing.length) bad('工具齐全', '缺 ' + missing.join(', '))
  else ok('工具齐全（11 个）')
  for (const t of registered) {
    if (!t.description || t.description.length < 8) bad(`工具 ${t.name} 的 description`, '太短 / 缺失')
    if (!t.parameters || typeof t.parameters !== 'object') bad(`工具 ${t.name} 的 parameters`, '缺失')
    if (typeof t.execute !== 'function') bad(`工具 ${t.name} 的 execute`, '不是函数')
  }
  if (!fail) ok('每个工具都有 description / parameters / execute')

  // 安全闸：自动评论关着时 dy_comment 必须拒绝
  const commentTool = registered.find((t) => t.name === 'dy_comment')
  const r = await commentTool.execute({ aweme_id: '123', text: 'hi' }, {})
  if (r && r.blocked) ok('自动评论关着时 dy_comment 会拦', r.hint ? '有提示' : '')
  else bad('自动评论闸', '关着的时候居然没拦：' + JSON.stringify(r))

  // dy_config 只认 schema 里的字段
  const cfgTool = registered.find((t) => t.name === 'dy_config')
  const rc = await cfgTool.execute({ patch: { perDay: 3, 乱七八糟: 'x' } }, {})
  if (rc && rc.applied && rc.applied.perDay === 3 && !('乱七八糟' in rc.applied)) ok('dy_config 过滤未知字段')
  else bad('dy_config 过滤', JSON.stringify(rc))

  // dy_status 能跑
  const stTool = registered.find((t) => t.name === 'dy_status')
  const rs = await stTool.execute({}, {})
  if (rs && rs.ok && rs.today && rs.windows?.noon) ok('dy_status 返回结构正常', `today=${rs.today}`)
  else bad('dy_status', JSON.stringify(rs).slice(0, 200))
} catch (e) {
  bad('host 半端整体', e?.stack ?? String(e))
}

// ── 2. client 半端 ───────────────────────────────────────────────────────
console.log('\n[2/3] client 半端（client.js）')
try {
  const src = readFileSync(join(here, 'client.js'), 'utf8')
  ok('文件可读', `${(src.length / 1024).toFixed(1)} KB`)

  // 这个 bundle 是自注册脚本：造一个假 window 去接
  let got = null
  const fakeDocument = {
    createElement: () => ({ setAttribute() {}, remove() {}, set textContent(v) {}, style: {} }),
    head: { appendChild() {} },
  }
  // 极小的 React 替身（只认 createElement / Fragment / useState / useEffect / useRef）
  const React = {
    createElement: (type, props, ...kids) => ({ type, props: props || {}, kids }),
    Fragment: Symbol('Fragment'),
    useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
    useEffect: () => {},
    useRef: (v) => ({ current: v }),
  }
  const fakeWindow = {
    __ModuleLoader__: {
      load: (def) => { got = def },
    },
    document: fakeDocument,
  }
  const fn = new Function('window', 'document', 'require', src + '\n;return window.__ModuleLoader__ && true')
  const req = (id) => (id === 'react' ? React : {})
  fn(fakeWindow, fakeDocument, req)

  if (!got) bad('自注册', '没调用 __ModuleLoader__.load')
  else {
    ok('自注册', `id=${got.id}`)
    if (got.id !== 'dsh-douyin-scroll') bad('bundle id', `期望 dsh-douyin-scroll，实际 ${got.id}`)
    const api = got.factory(req)
    if (typeof api?.apply !== 'function') bad('factory', '没返回 apply')
    else ok('factory 返回 apply')
    if (!Array.isArray(api.inject) || !api.inject.includes('slots')) bad('inject', JSON.stringify(api.inject))
    else ok('inject 含 slots')

    // 拿 Panel 出来渲染一下（不挂真实 React，只是走一遍 createElement）
    let panelEl = null
    const slots = {
      inject: (slot, fn2) => { fn2() },
      register: (meta, comp) => { if (meta.name === 'settings.section') panelEl = comp },
    }
    api.apply({
      get: () => slots,
      effect: (fn3) => fn3(),
    })
    if (!panelEl) bad('注册设置页', '没注册 settings.section')
    else {
      ok('注册设置页', 'settings.section')
      const el = panelEl()
      if (el && el.type) ok('Panel 能渲染成元素树')
      else bad('Panel 渲染', JSON.stringify(el)?.slice(0, 120))
    }
  }
} catch (e) {
  bad('client 半端整体', e?.stack ?? String(e))
}

// ── 3. 随包文件 ──────────────────────────────────────────────────────────
console.log('\n[3/3] 随包文件')
for (const [label, rel] of [
  ['值章程 prompts/duty.md', 'prompts/duty.md'],
  ['profile 模板 cordis.yml', 'profile-template/douyin-duty/cordis.yml'],
  ['profile 模板 cordis.patch.yml', 'profile-template/douyin-duty/cordis.patch.yml'],
  ['profile 模板 package.json', 'profile-template/douyin-duty/package.json'],
  ['bundle patch cordis.patch.yml', 'cordis.patch.yml'],
  ['package.json', 'package.json'],
  ['README.md', 'README.md'],
]) {
  if (existsSync(join(here, rel))) ok(label)
  else bad(label, '文件不在：' + rel)
}

try { rmSync(tmpHome, { recursive: true, force: true }) } catch { /* 删不掉算了 */ }

console.log(`\n${fail ? '✗' : '✓'} 通过 ${pass} 项${fail ? `，失败 ${fail} 项` : ''}\n`)
process.exit(fail ? 1 : 0)