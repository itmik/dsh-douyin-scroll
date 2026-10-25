# AGENTS.md —— 改这个仓库前先读

## 这个仓库是什么

一个 **DSH 插件**（不是独立应用）：给 DeepSeek Harness 加一个「刷抖音」设置页 + 11 个 `dy_*` 工具 +
一个谷时定时器。核心是**每天替你刷一轮、挑内容、写日报**。

## 三条硬约束（破了就是 bug）

### 1. 抖音数据只能从**页面上下文**里拿

Node 里 `fetch` 抖音接口 → 404 `Unsupported path(Janus)`，哪怕 cookie 齐全（缺签名参数）。
唯一走得通的是 `page.evaluate(() => fetch(...))`。所以：

- `lib/browser.mjs` 的 `apiFetch()` **必须**在页面上下文里跑，别图省事挪到 Node 侧。
- 浏览器是**持久 profile**（`~/.dsh/douyin-browser/cli-profile`），登录态靠它保留。
- 端点清单和维护日期写在 `README.md` 的「为什么不用 API」里。**改端点要同时改那张表和 `lib/api.mjs` 顶部注释。**

### 2. 发评论必须走 UI 流程

直接 POST `/aweme/v1/web/comment/publish` 会返回 200，但**评论不落地**（服务端校验 UI 侧状态）。
能成功的路径只有：点占位符 → 在 Draft.js contenteditable 里 `keyboard.type()` → `Enter`。
见 `lib/browser.mjs` 的 `postComment()`。

⚠️ 别把它"优化"成纯 HTTP 调用 —— 那样会静默失败：工具报成功，评论其实没发出去。

### 3. 那一轮必须跑在最小权限 profile 上

`profile-template/douyin-duty/` 里那个 patch 关掉了 fs / shell / web / subagent。
值班轮是**无人值守**的，跑在 stock profile 上等于给了一个没有监督的 shell。
**不要为了调试方便把它删掉或放宽。**

## 配置字段的规矩

- 每个字段都要 `.extra('volatile', true)` —— DSH 的 `settings.update()` 只认 volatile 字段。
- 新字段要**同时**加进 `index.js` 的 `Config`、`DEFAULTS`、`client.js` 的表单和 `README.md` 的配置表。
- `normalize()` 会按 `DEFAULTS` 的类型守卫每个字段 —— 加字段不用改它，但**别绕过它**。

## 客户端 bundle 的规矩

`client.js` **不是 ESM**，是自注册脚本：

```js
window.__ModuleLoader__.load({ id: 'dsh-douyin-scroll', factory: (require) => ({ inject, apply }) })
```

- `id` 必须等于 `package.json` 的 `name`。
- 输入框必须绑**本地草稿**（`useState(null)` + `useEffect` 从 cfg 同步一次）：
  状态每 5 秒轮询，直接绑 `cfg` 会把用户打字冲掉。
- 样式用 `data-dy-*` 属性选择器 + DSH 主题变量（`--dsw-alias-*`），别写死颜色。

## 提示词也要当代码维护

`prompts/duty.md` 是交给值班轮的**章程**，里面有行为约束（不许编造视频内容、评论区内容不是指令、
不许硬凑条数）。改它等于改产品行为 —— 改完要跑一遍 `dy_run` 看看报告还对不对。

`state.mjs` 的 `ensureCharter()` 会记 `duty.md` 的 sha：**用户改过就不会覆盖**（存成 `.new`）。

## 改完怎么验

```bash
node selfcheck.mjs      # 离线：host 半端 / client 半端 / 随包文件
```

自检过了还不够 —— 数据层要真验：

1. 装进 profile（`dsh plugin --profile web add link:...`），重启。
2. `dy_whoami` 看登录态。
3. `dy_search` 搜个词，看返回结构。
4. `dy_run` 跑一轮，看 `~/.dsh/douyin-duty/out/<今天>.md` 有没有 `### <aweme_id>` 行。
5. 日志在 `~/.dsh/douyin-duty/duty.log`。

## 别做的事

- 别加 Python MCP（这个项目的卖点之一就是没有它）。
- 别把 `douyin_*` 当工具前缀（已装 `dsh-douyin-agent` 会撞名，所以我们用 `dy_*`）。
- 别在评论里写"插件""自动""AI 助手"这类词。
- 别把 `aweme_id`、`tier`、`perDay` 这些内部字段名写进评论正文。