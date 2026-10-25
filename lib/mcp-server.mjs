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
import * as api from './api.mjs'
import { closeBrowser } from './browser.mjs'

const VERSION = '0.1.0'

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