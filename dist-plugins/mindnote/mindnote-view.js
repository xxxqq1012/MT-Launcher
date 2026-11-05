/**
 * mindnote-view.js —— 随心记增强覆盖层 v2（MT Launcher）
 *
 * 在 mindnote 前端（bundle 不可改）之上提供：
 *   1. 顶栏「Git 同步」图标按钮（打开 cmark 设置面板，含 GIT 集成/自动同步/备份/数据管理）
 *   2. 侧栏 git 分支栏：当前分支 + ↓拉取 / ↑推送 / ⟳同步 / ⋯操作（参照 cmark 分支栏形态）
 *      —— 点击分支 chip 打开「工作区变更记录」（cmark git-panel 的 __zgpOpen('changes')）
 *   3. 左侧右键菜单（文件/文件夹）：
 *        复制一份（笔记/文件夹及其下笔记）
 *        在资源管理器中打开（git 仓库根）
 *        编辑只读（锁定禁止编辑，加 🔒 标识；编辑器 contenteditable 拦截）
 *   4. 设置弹窗瘦身：隐藏「自动备份 / 数据管理」区块（已迁移到 git 设置面板），保留主题/字号/源码字体
 *
 * 数据层说明：锁定状态存独立 key（utools 插件本地数据 mn-locks / 浏览器模式 localStorage mn-locks），
 * 不污染 mindnote 笔记数据；saveNote/saveNotesBatch 被包装以拦截锁定笔记的写入。
 * 浏览器直开（无 preload）：分支栏/锁定显示降级提示，DOM 结构仍可验证。
 */
;(function () {
  'use strict'

  var GIT_ICON =
    '<svg class="app-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="6" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="6" r="3"></circle>' +
    '<path d="M6 9v6"></path><path d="M18 9a9 9 0 0 1-9 9"></path></svg>'
  // 设置图标（问题 5：git 设置按钮图标改为设置）
  var SETTINGS_ICON =
    '<svg class="app-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="3"></circle>' +
    '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>'
  // 刷新图标（问题 3：新增刷新按钮）
  var REFRESH_ICON =
    '<svg class="app-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M21 12a9 9 0 1 1-2.64-6.36"></path><path d="M21 3v6h-6"></path></svg>'
  // AI 图标（问题 8：AI 生成入口）
  var AI_ICON =
    '<svg class="app-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
    '<path d="M12 2.2l2.36 5.44L20 10l-5.64 2.36L12 17.8l-2.36-5.44L4 10l5.64-2.36L12 2.2z"></path>' +
    '<path d="M18.6 15.2l1.1 2.5 2.6 1.1-2.6 1.1-1.1 2.5-1.1-2.5-2.6-1.1 2.6-1.1 1.1-2.5z" opacity=".55"></path></svg>'
  var LOCK_ICON = '🔒'
  var BRANCH_LABEL = { pull: '↓', push: '↑', sync: '⟳' }

  // ============ AI 生成（问题 8，复刻 cmark 的 AI 弹窗） ============
  // system prompts（与 cmark bundle xN 同源）
  var AI_PROMPTS = {
    mermaid:
      '## 定位\n- 智能助手名称 ： Mermaid 图表生成助手\n- 主要功能 ：根据用户输入的内容生成 Mermaid 图表代码\n- Mermaid 版本 : 11.12.0\n\n## 要求\n- 生成的代码要符合 Mermaid 语法，准确表达用户需求\n- 根据用户输入的内容绘制最合适的图表类型\n- 确保生成的 Mermaid 代码可以正确渲染\n- 输出不要包含任何解释或其他内容\n\n## 输出格式：\n```mermaid\nMermaid 图表代码\n```',
    echarts:
      '## 定位\n- 智能助手名称 ：ECharts 统计图表生成助手\n- 主要功能 ：根据用户输入的内容生成 JSON 格式的 ECharts 配置代码\n- ECharts 版本 : 6.0.0\n\n## 要求\n- 只支持 ECharts 基础图表类型：柱状图（bar）、折线图（line）、饼图（pie）、散点图（scatter）\n- 根据用户输入的内容选择最合适的图表类型\n- 默认图表高度是 300, 可根据图表内容设置合适的图表高度：返回的 JSON 增加 "height" 字段，例如 { "height": 300, ... }\n- 不理解内容或数据格式错误时，返回一个空的 ECharts 配置代码\n- 输出不要包含任何解释或其他内容\n\n## 输出格式：\n```echarts\nJSON 格式的 ECharts 配置代码\n```',
    table:
      '## 定位\n- 智能助手名称 ： Markdown 表格生成助手\n- 主要功能 ：根据用户输入的内容生成 Markdown 表格\n\n## 要求\n- 确保生成的 Markdown 表格可以正确渲染\n\n## 输出\n- 只能返回一个 Markdown 表格\n- 不要包含任何解释或其他内容\n- 不理解用户内容或用户内容无法转为表格时，输出 "fail"'
  }
  // 预设按钮（与 cmark y2e 同源）
  var AI_PRESETS = [
    {
      key: 'mermaid',
      label: '生成 Mermaid 流程图表',
      d: 'M14 9v2h-3V9H8.5V7H11V1H4v6h2.5v2H4v6h2.5v2H4v6h7v-6H8.5v-2H11v-2h3v2h7V9z'
    },
    {
      key: 'echarts',
      label: '生成 ECharts 统计图表',
      d: 'M4 9h4v11H4zm12 4h4v7h-4zm-6-9h4v16h-4z'
    },
    {
      key: 'table',
      label: '生成表格',
      d: 'M3 3v18h18V3zm8 16H5v-6h6zm0-8H5V5h6zm8 8h-6v-6h6zm0-8h-6V5h6z'
    }
  ]
  var AI_MODEL_KEY = 'mindnote-ai-model'
  var aiState = { models: [], model: '', desc: '', busy: false, err: '', cur: '' }

  // ============ 轻量工具 ============
  function $(sel, el) {
    return (el || document).querySelector(sel)
  }
  function $$(sel, el) {
    return Array.prototype.slice.call((el || document).querySelectorAll(sel))
  }

  function toast(msg, kind) {
    try {
      var t = document.createElement('div')
      t.textContent = msg
      t.className =
        'mn-toast' + (kind === 'err' ? ' mn-toast-err' : kind === 'warn' ? ' mn-toast-warn' : '')
      document.body.appendChild(t)
      setTimeout(function () {
        t.remove()
      }, 3200)
    } catch (e) {}
  }

  // 读 cmark 配置（workspace）：view 是渲染层不能 require，走 __znotesGit.repoRoot
  function repoRoot() {
    try {
      if (window.__znotesGit && window.__znotesGit.repoRoot) return window.__znotesGit.repoRoot
    } catch (e) {}
    return ''
  }

  function gitReady() {
    return !!(window.__znotesGit && window.__znotesGit.branches && window.__znotesGit.repoRoot)
  }

  // ============ 1. 顶栏 Git 按钮（保留既有逻辑） ============
  function toggleGitPanel() {
    if (!window.__zgsOpen) {
      toast('Git 服务未就绪：请在 MT Launcher 宿主中打开本插件', 'warn')
      return
    }
    if (window.__zgsIsOpen && window.__zgsIsOpen()) {
      if (window.__zgsClose) window.__zgsClose()
      setBtnActive(false)
    } else {
      window.__zgsOpen()
      setBtnActive(true)
    }
  }

  function setBtnActive(on) {
    var b = document.getElementById('mn-git-btn')
    if (b) b.classList.toggle('active', !!on)
  }

  function ensureGitBtn() {
    if (document.getElementById('mn-git-btn')) return
    // bundle 顶栏是 header（压缩类，无 .topbar/.topbar-right/.topbar-center）：
    // 锚定右上角按钮区 = 含「目录」按钮的容器（右区），把 git 设置入口插到它末尾
    var host = null
    var tocBtn = document.querySelector('header [title="目录"]')
    if (tocBtn && tocBtn.parentNode) host = tocBtn.parentNode
    if (!host) {
      var header = document.querySelector('header')
      if (header) host = header
    }
    if (!host) return
    // git 设置入口（⚙️）：title 用「Git 设置」，与 bundle 原生「设置」区分、避免被 hideNativeSettingsBtn 误删
    var btn = document.createElement('button')
    btn.id = 'mn-git-btn'
    btn.className = 'btn-icon mn-git-top-btn'
    btn.title = 'Git 设置'
    btn.setAttribute('aria-label', 'Git 设置')
    btn.innerHTML = SETTINGS_ICON
    btn.style.cssText =
      'display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:none;background:transparent;cursor:pointer;color:inherit;flex:none;'
    btn.addEventListener('click', function (ev) {
      ev.stopPropagation()
      toggleGitPanel()
    })
    host.appendChild(btn)
    // 移除 bundle 原生「设置」按钮（避免两个入口）
    hideNativeSettingsBtn()
  }

  // ============ 3. 刷新文件夹区 + 顶栏刷新/AI 按钮（问题 2/3/8） ============
  // 取 bundle 的 Pinia store（#app 的 Vue app → globalProperties.$pinia → 含 loadNoteList 的 store）
  function mnStore() {
    try {
      var app = document.querySelector('#app').__vue_app__
      if (!app) return null
      var pinia = app.config && app.config.globalProperties && app.config.globalProperties.$pinia
      if (!pinia || !pinia._s) return null
      var found = null
      pinia._s.forEach(function (st) {
        if (
          !found &&
          st &&
          typeof st.loadNoteList === 'function' &&
          typeof st.createNote === 'function'
        )
          found = st
      })
      return found
    } catch (e) {
      return null
    }
  }

  // 3.2.28：文件夹目录顺序跳动根因之二——bundle 的 loadNoteList（ae→Uu）对「组内存在
  // sortOrder==null 笔记」的文件夹每次全量重排并写回，顺序被 updatedAt（编辑时间）支配，
  // 任何一篇保存/拉取后 updatedAt 变化 → 下次刷新顺序就变（“随机跳动”）。
  // 这里在每次刷新前把 null sortOrder 一次性固化（按当前列表位置 (i+1)*100），此后组内无
  // null，bundle 的 Uu 不再触发，顺序由 sortOrder 唯一决定（稳定）。
  function stabilizeSortOrder() {
    try {
      var mn = window.mindnote
      if (!mn || typeof mn.getNoteList !== 'function' || typeof mn.saveNote !== 'function') return
      var list = mn.getNoteList() || []
      var patch = []
      for (var i = 0; i < list.length; i++) {
        var n = list[i]
        if (n && n.id != null && n.sortOrder == null)
          patch.push({ id: n.id, sortOrder: (i + 1) * 100 })
      }
      if (!patch.length) return
      for (var j = 0; j < patch.length; j++) {
        var note = mn.getNote(patch[j].id)
        if (note) {
          note.sortOrder = patch[j].sortOrder
          try {
            mn.saveNote(note.id, note)
          } catch (e) {}
        }
      }
      // 同步列表缓存里的 sortOrder：否则 bundle loadNoteList 重读列表项仍是 null →
      // Uu 每次刷新重新重排（顺序跳动复现），必须让列表缓存与 note 文档一致
      var nl = mn.getNoteList ? mn.getNoteList() : null
      var touched = false
      if (Array.isArray(nl)) {
        for (var k = 0; k < patch.length; k++) {
          var pi = patch[k]
          for (var m = 0; m < nl.length; m++) {
            if (nl[m] && nl[m].id === pi.id && nl[m].sortOrder == null) {
              nl[m].sortOrder = pi.sortOrder
              touched = true
            }
          }
        }
        if (touched && typeof mn.saveNoteList === 'function') {
          try {
            mn.saveNoteList(nl)
          } catch (e) {}
        }
      }
    } catch (e) {}
  }
  // 导出给宿主/测试/右键刷新等外部入口直接调用（幂等：无 null 时不产生任何写）
  try {
    if (window.mindnote) window.mindnote.stabilizeSortOrder = stabilizeSortOrder
  } catch (e) {}

  // 刷新文件夹区（笔记+文件夹树）：先强制重扫磁盘 md 列表（3.2.25：git 拉取落盘的新文件
  // 不会自动进 mfStorage 缓存），再调用 bundle store 的 loadNoteList（同源重读）
  function refreshFileArea() {
    try {
      stabilizeSortOrder()
    } catch (e) {}
    try {
      if (window.mindnote && typeof window.mindnote.refreshNoteListFromDisk === 'function') {
        window.mindnote.refreshNoteListFromDisk()
      }
    } catch (e) {}
    var st = mnStore()
    if (st && typeof st.loadNoteList === 'function') {
      try {
        st.loadNoteList()
      } catch (e) {}
    }
    // 兜底：预热事件 + 锁标识刷新
    try {
      window.dispatchEvent(new Event('mindnote:warmed'))
    } catch (e) {}
    try {
      applyTreeLocks()
    } catch (e) {}
  }

  // 定位 bundle 格式工具栏（FormatToolbar）：.editor-toolbar 为根；
  // bundle 的 H1 按钮 title 是「标题 1 (Alt+1)」（Wg 生成），旧 [title="H1"] 永远不命中
  // 3.2.19：加固多级兜底（实机反馈「AI 生成」按钮未出现在工具栏行首 → 此前定位器可能未命中 bundle 结构）
  function formatToolbarEl() {
    var el = document.querySelector(
      '.editor-toolbar, .format-toolbar, [class*="editor-toolbar"], [class*="format-toolbar"], [role="toolbar"], [aria-label*="格式"]'
    )
    if (el && el !== document.body) return el
    var row = document.querySelector('[aria-label="格式工具栏"]')
    if (row && row !== document.body) return row
    var h1 = document.querySelector(
      'button[title*="标题 1"], [aria-label*="标题 1"], button[title="H1"], [aria-label="H1"]'
    )
    if (!h1) {
      // 压缩 class 未知场景：全文档扫按钮文本 "H1"（编辑工具栏行首标题按钮）
      var bts = document.querySelectorAll('button')
      for (var i = 0; i < bts.length; i++) {
        var bt = bts[i]
        if ((bt.textContent || '').trim() === 'H1' || bt.getAttribute('aria-label') === 'H1') {
          h1 = bt
          break
        }
      }
    }
    if (h1 && h1.parentNode && h1.parentNode !== document.body) return h1.parentNode
    // 泛化兜底：遍历 header/工具区所有按钮，按 title/aria-label/文本 匹配 H1 样式按钮，取其行容器
    var all = document.querySelectorAll(
      'header button, [class*="topbar"] button, [class*="toolbar"] button, [class*="btn-icon"], [class*="icon-btn"]'
    )
    for (var i = 0; i < all.length; i++) {
      var b = all[i]
      var t = (
        (b.title || '') +
        ' ' +
        (b.getAttribute('aria-label') || '') +
        ' ' +
        (b.textContent || '')
      ).trim()
      if (!/标题\s*1|(^|\s)H1(\s|$)/i.test(t)) continue
      var p = b.parentNode
      if (p && p !== document.body && p !== document.documentElement) return p
    }
    return null
  }

  // 3.2.20 需求⑥根因：bundle 格式工具栏（.editor-toolbar，行首组含 H1/H2/H3）只在有激活笔记标签时
  // 渲染——空编辑器窗口（无激活笔记）下 toolbar DOM 不存在，旧 ensureToolbarBtns 插不进去。
  // 修法：有工具栏 → 插行首（AI 在最前）；无工具栏 → 兜底挂顶栏右区（目录/设置按钮容器），任何状态可见。
  function topbarHost() {
    try {
      var toc = document.querySelector('header [title="目录"]')
      if (toc && toc.parentNode && toc.parentNode !== document.body) return toc.parentNode
    } catch (e) {}
    try {
      var header = document.querySelector('header')
      if (header && header !== document.body) return header
    } catch (e) {}
    return null
  }

  // 精确定位「可见」的 H1 按钮（工具栏行首锚点；3.2.22 需求②）
  // 3.2.21 的 H1 扫描未过滤可见性，可能命中隐藏模板副本 → AI 迁入不可见容器 → 实机「AI 完全消失」。
  // 修复：只接受可见的 H1（offsetParent / getClientRects 判定），优先 title/aria 精确匹配，文本扫描兜底。
  function findH1Btn() {
    var cands = []
    try {
      var hits = document.querySelectorAll(
        'button[title*="标题 1"], [aria-label*="标题 1"], button[title="H1"], [aria-label="H1"]'
      )
      for (var i = 0; i < hits.length; i++) cands.push(hits[i])
    } catch (e) {}
    if (!cands.length) {
      try {
        var bts = document.querySelectorAll('button')
        for (var j = 0; j < bts.length; j++) {
          var bt = bts[j]
          if ((bt.textContent || '').trim() === 'H1' || bt.getAttribute('aria-label') === 'H1')
            cands.push(bt)
        }
      } catch (e) {}
    }
    for (var k = 0; k < cands.length; k++) {
      var c = cands[k]
      try {
        if (
          c.offsetParent != null ||
          (typeof c.getClientRects === 'function' && c.getClientRects().length > 0)
        )
          return c
      } catch (e) {}
    }
    return null
  }

  // 顶栏工具行新增「AI 生成」+「刷新文件夹区」按钮（需求⑥：用户点名行首 AI；问题 3：刷新）
  // 3.2.22 需求②：AI 必须以可见 H1 按钮为锚点、紧贴 H1 左侧；bundle 重渲染/重排后
  // tick 检测到偏离即搬回（自愈）。类名容器（formatToolbarEl）与顶栏仅为 H1 缺失时的兜底，
  // 不再让容器选择器优先于 H1 锚点（否则可能命中隐藏模板容器 → AI 不可见）。
  function ensureToolbarBtns() {
    var h1Btn = findH1Btn()
    var holder = null
    if (h1Btn && h1Btn.parentNode && h1Btn.parentNode !== document.body) holder = h1Btn.parentNode
    if (!holder) {
      var fe = formatToolbarEl()
      if (fe && fe !== document.body) holder = fe
    }
    var host = holder || topbarHost()
    if (!host) return
    var ab = document.getElementById('mn-ai-btn')
    if (!ab) {
      ab = document.createElement('button')
      ab.id = 'mn-ai-btn'
      ab.type = 'button'
      ab.className = 'btn-icon mn-tool-btn mn-ai-tool-btn'
      ab.title = 'AI 生成'
      ab.setAttribute('aria-label', 'AI 生成')
      // 3.2.23：只要图标，不要文字（用户反馈①）
      ab.innerHTML = AI_ICON
      ab.addEventListener('click', function (ev) {
        ev.stopPropagation()
        openAiModal()
      })
    } else if (ab.getAttribute('aria-label') !== 'AI 生成' || ab.title !== 'AI 生成') {
      // 旧版本残留：只刷新属性与文案，不重复创建
      try {
        ab.setAttribute('aria-label', 'AI 生成')
        ab.title = 'AI 生成'
      } catch (e) {}
      try {
        ab.innerHTML = AI_ICON
      } catch (e) {}
    }
    // 3.2.23：移除「刷新文件夹区」按钮（用户反馈①）——已存在的旧按钮直接删除，之后不再创建
    var rb = document.getElementById('mn-refresh-btn')
    if (rb) {
      try {
        rb.remove()
      } catch (e) {
        try {
          if (rb.parentNode) rb.parentNode.removeChild(rb)
        } catch (e2) {}
      }
    }
    if (h1Btn && h1Btn.parentNode === host) {
      // AI 紧贴 H1 左侧：被 bundle 重排/重建后自动搬回
      // （用 h1Btn.previousSibling 判定，刷新按钮在 AI 后面不影响）
      if (ab.parentNode !== host || h1Btn.previousSibling !== ab) host.insertBefore(ab, h1Btn)
    } else if (ab.parentNode !== host) {
      var first = host.querySelector('button')
      if (first && first !== ab) host.insertBefore(ab, first)
      else if (!first) host.appendChild(ab)
    }
    if (!ensureToolbarBtns._hostLogged) {
      ensureToolbarBtns._hostLogged = true
      var where = h1Btn
        ? '格式工具栏行首（H1 左侧）'
        : holder
          ? '格式工具栏容器'
          : '顶栏右区兜底（无激活笔记）'
      try {
        console.info('[mindnote] 工具按钮挂载：' + where)
      } catch (e) {}
    }
  }

  // 问题 5：移除 bundle 原生「设置」按钮（保留我们的 mn-git-btn 作为唯一设置入口）
  // 3.2.20：执行过一次即标记 done，避免每 800ms 全文档查 header 按钮（白屏加固 ②）
  var nativeSettingsHidden = false
  function hideNativeSettingsBtn() {
    if (nativeSettingsHidden) return
    try {
      // bundle 顶栏是 header（压缩类，无 .topbar 类），选择器覆盖 header 与旧 topbar 结构
      var btns = document.querySelectorAll(
        'header button[title="设置"], .topbar button[title="设置"], [class*="topbar"] button[title="设置"], .topbar-center button[title="设置"], .editor-toolbar button[title="设置"]'
      )
      var hit = 0
      for (var i = 0; i < btns.length; i++) {
        var b = btns[i]
        if (b.id === 'mn-git-btn') continue
        var p = b.parentNode
        if (p) {
          p.removeChild(b)
          hit++
        }
      }
      if (hit) nativeSettingsHidden = true
    } catch (e) {}
  }

  // 面板打开时点击别处自动收起
  function installAutoHide() {
    document.addEventListener(
      'mousedown',
      function (ev) {
        if (!window.__zgsIsOpen || !window.__zgsIsOpen()) return
        var el = ev.target
        if (!el || el.nodeType !== 1) return
        if (
          el.closest('#zgs-root') ||
          el.closest('#zgp-root') ||
          el.closest('#zgp-view') ||
          el.id === 'mn-git-btn' ||
          el.closest('.mn-git-bar') ||
          el.closest('.mn-ctx')
        )
          return
        if (
          el.closest('.workspace') ||
          el.closest('.editor') ||
          el.closest('[contenteditable="true"]') ||
          el.closest('.topbar') ||
          el.closest('.status-bar') ||
          el.closest('.sidebar')
        ) {
          if (window.__zgsClose) window.__zgsClose()
        }
      },
      true
    )
  }

  // ============ 2. 锁定数据层（patch window.mindnote） ============
  var locks = {} // noteId -> true
  var currentId = '' // 最近打开的笔记 id
  var currentLocked = false

  function loadLocks() {
    try {
      if (window.utools && typeof window.utools.getPluginLocalData === 'function') {
        var buf = window.utools.getPluginLocalData('mn-locks')
        if (buf) locks = JSON.parse(Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf))
      } else {
        locks = JSON.parse(localStorage.getItem('mn-locks') || '{}')
      }
    } catch (e) {
      locks = {}
    }
    if (!locks || typeof locks !== 'object' || Array.isArray(locks)) locks = {}
  }

  function saveLocks() {
    try {
      var json = JSON.stringify(locks || {})
      if (window.utools && typeof window.utools.setPluginLocalData === 'function') {
        window.utools.setPluginLocalData('mn-locks', Buffer.from(json, 'utf8'))
      } else {
        localStorage.setItem('mn-locks', json)
      }
    } catch (e) {}
  }

  function isLocked(id) {
    return !!(locks && locks[id])
  }

  function listStore() {
    // 统一读笔记列表：preload 模式走 window.mindnote，浏览器模式走 localStorage
    try {
      if (window.mindnote && window.mindnote.getNoteList) return window.mindnote.getNoteList() || []
      return JSON.parse(localStorage.getItem('mindnote_note_list') || '[]')
    } catch (e) {
      return []
    }
  }

  function noteTitle(id) {
    var list = listStore()
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i].title
    return ''
  }

  function newId() {
    return 'mn' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
  }

  // 标题清洗：去掉锁标识（🔒/🔓 badge 不再挂进标题元素，此处兜底兼容旧残留）
  function cleanTitle(t) {
    return String(t || '')
      .replace(/🔒|🔓/g, '')
      .trim()
  }

  // 把 Markdown 内容写一份到仓库根目录（cmark bridge createNote：fs 落盘 + rescan）
  // 复制副本由此获得真实磁盘文件，资源管理器可见
  function writeNoteToRepo(title, content) {
    try {
      if (window.__CMARK && typeof window.__CMARK.createNote === 'function') {
        var r = window.__CMARK.createNote('', title, content == null ? '' : String(content))
        return !!(r && r.ok)
      }
    } catch (e) {}
    return false
  }

  // 包装 window.mindnote：拦截锁定笔记的写入；记录当前打开笔记
  function patchMindnote() {
    var mn = window.mindnote
    if (!mn) return
    var oGet = mn.getNote,
      oSave = mn.saveNote,
      oBatch = mn.saveNotesBatch
    mn.getNote = function (id) {
      currentId = id == null ? '' : String(id)
      applyLockUI()
      return oGet(id)
    }
    mn.saveNote = function (id, data) {
      var key = id == null ? '' : String(id)
      if (data && typeof data === 'object' && data.locked !== undefined) {
        // view 自己的锁定状态写入（锁定/解锁）
        if (data.locked) locks[key] = true
        else delete locks[key]
        saveLocks()
        applyLockUI()
        var cp = {}
        for (var k in data) if (k !== 'locked') cp[k] = data[k]
        if (Object.keys(cp).length) return oSave(key, cp)
        return true
      }
      if (isLocked(key)) {
        toast('「' + (noteTitle(key) || '当前笔记') + '」已锁定，禁止编辑', 'warn')
        return false
      }
      return oSave(key, data)
    }
    mn.saveNotesBatch = function (notes) {
      var blocked = (notes || []).filter(function (n) {
        return isLocked(n.id)
      })
      if (blocked.length) toast('有 ' + blocked.length + ' 篇锁定笔记被跳过保存', 'warn')
      var ok = (notes || []).filter(function (n) {
        return !isLocked(n.id)
      })
      return oBatch(ok)
    }
    loadLocks()
  }

  // ============ 3. 只读 UI（编辑器 + 锁标识） ============
  function setEditorReadonly(ro) {
    // WYSIWYG
    $$('.ProseMirror.editor, .cm-content').forEach(function (el) {
      try {
        if (el.hasAttribute('contenteditable')) el.contentEditable = ro ? 'false' : 'true'
        else if (ro) el.setAttribute('contenteditable', 'false')
      } catch (e) {}
    })
  }

  function applyLockUI() {
    var locked = isLocked(currentId)
    currentLocked = locked
    setEditorReadonly(locked)
    ensureLockInd()
    // 锁定状态变化时强制重扫树（绕过签名缓存）
    treeLocksSig = ''
    rowNoteCache = null
    rowNoteCacheSig = ''
    applyTreeLocks()
  }

  // 轮询兜底：bundle 重渲染可能移除锁标识/恢复可编辑，1s tick 里补齐
  function ensureLockUI() {
    if (!currentLocked) return
    setEditorReadonly(true)
    ensureLockInd()
  }

  function ensureLockInd() {
    var ind = document.getElementById('mn-lock-ind')
    if (currentLocked) {
      if (!ind) {
        ind = document.createElement('span')
        ind.id = 'mn-lock-ind'
        ind.className = 'mn-lock-ind'
        ind.innerHTML = LOCK_ICON + ' 已锁定'
        var btn = document.getElementById('mn-git-btn')
        if (btn && btn.parentNode) btn.parentNode.insertBefore(ind, btn.nextSibling)
        else {
          var toc = document.querySelector('header [title="目录"]')
          if (toc && toc.parentNode) toc.parentNode.appendChild(ind)
          else {
            var r = document.querySelector('header')
            if (r) r.appendChild(ind)
          }
        }
      }
    } else if (ind) {
      ind.remove()
    }
  }

  // 侧栏树：统一映射行 → 笔记，给锁定笔记加 🔒
  // 3.2.20 需求⑧：改用 buildRowNoteMap（搜索视图优先），杜绝索引错位把锁标挂到错行；
  // 签名缓存避免无变化时每 800ms 全树扫描（白屏加固 ②）
  var treeLocksSig = ''
  function applyTreeLocks() {
    var tree = document.querySelector('.sidebar-tree')
    if (!tree) return
    var items = $$(
      '.note-item.tree-note-item, .tree-folder-item, .folder-item, .note-item, [class*="tree-note"], [class*="note-row"], [class*="tree-item"], [class*="tree-node"], .sidebar-tree [class*="item"]',
      tree
    )
    if (!items.length) return
    var list = listStore()
    // 3.2.27 反馈③：锁定摘要进签名——锁定/解锁（不走 applyLockUI 的 800ms 轮询路径）时
    // 也能强制重扫挂/摘锁标，避免签名不变导致锁标不刷新
    var lk = ''
    for (var k in locks) if (locks[k]) lk += k + ','
    var sig =
      items.length +
      ':' +
      list.length +
      ':' +
      list
        .map(function (n) {
          return (n.id || n.noteId) + '/' + cleanTitle(n.title)
        })
        .join(',') +
      ':L' +
      lk
    if (sig === treeLocksSig) return
    treeLocksSig = sig
    var map = buildRowNoteMap()
    items.forEach(function (item) {
      // 3.2.27 反馈③：buildRowNoteMap 返回数组（{item,note}[]），不能 map[item] 直接索引
      // （对象键取数组 → 永远 undefined → 锁标永不挂）；按 item 线性查找
      var note = null
      for (var i = 0; i < map.length; i++)
        if (map[i].item === item) {
          note = map[i].note || null
          break
        }
      var noteId = note ? note.id || note.noteId : null
      var locked = noteId && isLocked(noteId)
      var badge = item.querySelector('.mn-lock-badge')
      if (locked && !badge) {
        badge = document.createElement('span')
        badge.className = 'mn-lock-badge'
        badge.textContent = LOCK_ICON
        // 锁标挂到行容器末尾（不挂进标题元素），避免污染标题文本导致右键/复制匹配失败
        item.appendChild(badge)
      } else if (!locked && badge) {
        badge.remove()
      }
    })
  }

  // 编辑器输入拦截（兜底：即使 contenteditable 恢复也拦住）
  document.addEventListener(
    'beforeinput',
    function (ev) {
      if (!currentLocked) return
      var el = ev.target
      if (el && (el.closest('.ProseMirror') || el.closest('.cm-content'))) {
        ev.preventDefault()
        ev.stopPropagation()
      }
    },
    true
  )
  document.addEventListener(
    'keydown',
    function (ev) {
      if (!currentLocked) return
      var el = ev.target
      if (el && (el.closest('.ProseMirror') || el.closest('.cm-content'))) {
        if (ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey) {
          ev.preventDefault()
          ev.stopPropagation()
        }
      }
    },
    true
  )

  // ============ 4. 右键菜单 ============
  // 策略：保留 bundle 原生菜单（重命名/移动到/置顶/删除），在其中追加我们的
  // 复制一份 / 在资源管理器中打开 / 编辑只读锁定；若宿主未渲染原生菜单（如浏览器直开），
  // 则自绘同样的三项兜底。
  var ctx = null
  var ctxNote = null
  var ctxFolder = null
  function closeCtx() {
    if (ctx) {
      ctx.remove()
      ctx = null
    }
  }

  function openCtx(x, y, items) {
    closeCtx()
    ctx = document.createElement('div')
    ctx.className = 'mn-ctx'
    items.forEach(function (it) {
      var li = document.createElement('button')
      li.type = 'button'
      li.className =
        'mn-ctx-item' + (it.danger ? ' mn-ctx-danger' : '') + (it.checked ? ' mn-ctx-checked' : '')
      li.innerHTML =
        (it.icon ? '<span class="mn-ctx-ic">' + it.icon + '</span>' : '') +
        '<span>' +
        it.label +
        '</span>'
      li.addEventListener('click', function (ev) {
        ev.stopPropagation()
        closeCtx()
        it.run()
      })
      ctx.appendChild(li)
    })
    document.body.appendChild(ctx)
    var r = ctx.getBoundingClientRect()
    var vw = window.innerWidth,
      vh = window.innerHeight
    var px = Math.min(x, vw - r.width - 8),
      py = Math.min(y, vh - r.height - 8)
    ctx.style.left = Math.max(4, px) + 'px'
    ctx.style.top = Math.max(4, py) + 'px'
  }

  // 行 → 笔记 统一映射（3.2.20 需求⑧：搜索视图下 bundle 树行序与全量列表不一致，
  // 旧 index 配对会把锁标/右键动作挂到错行；优先匹配搜索视图结果，其次全量列表 index，
  // 最后标题兜底）
  var rowNoteCache = null
  var rowNoteCacheSig = ''
  function buildRowNoteMap() {
    var tree = document.querySelector('.sidebar-tree')
    // 3.2.27 反馈③：选择器与 applyTreeLocks 保持一致（宽匹配），避免 bundle 树行缺
    // tree-note-item class 时行→笔记映射落空、锁标挂不上（右键定位同步受益）
    var items = tree
      ? $$(
          '.note-item.tree-note-item, .tree-folder-item, .folder-item, .note-item, [class*="tree-note"], [class*="note-row"], [class*="tree-item"], [class*="tree-node"], .sidebar-tree [class*="item"]',
          tree
        )
      : []
    if (window.__mnDbg)
      console.error('[mn-map2]', JSON.stringify({ tree: !!tree, items: items.length }))
    if (!tree || !items.length) return []
    var list = listStore()
    var st = mnStore()
    var searched = null
    try {
      searched = st.searchedNoteList || st.searchResults || null
    } catch (e) {}
    var sig = items.length + ':' + list.length + ':' + (searched ? searched.length : -1)
    if (window.__mnDbg)
      console.error(
        '[mn-list]',
        JSON.stringify({
          sig: sig,
          list: list.map(function (x) {
            return x.title
          })
        })
      )
    if (rowNoteCache && sig === rowNoteCacheSig) return rowNoteCache
    var map = []
    items.forEach(function (item, idx) {
      var titleEl = item.querySelector('.note-title') || item
      var title = cleanTitle(titleEl.textContent)
      if (!title) return
      var note = null
      if (
        searched &&
        searched[idx] &&
        searched[idx].title &&
        cleanTitle(searched[idx].title) === title
      )
        note = searched[idx]
      else if (list[idx] && cleanTitle(list[idx].title) === title) note = list[idx]
      if (!note)
        for (var i = 0; i < list.length; i++)
          if (cleanTitle(list[i].title) === title) {
            note = list[i]
            break
          }
      map.push({ item: item, note: note })
      if (window.__mnDbg)
        console.error(
          '[mn-map]',
          JSON.stringify({
            idx: idx,
            cls: String(item.className || '').slice(0, 20),
            txt: String(item.textContent || '').slice(0, 14),
            nid: note && (note.id || note.noteId)
          })
        )
    })
    rowNoteCache = map
    rowNoteCacheSig = sig
    return map
  }

  function findNoteByItem(item) {
    var map = buildRowNoteMap()
    for (var i = 0; i < map.length; i++) if (map[i].item === item) return map[i].note || null
    return null
  }

  function isFolderItem(item) {
    var cls = String(item.className || '')
    return cls.indexOf('folder') >= 0 && cls.indexOf('note-item') < 0
  }

  function revealWorkspace() {
    var root = repoRoot()
    if (!root) {
      toast('Git 服务未就绪，无法定位仓库目录', 'warn')
      return
    }
    try {
      if (window.utools && typeof window.utools.shellShowItemInFolder === 'function') {
        // 打开目录本身：shellShowItemInFolder 需要文件路径，改走 shellOpenPath
        if (typeof window.utools.shellOpenPath === 'function') window.utools.shellOpenPath(root)
        else toast('已在资源管理器中打开：' + root)
      } else if (window.ztools && typeof window.ztools.shellOpenPath === 'function') {
        window.ztools.shellOpenPath(root)
      } else {
        toast('资源管理器打开不可用（浏览器直开）', 'warn')
      }
    } catch (e) {
      toast('打开失败：' + (e && e.message), 'err')
    }
  }

  function duplicateNote(note) {
    var nid = note ? note.id || note.noteId : ''
    if (!nid) return
    var src = null
    try {
      src = window.mindnote
        ? window.mindnote.getNote(nid)
        : JSON.parse(localStorage.getItem('mindnote_note_' + nid) || 'null')
    } catch (e) {}
    var base = src && typeof src === 'object' && src.content !== undefined ? src : { content: '' }
    var copy = {}
    for (var k in base) if (base.hasOwnProperty(k)) copy[k] = base[k]
    copy.id = newId()
    copy.title = (note.title || '未命名') + ' 副本'
    copy.updatedAt = Date.now()
    copy.sortOrder = (note.sortOrder == null ? 0 : note.sortOrder) + 0.5
    delete copy.locked
    if (window.mindnote && window.mindnote.saveNotesBatch) {
      window.mindnote.saveNotesBatch([copy])
    } else {
      localStorage.setItem('mindnote_note_' + copy.id, JSON.stringify(copy))
      var list = listStore()
      list.push({
        id: copy.id,
        title: copy.title,
        folderId: copy.folderId,
        updatedAt: copy.updatedAt,
        sortOrder: copy.sortOrder
      })
      localStorage.setItem('mindnote_note_list', JSON.stringify(list))
      try {
        window.dispatchEvent(new Event('storage'))
      } catch (e) {}
    }
    // 问题 3：saveNotesBatch 只写 db 不落盘，副本必须经 cmark bridge 写一份真实文件到仓库
    var wrote = writeNoteToRepo(copy.title, base.content)
    toast(wrote ? '已复制为「' + copy.title + '」（已写入仓库）' : '已复制为「' + copy.title + '」')
    // 问题 2：复制后同步刷新文件夹区（bundle store 重读列表）
    refreshFileArea()
  }

  function duplicateFolder(folder) {
    var folders = []
    try {
      folders = window.mindnote
        ? window.mindnote.getFolderList()
        : JSON.parse(localStorage.getItem('mindnote_folder_list') || '[]')
    } catch (e) {}
    var newFolder = {}
    for (var k in folder) if (folder.hasOwnProperty(k)) newFolder[k] = folder[k]
    newFolder.id = newId()
    newFolder.name = (folder.name || '未命名文件夹') + ' 副本'
    folders.push(newFolder)
    if (window.mindnote) window.mindnote.saveFolderList(folders)
    else localStorage.setItem('mindnote_folder_list', JSON.stringify(folders))
    // 复制其下笔记
    var list = listStore()
    var kids = list.filter(function (n) {
      return n.folderId === folder.id
    })
    kids.forEach(function (n) {
      duplicateNote(n)
    })
    if (!kids.length) toast('已复制文件夹「' + newFolder.name + '」')
    // 问题 2：刷新文件夹区
    refreshFileArea()
  }

  // ============ 4b0. cmark 落盘桥（3.2.18：废弃新建只写 db.json，改按 cmark 逻辑真实落盘） ============
  // bundle 原生 store.createNote/createFolder 只写 db（mfStorage），资源管理器不可见。
  // 这里在 bundle store 上包一层：创建后立即用 __CMARK.createNote/createFolder 落盘真实文件/目录，
  // 重命名（renameNote/renameFolder）时用 __CMARK.renameNode 同步磁盘文件名。
  // 所有入口（工具栏 + 按钮 create-menu、bundle 原生右键菜单、本层空白区右键菜单）最终都调
  // store.createNote/createFolder，因此功能天然一致；创建后进入重命名由 bundle 原生流程
  // （He→mt / Ue→tt）或本层的 enterRenameRow 驱动。
  var diskRelMap = {} // bundle id -> cmark 磁盘相对路径（已落盘）

  // bundle folder id -> 磁盘相对目录（folder 树只存 name/parentId，按 parentId 拼路径）
  function folderRelOf(folderId) {
    if (!folderId) return ''
    try {
      var folders = []
      if (window.mindnote && typeof window.mindnote.getFolderList === 'function')
        folders = window.mindnote.getFolderList()
      else folders = JSON.parse(localStorage.getItem('mindnote_folder_list') || '[]')
      var byId = {}
      for (var i = 0; i < folders.length; i++) byId[folders[i].id] = folders[i]
      var parts = []
      var cur = byId[folderId]
      var guard = 0
      while (cur && cur.name && guard++ < 20) {
        parts.unshift(String(cur.name))
        cur = cur.parentId ? byId[cur.parentId] : null
      }
      return parts.join('/')
    } catch (e) {
      return ''
    }
  }

  // ============ 4b1. 磁盘路径定位（3.2.20 需求③⑤：移动/删除真实落盘） ============
  // diskRelMap 是创建/重命名/移动时记录的真实磁盘 rel（权威）；历史条目（3.2.19 之前）
  // 没有记录，用「与 cmark 一致的名称清洗 + resolveNoteRel 目录扫描」兜底定位。

  // 与 cmark createNote/createFolder 完全一致的名称清洗
  function cleanDiskName(name) {
    var base =
      String(name || '未命名')
        .replace(/[\\/:*?"<>|]/g, '')
        .trim() || '未命名'
    if (base.startsWith('.')) base = base.replace(/^\.+/, '') || '未命名'
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(base)) base = '_' + base
    base = base.replace(/[. ]+$/, '') || '未命名'
    return base
  }

  function findNoteById(id) {
    try {
      var st = mnStore()
      if (st && st.noteList) {
        var arr = st.noteList
        for (var i = 0; i < arr.length; i++)
          if (arr[i].noteId === id || arr[i].id === id) return arr[i]
      }
    } catch (e) {}
    var list = listStore()
    for (var j = 0; j < list.length; j++) if (list[j].id === id) return list[j]
    return null
  }

  function findFolderById(id) {
    try {
      var st = mnStore()
      if (st && st.folderList) {
        for (var i = 0; i < st.folderList.length; i++)
          if (st.folderList[i].id === id) return st.folderList[i]
      }
    } catch (e) {}
    try {
      var folders = window.mindnote ? window.mindnote.getFolderList() : []
      for (var j = 0; j < folders.length; j++) if (folders[j].id === id) return folders[j]
    } catch (e) {}
    return null
  }

  // 笔记的磁盘相对路径：diskRelMap 权威 → __CMARK.resolveNoteRel 目录扫描 → 名称推算
  function noteRel(note) {
    if (!note) return ''
    if (diskRelMap[note.id]) return diskRelMap[note.id]
    var dir = folderRelOf(note.folderId)
    var base = cleanDiskName(note.title)
    try {
      if (window.__CMARK && typeof window.__CMARK.resolveNoteRel === 'function') {
        var hit = window.__CMARK.resolveNoteRel(dir, base)
        if (hit) {
          diskRelMap[note.id] = hit
          return hit
        }
      }
    } catch (e) {}
    return dir ? dir + '/' + base + '.md' : base + '.md'
  }

  // 文件夹的磁盘相对路径（按 db name 链推算；cmark 目录同名去重场景少见，推算够用）
  function folderRel(folder) {
    if (!folder) return ''
    if (diskRelMap[folder.id]) return diskRelMap[folder.id]
    var p = folderRelOf(folder.id)
    if (p) diskRelMap[folder.id] = p
    return p
  }

  // 移动文件夹后：磁盘目录整体迁移，其下子孙的 rel 前缀全变，级联重建（同名文件用 resolveNoteRel 校准）
  function rebuildSubTreeDiskRel(folderId) {
    var folders = []
    var list = []
    try {
      folders = window.mindnote ? window.mindnote.getFolderList() : []
    } catch (e) {}
    try {
      list = listStore()
    } catch (e) {}
    var rootRel = diskRelMap[folderId]
    if (!rootRel) return
    function walk(fid, prefix) {
      for (var i = 0; i < folders.length; i++) {
        var f = folders[i]
        if (f.parentId !== fid) continue
        var dir = prefix ? prefix + '/' + cleanDiskName(f.name) : cleanDiskName(f.name)
        diskRelMap[f.id] = dir
        walk(f.id, dir)
      }
      for (var j = 0; j < list.length; j++) {
        var n = list[j]
        if (n.folderId !== fid) continue
        var base = cleanDiskName(n.title)
        diskRelMap[n.id] = (prefix ? prefix + '/' : '') + base + '.md'
        try {
          if (window.__CMARK && typeof window.__CMARK.resolveNoteRel === 'function') {
            var hit = window.__CMARK.resolveNoteRel(prefix, base)
            if (hit) diskRelMap[n.id] = hit
          }
        } catch (e) {}
      }
    }
    walk(folderId, rootRel)
  }

  // 删除文件夹后：清理其子孙的 diskRelMap（磁盘已随目录删除）
  function cleanupSubTreeDiskRel(folderId) {
    var folders = []
    var list = []
    try {
      folders = window.mindnote ? window.mindnote.getFolderList() : []
    } catch (e) {}
    try {
      list = listStore()
    } catch (e) {}
    function walk(fid) {
      for (var i = 0; i < folders.length; i++)
        if (folders[i].parentId === fid) {
          delete diskRelMap[folders[i].id]
          walk(folders[i].id)
        }
      for (var j = 0; j < list.length; j++)
        if (list[j].folderId === fid) delete diskRelMap[list[j].id]
    }
    walk(folderId)
  }

  // 右键空白区：定位视觉上最近的文件夹（点落在行内/紧邻 → 该行；否则取上方最近一行），
  // 使「新建笔记/新建文件夹」落到该文件夹（需求④：不再误落根目录/上次激活文件夹）
  function folderFromRow(row) {
    try {
      var tree = document.querySelector('.sidebar-tree, .sidebar, [class*="tree"]')
      var all = tree ? $$('[class*="item"]', tree) : []
      var folders = []
      try {
        folders = window.mindnote
          ? window.mindnote.getFolderList()
          : JSON.parse(localStorage.getItem('mindnote_folder_list') || '[]')
      } catch (e) {}
      var idx = all.indexOf(row)
      var nameEl =
        row.querySelector('.note-title, [class*="title"], [class*="name"], [class*="label"]') || row
      var name = (nameEl.textContent || '').trim()
      var f = folders[idx] || null
      // 树行索引与 folderList 可能错位（树含文件夹+笔记混排、搜索态等），
      // 名称兜底必须覆盖「idx 越界 → folders[idx] 为 undefined」的情况（问题④实机表现）；
      // 兜底失败必须置 null，不得保留 index 命中的错配文件夹（否则空白区新建会落错文件夹）
      if (!f || (f.name && f.name !== name)) {
        var m = folders.filter(function (x) {
          return x.name === name
        })[0]
        f = m || null
      }
      return f || null
    } catch (e) {
      return null
    }
  }

  function nearestFolderAt(x, y) {
    try {
      var rows = $$(
        '.sidebar-tree [class*="folder"]:not([class*="note-item"]), [class*="folder-item"], [class*="folder-row"], [class*="tree-folder"], .tree-folder-item'
      )
      var best = null,
        bestDy = Infinity
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i].getBoundingClientRect()
        if (!r || r.width < 4 || r.height < 4) continue
        if (x >= r.left - 12 && x <= r.right + 12 && y >= r.top - 4 && y <= r.bottom + 12)
          return folderFromRow(rows[i])
        if (y > r.bottom) {
          var dy = y - r.bottom
          if (dy < bestDy) {
            bestDy = dy
            best = rows[i]
          }
        }
      }
      return best ? folderFromRow(best) : null
    } catch (e) {
      return null
    }
  }

  function cmarkCreateNoteOnDisk(note, folderId) {
    try {
      if (window.__CMARK && typeof window.__CMARK.createNote === 'function') {
        var r = window.__CMARK.createNote(folderRelOf(folderId), note.title, '')
        if (r && r.ok && r.rel) {
          diskRelMap[note.id] = r.rel
          return true
        }
      }
    } catch (e) {}
    return false
  }

  function cmarkCreateFolderOnDisk(folder, parentId) {
    try {
      if (window.__CMARK && typeof window.__CMARK.createFolder === 'function') {
        var r = window.__CMARK.createFolder(folderRelOf(parentId), folder.name)
        if (r && r.ok && r.rel) {
          diskRelMap[folder.id] = r.rel
          return true
        }
      }
    } catch (e) {}
    return false
  }

  function cmarkRenameOnDisk(id, newName) {
    try {
      var rel = diskRelMap[id]
      if (!rel) return
      if (window.__CMARK && typeof window.__CMARK.renameNode === 'function') {
        var r = window.__CMARK.renameNode(rel, newName)
        if (r && r.ok && r.rel) diskRelMap[id] = r.rel
      }
    } catch (e) {}
  }

  // patch bundle Pinia store：新建/重命名 → db（bundle 原逻辑：树显示+激活/进编辑态）+ cmark 真实落盘
  function patchCmarkStore() {
    var st = mnStore()
    if (!st || st.__mnCmarkPatched) return
    st.__mnCmarkPatched = true
    var oCreateNote = st.createNote
    if (typeof oCreateNote === 'function') {
      st.createNote = function (folderId) {
        var note = oCreateNote(folderId)
        if (note && note.id) {
          // 3.2.22 需求①：bundle 默认名「新建笔记(2026/11/4)」含 Windows 非法字符 /，
          // cmark 落盘会 sanitize 成 2026114，db 态仍保留原斜杠名 → 重开后树出现两条重复。
          // 在 patch 层把 db 态标题同步为磁盘同名（先改引用对象，再走 renameNote 更新 store 与树）。
          var c = String(note.title == null ? '' : note.title)
            .replace(/[\\/:*?"<>|]/g, '')
            .trim()
          if (c && c !== note.title) {
            note.title = c
            try {
              if (typeof st.renameNote === 'function') st.renameNote(note.id, c)
            } catch (e) {}
          }
          cmarkCreateNoteOnDisk(note, folderId)
        }
        return note
      }
    }
    var oCreateFolder = st.createFolder
    if (typeof oCreateFolder === 'function') {
      st.createFolder = function (name, parentId) {
        var folder = oCreateFolder(name, parentId)
        if (folder && folder.id) cmarkCreateFolderOnDisk(folder, parentId)
        return folder
      }
    }
    var oRenameNote = st.renameNote
    if (typeof oRenameNote === 'function') {
      st.renameNote = function (id, title) {
        // 3.2.22 需求①：改名提交统一 sanitize（Windows 非法字符），db 与磁盘始终一致
        var t = String(title == null ? '' : title)
        var c = t.replace(/[\\/:*?"<>|]/g, '').trim() || t
        if (window.__mnDbg) console.error('[mn-rn]', JSON.stringify({ id: id, title: c }))
        var r = oRenameNote(id, c)
        cmarkRenameOnDisk(id, c)
        return r
      }
    }
    var oRenameFolder = st.renameFolder
    if (typeof oRenameFolder === 'function') {
      st.renameFolder = function (id, name) {
        // 3.2.22 需求①：文件夹同名处理（文件夹名同样不能含 / 等非法字符）
        var t = String(name == null ? '' : name)
        var c = t.replace(/[\\/:*?"<>|]/g, '').trim() || t
        var r = oRenameFolder(id, c)
        cmarkRenameOnDisk(id, c)
        return r
      }
    }
    // 3.2.20 需求⑤：移动/删除也要真实落盘（此前只 patch 新建/重命名，右键移动/删除仅改 db 不碰磁盘）
    var oMoveNote = st.moveNote
    if (typeof oMoveNote === 'function') {
      st.moveNote = function () {
        var id = arguments[0],
          folderId = arguments[1]
        var note = findNoteById(id)
        var rel = note ? noteRel(note) : ''
        if (window.__mnDbg)
          console.error(
            '[mn-move]',
            JSON.stringify({
              id: id,
              folderId: folderId,
              note: !!note,
              rel: rel,
              hasMove: !!(window.__CMARK && window.__CMARK.moveNode),
              target: folderRelOf(folderId)
            })
          )
        var r = oMoveNote.apply(st, arguments)
        if (note && rel) {
          try {
            var rr = window.__CMARK && window.__CMARK.moveNode(rel, folderRelOf(folderId))
            if (rr && rr.ok && rr.rel) diskRelMap[id] = rr.rel
          } catch (e) {
            if (window.__mnDbg) console.error('[mn-move-err]', e && e.message)
          }
        }
        return r
      }
    }
    var oMoveFolder = st.moveFolder
    if (typeof oMoveFolder === 'function') {
      st.moveFolder = function () {
        var id = arguments[0],
          parentId = arguments[1]
        var f = findFolderById(id)
        var rel = f ? folderRel(f) : ''
        var r = oMoveFolder.apply(st, arguments)
        if (f && rel) {
          try {
            var rr = window.__CMARK && window.__CMARK.moveNode(rel, folderRelOf(parentId))
            if (rr && rr.ok && rr.rel) {
              diskRelMap[id] = rr.rel
              rebuildSubTreeDiskRel(id)
            }
          } catch (e) {}
        }
        return r
      }
    }
    var oDeleteNote = st.deleteNote
    if (typeof oDeleteNote === 'function') {
      st.deleteNote = function () {
        var id = arguments[0]
        var note = findNoteById(id)
        var rel = note ? noteRel(note) : ''
        var r = oDeleteNote.apply(st, arguments)
        if (note && rel) {
          try {
            if (window.__CMARK) window.__CMARK.deleteNode(rel)
          } catch (e) {}
        }
        delete diskRelMap[id]
        return r
      }
    }
    var oDeleteFolder = st.deleteFolder
    if (typeof oDeleteFolder === 'function') {
      st.deleteFolder = function () {
        var id = arguments[0]
        var f = findFolderById(id)
        var rel = f ? folderRel(f) : ''
        var r = oDeleteFolder.apply(st, arguments)
        if (f && rel) {
          try {
            if (window.__CMARK) window.__CMARK.deleteNode(rel)
          } catch (e) {}
        }
        delete diskRelMap[id]
        cleanupSubTreeDiskRel(id)
        return r
      }
    }
    var oLoadNoteList = st.loadNoteList
    if (typeof oLoadNoteList === 'function') {
      st.loadNoteList = function () {
        var r = oLoadNoteList.apply(st, arguments)
        // 3.2.22 需求①存量兜底：历史 db 条目标题带 /（磁盘已是 sanitize 名，如 2026114）
        // → 归一为磁盘同名，消除旧数据重开后双条（同名后 bundle 按名合并为一条）
        try {
          var arr = null
          try {
            arr = st.notes || st.noteList || st.list || st.items || []
          } catch (e) {}
          if (Array.isArray(arr)) {
            for (var i = 0; i < arr.length; i++) {
              var n = arr[i]
              if (n && typeof n.title === 'string' && /[\\/:*?"<>|]/.test(n.title)) {
                var c = n.title.replace(/[\\/:*?"<>|]/g, '').trim()
                if (c) n.title = c
              }
            }
            // 3.2.23：同名且同目录的重复条目只保留一条（文件系统同目录不可能存在两个同名文件，
            // 同 title+同 folder 必然重复）。优先保留 md_* 桥接条目（真实磁盘文件对应）。
            // 修复实机反馈②中「新建笔记(2026114) 双条并排」的存量残留。
            var groups = {}
            for (var gi = 0; gi < arr.length; gi++) {
              var gn = arr[gi]
              if (!gn || typeof gn.title !== 'string') continue
              var gkey = gn.title + '|' + (gn.folderId || gn.parentId || gn.dir || '')
              if (!groups[gkey]) groups[gkey] = []
              groups[gkey].push(gn)
            }
            for (var gk in groups) {
              var g = groups[gk]
              if (!g || g.length < 2) continue
              var keep = null
              for (var ki = 0; ki < g.length; ki++) {
                if (/^md_/i.test(String(g[ki].id || ''))) {
                  keep = g[ki]
                  break
                }
              }
              if (!keep) keep = g[0]
              for (var rj = g.length - 1; rj >= 0; rj--) {
                if (g[rj] !== keep) {
                  var idx = arr.indexOf(g[rj])
                  if (idx >= 0) arr.splice(idx, 1)
                }
              }
            }
          }
        } catch (e) {}
        return r
      }
    }
  }

  // 在树行内注入重命名编辑态（input 替换标题）：Enter/blur 提交（走 patch 后 renameNote/renameFolder，
  // db+磁盘同步），Esc 取消。与 bundle 原生重命名体验一致（录屏：创建后立即进入重命名）。
  function enterRenameRow(row, id, isFolder, oldTitle) {
    try {
      var titleEl = row.querySelector(
        '.note-title, [class*="note-title"], [class*="tree-title"], [class*="tree-name"], [class*="folder-name"], [class*="title"], [class*="name"], [class*="label"]'
      )
      if (!titleEl) {
        var kids = row.children || []
        for (var i = kids.length - 1; i >= 0; i--) {
          if (
            kids[i].tagName !== 'BUTTON' &&
            kids[i].tagName !== 'INPUT' &&
            kids[i].tagName !== 'SVG'
          ) {
            titleEl = kids[i]
            break
          }
        }
      }
      if (!titleEl) return
      var old =
        oldTitle != null && oldTitle !== '' ? String(oldTitle) : (titleEl.textContent || '').trim()
      var inp = document.createElement('input')
      inp.type = 'text'
      inp.value = old
      inp.className = 'mn-rename-input'
      inp.spellcheck = false
      titleEl.innerHTML = ''
      titleEl.appendChild(inp)
      try {
        inp.focus()
        inp.select()
      } catch (e) {}
      var done = false
      function commit() {
        if (done) return
        done = true
        var v = (inp.value || '').trim()
        if (!v) v = old
        try {
          titleEl.textContent = v
        } catch (e) {}
        var st = mnStore()
        if (st) {
          try {
            if (isFolder && typeof st.renameFolder === 'function') st.renameFolder(id, v)
            else if (!isFolder && typeof st.renameNote === 'function') st.renameNote(id, v)
          } catch (e) {}
        }
        toast(isFolder ? '文件夹已重命名为「' + v + '」' : '笔记已重命名为「' + v + '」')
      }
      function cancel() {
        if (done) return
        done = true
        try {
          titleEl.textContent = old
        } catch (e) {}
        var st = mnStore()
        if (st) {
          try {
            if (st.cancelRenameNotePreview) st.cancelRenameNotePreview(id)
          } catch (e) {}
        }
      }
      inp.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') {
          ev.preventDefault()
          ev.stopPropagation()
          commit()
        } else if (ev.key === 'Escape') {
          ev.preventDefault()
          ev.stopPropagation()
          cancel()
        }
      })
      inp.addEventListener('blur', function () {
        commit()
      })
      inp.addEventListener('click', function (ev) {
        ev.stopPropagation()
      })
      inp.addEventListener('mousedown', function (ev) {
        ev.stopPropagation()
      })
    } catch (e) {}
  }

  // 创建后立即进入重命名：按标题在树中定位新行
  function enterRenameById(id, isFolder, titleHint) {
    if (window.__mnDbg)
      console.error(
        '[mn-erb]',
        JSON.stringify({ id: id, isFolder: !!isFolder, title: String(titleHint || '') })
      )
    var title = titleHint || ''
    if (!title) {
      try {
        var st = mnStore()
        if (st) {
          if (isFolder && st.folderList) {
            var f = st.folderList.find(function (x) {
              return x.id === id
            })
            if (f) title = f.name
          } else if (!isFolder && st.noteList) {
            var n = st.noteList.find(function (x) {
              return x.noteId === id || x.id === id
            })
            if (n) title = n.title
          }
        }
      } catch (e) {}
    }
    if (!title) return
    try {
      var cands = $$(
        '.sidebar-tree [class*="item"], .sidebar [class*="item"], [class*="tree"] [class*="item"], [class*="folder-item"], [class*="note-item"], [class*="tree-folder"], [class*="tree-note"]'
      )
      for (var i = 0; i < cands.length; i++) {
        var tx = (cands[i].textContent || '').trim()
        if (tx.indexOf(title) >= 0) {
          enterRenameRow(cands[i], id, isFolder, title)
          return
        }
      }
    } catch (e) {}
  }

  // ============ 4b. 空白区右键操作（问题 4） ============
  // 3.2.18：新增笔记/新增文件夹统一走 bundle store（已 patch cmark 真实落盘），
  // 与工具栏 + 按钮的「新建笔记/新建文件夹」功能完全一致；创建后立即进入重命名。
  // 3.2.19：右键改为触发 bundle 原生「新建」菜单（与工具栏入口同一条链路）——
  // 原生处理器创建后自带「立即进入重命名」编辑态（录屏行为），store patch 同步 cmark 落盘；
  // 实机反馈「右键新建文件夹不触发重命名」即因自造 enterRename 对文件夹行时序不稳，改走原生后消除。
  function queryCreateMenu() {
    try {
      return (
        document.querySelector('.export-menu.create-menu, [class*="create-menu"], .export-menu') ||
        null
      )
    } catch (e) {
      return null
    }
  }
  function clickCreateMenuItem(menu, isFolder) {
    try {
      var items = menu.querySelectorAll('[class*="menu-item"], [class*="menuitem"], li, button')
      for (var i = 0; i < items.length; i++) {
        var t = (items[i].textContent || '').trim()
        if (isFolder && t.indexOf('新建文件夹') >= 0) {
          try {
            items[i].click()
          } catch (e) {}
          return true
        }
        if (!isFolder && t.indexOf('新建笔记') >= 0) {
          try {
            items[i].click()
          } catch (e) {}
          return true
        }
      }
    } catch (e) {}
    return false
  }
  function nativeCreateViaToolbar(isFolder, folderId, _retry) {
    try {
      var createBtn = document.querySelector(
        '.sidebar-menu-wrap button.btn-icon[title="新建"], button.btn-icon[title="新建"], [class*="sidebar"] button[title="新建"]'
      )
      if (!createBtn) return false
      // 3.2.20 需求④：指定文件夹时，临时把 bundle activeFolderId 指向目标，让原生「新建」落到该文件夹
      var st = mnStore()
      var oldActive = null
      var hadActive = false
      try {
        if (folderId != null && st && 'activeFolderId' in st) {
          oldActive = st.activeFolderId
          hadActive = true
          st.activeFolderId = folderId
        }
      } catch (e) {}
      var restore = function () {
        try {
          if (hadActive && st) st.activeFolderId = oldActive
        } catch (e) {}
      }
      var menu = queryCreateMenu()
      if (menu && menu.offsetParent !== null) {
        var hit = clickCreateMenuItem(menu, isFolder)
        setTimeout(restore, 400)
        return hit
      }
      createBtn.click()
      // Vue 渲染菜单需要一拍；150ms 后点击 menuitem，找不到则回退 store action 路径
      setTimeout(function () {
        var m = queryCreateMenu()
        if (!m || !clickCreateMenuItem(m, isFolder)) {
          if (!_retry) {
            try {
              ;(isFolder ? createFolder : createBlankNote)(folderId, true)
            } catch (e) {}
          }
        }
        restore()
      }, 150)
      return true
    } catch (e) {
      return false
    }
  }

  function createBlankNote(folderId, _skipNative) {
    // 3.2.19：优先走 bundle 原生「新建」菜单（工具栏同链路：创建即进原生重命名 + cmark 落盘）
    // 3.2.20 需求④：支持指定文件夹（右键空白区定位的最近文件夹），不再误落根目录/上次激活文件夹
    if (!_skipNative && nativeCreateViaToolbar(false, folderId)) return
    // ---- 回退路径：原生菜单不可用时，走 store action（已 patch cmark 落盘）+ 自造重命名 ----
    var st = mnStore()
    if (st && typeof st.createNote === 'function') {
      var fid = null
      try {
        fid = folderId != null ? folderId : st.activeFolderId || null
      } catch (e) {}
      var note = st.createNote(fid)
      refreshFileArea()
      if (note && note.id) {
        // 创建后立即显示并进入重命名（等 Vue 渲染新行后定位标题）
        setTimeout(function () {
          enterRenameById(note.id, false, note.title)
        }, 80)
      } else {
        toast('已新建笔记')
      }
      return
    }
    // 兜底：无 bundle store（浏览器直开无 #app）时保持原 db 逻辑
    var id = newId()
    var title = '未命名笔记'
    var list = listStore()
    var fid2 = null
    try {
      // 若当前处于某文件夹过滤视图，新建到该文件夹
      var st2 = mnStore()
      if (folderId != null) fid2 = folderId
      else if (st2 && st2.activeFolderId) fid2 = st2.activeFolderId || null
    } catch (e) {}
    var data = {
      id: id,
      title: title,
      content: '',
      folderId: fid2,
      updatedAt: Date.now(),
      sortOrder: Date.now()
    }
    if (window.mindnote) {
      window.mindnote.saveNote(id, data)
      list.push({
        id: id,
        title: title,
        folderId: fid2,
        updatedAt: data.updatedAt,
        sortOrder: data.sortOrder
      })
      window.mindnote.saveNoteList(list)
    } else {
      localStorage.setItem('mindnote_note_' + id, JSON.stringify(data))
      list.push({
        id: id,
        title: title,
        folderId: fid2,
        updatedAt: data.updatedAt,
        sortOrder: data.sortOrder
      })
      localStorage.setItem('mindnote_note_list', JSON.stringify(list))
    }
    refreshFileArea()
    // 打开新笔记
    try {
      var st3 = mnStore()
      if (st3 && typeof st3.openNote === 'function') st3.openNote(id)
    } catch (e) {}
    toast('已新建笔记「' + title + '」')
  }

  function createFolder(folderId, _skipNative) {
    // 3.2.19：优先走 bundle 原生「新建」菜单（工具栏同链路：创建即进原生重命名 + cmark 落盘）
    // 3.2.20 需求④：支持指定父文件夹（右键空白区定位的最近文件夹）
    if (!_skipNative && nativeCreateViaToolbar(true, folderId)) return
    // ---- 回退路径：原生菜单不可用时，走 store action（已 patch cmark 落盘）+ 自造重命名 ----
    var st = mnStore()
    if (st && typeof st.createFolder === 'function') {
      var parentId = folderId != null ? folderId : null
      var folder = st.createFolder('新建文件夹', parentId)
      refreshFileArea()
      if (folder && folder.id) {
        // 创建后立即显示并进入重命名（等 Vue 渲染新行后定位标题）
        setTimeout(function () {
          enterRenameById(folder.id, true, folder.name)
        }, 80)
      } else {
        toast('已新建文件夹')
      }
      return
    }
    // 兜底：无 bundle store 时保持原 db 逻辑
    var folders = []
    try {
      folders = window.mindnote
        ? window.mindnote.getFolderList()
        : JSON.parse(localStorage.getItem('mindnote_folder_list') || '[]')
    } catch (e) {}
    var order = 0
    for (var i = 0; i < folders.length; i++)
      if (folders[i].order != null && folders[i].order >= order) order = folders[i].order + 1
    folders.push({
      id: newId(),
      name: '未命名文件夹',
      order: order,
      parentId: folderId != null ? folderId : null
    })
    if (window.mindnote) window.mindnote.saveFolderList(folders)
    else localStorage.setItem('mindnote_folder_list', JSON.stringify(folders))
    refreshFileArea()
    toast('已新建文件夹「未命名文件夹」')
  }

  function findFolderRows() {
    var rows = $$(
      '.sidebar-tree [class*="folder"]:not([class*="note-item"]), .sidebar [class*="folder"]:not([class*="note-item"]), [class*="tree"] [class*="folder"]:not([class*="note-item"]), [class*="folder-item"], [class*="folder-row"], [class*="tree-folder"]'
    )
    return rows
  }

  // 3.2.18：全部折叠/全部展开直接驱动 bundle 原生「收起/展开所有文件夹」按钮
  // （button.folders-collapse-btn，点击切换状态，title 随状态变），与录屏行为一致；
  // 不再用猜测 DOM 结构逐行点击的方式（3.2.17 该方式实机不可靠）。
  function collapseAllFolders() {
    var btn = document.querySelector('button.folders-collapse-btn')
    if (btn) {
      var t = (btn.title || '') + ' ' + (btn.getAttribute('aria-label') || '')
      if (t.indexOf('收起所有') >= 0) {
        btn.click()
        toast('已全部折叠')
      } else {
        toast('文件夹已处于折叠状态')
      }
      return
    }
    // 兜底：无 bundle 按钮（浏览器直开等）时按旧逻辑处理
    var rows = findFolderRows()
    var hit = 0
    rows.forEach(function (row) {
      var b = row.querySelector('[class*="expand"], [class*="arrow"], [class*="chevron"], button')
      if (b && isExpanded(row)) {
        b.click()
        hit++
      }
    })
    if (!hit) {
      rows.forEach(function (row) {
        row.classList.add('mn-folding')
      })
      setTimeout(function () {
        rows.forEach(function (row) {
          row.classList.remove('mn-folding')
        })
      }, 1)
    }
    toast(hit ? '已全部折叠' : '已折叠文件夹区域')
  }

  function expandAllFolders() {
    var btn = document.querySelector('button.folders-collapse-btn')
    if (btn) {
      var t = (btn.title || '') + ' ' + (btn.getAttribute('aria-label') || '')
      if (t.indexOf('展开所有') >= 0) {
        btn.click()
        toast('已全部展开')
      } else {
        toast('文件夹已处于展开状态')
      }
      return
    }
    // 兜底：无 bundle 按钮时按旧逻辑处理
    var rows = findFolderRows()
    var hit = 0
    rows.forEach(function (row) {
      var b = row.querySelector('[class*="expand"], [class*="arrow"], [class*="chevron"], button')
      if (b && !isExpanded(row)) {
        b.click()
        hit++
      }
    })
    if (!hit) {
      rows.forEach(function (row) {
        row.classList.remove('mn-folding')
      })
    }
    toast(hit ? '已全部展开' : '已展开文件夹区域')
  }

  function isExpanded(row) {
    try {
      var cls = String(row.className || '') + ' ' + String(row.getAttribute('data-state') || '')
      var btn = row.querySelector('[class*="expand"], [class*="arrow"], [class*="chevron"]')
      if (btn) {
        var bcls = String(btn.className || '') + ' ' + String(btn.getAttribute('data-state') || '')
        // 常见展开态：open/expanded/rotate/active/arrow-down
        if (
          /open|expand(ed)?|rotate|active|down|chevron-down/i.test(bcls) ||
          /▾|▼/.test(btn.textContent || '')
        )
          return true
        if (/closed|collapsed|right|chevron-right/i.test(bcls) || /▸|▶/.test(btn.textContent || ''))
          return false
      }
      if (/open|expanded/i.test(cls)) return true
      if (/closed|collapsed/i.test(cls)) return false
    } catch (e) {}
    return false
  }

  function toggleLock(note) {
    var nid = note ? note.id || note.noteId : ''
    var ntitle = note && note.title ? note.title : nid ? noteTitle(nid) : ''
    if (!nid) return
    var locked = isLocked(nid)
    if (window.mindnote) {
      window.mindnote.saveNote(nid, { locked: !locked })
    } else {
      if (!locked) locks[nid] = true
      else delete locks[nid]
      saveLocks()
      applyLockUI()
    }
    toast(locked ? '已解锁「' + ntitle + '」' : '已锁定「' + ntitle + '」，禁止编辑')
  }

  // 问题 7：右键前清理残留：只移除我们追加的菜单项节点，避免堆叠；
  // 不碰 bundle 原生菜单容器（Vue 管理，remove 会破坏后续渲染——问题 2/4）
  function cleanupStaleMenus() {
    closeCtx()
    try {
      // 只移除我们追加的菜单项节点本身；绝不向上 remove 容器——
      // bundle 原生菜单容器由 Vue 管理（Teleport 到 body 的 context-menu-fixed），
      // 把它整个 remove 会导致 Vue 状态残留、此后右键菜单不再渲染（问题 2/4 根因）
      var appended = document.querySelectorAll('.mn-ctx-sep, .mn-ctx-append')
      for (var i = 0; i < appended.length; i++) {
        var el = appended[i]
        if (el.parentNode) el.parentNode.removeChild(el)
      }
    } catch (e) {}
  }

  function installContextMenu() {
    var ITEMS =
      '.note-item.tree-note-item, .sidebar-tree [class*="item"], .sidebar [class*="item"], [class*="tree"] [class*="item"], .note-item'
    document.addEventListener('contextmenu', function (ev) {
      var el = ev.target
      if (!el || el.nodeType !== 1) return
      // 问题 7：右键触发即清理旧菜单残留（在新菜单渲染前）
      cleanupStaleMenus()
      var item = el.closest && el.closest(ITEMS)
      // 空白区：侧栏/树区域但未命中条目 → 显示「新增/刷新/折叠展开」菜单（问题 4）
      if (!item) {
        var blank =
          el.closest &&
          el.closest(
            '.sidebar, .sidebar-tree, [class*="sidebar"] [class*="tree"], [class*="tree"] > .sidebar'
          )
        if (blank) {
          if (el.closest('.sidebar-search') || el.closest('.mn-git-bar')) return
          ev.preventDefault()
          // 3.2.20 需求④：定位视觉上最近的文件夹行，新建落在该文件夹（不再误落根/上次激活文件夹）
          var tgt = nearestFolderAt(ev.clientX, ev.clientY)
          openCtx(ev.clientX, ev.clientY, [
            {
              icon: '📝',
              label: tgt ? '在此文件夹新建笔记' : '新增笔记',
              run: function () {
                createBlankNote(tgt ? tgt.id : null)
              }
            },
            {
              icon: '📁',
              label: tgt ? '在此文件夹新建文件夹' : '新增文件夹',
              run: function () {
                createFolder(tgt ? tgt.id : null)
              }
            },
            {
              icon: '🔄',
              label: '刷新',
              run: function () {
                refreshFileArea()
                toast('已刷新文件夹区')
              }
            },
            { icon: '🗂', label: '全部折叠', run: collapseAllFolders },
            { icon: '📂', label: '全部展开', run: expandAllFolders }
          ])
          return
        }
      }
      if (!item) return
      if (item.closest('.sidebar-search') || item.closest('.mn-git-bar')) return
      // 阻止浏览器默认菜单；不 stopPropagation，让 bundle 原生菜单照常弹出
      ev.preventDefault()
      var note = null,
        folder = null
      if (isFolderItem(item)) {
        // 3.2.20 需求④⑧：文件夹行解析统一走 folderFromRow（index + 标题兜底）
        folder = folderFromRow(item)
      } else {
        note = findNoteByItem(item)
        if (window.__mnDbg)
          console.error(
            '[mn-handler]',
            JSON.stringify({
              cls: String(item.className || ''),
              txt: String(item.textContent || '').slice(0, 10),
              note: !!(note && note.id),
              nid: note && (note.id || note.noteId)
            })
          )
      }
      ctxNote = note
      ctxFolder = folder
      setTimeout(function () {
        var menuEl = findBundleMenu()
        if (window.__mnDbg)
          console.error(
            '[mn-ctx]',
            JSON.stringify({
              menuEl: !!menuEl,
              note: !!note,
              noteId: note && (note.id || note.noteId),
              folder: !!folder,
              fname: folder && folder.name,
              item: !!item,
              isFolder: isFolderItem(item)
            })
          )
        if (menuEl) appendOurItems(menuEl, note, folder)
        else {
          var items = ourItems(note, folder)
          if (items.length) openCtx(ev.clientX, ev.clientY, items)
        }
      }, 140)
    })
    // mousedown 捕获期关菜单：但菜单自身内部的点击不得提前关闭（否则点击项不触发）
    document.addEventListener(
      'mousedown',
      function (ev) {
        if (ctx && ev.target && ev.target.closest && ev.target.closest('.mn-ctx')) return
        closeCtx()
      },
      true
    )
    window.addEventListener('blur', function () {
      closeCtx()
    })
  }

  // 查找 bundle 原生右键菜单浮层（文本含「重命名/置顶」的 fixed/absolute 容器）
  function findBundleMenu() {
    var nodes = document.querySelectorAll('body *')
    for (var i = 0; i < nodes.length; i++) {
      var e = nodes[i]
      if (e.classList && e.classList.contains('mn-ctx')) continue
      if (e.children.length > 12) continue
      var st = null
      try {
        st = window.getComputedStyle(e)
      } catch (err) {
        continue
      }
      if (!st || (st.position !== 'fixed' && st.position !== 'absolute')) continue
      if (st.display === 'none' || st.visibility === 'hidden' || +st.opacity === 0) continue
      var r = e.getBoundingClientRect()
      if (!r || r.width < 40 || r.height < 20) continue
      var t = e.innerText || ''
      if (t.indexOf('重命名') >= 0 || t.indexOf('置顶') >= 0 || t.indexOf('移动到') >= 0) return e
    }
    return null
  }

  function ourItems(note, folder) {
    if (folder) {
      // 3.2.20 需求④：右键文件夹行可直接在此文件夹下新建（_skipNative=true 直走 store+patch 落盘，
      // 不与 bundle 原生菜单的异步渲染竞争；创建后由 enterRenameById 进入重命名）
      return [
        {
          icon: '📝',
          label: '在此文件夹新建笔记',
          run: function () {
            createBlankNote(folder.id, true)
          }
        },
        {
          icon: '📁',
          label: '在此文件夹新建文件夹',
          run: function () {
            createFolder(folder.id, true)
          }
        },
        {
          icon: '📄',
          label: '复制一份',
          run: function () {
            duplicateFolder(folder)
          }
        },
        { icon: '🗂', label: '在资源管理器中打开', run: revealWorkspace }
      ]
    }
    if (!note) return []
    return [
      {
        icon: '📄',
        label: '复制一份',
        run: function () {
          duplicateNote(note)
        }
      },
      { icon: '🗂', label: '在资源管理器中打开', run: revealWorkspace },
      {
        icon: isLocked(note.id) ? '🔓' : '🔒',
        label: isLocked(note.id) ? '编辑只读：已锁定' : '编辑只读：锁定',
        checked: isLocked(note.id),
        run: function () {
          toggleLock(note)
        }
      }
    ]
  }

  // 向 bundle 原生菜单末尾追加我们的三项（样式独立，点击执行后关闭菜单）
  function appendOurItems(menuEl, note, folder) {
    // 3.2.20 需求⑧：已锁定笔记 → 禁用 bundle 原生「重命名/移动到/删除」项
    // （只隐藏/disabled 菜单项本身，绝不 remove 容器——Vue Teleport 状态残留会让后续右键不渲染）
    if (note && isLocked(note.id)) {
      var menuBtns = menuEl.querySelectorAll(
        'button, [role="menuitem"], .context-menu-item, [class*="menu-item"]'
      )
      for (var k = 0; k < menuBtns.length; k++) {
        var mb = menuBtns[k]
        var mt = (mb.textContent || '').trim()
        if (mt.indexOf('重命名') >= 0 || mt.indexOf('移动到') >= 0 || mt.indexOf('删除') >= 0) {
          mb.disabled = true
          mb.setAttribute('aria-disabled', 'true')
          mb.classList.add('mn-menu-disabled')
          mb.title =
            '已锁定，禁止' +
            (mt.indexOf('重命名') >= 0 ? '重命名' : mt.indexOf('移动到') >= 0 ? '移动' : '删除')
        }
      }
    }
    var items = ourItems(note, folder)
    if (!items.length) return
    // 追加前清掉该容器里上一次的追加项（Vue 复用同一容器时防堆叠——问题 7 复发防护）
    var olds = menuEl.querySelectorAll('.mn-ctx-sep, .mn-ctx-append')
    for (var j = 0; j < olds.length; j++) {
      var o = olds[j]
      if (o.parentNode) o.parentNode.removeChild(o)
    }
    var sep = document.createElement('div')
    sep.className = 'mn-ctx-sep'
    menuEl.appendChild(sep)
    items.forEach(function (it) {
      var li = document.createElement('button')
      li.type = 'button'
      li.className = 'mn-ctx-item mn-ctx-append' + (it.checked ? ' mn-ctx-checked' : '')
      li.innerHTML =
        (it.icon ? '<span class="mn-ctx-ic">' + it.icon + '</span>' : '') +
        '<span>' +
        it.label +
        '</span>'
      li.addEventListener('click', function (ev) {
        ev.stopPropagation()
        // 点击追加项后：不再 remove 容器（会让 Vue 菜单状态残留、后续右键不渲染）。
        // 派发一次全局 click 让 bundle 自身的 document click 监听关闭菜单（Vue 移除节点），
        // 操作延后一拍执行，保证菜单先关闭。
        try {
          document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
        } catch (e) {}
        closeCtx()
        setTimeout(function () {
          it.run()
        }, 0)
      })
      menuEl.appendChild(li)
    })
  }

  // ============ 5. 侧栏 git 分支栏 ============
  var bar = null
  // 3.2.18：分支栏插入点改为「侧栏顶部按钮行」之后（按钮行 = 收起/展开所有文件夹 +
  // 新建 + 导入 + 导出 按钮所在容器），避免锚 .sidebar-search 时被搜索框高度/折叠遮挡、
  // 或与按钮行挤在同一行导致内容显示不全。找不到按钮行时依次回退 .sidebar-search、侧栏容器。
  function branchBarAnchor() {
    try {
      var cb = document.querySelector(
        '.sidebar button.folders-collapse-btn, button.folders-collapse-btn'
      )
      if (cb && cb.parentNode && cb.parentNode.parentNode) {
        // cb.parentNode = 按钮行（含多个 sidebar-menu-wrap），再上一层是按钮行容器
        var rowHost = cb.parentNode.parentNode
        if (rowHost && rowHost !== document.body && rowHost !== document.documentElement)
          return { el: rowHost, mode: 'after' }
      }
    } catch (e) {}
    var search = document.querySelector('.sidebar-search')
    if (search) return { el: search, mode: 'after' }
    var sb = document.querySelector('.sidebar, .sidebar-tree, [class*="sidebar"]')
    if (sb) return { el: sb, mode: 'before' }
    return null
  }

  function ensureBranchBar() {
    if (document.getElementById('mn-git-bar')) return
    var anchor = branchBarAnchor()
    if (!anchor) return
    bar = document.createElement('div')
    bar.id = 'mn-git-bar'
    bar.className = 'mn-git-bar'
    bar.innerHTML =
      '<button type="button" class="mn-git-branch" id="mn-git-branch" title="点击查看工作区变更记录">' +
      '<span class="mn-git-branch-label">分支</span>' +
      '<span class="mn-git-branch-name" id="mn-git-branch-name">…</span>' +
      '</button>' +
      '<div class="mn-git-actions">' +
      '<button type="button" class="mn-git-act" data-act="pull" title="拉取">' +
      BRANCH_LABEL.pull +
      '</button>' +
      '<button type="button" class="mn-git-act" data-act="push" title="推送">' +
      BRANCH_LABEL.push +
      '</button>' +
      '<button type="button" class="mn-git-act" data-act="sync" title="同步">' +
      BRANCH_LABEL.sync +
      '</button>' +
      '<button type="button" class="mn-git-more" id="mn-git-more" title="工作区变更记录">📋</button>' +
      '</div>'
    if (anchor.mode === 'after') anchor.el.parentNode.insertBefore(bar, anchor.el.nextSibling)
    else anchor.el.insertBefore(bar, anchor.el.firstChild)
    bindBranchBar()
  }

  function bindBranchBar() {
    var branchBtn = document.getElementById('mn-git-branch')
    if (branchBtn)
      branchBtn.addEventListener('click', function (ev) {
        ev.stopPropagation()
        if (!window.__zgpOpen) {
          toast('Git 服务未就绪：请在 MT Launcher 宿主中打开本插件', 'warn')
          return
        }
        if (window.__zgpIsOpen && window.__zgpIsOpen() && window.__zgpClose) window.__zgpClose()
        window.__zgpOpen('changes')
      })
    $$('.mn-git-act').forEach(function (b) {
      b.addEventListener('click', function (ev) {
        ev.stopPropagation()
        runGitAction(b.getAttribute('data-act'))
      })
    })
    var more = document.getElementById('mn-git-more')
    if (more)
      more.addEventListener('click', function (ev) {
        ev.stopPropagation()
        // 3.2.27 反馈②：「⋯」按钮直接换成「工作区变更记录」图标，点击直接打开变更记录（不再弹下拉菜单）
        if (window.__zgpOpen) window.__zgpOpen('changes')
        else toast('Git 服务未就绪：请在 MT Launcher 宿主中打开本插件', 'warn')
      })
  }

  function runGitAction(act) {
    if (!gitReady()) {
      toast('Git 服务未就绪：请在 MT Launcher 宿主中打开本插件', 'warn')
      return
    }
    var fn = window.__znotesGit[act === 'pull' ? 'pull' : act === 'push' ? 'push' : 'sync']
    if (typeof fn !== 'function') return
    var names = { pull: '拉取', push: '推送', sync: '同步' }
    toast(names[act] + '进行中…')
    Promise.resolve(fn())
      .then(function (r) {
        if (r && r.ok === false) toast(names[act] + '失败：' + (r.message || ''), 'err')
        else {
          toast(names[act] + '完成')
          // 3.2.25：拉取成功后远程落盘的新 md（如 README.md）要立即进文件树，
          // 否则用户手动右键刷新前树里看不到（此前只刷新分支栏）。
          if (act === 'pull' || act === 'sync') refreshFileArea()
        }
        refreshBranchBar()
      })
      .catch(function (e) {
        toast(names[act] + '失败：' + (e && e.message), 'err')
      })
  }

  function refreshBranchBar() {
    var nameEl = document.getElementById('mn-git-branch-name')
    if (!nameEl) return
    if (!gitReady()) {
      nameEl.textContent = '未连接'
      return
    }
    try {
      Promise.resolve(window.__znotesGit.branches())
        .then(function (r) {
          // git-service.branches() 返回 { ok, data:{ local, remote, current } }；旧实现误读 r.branches.current
          // 导致分支名恒为占位「…」（实机「分支栏显示不全」真因）。兼容 data.current 与 branches.current 两种结构。
          var cur = (r && ((r.data && r.data.current) || (r.branches && r.branches.current))) || ''
          nameEl.textContent = cur || '…'
        })
        .catch(function () {
          nameEl.textContent = '…'
        })
    } catch (e) {
      nameEl.textContent = '…'
    }
  }

  // ============ 5b. AI 生成弹窗（问题 8，复刻 cmark AI 能力） ============
  function aiBridge() {
    // AI 桥由 cmark-preload.js 挂到 window.__znotesAi（ipcRenderer 直连宿主 plugin:ai-* IPC）
    return window.__znotesAi && typeof window.__znotesAi.ai === 'function'
      ? window.__znotesAi
      : null
  }

  function openAiModal() {
    closeAiModal()
    var bridge = aiBridge()
    var mask = document.createElement('div')
    mask.className = 'ai-mask'
    mask.id = 'mn-ai-mask'
    mask.innerHTML =
      '<div class="ai-panel">' +
      '<div class="ai-head">' +
      '<span class="ai-spark" aria-hidden="true">' +
      AI_ICON +
      '</span>' +
      '<span class="ai-title">AI 生成</span>' +
      '<button class="ai-close" type="button" title="关闭 (Esc)">✕</button>' +
      '</div>' +
      '<div class="ai-modelrow">' +
      '<div class="ai-modelleft">' +
      '<span class="ai-mlabel">模型</span>' +
      '<select class="ai-model" title="选择模型"><option value="">（加载中…）</option></select>' +
      '</div>' +
      '<button type="button" class="ai-modelset" title="模型设置">模型设置</button>' +
      '</div>' +
      '<div class="ai-body"><textarea class="ai-input" placeholder="描述你要生成的内容，例如：把本周各渠道的成交量整理成柱状图"></textarea></div>' +
      '<div class="ai-out" style="display:none">正在生成，请稍候…</div>' +
      '<div class="ai-err" style="display:none"></div>' +
      '<div class="ai-dialog-btns">' +
      AI_PRESETS.map(function (p) {
        return (
          '<button type="button" class="ai-preset-btn" data-key="' +
          p.key +
          '" title="' +
          p.label +
          '">' +
          '<span class="ai-preset-ico" aria-hidden="true"><svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><path d="' +
          p.d +
          '"></path></svg></span>' +
          '<span class="ai-preset-txt">' +
          p.label +
          '</span></button>'
        )
      }).join('') +
      '</div>' +
      '</div>'
    mask.addEventListener('mousedown', function (ev) {
      if (ev.target === mask) closeAiModal()
    })
    document.body.appendChild(mask)
    var closeBtn = mask.querySelector('.ai-close')
    if (closeBtn) closeBtn.addEventListener('click', closeAiModal)
    // Esc 关闭
    var escFn = function (ev) {
      if (ev.key === 'Escape') closeAiModal()
    }
    mask._esc = escFn
    document.addEventListener('keydown', escFn, true)
    // 预置按钮
    var btns = mask.querySelectorAll('.ai-preset-btn')
    for (var i = 0; i < btns.length; i++) {
      ;(function (b) {
        b.addEventListener('click', function () {
          aiRun(b.getAttribute('data-key'), mask)
        })
      })(btns[i])
    }
    // 模型设置：跳转宿主「高级服务 - AI 页签」配置（3.2.23 反馈②）
    var msBtn = mask.querySelector('.ai-modelset')
    if (msBtn)
      msBtn.addEventListener('click', function () {
        try {
          if (window.ztools && typeof window.ztools.openSettings === 'function') {
            window.ztools.openSettings({ tab: 'ai' })
          }
        } catch (e) {}
      })
    // 模型列表
    aiLoadModels(mask)
  }

  function closeAiModal() {
    var mask = document.getElementById('mn-ai-mask')
    if (mask) {
      if (mask._esc) document.removeEventListener('keydown', mask._esc, true)
      mask.remove()
    }
  }

  function aiLoadModels(mask) {
    var sel = mask.querySelector('.ai-model')
    var bridge = aiBridge()
    if (!bridge) {
      aiErr(mask, '当前宿主没有可用的 AI 能力。请在 MT Launcher 的「AI 提供商」中配置模型。')
      return
    }
    Promise.resolve(bridge.allAiModels ? bridge.allAiModels() : [])
      .catch(function () {
        return []
      })
      .then(function (r) {
        var list = r && typeof r === 'object' && r.success !== undefined ? r.data || [] : r
        var models = Array.isArray(list)
          ? list.map(function (m) {
              return {
                value: m && (m.value || m.id || ''),
                label: m && (m.label || m.value || m.id || '默认模型')
              }
            })
          : []
        if (!models.length) models = [{ value: '', label: '默认模型' }]
        aiState.models = models
        var saved = ''
        try {
          saved = localStorage.getItem(AI_MODEL_KEY) || ''
        } catch (e) {}
        var cur = null
        for (var i = 0; i < models.length; i++)
          if (models[i].value === saved) {
            cur = models[i]
            break
          }
        if (!cur) cur = models[0]
        sel.innerHTML = models
          .map(function (m) {
            return (
              '<option value="' +
              (m.value || '') +
              '"' +
              (m === cur ? ' selected' : '') +
              '>' +
              (m.label || '默认模型') +
              '</option>'
            )
          })
          .join('')
        aiState.model = cur ? cur.value : ''
      })
  }

  function aiErr(mask, msg) {
    var e = mask.querySelector('.ai-err')
    if (e) {
      e.textContent = msg
      e.style.display = 'block'
    }
    var out = mask.querySelector('.ai-out')
    if (out) out.style.display = 'none'
  }

  function aiBusy(mask, on) {
    aiState.busy = on
    var out = mask.querySelector('.ai-out')
    if (out) out.style.display = on ? 'block' : 'none'
    var btns = mask.querySelectorAll('.ai-preset-btn')
    for (var i = 0; i < btns.length; i++) btns[i].disabled = on
  }

  function aiRun(key, mask) {
    if (aiState.busy) return
    var bridge = aiBridge()
    if (!bridge) {
      aiErr(mask, '当前宿主没有可用的 AI 能力。请在 MT Launcher 的「AI 提供商」中配置模型。')
      return
    }
    var descEl = mask.querySelector('.ai-input')
    var desc = descEl ? descEl.value.trim() : ''
    if (!desc) {
      aiErr(mask, '请输入内容')
      return
    }
    var sel = mask.querySelector('.ai-model')
    var model = sel ? sel.value : aiState.model
    aiState.model = model
    try {
      localStorage.setItem(AI_MODEL_KEY, model || '')
    } catch (e) {}
    aiBusy(mask, true)
    aiErr(mask, '')
    var call =
      typeof bridge.ai === 'function'
        ? bridge.ai({
            model: model || undefined,
            messages: [
              { role: 'system', content: AI_PROMPTS[key] },
              { role: 'user', content: desc }
            ]
          })
        : bridge.aiChat({
            model: model || undefined,
            messages: [
              { role: 'system', content: AI_PROMPTS[key] },
              { role: 'user', content: desc }
            ],
            temperature: 0.2
          })
    Promise.resolve(call)
      .then(function (r) {
        var text = ''
        if (r && typeof r === 'object') {
          // 宿主 IPC 形状：{ success:true, data:{ content } } / { success:false, error }
          if (r.success && r.data && typeof r.data.content === 'string') text = r.data.content
          else if (!r.success && r.error) {
            aiErr(mask, '生成失败：' + (r.error || ''))
            aiBusy(mask, false)
            return
          } else if (typeof r.content === 'string') text = r.content
        } else if (typeof r === 'string') text = r
        text = (text || '').trim()
        if (!text) {
          aiErr(mask, '模型没有返回内容')
          aiBusy(mask, false)
          return
        }
        if (key === 'table') {
          // mindnote 无 toNodes 校验，直接插入（模型 prompt 已约束只输出表格）
          aiInsert(text, mask)
        } else {
          var stripped = text
            .replace(/^```(?:echarts|mermaid|json)/i, '')
            .replace(/```$/, '')
            .trim()
          aiInsert('```' + key + '\n' + stripped + '\n```', mask)
        }
      })
      .catch(function (e) {
        aiErr(mask, '生成失败：' + (e && e.message ? e.message : String(e)))
        aiBusy(mask, false)
      })
  }

  // 把 AI 结果插入编辑器（contenteditable 通用：focus + execCommand insertText）
  function aiInsert(text, mask) {
    try {
      // 1) 优先：聚焦现有编辑器并 execCommand 插入（CM6 响应 beforeinput insertText）
      var ed = document.querySelector(
        '.cm-content, .ProseMirror.editor, [contenteditable="true"].editor, .editor [contenteditable="true"]'
      )
      if (ed) {
        ed.focus()
        var ok = document.execCommand('insertText', false, (aiInsert._last = text))
        if (ok !== false) {
          aiDone(mask, '已插入正文')
          return
        }
      }
    } catch (e) {}
    // 2) 兜底：无编辑器可聚焦 → 尝试 store 层（追加到当前笔记内容）
    try {
      var st = mnStore()
      if (
        st &&
        typeof st.currentNote === 'object' &&
        st.currentNote &&
        st.currentNote.id &&
        typeof st.setLiveContent === 'function'
      ) {
        var id = st.currentNote.id
        var cur = (typeof st.liveContent === 'string' ? st.liveContent : '') || ''
        var next = cur ? cur + '\n\n' + text : text
        st.setLiveContent(next)
        aiDone(mask, '已插入正文')
        return
      }
    } catch (e) {}
    aiErr(mask, '未找到可插入的编辑器，请在编辑器界面重试')
    aiBusy(mask, false)
  }

  function aiDone(mask, msg) {
    aiBusy(mask, false)
    closeAiModal()
    toast(msg)
  }

  // ============ 6. 设置弹窗瘦身（字号/源码字体/自动备份/数据管理 → git 设置面板） ============
  // 读设置：优先 utools.db（与 bundle 同源），回退 localStorage；双源合并
  function readSettings() {
    var s = null
    try {
      if (window.utools && window.utools.db && typeof window.utools.db.get === 'function') {
        var d = window.utools.db.get('kv/mindnote_settings')
        if (d && d.val) s = d.val
      }
    } catch (e) {}
    if (!s) {
      try {
        s = JSON.parse(localStorage.getItem('mindnote_settings') || 'null')
      } catch (e) {}
    }
    return s || {}
  }

  // 把字号 / 源码字体设置应用到编辑器（bundle 从 db 读设置但宿主不响应，这里直接改 DOM 兜底）
  // 3.2.20 需求①：默认正文字体改 18 号；同时写 CSS 变量（bundle CM6 主题 fontSize:
  // var(--editor-font-size) 的官方路径）；无变化时跳过全文档扫描（白屏加固 ②）
  var _fontApplied = null
  function applyFontSettings() {
    try {
      var s = readSettings()
      var fs = s.fontSize || 18
      var ff = s.editorFontFamily || ''
      if (_fontApplied && _fontApplied.fs === fs && _fontApplied.ff === ff) return
      _fontApplied = { fs: fs, ff: ff }
      try {
        document.documentElement.style.setProperty('--editor-font-size', fs + 'px')
      } catch (e) {}
      try {
        if (ff) document.documentElement.style.setProperty('--editor-font-family', ff)
      } catch (e) {}
      var targets = $$(
        '.editor, .cm-content, .ProseMirror, .markdown-body, [class*="editor"] .cm-editor, .cm-editor'
      )
      targets.forEach(function (el) {
        if (fs) el.style.fontSize = fs + 'px'
        if (ff) el.style.fontFamily = ff
      })
      // 源码模式 CodeMirror 的具体字号
      if (fs) {
        var codemirror = document.querySelector('.cm-scroller, .cm-content')
        if (codemirror) codemirror.style.fontSize = fs + 'px'
        if (ff && codemirror) codemirror.style.fontFamily = ff
      }
    } catch (e) {}
  }

  function slimSettings() {
    var modal = document.querySelector('.modal.settings-modal')
    if (!modal) return
    // CSS 兜底已隐藏（view.css），这里精准恢复「主题」「字号」并隐藏其余
    // 3.2.20 需求①：默认正文字体 18 号需在设置「字号」行可见可调，故从"只留主题"恢复为"主题 + 字号"
    var themeShown = false
    $$('.settings-option-row', modal).forEach(function (row) {
      var label = row.querySelector('.settings-option-label')
      var txt = label ? (label.textContent || '').trim() : ''
      if (txt === '主题' || txt === '字号' || txt === '字体') {
        row.style.display = ''
        row.removeAttribute('hidden')
        themeShown = true
      } else {
        row.style.display = 'none'
        row.setAttribute('hidden', '')
      }
    })
    if (!themeShown) {
      // 兜底：找不到「主题」行时，至少保留第一行，隐藏其余
      var rows = $$('.settings-option-row', modal)
      rows.forEach(function (row, i) {
        if (i === 0) {
          row.style.display = ''
          row.removeAttribute('hidden')
        } else {
          row.style.display = 'none'
          row.setAttribute('hidden', '')
        }
      })
    }
    // 隐藏「自动备份 / 数据管理」区块（已迁移到 git 设置面板）
    $$('.settings-section', modal).forEach(function (sec) {
      var hasThemeRow =
        sec.querySelector('.settings-option-row') &&
        Array.prototype.some.call(sec.querySelectorAll('.settings-option-row'), function (r) {
          var lb = r.querySelector('.settings-option-label')
          return (
            lb &&
            ((lb.textContent || '').trim() === '主题' || (lb.textContent || '').trim() === '字号')
          )
        })
      if (hasThemeRow) return
      sec.style.display = 'none'
      sec.setAttribute('hidden', '')
    })
  }

  // ============ 3.2.20 需求⑦：Ctrl+, 打开新设置页签 ============
  // bundle 命令表 openSettings(Mod-,) → App keydown → dispatch CustomEvent('MindNote:open-settings')，
  // 该事件由 Toolbar 组件监听并打开旧 SettingsModal。这里两层处理：
  //   1) view.js 普通脚本先于 bundle module 执行 → document keydown capture 先拦截（preventDefault +
  //      stopImmediatePropagation），bundle 命令表收不到按键，旧弹窗根本不打开；
  //   2) 兜底监听 MindNote:open-settings：若 bundle 仍派发，关掉旧弹窗并转开新设置页签（__zgsOpen）。
  function installSettingsShortcut() {
    document.addEventListener(
      'keydown',
      function (ev) {
        if (!(ev.ctrlKey || ev.metaKey) || ev.altKey || ev.shiftKey) return
        if (ev.key !== ',' && ev.key !== '，') return
        ev.preventDefault()
        ev.stopPropagation()
        try {
          ev.stopImmediatePropagation()
        } catch (e) {}
        openNewSettings()
      },
      true
    )
    window.addEventListener('MindNote:open-settings', function () {
      setTimeout(function () {
        try {
          var modal = document.querySelector('.modal.settings-modal')
          if (modal) {
            var cancelBtn = null
            var btns = modal.querySelectorAll('button')
            for (var i = 0; i < btns.length; i++) {
              if ((btns[i].textContent || '').trim() === '取消') {
                cancelBtn = btns[i]
                break
              }
            }
            // 优先点「取消」（Vue 正常关闭弹窗，不残留状态）；找不到才移除节点
            if (cancelBtn) cancelBtn.click()
            else modal.remove()
          }
          if (window.__zgsOpen && !(window.__zgsIsOpen && window.__zgsIsOpen())) window.__zgsOpen()
        } catch (e) {}
      }, 0)
    })
  }

  function openNewSettings() {
    if (window.__zgsOpen) {
      if (window.__zgsIsOpen && window.__zgsIsOpen()) {
        if (window.__zgsClose) window.__zgsClose()
        return
      }
      window.__zgsOpen()
    } else {
      toast('新设置页签不可用（宿主 Git 服务未就绪）', 'warn')
    }
  }

  // ============ 3.2.20 需求⑨：插件更名「小沈笔记」 ============
  // 窗口标题/插件名由 plugin.json 提供（构建时改）；bundle 编译死的 header logo 文本
  // 「随心记 Markdown」在渲染层覆盖为「小沈笔记」
  function ensureBrand() {
    try {
      var names = document.querySelectorAll('.logo-name, [class*="logo-name"]')
      for (var i = 0; i < names.length; i++) {
        var el = names[i]
        if ((el.textContent || '').trim() !== '小沈笔记') el.textContent = '小沈笔记'
      }
    } catch (e) {}
  }

  // ============ 启动 ============
  // 注：不注册全局 MutationObserver —— 完整 bundle 页面下 MO 与 bundle 自身渲染相互触发会导致
  // 主线程死循环（headless 实测 2~9 分钟后 CPU 打满、CDP 无响应）。改由低频轮询保证注入与恢复：
  // 轮询成本（几次 querySelector + 幂等判断）远低于 MO 风暴，且不会与 bundle 渲染乒乓。
  // 3.2.20 白屏加固（需求②）：tick 由 500ms 降频到 800ms；applyTreeLocks/applyFontSettings/
  // hideNativeSettingsBtn 均带状态缓存，无变化时不重复 DOM 扫描。
  var booted = false
  // 3.2.23 反馈④：首次运行（无工作区配置）弹初始化向导，参照 cmark 首次初始化：
  // 选择工作区目录（git 仓库根），选定后写配置并重启插件加载。有工作区则顺带确保
  // .gitignore（反馈⑤：.cmark/.mindnote 应用数据目录不入库）。
  var firstRunShown = false
  function ensureFirstRunWorkspace() {
    try {
      var cm = window.__CMARK
      if (!cm || typeof cm.getConfig !== 'function') return
      var info = cm.getConfig()
      if (!info) return
      // 已初始化（cmark 的 pickWorkspace 会写 initialized:true）且工作区存在 → 正常使用，
      // 顺带确保 .gitignore（反馈⑤：.cmark/.mindnote 应用数据目录不入库）。
      // 注意：cmark 对空 workspace 会自动 fallback 到 ~/Documents/CMark（getConfig().workspace 永非空），
      // 因此首次判定必须看 initialized 而非 workspace 是否为空。
      if (info.initialized && info.workspace && info.workspaceExists) {
        try {
          if (typeof cm.ensureGitignore === 'function') cm.ensureGitignore()
        } catch (e) {}
        return
      }
      showFirstRunWizard(cm)
    } catch (e) {}
  }
  function showFirstRunWizard(cm) {
    if (firstRunShown) return
    firstRunShown = true
    try {
      var m = document.createElement('div')
      m.id = 'mn-firstrun-mask'
      m.className = 'mn-firstrun-mask'
      m.innerHTML =
        '<div class="mn-firstrun-card">' +
        '<div class="mn-firstrun-title">首次使用小沈笔记</div>' +
        '<div class="mn-firstrun-desc">请选择工作区目录（Git 仓库根），笔记将保存在该目录下。<br>也可以稍后在「设置 → GIT 集成」中选择。</div>' +
        '<div class="mn-firstrun-actions">' +
        '<button type="button" class="mn-firstrun-primary">选择工作区目录</button>' +
        '<button type="button" class="mn-firstrun-later">稍后再说</button>' +
        '</div>' +
        '</div>'
      document.body.appendChild(m)
      var okBtn = m.querySelector('.mn-firstrun-primary')
      var laterBtn = m.querySelector('.mn-firstrun-later')
      if (okBtn)
        okBtn.addEventListener('click', function () {
          try {
            var r = cm.pickWorkspace()
            if (r && r.ok) {
              try {
                m.parentNode && m.parentNode.removeChild(m)
              } catch (e) {}
              try {
                if (typeof cm.ensureGitignore === 'function') cm.ensureGitignore()
              } catch (e) {}
              try {
                if (window.location && typeof window.location.reload === 'function')
                  window.location.reload()
              } catch (e) {}
            } else {
              toast((r && r.message) || '未选择工作区目录')
            }
          } catch (e) {}
        })
      if (laterBtn)
        laterBtn.addEventListener('click', function () {
          try {
            m.parentNode && m.parentNode.removeChild(m)
          } catch (e) {}
        })
    } catch (e) {}
  }
  function tick() {
    if (!booted) return
    // 每步独立 try：任何一步异常都不能拖垮后续步骤（否则 git 分支栏/AI 按钮会被连带跳过）
    try {
      patchCmarkStore()
    } catch (e) {}
    try {
      ensureGitBtn()
    } catch (e) {}
    try {
      ensureToolbarBtns()
    } catch (e) {}
    try {
      hideNativeSettingsBtn()
    } catch (e) {}
    try {
      ensureBranchBar()
    } catch (e) {}
    try {
      applyTreeLocks()
    } catch (e) {}
    try {
      slimSettings()
    } catch (e) {}
    try {
      applyFontSettings()
    } catch (e) {}
    try {
      ensureLockUI()
    } catch (e) {}
    try {
      ensureBrand()
    } catch (e) {}
    try {
      refreshBranchBar()
    } catch (e) {}
  }
  function boot() {
    booted = true
    ensureFirstRunWorkspace()
    patchCmarkStore()
    ensureGitBtn()
    ensureToolbarBtns()
    hideNativeSettingsBtn()
    ensureBranchBar()
    refreshBranchBar()
    patchMindnote()
    installContextMenu()
    slimSettings()
    applyFontSettings()
    ensureBrand()
    // 3.2.20 需求⑦：Ctrl+, 拦截——view.js 是普通脚本先于 bundle module 执行，
    // capture 阶段 keydown 先命中，bundle 的 openSettings（Mod-,）收不到事件，旧设置弹窗不再打开；
    // 兜底监听 MindNote:open-settings：若 bundle 仍派发（脚本顺序倒挂），关闭旧弹窗并转新页签
    installSettingsShortcut()
    // settings-panel（git 设置面板）保存字号/源码字体后通知本层立即应用
    document.addEventListener('mn-settings-changed', function () {
      applyFontSettings()
      slimSettings()
    })
    // 轻量 MutationObserver：设置弹窗由 bundle 动态渲染，出现即瘦身（只改 style、不增删节点，
    // 不会与 bundle 渲染乒乓；历史 MO 死循环是"插入 DOM"导致的，本观察器无此行为）。
    // 节流 150ms：modal 打开后 150ms 内瘦身，同时避免高频回调空转。
    try {
      var moTimer = null
      var mo = new MutationObserver(function () {
        if (moTimer) return
        moTimer = setTimeout(function () {
          moTimer = null
          slimSettings()
        }, 150)
      })
      mo.observe(document.body, { childList: true, subtree: true })
    } catch (e) {}
    // 800ms 轮询兜底：Vue 重渲染会重建 topbar/侧栏；分支栏状态定时刷新（3.2.20 降频，白屏加固 ②）
    setInterval(tick, 800)
  }

  if (document.body) boot()
  else document.addEventListener('DOMContentLoaded', boot)
})()
