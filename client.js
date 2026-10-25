/**
 * dsh-douyin-scroll —— 浏览器半端（**设置里的一页**）
 * ============================================================================
 * ⭐ client bundle 不是 ESM，是自注册脚本：
 *
 *     window.__ModuleLoader__.load({ id: '<包名>', factory: (require) => ({ inject, apply }) })
 *
 *   id 必须等于 package.json 的 name。
 *
 * ⭐ 进「设置」的方式（抄官方 dsh-meme 的写法）：
 *
 *     const slots = ctx.get('slots')
 *     slots.inject('settings.section', () => slots.register(
 *       { name: 'settings.section', id: 'douyin-scroll', order: 31, label: '刷抖音' },
 *       () => h(Panel),
 *     ))
 *
 * 这一页的形状：
 *   · 总开关（峰谷自动刷）→ 打开之后下面才展开子开关（中午 / 晚上）
 *   · 数字项能自己填（每天几条）
 *   · 账号绑定在设置页里（一个按钮开浏览器窗口去登录，cookie 留在 profile 里）
 *   · 会发东西出去的（自动评论）默认关
 * ============================================================================
 */
window.__ModuleLoader__.load({
  id: 'dsh-douyin-scroll',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const API = '/api/douyin-duty'

    /* ⚠️ jget/jpost 必须看 res.ok —— 否则 HTTP 500 的 {ok:false,error} 会被当成"已保存" */
    const asJson = async (res) => {
      if (res.ok) return res.json()
      const why = res.status === 401 ? '（未登录 / 没权限）' : res.status === 403 ? '（被宿主拦了）' : ''
      throw new Error('HTTP ' + res.status + why)
    }
    const jget = async (p) => asJson(await fetch(API + p, { credentials: 'same-origin' }))
    const jpost = async (p, body) => asJson(await fetch(API + p, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
    }))

    const CSS = `
[data-dy-page]{display:flex;flex-direction:column;gap:16px;padding:2px 2px 10px;max-width:660px;}
[data-dy-sec]{display:flex;flex-direction:column;gap:8px;}
[data-dy-h]{font-size:11px;font-weight:600;letter-spacing:.04em;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-dy-row]{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
[data-dy-grow]{flex:1;min-width:0;}
[data-dy-label]{font-size:13px;}
[data-dy-note]{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-dy-sw]{flex:none;width:38px;height:22px;border-radius:11px;border:0;cursor:pointer;position:relative;
  background:var(--dsw-alias-bg-layer-3,#3a3a3c);transition:background .15s;}
[data-dy-sw][data-on]{background:var(--dsw-alias-brand-primary,#4c8dff);}
[data-dy-sw]::after{content:'';position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:9px;
  background:#fff;transition:transform .15s;}
[data-dy-sw][data-on]::after{transform:translateX(16px);}
[data-dy-num]{width:72px;flex:none;padding:5px 8px;border-radius:8px;font-size:13px;
  border:1px solid var(--dsw-alias-bg-layer-3,#3a3a3c);background:var(--dsw-alias-bg-layer-2,#2c2c2e);
  color:var(--dsw-alias-label-primary,#e8e8ea);}
[data-dy-input]{width:100%;padding:6px 9px;border-radius:8px;font-size:13px;font-family:inherit;box-sizing:border-box;
  border:1px solid var(--dsw-alias-bg-layer-3,#3a3a3c);background:var(--dsw-alias-bg-layer-2,#2c2c2e);
  color:var(--dsw-alias-label-primary,#e8e8ea);}
[data-dy-ta]{min-height:76px;resize:vertical;line-height:1.5;}
[data-dy-btn]{padding:5px 11px;border-radius:8px;font-size:12px;cursor:pointer;
  border:1px solid var(--dsw-alias-bg-layer-3,#3a3a3c);background:var(--dsw-alias-bg-layer-2,#2c2c2e);
  color:var(--dsw-alias-label-primary,#e8e8ea);}
[data-dy-btn]:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.07));}
[data-dy-btn]:disabled{opacity:.45;cursor:default;}
[data-dy-btn][data-primary]{background:var(--dsw-alias-brand-primary,#4c8dff);border-color:transparent;color:#fff;}
[data-dy-msg]{font-size:12px;line-height:18px;padding:7px 10px;border-radius:8px;
  background:var(--dsw-alias-bg-layer-2,#2c2c2e);color:var(--dsw-alias-label-secondary,#c7c7cc);}
[data-dy-msg][data-warn]{color:#ffb04d;}
[data-dy-msg][data-good]{color:#5fd38d;}
[data-dy-tabs]{display:flex;gap:6px;border-bottom:1px solid var(--dsw-alias-bg-layer-3,#3a3a3c);padding-bottom:8px;}
[data-dy-tab]{padding:4px 10px;border-radius:7px;font-size:12px;cursor:pointer;border:0;background:transparent;
  color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-dy-tab][aria-selected="true"]{background:var(--dsw-alias-bg-layer-3,#3a3a3c);
  color:var(--dsw-alias-label-primary,#e8e8ea);}
[data-dy-kv]{display:grid;grid-template-columns:auto 1fr;gap:3px 12px;font-size:12px;line-height:18px;}
[data-dy-k]{color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-dy-pre]{max-height:340px;overflow:auto;margin:0;padding:10px;border-radius:8px;font-size:11px;line-height:1.55;
  white-space:pre-wrap;word-break:break-word;background:var(--dsw-alias-bg-layer-1,#232325);
  color:var(--dsw-alias-label-secondary,#c7c7cc);}
`

    const useStatus = (ms) => {
      const [st, setSt] = React.useState(null)
      const [err, setErr] = React.useState('')
      React.useEffect(() => {
        let alive = true
        const load = async () => {
          try {
            const r = await jget('/status')
            if (alive) { setSt(r); setErr('') }
          } catch (e) { if (alive) setErr(String(e?.message ?? e)) }
        }
        load()
        const t = setInterval(load, ms)
        return () => { alive = false; clearInterval(t) }
      }, [ms])
      return [st, err]
    }

    const Sw = ({ on, onChange, label, note, disabled }) => h('div', { 'data-dy-row': '' },
      h('div', { 'data-dy-grow': '' },
        h('div', { 'data-dy-label': '' }, label),
        note ? h('div', { 'data-dy-note': '' }, note) : null),
      h('button', {
        'data-dy-sw': '', 'data-on': on ? 'true' : undefined,
        role: 'switch', 'aria-checked': on ? 'true' : 'false',
        disabled: disabled || undefined,
        onClick: () => onChange(!on),
      }))

    const Num = ({ value, onChange, unit, label, note }) => h('div', { 'data-dy-row': '' },
      h('div', { 'data-dy-grow': '' },
        h('div', { 'data-dy-label': '' }, label),
        note ? h('div', { 'data-dy-note': '' }, note) : null),
      h('input', {
        'data-dy-num': '', type: 'number', min: 0, value,
        onChange: (e) => onChange(e.target.value),
      }),
      unit ? h('div', { 'data-dy-note': '' }, unit) : null)

    function Panel() {
      const [st, stErr] = useStatus(5000)
      const [tab, setTab] = React.useState('daily')
      const [busy, setBusy] = React.useState('')
      const [msg, setMsg] = React.useState('')
      const [tone, setTone] = React.useState('')
      // ⚠️ 输入框必须绑"本地草稿"：/status 每 5 秒轮询，直接绑 cfg 会把用户打字冲掉
      const [perDay, setPerDay] = React.useState(null)
      const [perRound, setPerRound] = React.useState(null)
      const [mention, setMention] = React.useState(null)
      const [kws, setKws] = React.useState(null)
      const [persona, setPersona] = React.useState(null)
      const [rl, setRl] = React.useState(null)
      const [port, setPort] = React.useState(null)
      const [profileName, setProfileName] = React.useState(null)
      const [dshBin, setDshBin] = React.useState(null)
      const [report, setReport] = React.useState(null)
      const [who, setWho] = React.useState(null)
      const alive = React.useRef(true)
      React.useEffect(() => () => { alive.current = false }, [])

      const cfg = st?.config
      React.useEffect(() => {
        if (!cfg) return
        if (perDay === null) setPerDay(String(cfg.perDay ?? 5))
        if (perRound === null) setPerRound(String(cfg.commentPerRound ?? 1))
        if (mention === null) setMention(cfg.mentionName || '')
        if (kws === null) setKws((cfg.keywords || []).join('\n'))
        if (persona === null) setPersona(cfg.personaPrompt || '')
        if (rl === null) setRl(cfg.reportLevel || 'full')
        if (port === null) setPort(String(cfg.cdpPort ?? 9238))
        if (profileName === null) setProfileName(cfg.headlessProfile || 'douyin-duty')
        if (dshBin === null) setDshBin(cfg.dshBin || '')
      }, [cfg])

      const say = (t, tn) => { setMsg(t); setTone(tn || '') }

      const patch = async (p, what) => {
        setBusy(JSON.stringify(p))
        try {
          const r = await jpost('/config', p)
          if (r?.host && r.host.ok === false) say(`${what || '设置'}：插件自己那份存了，但 DSH 设置页那份没写进去（${r.host.error}）`, 'warn')
          else say(`${what || '设置'}：已保存`, 'good')
        } catch (e) { say(String(e?.message ?? e), 'warn') }
        finally { setBusy('') }
      }

      const onRun = async () => {
        setBusy('run')
        try {
          const r = await jpost('/run', {})
          if (r?.started) say('已经跑起来了 —— 几分钟后回来看报告', 'good')
          else say('没跑起来：' + (r?.error || r?.hint || '未知原因'), 'warn')
        } catch (e) { say(String(e?.message ?? e), 'warn') }
        finally { setBusy('') }
      }

      const onChrome = async () => {
        setBusy('chrome')
        try {
          const r = await jpost('/chrome', {})
          setWho(r)
          if (r?.loggedIn) say(`已登录：${r.nickname}`, 'good')
          else say('浏览器开了 —— 在那个窗口里登录一次抖音（扫码或手机号），登录完回来说一声即可', '')
        } catch (e) { say(String(e?.message ?? e), 'warn') }
        finally { setBusy('') }
      }

      const onReport = async () => {
        setBusy('report')
        try {
          const r = await jget('/report')
          if (!r.exists) say('今天还没有报告（还没跑过，或者那一轮没挑到什么）', '')
          else setReport(r.text)
        } catch (e) { say(String(e?.message ?? e), 'warn') }
        finally { setBusy('') }
      }

      const onOpen = async (what) => {
        try { await jpost('/open', { what }) } catch (e) { say(String(e?.message ?? e), 'warn') }
      }

      const win = st?.windows || {}
      const tabBtn = (id, label) => h('button', {
        'data-dy-tab': '', type: 'button', 'aria-selected': tab === id ? 'true' : 'false',
        onClick: () => setTab(id),
      }, label)

      const daily = h(React.Fragment, null,
        h('div', { 'data-dy-sec': '' },
          h('div', { 'data-dy-h': '' }, '定量'),
          h(Num, {
            label: '每天最多挑几条',
            note: '这是**全天总量**，不是每轮。挑够了当天就不再跑。',
            value: perDay ?? '', unit: '条',
            onChange: (v) => {
              setPerDay(v)
              if (v === '' || Number.isNaN(Number(v))) return
              patch({ perDay: Math.max(0, Number(v)) }, '每天挑几条')
            },
          })),

        h('div', { 'data-dy-sec': '' },
          h('div', { 'data-dy-h': '' }, '峰谷自动刷'),
          h(Sw, {
            label: '在谷时段自动刷',
            note: '中午 12–14 点、晚上 18 点–早上 9 点（跟 DeepSeek 峰谷价对上的那几段）。关掉就只手动跑。',
            on: Boolean(cfg?.peakValley),
            onChange: (v) => patch({ peakValley: v }, '峰谷自动刷'),
          }),
          cfg?.peakValley ? h('div', { style: { paddingLeft: 2, display: 'flex', flexDirection: 'column', gap: 6 } },
            h(Sw, {
              label: '中午那一轮', on: Boolean(cfg?.noon),
              note: win.noon ? `${win.noon.start}–${win.noon.end}` : '12:00–14:00',
              onChange: (v) => patch({ noon: v }, '中午'),
            }),
            h(Sw, {
              label: '晚上那一轮', on: Boolean(cfg?.night),
              note: win.night ? `${win.night.start}–${win.night.end}` : '18:00–09:00',
              onChange: (v) => patch({ night: v }, '晚上'),
            })) : null),

        h('div', { 'data-dy-sec': '' },
          h('div', { 'data-dy-h': '' }, '手动'),
          h('div', { 'data-dy-row': '' },
            h('button', { 'data-dy-btn': '', 'data-primary': '', disabled: busy === 'run' || st?.running, onClick: onRun },
              st?.running ? '正在跑…' : '现在跑一轮'),
            h('button', { 'data-dy-btn': '', disabled: busy === 'report', onClick: onReport }, '看今天的报告'),
            h('button', { 'data-dy-btn': '', onClick: () => onOpen('out') }, '打开报告文件夹')),
          report !== null ? h('pre', { 'data-dy-pre': '' }, report) : null))

      const taste = h(React.Fragment, null,
        h('div', { 'data-dy-sec': '' },
          h('div', { 'data-dy-h': '' }, '关注关键词'),
          h('div', { 'data-dy-note': '' }, '一行一个。空了就用章程里默认那几组（AI 编程、大模型、效率工具…）。'),
          h('textarea', {
            'data-dy-input': '', 'data-dy-ta': '', value: kws ?? '',
            placeholder: 'DeepSeek\nAI 编程\n独立开发',
            onChange: (e) => setKws(e.target.value),
            onBlur: () => patch({ keywords: String(kws || '').split('\n').map((s) => s.trim()).filter(Boolean) }, '关键词'),
          })),
        h('div', { 'data-dy-sec': '' },
          h('div', { 'data-dy-h': '' }, '人设 / 口味'),
          h('div', { 'data-dy-note': '' }, '它会按这段话来判断"什么值得看"、也按这个口吻写日报。留空 = 中性。'),
          h('textarea', {
            'data-dy-input': '', 'data-dy-ta': '', value: persona ?? '',
            placeholder: '例：我是个在写代码的人，喜欢看具体的技术讲解、真实项目复盘，讨厌标题党和纯情绪输出。',
            onChange: (e) => setPersona(e.target.value),
            onBlur: () => patch({ personaPrompt: persona || '' }, '人设'),
          })))

      const social = h(React.Fragment, null,
        h('div', { 'data-dy-sec': '' },
          h('div', { 'data-dy-h': '' }, '互动'),
          h(Sw, {
            label: '自动评论并 @ 你',
            note: '默认关。开了之后它会在挑中的视频下发一条短评论，把 @昵称 写在正文里 —— 相当于替你"点一下"。',
            on: Boolean(cfg?.autoComment),
            onChange: (v) => patch({ autoComment: v }, '自动评论'),
          }),
          h('div', { 'data-dy-sec': '' },
            h('div', { 'data-dy-label': '' }, '@ 谁（抖音昵称，必须填）'),
            h('input', {
              'data-dy-input': '', type: 'text', value: mention ?? '',
              placeholder: '你的抖音昵称',
              onChange: (e) => setMention(e.target.value),
              onBlur: () => patch({ mentionName: mention || '' }, '要 @ 谁'),
            })),
          h(Num, {
            label: '每轮最多发几条评论', value: perRound ?? '', unit: '条',
            note: '抖音对高频评论有风控（会要短信验证），建议就 1 条。',
            onChange: (v) => {
              setPerRound(v)
              if (v === '' || Number.isNaN(Number(v))) return
              patch({ commentPerRound: Math.max(0, Number(v)) }, '每轮几条评论')
            },
          })))

      const adv = h(React.Fragment, null,
        h('div', { 'data-dy-sec': '' },
          h('div', { 'data-dy-h': '' }, '浏览器'),
          h('div', { 'data-dy-row': '' },
            h('button', { 'data-dy-btn': '', disabled: busy === 'chrome', onClick: onChrome }, '打开浏览器（去登录）')),
          who ? h('div', { 'data-dy-note': '' }, who.loggedIn ? `已登录：${who.nickname}（uid ${who.uid}）` : '还没登录') : null,
          h(Num, {
            label: '浏览器调试端口', value: port ?? '', unit: '',
            note: '默认 9238。被别的插件占了就改一个。改完重开浏览器生效。',
            onChange: (v) => {
              setPort(v)
              if (v === '' || Number.isNaN(Number(v))) return
              patch({ cdpPort: Math.max(1, Number(v)) }, '调试端口')
            },
          })),
        h('div', { 'data-dy-sec': '' },
          h('div', { 'data-dy-h': '' }, '那一轮怎么跑'),
          h('div', { 'data-dy-label': '' }, 'profile 名'),
          h('div', { 'data-dy-note': '' }, '默认 douyin-duty（最小权限：没有文件、没有命令、没有网络，只有读抖音的工具）。'),
          h('input', {
            'data-dy-input': '', type: 'text', value: profileName ?? '',
            onChange: (e) => setProfileName(e.target.value),
            onBlur: () => patch({ headlessProfile: profileName || 'douyin-duty' }, 'profile'),
          }),
          h('div', { 'data-dy-label': '', style: { marginTop: 6 } }, 'dsh 路径（留空自动找）'),
          h('input', {
            'data-dy-input': '', type: 'text', value: dshBin ?? '',
            placeholder: '…/@deepseek-ai/dsh/lib/bin.js',
            onChange: (e) => setDshBin(e.target.value),
            onBlur: () => patch({ dshBin: dshBin || '' }, 'dsh 路径'),
          }),
          h(Sw, {
            label: '无头模式（不弹窗口）',
            note: '默认关 —— 能看见它在做什么，出问题时也好插手。',
            on: Boolean(cfg?.headless),
            onChange: (v) => patch({ headless: v }, '无头模式'),
          })),
        h('div', { 'data-dy-sec': '' },
          h('div', { 'data-dy-h': '' }, '报告'),
          h('div', { 'data-dy-row': '' },
            ['full', 'brief', 'off'].map((v) => h('button', {
              key: v, 'data-dy-btn': '', 'data-primary': cfg?.reportLevel === v ? '' : undefined,
              onClick: () => { setRl(v); patch({ reportLevel: v }, '报告形态') },
            }, v === 'full' ? '完整' : v === 'brief' ? '薄版' : '不写'))),
          h('div', { 'data-dy-note': '' },
            '完整：每条都有为什么。薄版：每条一两行。不写：只记真发了评论的那几条。')),
        h('div', { 'data-dy-sec': '' },
          h('div', { 'data-dy-h': '' }, '路径'),
          st ? h('div', { 'data-dy-kv': '' },
            h('div', { 'data-dy-k': '' }, '家目录'), h('div', {}, st.home || ''),
            h('div', { 'data-dy-k': '' }, '今天报告'), h('div', {}, st.report || ''),
            h('div', { 'data-dy-k': '' }, 'dsh'), h('div', {}, st.dshCli || '（没找到）'),
            h('div', { 'data-dy-k': '' }, 'profile'), h('div', {}, `${st.profile || ''}（${st.profileState || '?'}）`)) : null,
          h('div', { 'data-dy-row': '' },
            h('button', { 'data-dy-btn': '', onClick: () => onOpen('home') }, '打开家目录'))))

      const statusLine = () => {
        if (stErr) return h('div', { 'data-dy-msg': '', 'data-warn': '' }, '读不到状态：' + stErr)
        if (!st) return h('div', { 'data-dy-msg': '' }, '读取中…')
        const left = Math.max(0, (st.perDay || 0) - (st.pickedToday || 0))
        return h('div', { 'data-dy-kv': '' },
          h('div', { 'data-dy-k': '' }, '今天'), h('div', {}, `${st.today} · 已挑 ${st.pickedToday} 条，还剩 ${left} 条`),
          h('div', { 'data-dy-k': '' }, '状态'), h('div', {}, st.running ? '正在跑一轮…' : '空闲'),
          h('div', { 'data-dy-k': '' }, '自动'), h('div', {}, st.peakValley
            ? `开 · ${['noon', 'night'].filter((k) => st.windows?.[k]?.switchOn).map((k) => st.windows[k].label).join(' / ') || '（两个都关了）'}`
            : '关 · 只手动跑'),
          h('div', { 'data-dy-k': '' }, '评论'), h('div', {}, st.autoComment && st.mentionName ? `开 · @ ${st.mentionName}` : '关'))
      }

      return h('div', { 'data-dy-page': '' },
        h('div', { 'data-dy-sec': '' },
          h('div', { 'data-dy-h': '' }, '刷抖音'),
          statusLine()),
        msg ? h('div', { 'data-dy-msg': '', 'data-warn': tone === 'warn' ? '' : undefined, 'data-good': tone === 'good' ? '' : undefined }, msg) : null,
        h('div', { 'data-dy-tabs': '' },
          tabBtn('daily', '日常'),
          tabBtn('taste', '偏好'),
          tabBtn('social', '互动'),
          tabBtn('adv', '高级')),
        tab === 'daily' ? daily : tab === 'taste' ? taste : tab === 'social' ? social : adv,
        report !== null ? h('div', { 'data-dy-sec': '' },
          h('div', { 'data-dy-row': '' },
            h('div', { 'data-dy-h': '' }, '今天的报告'),
            h('button', { 'data-dy-btn': '', onClick: () => setReport(null) }, '收起')),
          h('pre', { 'data-dy-pre': '' }, report)) : null)
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const style = document.createElement('style')
        style.setAttribute('data-plugin-css', 'dsh-douyin-scroll')
        style.textContent = CSS
        document.head.appendChild(style)
        try { ctx.effect(() => () => style.remove(), 'dsh-douyin-scroll: 设置页样式') } catch { /* 老宿主没有 effect */ }

        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
        if (!slots) return
        slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'douyin-scroll', order: 31, label: '刷抖音' },
          () => h(Panel),
        ))
      },
    }
  },
})