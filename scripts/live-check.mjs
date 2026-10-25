/**
 * live-check.mjs —— 真连一次抖音，验数据层（会启动浏览器）
 * ============================================================================
 * 跑法：node scripts/live-check.mjs
 *
 * 它依次做：
 *   1. whoami      —— 登录态还在不在
 *   2. search      —— 搜一个词（验 hex 分帧流解析）
 *   3. detail      —— 拿第一条的详情
 *   4. comments    —— 拿那条的评论
 *
 * ⚠️ 这个脚本**不发评论**（会碰风控，且是"拿用户的号说话"）。要验发评论请用宿主里的 dy_comment。
 * ============================================================================
 */
import { whoami, search, videoDetail, videoComments, closeBrowser } from '../lib/api.mjs'

const line = (s) => console.log(s)
const brief = (v) => JSON.stringify(v).slice(0, 220)

let fail = 0
const step = async (name, fn) => {
  process.stdout.write(`\n▶ ${name} … `)
  const t0 = Date.now()
  try {
    const r = await fn()
    console.log(`(${Date.now() - t0}ms)`)
    return r
  } catch (e) {
    console.log('✗')
    console.log('  ' + String(e?.stack ?? e).split('\n').slice(0, 6).join('\n  '))
    fail++
    return null
  }
}

// 1. 登录态
const me = await step('whoami', () => whoami())
if (me) {
  if (me.loggedIn) line(`  ✓ 已登录：${me.nickname}（uid ${me.uid}）`)
  else { line('  ✗ 没登录 —— 先开浏览器登录一次（dy_chrome）'); fail++ }
}

// 2. 搜索
const hits = await step('search("DeepSeek")', () => search('DeepSeek', { count: 5 }))
if (hits) {
  if (!hits.ok) { line('  ✗ ' + brief(hits)); fail++ }
  else {
    const vids = hits.videos || []
    line(`  ✓ ${vids.length} 条视频（总 ${hits.total ?? '?'}）`)
    for (const v of vids.slice(0, 3)) {
      line(`    · ${v.aweme_id}  ${(v.desc || '').slice(0, 40)}  @${v.author?.nickname || '?'}  ♡${v.stats?.digg ?? 0}  ${v.duration ?? '?'}s`)
    }
    if (!vids.length) { line('  ✗ 解析出来 0 条 —— 分帧解析可能坏了'); fail++ }
  }
}

// 3 & 4. 拿第一条验详情 + 评论
const first = hits?.videos?.[0]
if (first?.aweme_id) {
  const d = await step(`videoDetail(${first.aweme_id})`, () => videoDetail(first.aweme_id))
  if (d) {
    if (!d.ok) { line('  ✗ ' + brief(d)); fail++ }
    else line(`  ✓ ${(d.desc || '').slice(0, 50)} · ${d.duration ?? '?'}s · ${d.stats?.comment ?? '?'} 评论 · ${(d.hashtags || []).join('/')}`)
  }

  const c = await step(`videoComments(${first.aweme_id})`, () => videoComments(first.aweme_id, { count: 5 }))
  if (c) {
    if (!c.ok) { line('  ✗ ' + brief(c)); fail++ }
    else {
      line(`  ✓ ${(c.comments || []).length} 条评论（总 ${c.total ?? '?'}）`)
      for (const x of (c.comments || []).slice(0, 3)) {
        line(`    · ${x.user}: ${(x.text || '').slice(0, 36)}  ♡${x.digg ?? 0}  ↳${x.replies ?? 0}`)
      }
    }
  }
}

await closeBrowser()
console.log(fail ? `\n✗ 有 ${fail} 项没过\n` : '\n✓ 数据层全通\n')
process.exit(fail ? 1 : 0)