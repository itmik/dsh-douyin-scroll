/**
 * lib/state.mjs —— 家目录 / 峰谷时间窗 / 判重
 * 移植自 dsh-bili-scroll（把 B站 MCP 那套换成了"浏览器直连"），保持同一套习惯：
 *   · 状态目录 = $DSH_HOME/douyin-duty/
 *   · 谷时窗口：中午 12:00–14:00、夜间 18:00–09:00（按北京时区算，跟 DeepSeek 的峰谷定价对齐）
 *   · 判重表 seen.md（每天一行）、报告 out/<日期>.md、归档 digest/<年月>.md
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** 谷时窗口（北京时间的 24 小时制；night 跨零点） */
export const WINDOWS = {
  noon: { start: '12:00', end: '14:00', label: '中午' },
  night: { start: '18:00', end: '09:00', label: '晚上' },
}

/**
 * ctx.get('dshHomePath') 是**函数**（(...segments) => 绝对路径）。
 * 拿不到宿主函数（比如自检测试）时用 process.env.DSH_HOME 兜底。
 */
export const stateDirOf = (ctx) => {
  const fn = ctx?.get?.('dshHomePath')
  if (typeof fn === 'function') return fn('douyin-duty')
  const home = process.env.DSH_HOME || join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh')
  return join(home, 'douyin-duty')
}

export const dayKey = (now = new Date()) => {
  const y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2, '0'), d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** 判断 now 是否落在窗口里（支持跨零点） */
export const inWindow = (now, w) => {
  const hhmm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0')
  const [s, e] = [w.start, w.end]
  if (s <= e) return hhmm >= s && hhmm < e
  return hhmm >= s || hhmm < e   // 跨零点（18:00–09:00）
}

export const readJson = (file, dflt) => {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return dflt }
}
export const writeJson = (file, obj) => {
  try { writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8') } catch { /* 写不进去下次再说 */ }
}

/** 把 vendor/ 里的文件铺到家目录（带指纹：用户改过的不覆盖） */
export const ensureHomeFiles = (stateDir, vendorDir) => {
  mkdirSync(stateDir, { recursive: true })
  for (const name of readdirSync(vendorDir, { withFileTypes: true })) {
    // 只铺普通文件：vendor/ 里残留个子目录不该把整个家目录铺文件弄废
    if (!name.isFile()) continue
    const src = join(vendorDir, name.name)
    const dst = join(stateDir, name.name)
    const shaFile = dst + '.shipped.sha'
    const srcHash = hash(readFileSync(src))
    if (existsSync(shaFile)) {
      const shipped = String(readFileSync(shaFile, 'utf8'))
      if (shipped !== hash(readFileSync(dst, 'utf8'))) {
        // 用户改过 ⇒ 留 .bak，然后覆盖
        try { renameSync(dst, dst + '.bak-' + Date.now()) } catch { /* 删不掉就硬覆盖 */ }
        writeFileSync(dst, readFileSync(src), 'utf8')
        writeFileSync(shaFile, srcHash, 'utf8')
      }
      continue
    }
    writeFileSync(dst, readFileSync(src), 'utf8')
    writeFileSync(shaFile, srcHash, 'utf8')
  }
}

/**
 * 章程（duty.md）：用户改过的，新版本存成 .new 不覆盖。
 * ⚠️ 账本（.sha）记的是**我们上次铺出去的那版**的指纹，不是"新版"的指纹 ——
 *    这样才能分辨"用户动过"和"我们升级了"：本地==账本 ⇒ 没被改过 ⇒ 直接换新版。
 */
export const ensureCharter = (stateDir, charterFile) => {
  const dst = join(stateDir, 'duty.md')
  const ledger = join(stateDir, 'duty.md.sha')
  const h = hash(readFileSync(charterFile))
  const shippedPrev = existsSync(ledger) ? String(readFileSync(ledger, 'utf8')).trim() : ''
  if (shippedPrev === h) return dst                      // 随包版本没变，什么都不用做
  if (existsSync(dst)) {
    const localHash = hash(readFileSync(dst))
    const edited = shippedPrev ? localHash !== shippedPrev : localHash !== h
    if (edited) {                                        // 用户改过 ⇒ 他的留着，新版躺 .new
      writeFileSync(dst + '.new', readFileSync(charterFile), 'utf8')
      return dst
    }
  }
  writeFileSync(dst, readFileSync(charterFile), 'utf8')
  writeFileSync(ledger, h, 'utf8')
  return dst
}

const hash = (buf) => {
  // 简单的字符串指纹（不需要加密强度，防的就是"厂商新版被误覆盖"）
  let x = 0
  const s = buf.toString ? buf.toString('utf8') : String(buf)
  for (let i = 0; i < s.length; i++) x = (Math.imul(x, 31) + s.charCodeAt(i)) | 0
  return String(x >>> 0)
}
