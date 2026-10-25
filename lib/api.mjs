/**
 * lib/api.mjs —— 抖音网页版 API 封装（全部走 lib/browser.mjs 的持久 Edge）
 *
 * 已验证的端点（2026-10-24 实测，Edge 155 + 已登录 profile）：
 *   GET  /aweme/v1/web/aweme/detail/?device_platform=webapp&aid=6383&channel=channel_pc_web&aweme_id={ID}&request_source=600&origin_type=video_page
 *        → { aweme_detail: { desc, author:{nickname,sec_uid}, statistics, video:{duration}, text_extra[] } }
 *   GET  /aweme/v1/web/comment/list/?...&aweme_id={ID}&cursor=0&count=30&item_type=0&source=3
 *        → { comments[], total }
 *   GET  /aweme/v1/web/aweme/post/?...&sec_user_id={SEC}&max_cursor=0&count=10
 *        → { aweme_list[], aweme_count, has_more }
 *   GET  /aweme/v1/web/user/profile/other/?...&sec_user_id={SEC}
 *        → { user:{nickname,signature,follower_count,aweme_count} }
 *   GET  /aweme/v1/web/user/profile/self/...
 *   GET  /aweme/v1/web/general/search/stream/?aid=6383&keyword={KW}&search_channel=pc_awesome&search_id=1&count={N}&cursor=0
 *        → hex 帧流，data[type=1]=视频，data[type=4]=用户
 *
 * 死的端点（404 "Unsupported path(Janus)"，别再用）：
 *   /aweme/v1/web/search/item/list/、/user/post/、/comment/hot/、/feed/、
 *   /comment/post/、/comment/create/、/aweme/v2/web/comment/post/
 */
import { apiFetch, searchStreamFetch } from './browser.mjs'

const BASE = 'https://www.douyin.com'

/**
 * 归一化一条 aweme。
 * ⚠️ 实测（2026-10-25）字段脾气：
 *   · statistics.play_count 在网页版**恒为 0**（抖音不对外给播放量）⇒ play 为 null 时表示"拿不到"
 *   · 搜索返回的统计有时叫 `stats`、详情里叫 `statistics` ⇒ 两个都认
 *   · 时长在 video.duration（毫秒），不是秒
 *   · text_extra 在详情里可能是空数组 ⇒ 退化为从 desc 里抠 #话题
 */
const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v))
const norm = (v) => {
  const st = v.statistics || v.stats || {}
  const durMs = Number(v.video?.duration ?? v.duration ?? 0)
  const play = num(st.play_count)
  return {
    aweme_id: String(v.aweme_id ?? ''),
    desc: String(v.desc ?? ''),
    create_time: v.create_time,
    duration: durMs ? Math.round(durMs / 1000) : null,
    author: {
      nickname: v.author?.nickname,
      sec_uid: v.author?.sec_uid,
      signature: v.author?.signature,
      follower: num(v.author?.follower_count),
    },
    stats: {
      play: play && play > 0 ? play : null,   // 0 当成"拿不到"
      digg: num(st.digg_count),
      comment: num(st.comment_count),
      share: num(st.share_count),
    },
    hashtags: (v.text_extra || []).map((t) => t.hashtag_name).filter(Boolean).length
      ? (v.text_extra || []).map((t) => t.hashtag_name).filter(Boolean)
      : Array.from(String(v.desc ?? '').matchAll(/#([^\s#@]{1,30})/g)).map((m) => m[1]),
  }
}

export const videoDetail = async (awemeId) => {
  const u = `${BASE}/aweme/v1/web/aweme/detail/?device_platform=webapp&aid=6383&channel=channel_pc_web&aweme_id=${encodeURIComponent(awemeId)}&request_source=600&origin_type=video_page`
  const r = await apiFetch(u)
  if (r.error) return { ok: false, error: r.error }
  const j = JSON.parse(r.text)
  const d = j.aweme_detail
  if (!d) return { ok: false, error: '没拿到 aweme_detail（接口可能变了）' }
  return { ok: true, ...(norm(d)) }
}

export const videoComments = async (awemeId, { count = 30, cursor = 0 } = {}) => {
  const u = `${BASE}/aweme/v1/web/comment/list/?device_platform=webapp&aid=6383&channel=channel_pc_web&aweme_id=${encodeURIComponent(awemeId)}&cursor=${cursor}&count=${count}&item_type=0&source=3`
  const r = await apiFetch(u)
  if (r.error) return { ok: false, error: r.error }
  const j = JSON.parse(r.text)
  const out = (j.comments || []).map((c) => ({
    cid: String(c.cid ?? ''),
    user: c.user?.nickname,
    uid: c.user?.uid,
    // ⚠️ 评论正文的字段叫 `text`（不是 `content`）；回复数是 `reply_comment_total`
    text: c.text ?? '',
    digg: num(c.digg_count) ?? 0,
    replies: num(c.reply_comment_total) ?? num(c.reply_count) ?? 0,
    time: c.create_time,
    ip: c.ip_label,
  }))
  return { ok: true, total: j.total, hasMore: j.has_more, cursor: j.cursor, comments: out }
}

export const userPosts = async (secUid, { count = 10 } = {}) => {
  const u = `${BASE}/aweme/v1/web/aweme/post/?device_platform=webapp&aid=6383&channel=channel_pc_web&sec_user_id=${encodeURIComponent(secUid)}&max_cursor=0&locate_query=false&publish_video_strategy_type=2&count=${count}`
  const r = await apiFetch(u)
  if (r.error) return { ok: false, error: r.error }
  const j = JSON.parse(r.text)
  const out = (j.aweme_list || []).map(norm)
  return { ok: true, total: j.aweme_count, hasMore: j.has_more, posts: out }
}

export const userProfile = async (secUid) => {
  const u = `${BASE}/aweme/v1/web/user/profile/other/?device_platform=webapp&aid=6383&channel=channel_pc_web&sec_user_id=${encodeURIComponent(secUid)}`
  const r = await apiFetch(u)
  if (r.error) return { ok: false, error: r.error }
  const j = JSON.parse(r.text)
  const user = j.user
  if (!user) return { ok: false, error: '没拿到 user（sec_uid 可能错了）' }
  return { ok: true, nickname: user.nickname, uid: user.uid, signature: user.signature, follower: user.follower_count, awemes: user.aweme_count }
}

/** 搜索（hex 帧流）：type=1 是视频（aweme_info / aweme_list[]），type=4 是用户（user_list[]） */
export const search = async (keyword, { count = 20 } = {}) => {
  const u = `${BASE}/aweme/v1/web/general/search/stream/?aid=6383&keyword=${encodeURIComponent(keyword)}&search_channel=pc_awesome&search_id=1&count=${count}&cursor=0`
  const arr = await searchStreamFetch(u)
  const videos = []
  const users = []
  for (const j of arr) {
    for (const item of j.data || []) {
      if (item.type === 1) {
        if (item.aweme_info) videos.push(norm(item.aweme_info))
        for (const a of item.aweme_list || []) videos.push(norm(a))
      } else if (item.type === 4) {
        for (const uinfo of item.user_list?.user_info || []) {
          users.push({
            sec_uid: uinfo.sec_uid,
            uid: uinfo.uid,
            nickname: uinfo.nickname,
            follower: uinfo.follower_count,
            awemes: uinfo.aweme_count,
            signature: uinfo.signature,
          })
        }
      }
    }
  }
  return { ok: true, videos, users }
}

/** 评论发送走 UI 流程（见 lib/browser.mjs postComment） */
export { postComment } from './browser.mjs'
export { whoami } from './browser.mjs'
export { closeBrowser, configure as configureBrowser } from './browser.mjs'
