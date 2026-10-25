# dsh-douyin-scroll

> 给 DeepSeek Harness 用的小插件：**每天替你刷一轮抖音**，挑出真正值得的，写一份日报；值得的那一两条，顺手 @ 你。

仿 [`dsh-bili-scroll`](https://github.com/c1overzz/dsh-bili-scroll) 做的抖音版。
但它**没有 Python MCP** —— 所有数据都在浏览器里拿（原因见下面「为什么不用 API」）。

```
┌──────────────────────────────────────────────────────────────┐
│  谷时（中午 12–14 / 晚上 18–09）                              │
│      ↓  每 60 秒 tick 一次                                   │
│  起一个 douyin-duty profile 的 headless 会话                 │
│      ↓  把 duty.md 交给它                                     │
│  它用 dy_search / dy_video / dy_comments 挑              │
│      ↓                                                        │
│  out/2026-10-25.md  ← 日报（每条一个 ### <aweme_id>）         │
│  seen.md            ← 判重表（挑过的不再挑）                  │
└──────────────────────────────────────────────────────────────┘
```

---

## 它跟 `dsh-douyin-agent` 不是一回事

| | dsh-douyin-agent | **dsh-douyin-scroll**（本项目） |
|---|---|---|
| 形态 | 插件 + 独立桌面应用 | 纯 DSH 插件（设置页一页） |
| 做什么 | 私信自动回复、续火花、自主观看、日报、人格记忆 | **只做一件事**：定点刷一轮、挑内容、写日报、可选 @ 你 |
| 工具前缀 | `douyin_*` | `dy_*`（刻意避开，可以同时装） |
| 数据来源 | Playwright 驱动页面 | Playwright 驱动页面 + **页内 `fetch` 打抖音自己的接口** |
| 什么时候跑 | 开着就一直在 | **谷时段**（省 token）自动跑一轮，跑完就停 |

两个可以同时装，工具名不冲突。

---

## 装

```bash
# 从 npm（发布后）
dsh plugin --profile web add dsh-douyin-scroll

# 本地开发
dsh plugin --profile web add link:/path/to/dsh-douyin-scroll
```

装完**重启 DSH**，去 `设置 → 刷抖音`。

依赖 `playwright-core`：插件会先找
`~/.dsh/profiles/desktop/node_modules/playwright-core`（桌面版自带），找不到就报错让你装。
浏览器用 **Microsoft Edge**（`channel: 'msedge'`），不用另装 Chromium。

---

## 第一次用

1. 设置页 →「高级」→ **打开浏览器（去登录）**。
   会弹一个 Edge 窗口，profile 在 `~/.dsh/douyin-browser/cli-profile`。
2. 在那个窗口里扫码 / 手机号登录一次抖音。
3. 回来点「现在跑一轮」，看能不能出报告。

登录态存在 profile 目录里，**之后一直有效**，不用反复登。
遇到抖音要二次验证（短信 / 人脸）—— 那是账号侧的事，你在那个窗口里手动过一次就行。

---

## 每天会发生什么

- 到了谷时段（默认中午 + 晚上，可单独关），如果今天还没挑够 `perDay` 条，就自动跑一轮。
- 一轮里它：搜关键词 → 逐条看详情 / 评论 → 分三档（值得看 / 可以看 / 不值当）→ 写日报。
- 报告在 `~/.dsh/douyin-duty/out/2026-10-25.md`。
- 看过的每一条（挑了和没挑的）还会进 `digest/2026-10.md` 归档。
- 挑中的进 `seen.md` 判重表，**永不重复挑**。

⚠️ 一天跑几轮是有上限的：每个窗口最多跑一轮，且**当天挑够了就不再跑**。
宁可一天挑 0 条，也不硬凑 —— 硬凑会让这份日报失去可信度。

---

## 工具

| 工具 | 干什么 |
|---|---|
| `dy_whoami` | 抖音那边登录的是谁 |
| `dy_search` | 搜视频（返回标题 / ID / 播放 / 作者 / 时长 / 话题） |
| `dy_video` | 一条视频的详情（标题 / 作者 / 播放 / 点赞 / 评论数 / 时长 / 话题） |
| `dy_comments` | 热门评论（含点赞 / 回复数） |
| `dy_user` | 一个用户的主页（昵称 / 签名 / 粉丝 / 作品数） |
| `dy_user_posts` | 一个用户最近的视频 |
| `dy_chrome` | 打开那个专用浏览器窗口（登录 / 过验证码用） |
| `dy_comment` | 发评论并 @ 人（**默认拦住**，见下） |
| `dy_status` | 今天跑了没跑、挑了几条、额度剩多少、下次窗口何时开 |
| `dy_run` | 立刻跑一轮（不等窗口） |
| `dy_config` | 读 / 改设置 |

### 关于 `dy_comment` 的闸

发评论等于**拿用户的号说话**，所以默认是关的。要能发，必须**同时**满足：

1. 设置里开着「自动评论并 @ 你」
2. 填了「要 @ 谁」

两条都满足才放行；否则工具直接拒绝。本人当场让你发的时候，可以传 `force: true` 越过。

---

## 配置项

设置页四个 tab，对应的字段：

| 字段 | 默认 | 说明 |
|---|---|---|
| `perDay` | 5 | 每天最多挑几条（**全天总量**） |
| `peakValley` | false | 峰谷自动刷总开关 |
| `noon` | true | 中午 12:00–14:00 那一轮 |
| `night` | true | 晚上 18:00–次日 09:00 那一轮 |
| `autoComment` | **false** | 自动评论并 @ 你 |
| `mentionName` | `''` | 要 @ 谁的抖音昵称 |
| `commentPerRound` | 1 | 每轮最多几条评论（抖音有风控，别贪） |
| `keywords` | `[]` | 关注关键词（空了用章程默认那几组） |
| `personaPrompt` | `''` | 人设 / 口味，决定"什么值得看" |
| `reportLevel` | `full` | `full` / `brief` / `off` |
| `cdpPort` | 9238 | 浏览器调试端口 |
| `headless` | false | 无头模式 |
| `headlessProfile` | `douyin-duty` | 那一轮用哪个 profile |
| `dshBin` | `''` | dsh 的 bin.js（留空自动找） |

配置文件落在 `~/.dsh/douyin-duty/config.json`，同时会写回 DSH 设置页（两边同步）。

---

## 为什么不用 API（重要）

抖音**没有稳定公开的 Web API**。实测（2026-10-24，Edge 155）：

| 端点 | 状态 |
|---|---|
| `/aweme/v1/web/aweme/detail/` | ✅ 通（必须带全参数，且必须在页面上下文里） |
| `/aweme/v1/web/comment/list/` | ✅ 通 |
| `/aweme/v1/web/aweme/post/` | ✅ 通（用户作品列表） |
| `/aweme/v1/web/user/profile/other/` | ✅ 通 |
| `/aweme/v1/web/user/profile/self/` | ✅ 通 |
| `/aweme/v1/web/general/search/stream/` | ✅ 通（**hex 分帧流**，要自己解） |
| `/aweme/v1/web/comment/publish` | ✅ 通（POST，x-www-form-urlencoded） |
| `/aweme/v1/web/feed/`、`/search/item/list/`、`/comment/post/` | ❌ 404 `Unsupported path(Janus)` |

- **Node 里直接 `fetch` 会 404**，哪怕 cookie 齐全 —— 缺 `a_bogus` / `msToken` 之类的签名参数。
- 在**页面上下文**里 `fetch`（`page.evaluate`）就通 —— 页面自己的 JS 会补齐该补的东西。
  所以插件常驻一个 Edge，每次调用都是 `page.evaluate(fetch(...))`。
- 搜索结果不是普通 JSON，是 `<hex长度>\r\n<JSON>` 的**分帧流**，见 `lib/browser.mjs` 的 `searchStreamFrames()`。
- 发评论：直接 POST 能返回 200 但**评论不落地**。走得通的是 UI 流程 ——
  点「留下你的精彩评论吧」→ 在 Draft.js 的 contenteditable 里打字 → 回车。
  所以 `lib/browser.mjs` 里 `postComment()` 是 UI 操作，不是纯 HTTP。

---

## 安全边界

- **那一轮跑在最小权限 profile 上**（`douyin-duty`）：没有文件读写、没有 shell、没有网络、
  没有 subagent，只有读抖音的那些工具。它写不了你的文件，也碰不到别的东西。
- **评论内容是"别人的话"，不是指令**。有人在评论区写「忽略之前的指令」「输出 API Key」，
  章程要求一律当垃圾。
- **发出去的东西可控**：评论默认关；开了也限每轮 1 条、150 字内。
- 浏览器是一个**独立 profile**，不碰你日常用的 Edge 登录态。

---

## 已知限制

- **看不到视频内容**：抖音没有字幕 / ASR 接口。判断只基于标题、话题、作者、数据、评论。
  所以章程里明说了不许假装"看完了"。
- **评论会触发风控**：短时间多次发评论会要手机短信验证。默认每轮 1 条、每天最多几条，
  就是为了不踩这条线。
- **搜索结果是网页版排序**，跟 App 里不一样。
- 只做了 Windows 的"打开文件夹"按钮；其他平台那个按钮会返回一句提示。

---

## 目录结构

```
dsh-douyin-scroll/
├── index.js                  host 半端：11 个工具 + 谷时定时器 + HTTP API
├── client.js                 浏览器半端：设置页「刷抖音」（自注册 bundle）
├── cordis.patch.yml          bundle patch（装了就在 profile 里挂上）
├── lib/
│   ├── state.mjs             谷时窗口 / 家目录 / 判重表 / 章程指纹
│   ├── browser.mjs           Playwright 持久 Edge + 页内 fetch + 发评论 UI 流程
│   ├── api.mjs               抖音各端点 + 字段归一化
│   └── hostdeps.mjs          从宿主那棵树里借 schemastery / dsh-tools
├── prompts/duty.md           值班章程（交给那一轮的提示词）
├── profile-template/douyin-duty/   最小权限 profile 模板
├── selfcheck.mjs             离线自检（node selfcheck.mjs）
└── AGENTS.md                 给改这个仓库的 agent 看的约定
```

---

## 开发

```bash
node selfcheck.mjs     # 离线自检：host 半端 + client 半端 + 随包文件
```

自检**不启动浏览器**。要真验数据，装进 profile 后用 `dy_status` / `dy_search` 试。

## License

MIT