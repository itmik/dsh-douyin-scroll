/**
 * lib/browser.mjs —— Playwright 持久 Edge 会话
 * ============================================================================
 * 整个插件的"手"：抖音网页版的所有数据读取和评论发送都通过它。
 *
 * 设计要点（跟 bili-scroll 的 Python MCP 完全不同的路）：
 *   1. **不复用用户已开的浏览器** —— 起一个**独立的**持久 profile
 *      （~/.dsh/douyin-browser/cli-profile），CDP 端口固定 9238。
 *      用户在那个浏览器里登录一次，之后 cookie 就一直在，登录态自动延续。
 *   2. **懒启动**：第一次调用 ensureBrowser() 才 launch；之后所有调用复用同一个 context。
 *   3. **所有 API 调用走 page.evaluate(fetch(...))**：
 *      - 浏览器自动带 cookie（sessionid_ss 等）
 *      - 走的是抖音前端真实请求的**完整参数集**（aid/channel/device_platform 等），
 *        直接 Node fetch 会 404 "Unsupported path(Janus)"，浏览器里不会。
 *   4. **搜索接口返回的是带 hex 长度帧的二进制流**：
 *      <7位hex>\r\n<json>\r\n<hex>\r\n<json>... <hex=0> 结尾
 *      解析在 lib/api.mjs 里做。
 *   5. **评论发送走 UI 流程**（已验证）：
 *      视频页 → 等 6s → 点占位符 span → Draft.js contenteditable 出现 → 打字 → Enter → POST 自动发出
 *
 * 端口 9238 选它而不是 9227（被 dsh-douyin-agent 占了）。
 */
import path from 'node:path'
import { createRequire } from 'node:module'
import { readdirSync } from 'node:fs'

/** 可被宿主改（设置页里的 cdpPort / headless） */
const opt = { port: 9238, profile: '', headless: false }
export const configure = (patch = {}) => { Object.assign(opt, patch) }

const PROFILE_DIR = () => opt.profile
  || path.join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh', 'douyin-browser', 'cli-profile')

/** 解析 playwright-core（宿主那棵树里有；拿不到再退自己的 node_modules） */
const resolvePlaywright = () => {
  const dshHome = process.env.DSH_HOME || path.join(process.env.USERPROFILE || process.env.HOME || '', '.dsh')
  const roots = []
  // ⭐ 别再写死 'desktop'：有人跑 web profile、有人自建 profile。
  //   挨个 profile 的 node_modules 都试一遍（顺序：desktop 优先，然后其余按名字）。
  const profileRoot = path.join(dshHome, 'profiles')
  let names = []
  try { names = readdirSync(profileRoot, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) } catch { /* 没有就算了 */ }
  names.sort((a, b) => (a === 'desktop' ? -1 : b === 'desktop' ? 1 : a.localeCompare(b)))
  for (const n of names) roots.push(path.join(profileRoot, n, 'node_modules'))
  // 自己的依赖（「装依赖」会装到家目录）
  roots.push(path.join(dshHome, 'douyin-duty', 'node_modules'))
  // 插件自己那棵树（开发态 / npm 装的情况）
  try { roots.push(path.dirname(createRequire(import.meta.url).resolve('playwright-core/package.json'))) } catch { /* 跳过 */ }
  for (const root of roots) {
    try {
      const mod = createRequire(path.join(root, 'pkg.json'))('playwright-core')
      if (mod?.chromium) return mod
    } catch { /* 下一个 */ }
    // pnpm 的 store 布局：node_modules/.pnpm/playwright-core@*/node_modules/playwright-core
    try {
      const store = path.join(root, '.pnpm')
      for (const d of readdirSync(store)) {
        if (!d.startsWith('playwright-core@')) continue
        const mod = createRequire(path.join(root, 'pkg.json'))('./.pnpm/' + d + '/node_modules/playwright-core')
        if (mod?.chromium) return mod
      }
    } catch { /* 没有 .pnpm */ }
  }
  throw new Error('找不到 playwright-core：在 ' + roots.join(' 、 ')
    + ' 里都没找到。装一下就好：dsh plugin --profile desktop add playwright-core'
    + '（或跑一次插件设置页里的「装依赖」）')
}

let _chromium = null
let _context = null      // 持久 context（跨调用复用）
let _launching = null    // 并发去重
let _page = null
let _borrowed = false    // true = 连的是别人已经开着的浏览器（别关它）

/**
 * ⭐ 关键：**一个 profile 只能被一个 Chromium 实例锁住**。
 * 宿主插件和「值班轮里的 MCP 进程」都会走到这里 —— 如果两边各 launch 一次，
 * 第二个会拿到 "ProcessSingleton" 之类的锁错误。
 * 所以先试着 **connectOverCDP** 连已经开着的那个；连不上才自己 launch。
 */
const cdpUrl = () => `http://127.0.0.1:${Number(opt.port) || 9238}`

const tryAttach = async () => {
  try {
    const { chromium } = _chromium
    const browser = await chromium.connectOverCDP(cdpUrl(), { timeout: 4000 })
    const ctx = browser.contexts()[0]
    if (!ctx) { await browser.close().catch(() => {}); return null }
    // 验一下真的能用（有些端口上跑的是别的东西）
    if (!ctx.pages().length) await ctx.newPage()
    _borrowed = true
    return ctx
  } catch { return null }
}

/** 拿一个可用的 page（懒启动浏览器；失败抛错） */
export async function ensurePage() {
  if (!_chromium) _chromium = resolvePlaywright()
  if (_context && (_context.browser()?.isConnected?.() ?? true)) return getActivePage(_context)
  if (_launching) return _launching
  _launching = (async () => {
    const { chromium } = _chromium
    // 1) 先看有没有人已经开着（宿主插件 / 上一个进程）
    const attached = await tryAttach()
    if (attached) {
      _context = attached
      return getActivePage(_context)
    }
    // 2) 没有就自己开
    const profile = PROFILE_DIR()
    try {
      _context = await chromium.launchPersistentContext(profile, {
        channel: 'msedge',
        headless: Boolean(opt.headless),
        args: [`--remote-debugging-port=${Number(opt.port) || 9238}`, '--remote-debugging-address=127.0.0.1'],
        viewport: { width: 1280, height: 720 },
      })
      _borrowed = false
      // 等 douyin 域名的页面就绪（首次会开 about:blank）
      await _context.newPage()
      return getActivePage(_context)
    } finally {
      // 保留 _launching 直到返回（并发调用拿到同一个 context）
      setTimeout(() => { _launching = null }, 0)
    }
  })()
  return _launching
}

/** 选一个"能用"的 page：优先 douyin 域名的；没有就开一个 */
async function getActivePage(context) {
  const pages = context.pages()
  const existing = pages.find((p) => p.url().includes('douyin.com'))
  if (existing) {
    _page = existing
    return existing
  }
  _page = await context.newPage()
  await _page.goto('https://www.douyin.com/', { waitUntil: 'domcontentloaded', timeout: 30_000 })
  return _page
}

/** 在 douyin 页面上下文里 fetch 并 JSON 解析（cookie 自动带上） */
export async function apiFetch(url, { method = 'GET', body, headers, timeoutMs = 30_000 } = {}) {
  const page = await ensurePage()
  // 保证在 douyin 域名下（fetch 的 cookie 同源）
  if (!page.url().includes('douyin.com')) {
    await page.goto('https://www.douyin.com/', { waitUntil: 'domcontentloaded', timeout: 30_000 })
  }
  return page.evaluate(async ({ u, method, body, headers, timeoutMs }) => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetch(u, {
        method,
        headers: headers && Object.keys(headers).length ? headers : undefined,
        body: body || undefined,
        credentials: 'include',
        signal: ctrl.signal,
      })
      // 保留原始文本（可能是 hex 帧流，也可能是 HTML 错误页）
      const text = await res.text()
      return { status: res.status, text }
    } catch (e) {
      return { error: String(e?.message ?? e), aborted: true }
    } finally {
      clearTimeout(timer)
    }
  }, { u: url, method, body, headers: headers || {}, timeoutMs })
}

/** 搜索接口专用：hex 帧流解析 */
export async function searchStreamFetch(url, { timeoutMs = 30_000 } = {}) {
  const page = await ensurePage()
  if (!page.url().includes('douyin.com')) {
    await page.goto('https://www.douyin.com/', { waitUntil: 'domcontentloaded', timeout: 30_000 })
  }
  const out = await page.evaluate(async ({ u, timeoutMs }) => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetch(u, { credentials: 'include', signal: ctrl.signal })
      const buf = await res.arrayBuffer()
      const bytes = new Uint8Array(buf)
      // hex 帧：每段 <十六进制字节数>\r\n<JSON 字节>\r\n，len=0 终止。
      // ⚠️ 长度是**字节数**，不是字符数 —— 所以必须按 Uint8Array 切，再 TextDecoder 解，
      //    不能用 String.fromCharCode(...bytes)（大响应会爆栈，而且中文会乱码）。
      const utf8 = new TextDecoder('utf-8')
      const ascii = new TextDecoder('ascii')
      const chunks = []
      let i = 0
      while (i < bytes.length) {
        let nl = -1
        for (let j = i; j < bytes.length; j++) { if (bytes[j] === 10) { nl = j; break } }
        if (nl === -1) break
        const header = ascii.decode(bytes.subarray(i, nl)).replace(/\r/g, '').trim()
        const len = parseInt(header, 16)
        i = nl + 1
        if (!Number.isFinite(len) || len <= 0) break
        if (i + len > bytes.length) break
        chunks.push(utf8.decode(bytes.subarray(i, i + len)))
        i += len
        if (bytes[i] === 13) i++
        if (bytes[i] === 10) i++
      }
      return { status: res.status, chunks }
    } catch (e) {
      return { error: String(e?.message ?? e), aborted: true }
    } finally {
      clearTimeout(timer)
    }
  }, { u: url, timeoutMs })
  // 每个 chunk 都是完整 JSON（一般只有一个非空 chunk）
  const parsed = []
  for (const c of out.chunks || []) {
    try { parsed.push(JSON.parse(c)) } catch { /* 半截就丢 */ }
  }
  return parsed
}

/** 发评论（UI 流程）：text = 纯文本评论 */
export async function postComment({ videoId, text, timeoutMs = 90_000 }) {
  const page = await ensurePage()
  await page.goto('https://www.douyin.com/video/' + String(videoId), { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.waitForTimeout(6000)

  // ① 点占位符，让 Draft.js 输入框出现
  const placeholder = page.locator('span:has-text("留下你的精彩评论吧")').first()
  if (await placeholder.count() > 0) {
    await placeholder.click({ timeout: 8_000 }).catch(() => {})
  }
  await page.waitForTimeout(1500)

  // ② 找 contenteditable
  const ce = page.locator('.public-DraftEditor-content[contenteditable="true"]').first()
  await ce.waitFor({ timeout: 10_000 })
  await ce.click()
  await page.keyboard.type(String(text), { delay: 30 })
  await page.waitForTimeout(800)

  // ③ Enter 触发 POST
  const posted = { published: false }
  const handler = async (resp) => {
    if (resp.url().includes('comment/publish')) {
      try {
        const body = await resp.text()
        posted.status = resp.status()
        posted.body = body.slice(0, 500)
        if (resp.status() === 200) posted.published = true
      } catch { /* 读不到 body 也没关系 */ }
    }
  }
  page.on('response', handler)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(5000)
  page.off('response', handler)

  // ④ 验证：看输入框里的占位符是否回来（评论清空 = 发出）
  const gone = await page.locator('.public-DraftEditor-content').first().evaluate((el) => !el.textContent?.trim())
  return { ok: posted.published || gone, status: posted.status ?? null, note: 'UI 流程发评论；若抖音风控要求二次验证，需要本人在浏览器里手动过一次' }
}

/** 登录状态：查当前浏览器里是谁（或没登录） */
export async function whoami() {
  const r = await apiFetch('https://www.douyin.com/aweme/v1/web/user/profile/self/?device_platform=webapp&aid=6383&channel=channel_pc_web')
  if (r.error) return { ok: false, error: r.error }
  try {
    const j = JSON.parse(r.text)
    const user = j.user
    if (!user) return { ok: false, loggedIn: false, hint: '没拿到用户信息（可能没登录，或接口变了）' }
    return { ok: true, loggedIn: true, uid: user.uid, nickname: user.nickname, signature: user.signature, followerCount: user.follower_count }
  } catch {
    return { ok: false, loggedIn: false, hint: '响应不是 JSON（可能需要登录 / 被风控拦了）' }
  }
}

/** 关浏览器（卸载插件 / 宿主退出时调） */
export async function closeBrowser() {
  try {
    // 连的是别人的浏览器 ⇒ 只断开，别把人家关了（那可能是使用者正在用的窗口）
    if (_borrowed) await _context?.browser()?.close().catch(() => {})
    else await _context?.close()
  } catch { /* 已经关了 */ }
  _context = null; _page = null; _launching = null; _borrowed = false
}
