/**
 * MT Launcher 视图工具栏覆盖层 - CMark
 * 提供 编辑 / 源码 / 分屏 / 专注 四个视图按钮（居中显示）+ 目录（图标，位于右上角源码图标位置）。
 * 纯 DOM 覆盖层：不修改 CMark 构建产物，通过操作 DOM 与点击原生按钮实现状态联动。
 *
 * 布局约定（用户需求 2026-11-03）：
 *   - 编辑/源码/分屏/专注 四个文字按钮 → 居中（标题右侧）
 *   - 目录 → 图标按钮，替换右上角原“源码模式 <>”图标的位置（原生源码按钮隐藏但保留可点击）
 *   - 分屏 → 左侧源码编辑，右侧实时预览
 */
;(() => {
  'use strict'

  const state = { split: false, focus: false, toc: false, source: false, preSplitSource: false }
  let previewBody = null
  let tocPanel = null
  let previewTimer = null
  let tocTimer = null
  let barTimer = null

  const NS = 'mtv'
  const BTNS = [
    { id: 'edit', label: '编辑', title: '编辑模式（所见即所得）' },
    { id: 'source', label: '源码', title: '切换 Markdown 源码视图' },
    { id: 'split', label: '分屏', title: '分屏：左侧源码，右侧实时预览' },
    { id: 'focus', label: '专注', title: '专注：隐藏目录与工具栏，只留编辑器' }
  ]

  const $ = (sel, root) => (root || document).querySelector(sel)
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel))

  function isSourceMode() {
    return (
      !!$('.content .plate-host.is-source textarea.source-editor') ||
      !!$('.content textarea.source-editor')
    )
  }
  function nativeSourceBtn() {
    return $$('button').find((b) => (b.title || '').includes('源码模式') && !b.closest('.mtv-bar'))
  }
  function editorArea() {
    return $('.content .plate-host')
  }
  function sourceTextarea() {
    return $('.content textarea.source-editor')
  }

  /* ---------- 中间按钮组（编辑/源码/分屏/专注） ---------- */
  function buildBar() {
    const bar = document.createElement('div')
    bar.className = 'mtv-bar'
    bar.id = NS + '-bar'
    for (const b of BTNS) {
      const btn = document.createElement('button')
      btn.id = NS + '-' + b.id
      btn.title = b.title
      btn.textContent = b.label
      btn.addEventListener('click', () => onViewBtn(b.id))
      bar.appendChild(btn)
    }
    return bar
  }
  function ensureBar() {
    if (document.getElementById(NS + '-bar')) return
    const title = $('.header .title')
    if (title && title.parentElement) {
      // 插到标题之后、handle 之前：配合 CSS 让 4 个按钮与标题一起居中
      title.parentElement.insertBefore(buildBar(), title.nextSibling)
    } else {
      const menuToggle = $('.header .menu-toggle')
      if (!menuToggle || !menuToggle.parentElement) return
      menuToggle.parentElement.insertBefore(buildBar(), menuToggle)
    }
    syncBarState()
  }

  /* ---------- 目录图标按钮（右上角，替换原源码图标位置） ---------- */
  function buildTocBtn() {
    const btn = document.createElement('button')
    btn.id = NS + '-toc'
    btn.type = 'button'
    btn.className = 'iconbtn mtv-toc-btn'
    btn.title = '目录：显示当前笔记大纲'
    btn.innerHTML =
      '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h2M2 8h2M2 12h2"/><path d="M6.5 4h7.5M6.5 8h7.5M6.5 12h7.5"/></svg>'
    btn.addEventListener('click', () => onViewBtn('toc'))
    return btn
  }
  function ensureTocBtn() {
    if (document.getElementById(NS + '-toc')) return
    const handle = $('.header .handle')
    if (!handle) return
    const nativeSrc = $$('.header .handle .iconbtn').find((b) =>
      (b.title || '').includes('源码模式')
    )
    const btn = buildTocBtn()
    if (nativeSrc) nativeSrc.parentElement.insertBefore(btn, nativeSrc)
    else handle.appendChild(btn)
  }
  function hideNativeSource() {
    const b = nativeSourceBtn()
    if (b && !b.classList.contains('mtv-hidden')) b.classList.add('mtv-hidden')
  }

  function syncBarState() {
    const setActive = (id, on) => {
      const el = document.getElementById(NS + '-' + id)
      if (el) el.classList.toggle('active', !!on)
    }
    setActive('edit', !state.source)
    setActive('source', state.source)
    setActive('split', state.split)
    setActive('focus', state.focus)
    setActive('toc', state.toc)
  }

  /* ---------- 视图动作 ---------- */
  function onViewBtn(id) {
    if (id === 'edit') {
      if (state.source) clickNativeSource()
      setSplit(false)
      setFocus(false)
      setToc(false)
    } else if (id === 'source') {
      if (state.split && !state.source) {
        // 分屏状态下切源码：只需切模式，预览自动跟随
        clickNativeSource()
      } else {
        clickNativeSource()
      }
    } else if (id === 'split') {
      setSplit(!state.split)
    } else if (id === 'focus') {
      setFocus(!state.focus)
    } else if (id === 'toc') {
      setToc(!state.toc)
    }
  }
  function clickNativeSource() {
    const b = nativeSourceBtn()
    if (b) b.click()
  }

  function setSplit(on) {
    const was = state.split
    state.split = !!on
    document.body.classList.toggle('cm-split', state.split)
    if (state.split) {
      if (!was) state.preSplitSource = state.source
      // 分屏 = 左源码 + 右预览：进入分屏时若不在源码模式则强制切源码
      if (!state.source) clickNativeSource()
      ensurePreview()
      refreshPreview()
    } else {
      if (was && state.preSplitSource === false && state.source) clickNativeSource()
      const pv = $('.mtv-preview')
      if (pv) pv.remove()
      previewBody = null
    }
    syncBarState()
  }

  function setFocus(on) {
    state.focus = !!on
    document.body.classList.toggle('cm-focus', state.focus)
    syncBarState()
  }

  function setToc(on) {
    state.toc = !!on
    document.body.classList.toggle('cm-toc-open', state.toc)
    if (state.toc) {
      ensureToc()
      refreshToc()
    } else if (tocPanel) {
      tocPanel.remove()
      tocPanel = null
    }
    syncBarState()
  }

  /* ---------- 分屏预览（右侧） ---------- */
  function ensurePreview() {
    if ($('.mtv-preview')) return
    const main = $('.main')
    if (!main) return
    const pv = document.createElement('div')
    pv.className = 'mtv-preview'
    const head = document.createElement('div')
    head.className = 'mtv-preview-head'
    head.textContent = '预览'
    previewBody = document.createElement('div')
    previewBody.className = 'mtv-preview-body'
    pv.appendChild(head)
    pv.appendChild(previewBody)
    main.appendChild(pv)
  }
  function refreshPreview() {
    if (!state.split || !previewBody) return
    if (state.source) {
      const ta = sourceTextarea()
      previewBody.innerHTML = ''
      previewBody.classList.remove('plate-host')
      const pre = document.createElement('pre')
      pre.className = 'mtv-src-pre'
      pre.textContent = ta ? ta.value : ''
      previewBody.appendChild(pre)
    } else {
      const host = editorArea()
      if (!host) return
      const clone = host.cloneNode(true)
      $$('[contenteditable]', clone).forEach((el) => el.setAttribute('contenteditable', 'false'))
      $$('button', clone).forEach((el) => el.remove())
      $$(
        '.tc-btn, .code-lang, .code-editor-copy, .math-toggle, .math-inline-toggle',
        clone
      ).forEach((el) => el.remove())
      previewBody.innerHTML = ''
      previewBody.classList.add('plate-host')
      while (clone.firstChild) previewBody.appendChild(clone.firstChild)
    }
  }
  function schedulePreview() {
    if (!state.split) return
    window.clearTimeout(previewTimer)
    previewTimer = window.setTimeout(refreshPreview, 350)
  }

  /* ---------- 目录 ---------- */
  function ensureToc() {
    if ($('.mtv-toc')) return
    tocPanel = document.createElement('div')
    tocPanel.className = 'mtv-toc'
    const head = document.createElement('div')
    head.className = 'mtv-toc-head'
    head.textContent = '目录'
    tocPanel.appendChild(head)
    document.body.appendChild(tocPanel)
  }
  function buildTocItems() {
    const items = []
    if (state.source) {
      const ta = sourceTextarea()
      if (ta) {
        const lines = ta.value.split('\n')
        lines.forEach((ln, idx) => {
          const m = ln.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
          if (m) items.push({ level: m[1].length, text: m[2], line: idx })
        })
      }
    } else {
      const host = editorArea()
      if (host) {
        const seen = new Set()
        $$('h1,h2,h3,h4,h5,h6,div.h1,div.h2,div.h3,div.h4,div.h5,div.h6', host).forEach((h) => {
          if (seen.has(h)) return
          seen.add(h)
          const m = h.tagName.match(/^H(\d)$/) || (h.className || '').toString().match(/\bh(\d)\b/)
          if (!m) return
          items.push({
            level: Number(m[1]),
            text: (h.textContent || '').trim() || '(无标题)',
            el: h
          })
        })
      }
    }
    return items
  }
  function refreshToc() {
    if (!state.toc || !tocPanel) return
    const items = buildTocItems()
    $$('a, .mtv-toc-empty', tocPanel).forEach((el) => el.remove())
    if (!items.length) {
      const empty = document.createElement('div')
      empty.className = 'mtv-toc-empty'
      empty.textContent = '当前笔记没有标题'
      tocPanel.appendChild(empty)
      return
    }
    items.forEach((it) => {
      const a = document.createElement('a')
      a.href = 'javascript:void(0)'
      a.className = 'mtv-lv-' + Math.min(it.level, 6)
      a.textContent = it.text
      a.title = it.text
      a.addEventListener('click', (ev) => {
        ev.preventDefault()
        if (it.el) {
          it.el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        } else if (it.line !== undefined) {
          const ta = sourceTextarea()
          if (ta) {
            const lineH = 22
            ta.scrollTop = Math.max(0, it.line * lineH - 40)
            ta.focus()
          }
        }
      })
      tocPanel.appendChild(a)
    })
  }
  function scheduleToc() {
    if (!state.toc) return
    window.clearTimeout(tocTimer)
    tocTimer = window.setTimeout(refreshToc, 350)
  }

  /* ---------- 状态轮询与联动 ---------- */
  function refreshState() {
    const src = isSourceMode()
    if (src !== state.source) {
      state.source = src
      syncBarState()
      schedulePreview()
      scheduleToc()
    }
    if (state.split) schedulePreview()
    if (state.toc) scheduleToc()
  }

  function install() {
    ensureBar()
    ensureTocBtn()
    hideNativeSource()
    refreshState()
    const mo = new MutationObserver(() => {
      window.clearTimeout(barTimer)
      barTimer = window.setTimeout(() => {
        ensureBar()
        ensureTocBtn()
        hideNativeSource()
        refreshState()
      }, 120)
    })
    mo.observe(document.body, { childList: true, subtree: true })
    document.addEventListener(
      'input',
      () => {
        schedulePreview()
        scheduleToc()
      },
      true
    )
    document.addEventListener(
      'keydown',
      (ev) => {
        if (ev.key === 'Escape' && state.focus) {
          setFocus(false)
        }
      },
      true
    )
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install)
  } else {
    install()
  }
})()
