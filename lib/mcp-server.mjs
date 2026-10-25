/**
 * lib/mcp-server.mjs —— 给「值班轮」用的 stdio MCP server
 * ============================================================================
 * 为什么要它：
 *   宿主插件里注册的 `dy_*` 工具只在**宿主进程**里存在。而值班轮是
 *   `dsh --profile douyin-duty <prompt>` 另起的一个进程 —— 它在最小权限 profile 上
 *   （没有 fs、没有 shell、没有网络），**看不到宿主的工具**。
 *   ⇒ 用这个 MCP server 把同一套 lib/api.mjs 暴露给那一轮。
 *
 * 浏览器：**不另开**。lib/browser.mjs 的 ensurePage() 会先 connectOverCDP 连宿主的那个
 *         浏览器（同一个 profile 只能被一个实例锁住，所以必须连、不能抢）。
 *
 * 协议：MCP over stdio，按行分隔的 JSON-RPC 2.0。
 *   initialize → tools/list → tools/call
 * ============================================================================
 */
import { createInterface } from 'node:readline'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import * as api from './api.mjs'
import { closeBrowser } from './browser.mjs'

const VERSION = '0.2.0'

/**
 * ⭐ 值班轮跑在**最小权限 profile** 上（没有 fs 工具）—— 所以"写报告"这件事必须由这个 MCP 代劳。
 *   只能往家目录里写（DOUYIN_DUTY_HOME 由宿主注入），写不到别处去。
 *   这也解释了为什么章程里只提 duty_* 三个写工具：别的路根本不通。
 */
const DUTY_HOME = String(process.env.DOUYIN_DUTY_HOME || '').trim()
const pad2 = (n) => String(n).padStart(2, '0')
const todayStr = (now = new Date()) => `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
const monthStr = (now = new Date()) => `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`
const needHome = () => {
  if (!DUTY_HOME) throw new Error('DOUYIN_DUTY_HOME 没设置 ⇒ 不知道家目录在哪，写不了')
  return DUTY_HOME
}
const cell = (s, limit = 60) => String(s ?? '').split(/[\r\n]+/).join(' ').replace(/\|/g, '\\|').slice(0, limit)
const appendTo = (file, text) => {
  mkdirSync(dirname(file), { recursive: true })
  appendFileSync(file, String(text).replace(/\r\n/g, '\n'), 'utf8')
  return file
}

/**
 * ⭐ 上一轮要是挂了，宿主会在报告开头留一段"占位报告"（-- 这一轮没写出报告 --）。
 *   真报告来了就该把它去掉，否则那份文件永远很难看。
 */
const PLACEHOLDER_MARK = '这一轮没写出报告'
const stripPlaceholder = (text) => {
  if (!text.includes(PLACEHOLDER_MARK)) return text
  const lines = text.split('\n')
  if (!(lines[0] || '').startsWith('# 刷抖音') || !lines[0].includes(PLACEHOLDER_MARK)) return text
  const real = lines.findIndex((l, i) => i > 1 && /^#\s*刷抖音/.test(l) && !l.includes(PLACEHOLDER_MARK))
  if (real === -1) return text
  return lines.slice(real).join('\n')
}

/** 工具白名单：由宿主通过 env 传进来（没传就默认只给只读的） */
const whitelist = () => {
  const raw = String(process.env.DOUYIN_MCP_TOOLS || '').trim()
  if (!raw) return null
  return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))
}

const TOOLS = [
  {
    name: 'dy_whoami',
    description: '看抖音那边登录的是谁（昵称 / uid / 粉丝数）。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: () => api.whoami(),
  },
  {
    name: 'dy_search',
    description: '搜抖音视频。返回标题 / aweme_id / 点赞 / 作者 / 时长 / 话题。',
    inputSchema: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '搜索关键词' },
        num: { type: 'number', description: '返回几条（默认 20，最大 50）' },
      },
      required: ['keyword'],
    },
    run: (a) => api.search(String(a.keyword ?? ''), { count: Math.max(1, Math.min(Number(a.num) || 20, 50)) }),
  },
  {
    name: 'dy_video',
    description: '一个视频的详情：标题 / 作者 / 点赞 / 评论数 / 时长 / 话题。',
    inputSchema: { type: 'object', properties: { aweme_id: { type: 'string' } }, required: ['aweme_id'] },
    run: (a) => api.videoDetail(String(a.aweme_id ?? '')),
  },
  {
    name: 'dy_comments',
    description: '取一个视频的热门评论（含点赞 / 回复数）。',
    inputSchema: {
      type: 'object',
      properties: { aweme_id: { type: 'string' }, num: { type: 'number' } },
      required: ['aweme_id'],
    },
    run: (a) => api.videoComments(String(a.aweme_id ?? ''), { count: Math.max(1, Math.min(Number(a.num) || 30, 50)) }),
  },
  {
    name: 'dy_user',
    description: '一个用户的主页：昵称 / 签名 / 粉丝 / 作品数（需要 sec_uid）。',
    inputSchema: { type: 'object', properties: { sec_uid: { type: 'string' } }, required: ['sec_uid'] },
    run: (a) => api.userProfile(String(a.sec_uid ?? '')),
  },
  {
    name: 'dy_user_posts',
    description: '一个用户最近发的视频（标题 / ID / 点赞）。',
    inputSchema: {
      type: 'object',
      properties: { sec_uid: { type: 'string' }, num: { type: 'number' } },
      required: ['sec_uid'],
    },
    run: (a) => api.userPosts(String(a.sec_uid ?? ''), { count: Math.max(1, Math.min(Number(a.num) || 10, 30)) }),
  },
  {
    name: 'dy_comment',
    description: '在一个视频下发评论（短、干净、纯文本 @）。发评论前请确认设置里开了「自动评论」并且使用者知情。',
    inputSchema: {
      type: 'object',
      properties: {
        aweme_id: { type: 'string' },
        text: { type: 'string', description: '评论正文（150 字内）' },
      },
      required: ['aweme_id', 'text'],
    },
    run: (a) => {
      const text = String(a.text ?? '').trim()
      if (!text) return { ok: false, error: '评论正文是空的' }
      return api.postComment({ videoId: String(a.aweme_id ?? ''), text })
    },
  },
  {
    name: 'duty_paths',
    description: '这一轮允许写的三个位置（绝对路径）：日报 / 判重表 / 月度归档。写东西只能走 duty_* 工具。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: () => {
      const home = needHome()
      return {
        home,
        report: join(home, 'out', todayStr() + '.md'),
        seen: join(home, 'seen.md'),
        digest: join(home, 'digest', monthStr() + '.md'),
      }
    },
  },
  {
    name: 'duty_report_append',
    description: '往今天的日报末尾追加一段 markdown（文件不存在会自动建，并写上标题行）。',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: '要追加的 markdown 内容' } },
      required: ['text'],
    },
    run: (a) => {
      const body = String(a.text ?? '').replace(/\r\n/g, '\n').trim()
      if (!body) return { ok: false, wrote: '', error: '内容是空的，没写' }
      const home = needHome()
      const file = join(home, 'out', todayStr() + '.md')
      let existing = ''
      try { existing = existsSync(file) ? readFileSync(file, 'utf8') : '' } catch { existing = '' }
      const cleaned = stripPlaceholder(existing)
      if (cleaned !== existing) { try { writeFileSync(file, cleaned, 'utf8') } catch { /* 写不进去就照旧追加 */ } }
      const fresh = !cleaned.trim()
      return {
        ok: true,
        wrote: appendTo(file, (fresh ? `# 刷抖音 · ${todayStr()}\n\n` : '') + body + '\n'),
      }
    },
  },
  {
    name: 'duty_seen_append',
    description: '往判重表追加一行（挑了 / 跳过 / 评论）。同一天同一个 ID 别重复写。',
    inputSchema: {
      type: 'object',
      properties: {
        aweme_id: { type: 'string', description: '视频 ID（纯数字）' },
        title: { type: 'string' },
        author: { type: 'string', description: '作者昵称' },
        status: { type: 'string', description: '挑了 / 跳过 / 评论' },
        note: { type: 'string', description: '一句话结论' },
        date: { type: 'string', description: 'YYYY-MM-DD，留空=今天' },
      },
      required: ['aweme_id'],
    },
    run: (a) => {
      const id = String(a.aweme_id ?? '').trim()
      if (!/^\d{6,}$/.test(id)) return { ok: false, wrote: '', error: 'aweme_id 看着不对（要纯数字）' }
      const home = needHome()
      const file = join(home, 'seen.md')
      const d = (String(a.date ?? '').trim() || todayStr()).slice(0, 10)
      const row = `| ${cell(d, 10)} | ${cell(id, 20)} | ${cell(a.title)} | ${cell(a.author, 30)} | ${cell(a.status, 8)} | ${cell(a.note)} |\n`
      const fresh = !existsSync(file)
      const head = fresh ? '| 日期 | aweme_id | 标题 | 作者 | 档次 | 一句话结论 |\n|---|---|---|---|---|---|\n' : ''
      return { ok: true, wrote: appendTo(file, head + row) }
    },
  },
  {
    name: 'duty_seen_recent',
    description: '读判重表的最近若干行（只读）：挑之前先看看哪些已经挑过。',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: '取最近多少行（默认 40，上限 200）' },
        aweme_id: { type: 'string', description: '只查某个视频 ID（留空=看全部）' },
      },
    },
    run: (a) => {
      const home = needHome()
      const file = join(home, 'seen.md')
      if (!existsSync(file)) return { ok: true, total: 0, rows: [], note: '判重表还不存在（第一次跑）' }
      let lines = []
      try { lines = readFileSync(file, 'utf8').split(/\r?\n/) } catch (e) { return { ok: false, error: '读不到判重表：' + String(e?.message ?? e) } }
      let rows = lines.filter((ln) => ln.trim().startsWith('|') && !/^\|\s*-/.test(ln.trim()) && !ln.includes('aweme_id'))
      const want = String(a.aweme_id ?? '').trim()
      if (want) rows = rows.filter((ln) => ln.includes(want))
      const n = Math.max(1, Math.min(Number(a.limit) || 40, 200))
      return { ok: true, total: rows.length, rows: rows.slice(-n) }
    },
  },
  {
    name: 'duty_digest_append',
    description: '往本月归档追加一段（digest/<年-月>.md，给以后翻旧账用）。',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: '要追加的内容' } },
      required: ['text'],
    },
    run: (a) => {
      const body = String(a.text ?? '').replace(/\r\n/g, '\n').trim()
      if (!body) return { ok: false, wrote: '', error: '内容是空的，没写' }
      const home = needHome()
      const file = join(home, 'digest', monthStr() + '.md')
      const fresh = !existsSync(file)
      return {
        ok: true,
        wrote: appendTo(file, (fresh ? `# 抖音归档 · ${monthStr()}\n\n` : '') + body + '\n'),
      }
    },
  },
]

const allowed = whitelist()
const visible = () => TOOLS.filter((t) => (allowed ? allowed.has(t.name) : t.name !== 'dy_comment'))

const send = (obj) => {
  try { process.stdout.write(JSON.stringify(obj) + '\n') } catch { /* 管道断了 */ }
}
const reply = (id, result) => send({ jsonrpc: '2.0', id, result })
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } })

const handle = async (msg) => {
  const { id, method, params } = msg || {}
  // 通知（没有 id）不回包
  if (id === undefined || id === null) return

  if (method === 'initialize') {
    return reply(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'douyin-duty', version: VERSION },
    })
  }
  if (method === 'ping') return reply(id, {})
  if (method === 'tools/list') {
    return reply(id, {
      tools: visible().map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
    })
  }
  if (method === 'tools/call') {
    const name = params?.name
    const args = params?.arguments || {}
    const t = visible().find((x) => x.name === name)
    if (!t) return fail(id, -32602, `未知工具：${name}（这一轮没开它，或名字写错了）`)
    try {
      const out = await t.run(args)
      return reply(id, {
        content: [{ type: 'text', text: JSON.stringify(out ?? { ok: true }) }],
        isError: Boolean(out && out.ok === false && out.loggedIn === false),
      })
    } catch (e) {
      return reply(id, {
        content: [{ type: 'text', text: JSON.stringify({ ok: false, error: String(e?.message ?? e) }) }],
        isError: true,
      })
    }
  }
  return fail(id, -32601, `不支持的方法：${method}`)
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
rl.on('line', (line) => {
  const s = line.trim()
  if (!s) return
  let msg
  try { msg = JSON.parse(s) } catch { return }
  handle(msg).catch((e) => { if (msg?.id != null) fail(msg.id, -32603, String(e?.message ?? e)) })
})
rl.on('close', async () => {
  await closeBrowser().catch(() => {})
  process.exit(0)
})
process.on('SIGTERM', async () => { await closeBrowser().catch(() => {}); process.exit(0) })
process.on('uncaughtException', (e) => {
  // 别让一个异常把整条 stdio 服务带走（那一轮会卡住等不到回包）
  try { process.stderr.write('[douyin-mcp] ' + (e?.stack ?? String(e)) + '\n') } catch { /* 丢 */ }
})