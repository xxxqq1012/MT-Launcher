/* ==========================================================================
 * 3.2.48 结果区代码视图：行号 gutter / 点击折叠展开 / 查找替换双栏高亮
 * 依赖 index.html 内联脚本导出的 window.__sfCore（语法高亮与括号配对工具）
 * ========================================================================== */
;(function () {
  'use strict'

  var core = window.__sfCore
  if (!core) return

  var $ =
    core.$ ||
    function (id) {
      return document.getElementById(id)
    }

  var view = $('outputView')
  var outTa = $('outputSql')
  var inTa = $('inputSql')
  var inHl = $('inputHl')
  var gutterInner = $('inputGutterInner')
  if (!view || !outTa || !inTa) return

  var STORE_AUTOFOLD = 'sqlAutoFold'
  var CH = { KW: 1, TBL: 2, ID: 3, STR: 4, NUM: 5, FN: 6, CMT: 7 }
  var CLS = ['', 'tk-kw', 'tk-tbl', 'tk-id', 'tk-str', 'tk-num', 'tk-fn', 'tk-cmt']

  /* ---------------- 规则「是否代码折叠」= 视图级自动折叠 ---------------- */
  var foldAuto = false
  try {
    foldAuto = localStorage.getItem(STORE_AUTOFOLD) === '1'
  } catch (e) {}

  /* ---------------- 文本模型 ---------------- */
  var model = { text: '', lines: [], chars: null, folds: [], foldByStart: new Map() }
  var modelText = null
  var folded = new Set()

  function buildCharClasses(text, tables) {
    var chars = new Uint8Array(text.length)
    var re = core.TOKEN_RE
    if (!re) return chars
    re.lastIndex = 0
    var m
    while ((m = re.exec(text)) !== null) {
      var tok = m[0]
      // 与 index.html 的 highlightSql 保持同一套判定，避免换视图后配色漂移
      var code = CH.ID
      if (m[1] !== undefined) code = CH.STR
      else if (m[2] !== undefined) code = CH.CMT
      else if (m[3] !== undefined) code = CH.NUM
      else if (core.KW_SET && core.KW_SET.has(tok.toUpperCase())) code = CH.KW
      else if (tables.has(tok.toLowerCase())) code = CH.TBL
      var end = m.index + tok.length
      for (var i = m.index; i < end; i++) chars[i] = code
    }
    return chars
  }

  var CLOSER = { '(': ')', '[': ']', '{': '}' }

  /** 扫字符流得到可折叠的字符区间：括号配对 + CASE/BEGIN…END */
  function collectFoldChars(text, chars) {
    var raw = []
    var stack = []
    var wordRe = /[A-Za-z0-9_$]/
    for (var i = 0; i < text.length; i++) {
      var code = chars[i]
      if (code === CH.STR || code === CH.CMT) continue
      var ch = text[i]
      if (ch === '(' || ch === '[' || ch === '{') {
        stack.push({ ch: ch, i: i })
        continue
      }
      if (ch === ')' || ch === ']' || ch === '}') {
        for (var k = stack.length - 1; k >= 0; k--) {
          if (stack[k].word) continue
          if (CLOSER[stack[k].ch] !== ch) continue
          raw.push({ s: stack[k].i, e: i })
          stack.length = k
          break
        }
        continue
      }
      if (/[A-Za-z_]/.test(ch) && (i === 0 || !wordRe.test(text[i - 1]))) {
        var j = i + 1
        while (j < text.length && wordRe.test(text[j])) j++
        var word = text.slice(i, j).toUpperCase()
        if (word === 'CASE' || word === 'BEGIN') {
          stack.push({ ch: word, i: i, word: true })
        } else if (word === 'END') {
          for (var n = stack.length - 1; n >= 0; n--) {
            if (!stack[n].word) continue
            raw.push({ s: stack[n].i, e: j })
            stack.length = n
            break
          }
        }
        i = j - 1
      }
    }
    return raw
  }

  function buildModel(text) {
    var tables = core.collectTableNames ? core.collectTableNames(text) : new Set()
    var chars = buildCharClasses(text, tables)

    var starts = [0]
    for (var i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1)
    var lines = []
    for (var li = 0; li < starts.length; li++) {
      var s = starts[li]
      var e = li + 1 < starts.length ? starts[li + 1] - 1 : text.length
      lines.push({ start: s, text: text.slice(s, e) })
    }

    var lineAt = function (pos) {
      var lo = 0
      var hi = starts.length - 1
      while (lo < hi) {
        var mid = (lo + hi + 1) >> 1
        if (starts[mid] <= pos) lo = mid
        else hi = mid - 1
      }
      return lo
    }

    var folds = []
    var foldByStart = new Map()
    var raw = collectFoldChars(text, chars)
    for (var r = 0; r < raw.length; r++) {
      var sl = lineAt(raw[r].s)
      var el = lineAt(raw[r].e)
      if (el - sl < 2) continue // 只藏 0 行没有折叠意义
      var old = foldByStart.get(sl)
      if (old) {
        if (el > old.end) old.end = el
        continue
      }
      var f = { start: sl, end: el }
      foldByStart.set(sl, f)
      folds.push(f)
    }
    return { text: text, lines: lines, chars: chars, folds: folds, foldByStart: foldByStart }
  }

  function foldAll() {
    folded.clear()
    for (var i = 0; i < model.folds.length; i++) folded.add(model.folds[i].start)
  }

  /* ---------------- 查找状态 ---------------- */
  var find = { q: '', cs: false, rx: false, open: false, inMatches: [], outMatches: [], cur: -1 }

  /** 正则开关打开时编译正则；语法错误返回 false，由调用方回落字面量匹配 */
  function compileRe(q, cs) {
    if (!q) return null
    try {
      return new RegExp(q, cs ? 'g' : 'gi')
    } catch (e) {
      return false
    }
  }

  function matchesOf(text, q, cs, rx) {
    var res = []
    if (!q || !text) return res
    if (rx) {
      var re = compileRe(q, cs)
      if (re) {
        re.lastIndex = 0
        var m
        var guard = 0
        while ((m = re.exec(text)) !== null && guard++ < 50000) {
          if (m[0] === '') {
            re.lastIndex = m.index + 1
            if (re.lastIndex > text.length) break
            continue
          }
          res.push({ start: m.index, end: m.index + m[0].length })
        }
        return res
      }
      // 非法正则 → 退回字面量匹配，不让查找按钮失效
    }
    // cs = 区分大小写；未勾选时按不区分大小写匹配
    var hay = cs ? text : text.toLowerCase()
    var needle = cs ? q : q.toLowerCase()
    var step = Math.max(1, needle.length)
    var at = hay.indexOf(needle)
    while (at !== -1) {
      res.push({ start: at, end: at + needle.length })
      at = hay.indexOf(needle, at + step)
    }
    return res
  }

  /** 正则模式下的替换展开：支持 $$ / $& / $1..$99 */
  function expandReplacement(re, text, start, to) {
    re.lastIndex = start
    var m = re.exec(text)
    if (!m || m.index !== start) return to
    return to.replace(/\$(?:\$|&|\d{1,2})/g, function (token) {
      if (token === '$$') return '$'
      if (token === '$&') return m[0]
      var n = Number(token.slice(1))
      return m[n] === undefined ? '' : m[n]
    })
  }

  /* ---------------- 结果区渲染 ---------------- */
  function lineHtml(line, lineNo, findCls, curRange, brkSet) {
    var text = line.text
    if (!text) return ''
    var chars = model.chars
    var out = ''
    var buf = ''
    var bufCls = ''
    var flush = function () {
      if (!buf) return
      out += bufCls
        ? '<span class="' + bufCls + '">' + core.escapeHtml(buf) + '</span>'
        : core.escapeHtml(buf)
      buf = ''
      bufCls = ''
    }
    for (var i = 0; i < text.length; i++) {
      var gi = line.start + i
      var c = CLS[chars[gi]] || ''
      if (findCls) {
        var f = findCls[gi]
        if (f === 1) c = c ? c + ' tk-find' : 'tk-find'
        else if (f === 2) c = c ? c + ' tk-find-cur' : 'tk-find-cur'
      }
      if (brkSet && brkSet.has(gi)) c = c ? c + ' tk-brk' : 'tk-brk'
      if (c !== bufCls) {
        flush()
        bufCls = c
      }
      buf += text[i]
    }
    flush()
    return out
  }

  function render() {
    var text = outTa.value
    // 文本没变时，重绘前后都要把用户的选区原样带回去（悬停/查找高亮还会触发重绘）
    var keepSel = text === modelText ? getViewSelection() : null
    if (text !== modelText) {
      model = buildModel(text)
      modelText = text
      folded.clear()
      pinned = false
      hoverKey = ''
      if (core.setBrkMarks) core.setBrkMarks([])
      if (foldAuto) foldAll()
    }

    var keepTop = view.scrollTop
    var keepLeft = view.scrollLeft

    var findCls = null
    if (find.open && find.q) {
      findCls = new Uint8Array(text.length)
      var curOut =
        find.cur >= 0 && find.cur < find.outMatches.length ? find.outMatches[find.cur] : null
      for (var a = 0; a < find.outMatches.length; a++) {
        var r = find.outMatches[a]
        var isCur = !!curOut && r.start === curOut.start && r.end === curOut.end
        for (var b = r.start; b < r.end; b++) findCls[b] = isCur ? 2 : 1
      }
    }

    var marks = core.getBrkMarks ? core.getBrkMarks() : []
    var brkSet = marks && marks.length ? new Set(marks) : null

    var hidden = new Set()
    for (var i = 0; i < model.folds.length; i++) {
      var f = model.folds[i]
      if (!folded.has(f.start)) continue
      for (var h = f.start + 1; h <= f.end; h++) hidden.add(h)
    }

    var html = ''
    if (!text) {
      html = '<div class="cv-empty">格式化结果会显示在这里</div>'
    } else {
      for (var li = 0; li < model.lines.length; li++) {
        if (hidden.has(li)) continue
        var fold = model.foldByStart.get(li)
        var isFolded = !!(fold && folded.has(li))
        var gutter =
          '<span class="cv-num">' +
          (li + 1) +
          '</span>' +
          (fold
            ? '<button class="cv-fold-btn" type="button" data-fold="' +
              li +
              '" title="' +
              (isFolded ? '展开' : '折叠') +
              '">' +
              (isFolded ? '▸' : '▾') +
              '</button>'
            : '<span class="cv-fold-spacer"></span>')
        html +=
          '<div class="cv-row" data-line="' +
          li +
          '">' +
          '<span class="cv-gutter">' +
          gutter +
          '</span>' +
          '<span class="cv-line">' +
          lineHtml(model.lines[li], li, findCls, null, brkSet) +
          (isFolded ? '<span class="cv-fold-dots">…</span>' : '') +
          '</span></div>'
      }
    }

    view.innerHTML = html
    view.scrollTop = keepTop
    view.scrollLeft = keepLeft
    if (keepSel) setViewSelection(keepSel.a, keepSel.f)
  }

  /* ---------------- 坐标 → 全局字符下标 ---------------- */
  function indexFromNodeOffset(node, offset) {
    if (!node || node.nodeType !== 3) return -1
    var parent = node.parentNode
    var lineEl = null
    while (parent && parent !== view) {
      if (parent.classList && parent.classList.contains('cv-line')) {
        lineEl = parent
        break
      }
      parent = parent.parentNode
    }
    if (!lineEl) return -1
    var row = lineEl.parentNode
    var li = Number(row.getAttribute('data-line'))
    if (isNaN(li) || !model.lines[li]) return -1
    var extra = 0
    var walker = document.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT, null)
    while (walker.nextNode()) {
      if (walker.currentNode === node) break
      extra += walker.currentNode.nodeValue.length
    }
    return model.lines[li].start + extra + offset
  }

  function indexFromPoint(x, y) {
    var node = null
    var offset = 0
    if (document.caretPositionFromPoint) {
      var p = document.caretPositionFromPoint(x, y)
      if (p) {
        node = p.offsetNode
        offset = p.offset
      }
    } else if (document.caretRangeFromPoint) {
      var r = document.caretRangeFromPoint(x, y)
      if (r) {
        node = r.startContainer
        offset = r.startOffset
      }
    }
    return indexFromNodeOffset(node, offset)
  }

  /* ---------------- 全局下标 ↔ DOM 位置（让选区跨重绘保持） ---------------- */
  function lineIndexOfPos(idx) {
    var lo = 0
    var hi = model.lines.length - 1
    if (idx < 0 || hi < 0) return -1
    while (lo <= hi) {
      var mid = (lo + hi) >> 1
      if (model.lines[mid].start <= idx) lo = mid + 1
      else hi = mid - 1
    }
    return hi
  }

  /** 全局下标 → { node, offset }：折叠隐藏的行返回 null（选区内可见部分照常定位） */
  function posFromIndex(idx) {
    var li = lineIndexOfPos(idx)
    if (li < 0) return null
    var line = model.lines[li]
    var row = view.querySelector('.cv-row[data-line="' + li + '"]')
    if (!row) return null
    var lineEl = row.querySelector('.cv-line')
    if (!lineEl) return null
    var rel = idx - line.start
    if (rel < 0) rel = 0
    if (rel > line.text.length) rel = line.text.length
    var walker = document.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT, null)
    var acc = 0
    var last = null
    var node
    while ((node = walker.nextNode())) {
      var len = node.nodeValue.length
      if (rel <= acc + len) return { node: node, offset: rel - acc }
      acc += len
      last = node
    }
    return last ? { node: last, offset: last.nodeValue.length } : null
  }

  function hasViewSelection() {
    var sel = window.getSelection()
    if (!sel || !sel.rangeCount || sel.isCollapsed) return false
    return view.contains(sel.anchorNode) && view.contains(sel.focusNode)
  }

  function getViewSelection() {
    var sel = window.getSelection()
    if (!sel || !sel.rangeCount || sel.isCollapsed) return null
    if (!view.contains(sel.anchorNode) || !view.contains(sel.focusNode)) return null
    var a = indexFromNodeOffset(sel.anchorNode, sel.anchorOffset)
    var f = indexFromNodeOffset(sel.focusNode, sel.focusOffset)
    if (a < 0 || f < 0) return null
    return { a: a, f: f }
  }

  function setViewSelection(a, f) {
    var lo = Math.min(a, f)
    var hi = Math.max(a, f)
    var pLo = posFromIndex(lo)
    var pHi = posFromIndex(hi)
    if (!pLo || !pHi) return false
    var sel = window.getSelection()
    try {
      sel.setBaseAndExtent(pLo.node, pLo.offset, pHi.node, pHi.offset)
      return true
    } catch (e) {
      return false
    }
  }

  /** 清掉已渲染的括号高亮 class（不重建 DOM，避免打断正在进行的拖选） */
  function clearBrkMarksDom() {
    var marked = view.querySelectorAll('.tk-brk')
    for (var i = 0; i < marked.length; i++) {
      var keep = []
      var cls = ' ' + (marked[i].getAttribute('class') || '') + ' '
      cls.split(/\s+/).forEach(function (t) {
        if (t && t !== 'tk-brk') keep.push(t)
      })
      marked[i].setAttribute('class', keep.join(' '))
    }
  }

  /* ---------------- 括号配对（悬停预览 + 点击固定） ---------------- */
  var pinned = false
  var hoverKey = ''
  var rafId = 0
  var selecting = false

  /** 双击落在括号前/括号后时，定位括号并算出「括号内」的字符区间 */
  function bracketInnerAt(idx) {
    var text = outTa.value
    if (idx < 0 || !text) return null
    var hit = -1
    if (idx < text.length && (core.isBracketOpen(text[idx]) || core.isBracketClose(text[idx])))
      hit = idx
    else if (idx > 0 && (core.isBracketOpen(text[idx - 1]) || core.isBracketClose(text[idx - 1])))
      hit = idx - 1
    if (hit < 0) return null
    var pair = core.buildBracketPairs(text).get(hit)
    if (pair === undefined) return null
    return core.isBracketOpen(text[hit])
      ? { hit: hit, pair: pair, from: hit + 1, to: pair }
      : { hit: hit, pair: pair, from: pair + 1, to: hit }
  }

  function markAt(idx) {
    var text = outTa.value
    if (idx < 0 || !text) return null
    for (var d = 0; d <= 2; d++) {
      var cands = d === 0 ? [idx] : [idx - d, idx + d]
      for (var c = 0; c < cands.length; c++) {
        var at = cands[c]
        if (at < 0 || at >= text.length) continue
        var ch = text[at]
        if (core.isBracketOpen(ch) || core.isBracketClose(ch)) return at
      }
    }
    return null
  }

  function applyBrk(idx) {
    var text = outTa.value
    var hit = markAt(idx)
    if (hit === null) {
      if (hoverKey !== 'none') {
        hoverKey = 'none'
        if (core.setBrkMarks) core.setBrkMarks([])
        render()
      }
      return
    }
    var pairs = core.buildBracketPairs(text)
    var pair = pairs.get(hit)
    var key = hit + ':' + (pair === undefined ? -1 : pair)
    if (key === hoverKey) return
    hoverKey = key
    if (core.setBrkMarks) core.setBrkMarks(pair === undefined ? [] : [hit, pair])
    render()
  }

  /* 按下即进入「拖选」状态：期间不重绘，保证选区不被冲掉 */
  view.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return
    if (e.target.closest && (e.target.closest('.cv-fold-btn') || e.target.closest('.cv-gutter')))
      return
    selecting = true
    if (rafId) {
      cancelAnimationFrame(rafId)
      rafId = 0
    }
    if (hoverKey && hoverKey !== 'none') {
      hoverKey = 'none'
      if (core.setBrkMarks) core.setBrkMarks([])
      clearBrkMarksDom()
    }
  })

  document.addEventListener('mouseup', function () {
    selecting = false
  })

  view.addEventListener('mousemove', function (e) {
    if (pinned || selecting || hasViewSelection()) return
    var x = e.clientX
    var y = e.clientY
    if (rafId) cancelAnimationFrame(rafId)
    rafId = requestAnimationFrame(function () {
      rafId = 0
      applyBrk(indexFromPoint(x, y))
    })
  })

  view.addEventListener('mouseleave', function () {
    if (pinned || selecting) return
    if (rafId) {
      cancelAnimationFrame(rafId)
      rafId = 0
    }
    if (hoverKey === 'none') return
    hoverKey = 'none'
    if (core.setBrkMarks) core.setBrkMarks([])
    render()
  })

  view.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('.cv-fold-btn') : null
    if (btn) {
      var li = Number(btn.getAttribute('data-fold'))
      if (isNaN(li)) return
      if (folded.has(li)) folded.delete(li)
      else folded.add(li)
      render()
      e.preventDefault()
      e.stopPropagation()
      return
    }
    if (e.target.closest && e.target.closest('.cv-gutter')) return
    // 用户已经选中一段文本时不做括号高亮重绘，否则选区会被整块 HTML 重建冲掉
    if (hasViewSelection()) return
    var idx = indexFromPoint(e.clientX, e.clientY)
    hoverKey = ''
    pinned = true
    applyBrk(idx)
  })

  /* 双击括号前/括号后：选中括号内的内容（结果区同样可用） */
  view.addEventListener('dblclick', function (e) {
    if (e.target.closest && (e.target.closest('.cv-fold-btn') || e.target.closest('.cv-gutter')))
      return
    var info = bracketInnerAt(indexFromPoint(e.clientX, e.clientY))
    if (!info) return
    if (info.to <= info.from) return
    e.preventDefault()
    pinned = true
    hoverKey = 'none'
    if (core.setBrkMarks) core.setBrkMarks([info.hit, info.pair])
    render()
    setViewSelection(info.from, info.to)
    selecting = false
  })

  /* ---------------- 原始 SQL 区：双击括号前/括号后选中括号内内容 ---------------- */
  var inputBrkMarks = []

  /** 用 textarea 的选区/光标判断双击落点是否贴着括号，并算出括号内区间 */
  function bracketInnerInInput() {
    var text = inTa.value
    if (!text) return null
    var s = inTa.selectionStart
    var e = inTa.selectionEnd
    var hit = -1
    if (e - s === 1 && (core.isBracketOpen(text[s]) || core.isBracketClose(text[s]))) hit = s
    else if (e < text.length && (core.isBracketOpen(text[e]) || core.isBracketClose(text[e])))
      hit = e
    else if (e > 0 && (core.isBracketOpen(text[e - 1]) || core.isBracketClose(text[e - 1])))
      hit = e - 1
    else if (s < text.length && (core.isBracketOpen(text[s]) || core.isBracketClose(text[s])))
      hit = s
    if (hit < 0) return null
    var pair = core.buildBracketPairs(text).get(hit)
    if (pair === undefined) return null
    return core.isBracketOpen(text[hit])
      ? { hit: hit, pair: pair, from: hit + 1, to: pair }
      : { hit: hit, pair: pair, from: pair + 1, to: hit }
  }

  inTa.addEventListener('dblclick', function () {
    var info = bracketInnerInInput()
    if (!info) {
      if (inputBrkMarks.length) {
        inputBrkMarks = []
        renderInputHl()
      }
      return
    }
    inputBrkMarks = [info.hit, info.pair]
    if (info.to > info.from) {
      try {
        inTa.setSelectionRange(info.from, info.to)
      } catch (err) {}
    }
    renderInputHl()
    try {
      inTa.focus()
    } catch (err) {}
    syncGutterScroll()
  })

  inTa.addEventListener('input', function () {
    if (!inputBrkMarks.length) return
    inputBrkMarks = []
    if (find.open && find.q) renderInputHl()
  })

  // 在输入区重新点击/移动光标时收起括号高亮
  inTa.addEventListener('mousedown', function () {
    if (!inputBrkMarks.length) return
    inputBrkMarks = []
    core.renderHl(inHl, inTa, null)
  })

  /* ---------------- 输入区行号 ---------------- */
  var gutterCount = -1

  function renderGutter() {
    if (!gutterInner) return
    var n = inTa.value.split('\n').length
    if (n !== gutterCount) {
      gutterCount = n
      var parts = []
      for (var i = 1; i <= n; i++) parts.push(i)
      gutterInner.textContent = parts.join('\n')
    }
    syncGutterScroll()
  }

  function syncGutterScroll() {
    if (!gutterInner) return
    gutterInner.style.transform = 'translateY(' + -inTa.scrollTop + 'px)'
  }

  inTa.addEventListener('scroll', syncGutterScroll)
  ;['input', 'keyup', 'compositionend', 'paste', 'cut'].forEach(function (ev) {
    inTa.addEventListener(ev, renderGutter)
  })

  /* ---------------- value 赋值嗅探：程序化写入也能即时刷新 ---------------- */
  function watchValue(el, onChange) {
    try {
      var proto = Object.getPrototypeOf(el)
      var desc = Object.getOwnPropertyDescriptor(proto, 'value')
      if (!desc || !desc.get || !desc.set) return
      Object.defineProperty(el, 'value', {
        configurable: true,
        get: function () {
          return desc.get.call(this)
        },
        set: function (v) {
          desc.set.call(this, v)
          try {
            onChange()
          } catch (err) {}
        }
      })
    } catch (e) {}
  }

  watchValue(inTa, function () {
    renderGutter()
    if (find.open) refreshFind(false)
  })
  var outFindTimer = null

  watchValue(outTa, function () {
    render()
    // 结果重排后重新计算命中，避免替换后高亮停留在旧文本上
    if (find.open && find.q) {
      if (outFindTimer) clearTimeout(outFindTimer)
      outFindTimer = setTimeout(function () {
        outFindTimer = null
        refreshFind(true)
      }, 200)
    }
  })

  /* ---------------- 查找替换 ---------------- */
  var bar = $('findBar')
  var qInput = $('findQuery')
  var countEl = $('findCount')
  var replaceInput = $('findReplaceText')
  var caseBox = $('findCase')
  var rxBtn = $('findRegex')

  function regexOn() {
    return !!(rxBtn && rxBtn.classList.contains('is-on'))
  }

  function totalMatches() {
    return find.open && find.q ? find.inMatches.length : 0
  }

  function updateCount() {
    if (!countEl) return
    if (find.open && find.q && find.rx && compileRe(find.q, find.cs) === false) {
      countEl.textContent = '正则无效'
      return
    }
    var n = find.inMatches.length
    countEl.textContent = n ? find.cur + 1 + ' / ' + n : '0 / 0'
  }

  function renderInputHl() {
    if (!inHl || !inTa) return
    var ranges = find.open && find.q ? find.inMatches : null
    var cur = find.cur >= 0 && find.cur < find.inMatches.length ? find.inMatches[find.cur] : null
    core.renderHl(inHl, inTa, inputBrkMarks.length ? inputBrkMarks : null, ranges, cur)
  }

  function refreshFind(keepCur) {
    find.q = qInput ? qInput.value : ''
    find.cs = caseBox ? !!caseBox.checked : false
    find.rx = regexOn()
    find.inMatches = matchesOf(inTa.value, find.q, find.cs, find.rx)
    find.outMatches = matchesOf(outTa.value, find.q, find.cs, find.rx)
    var total = find.inMatches.length
    if (!total) find.cur = -1
    else if (!keepCur || find.cur < 0 || find.cur >= total) find.cur = 0
    renderInputHl()
    render()
    updateCount()
  }

  function lineOfIndex(text, idx) {
    var n = 0
    for (var i = 0; i < idx && i < text.length; i++) if (text.charCodeAt(i) === 10) n++
    return n
  }

  function gotoMatch(i, scroll) {
    var matches = find.inMatches
    if (!matches.length) {
      updateCount()
      renderInputHl()
      render()
      return
    }
    if (i < 0) i = matches.length - 1
    if (i >= matches.length) i = 0
    find.cur = i
    var m = matches[i]

    // 原始 SQL：移动光标 + 滚动到命中行
    try {
      inTa.setSelectionRange(m.start, m.end)
    } catch (e) {}
    var lh = parseFloat(getComputedStyle(inTa).lineHeight) || 19
    var line = lineOfIndex(inTa.value, m.start)
    var visible = Math.max(1, Math.floor(inTa.clientHeight / lh))
    inTa.scrollTop = Math.max(0, (line - Math.floor(visible / 2)) * lh)
    syncGutterScroll()

    // 格式化结果：先展开包含命中的折叠块，再滚动到对应行
    if (scroll !== false) {
      var outIdx = -1
      var targetText = m
      // 两栏同序常一致；若格式化改写了内容，用首个输出命中兜底
      var oi = find.outMatches.length ? 0 : -1
      for (var k = 0; k < find.outMatches.length; k++) {
        var om = find.outMatches[k]
        if (om.start >= m.start) {
          oi = k
          break
        }
      }
      if (oi >= 0) outIdx = lineOfIndex(outTa.value, find.outMatches[oi].start)
      if (outIdx >= 0) {
        var changed = false
        for (var f = 0; f < model.folds.length; f++) {
          var fold = model.folds[f]
          if (folded.has(fold.start) && outIdx > fold.start && outIdx <= fold.end) {
            folded.delete(fold.start)
            changed = true
          }
        }
        if (changed) render()
        var row = view.querySelector('.cv-row[data-line="' + outIdx + '"]')
        if (row) {
          var lh2 = parseFloat(getComputedStyle(view).lineHeight) || 19
          var rowTop = row.offsetTop
          view.scrollTop = Math.max(0, rowTop - Math.floor(view.clientHeight / 2) + lh2)
        }
      }
    }
    renderInputHl()
    render()
    updateCount()
  }

  function openFind() {
    if (!bar) return
    bar.hidden = false
    var wsEl = document.querySelector('.workspace')
    if (wsEl) wsEl.classList.add('find-open')
    find.open = true
    var sel = ''
    try {
      if (document.activeElement === inTa)
        sel = inTa.value.slice(inTa.selectionStart, inTa.selectionEnd)
    } catch (e) {}
    if (sel && sel.indexOf('\n') === -1 && sel.length < 80 && qInput) qInput.value = sel
    if (qInput) {
      qInput.focus()
      qInput.select()
    }
    refreshFind(false)
    if (find.q) gotoMatch(0)
  }

  function closeFind() {
    if (!bar) return
    bar.hidden = true
    var wsEl = document.querySelector('.workspace')
    if (wsEl) wsEl.classList.remove('find-open')
    find.open = false
    find.q = ''
    find.inMatches = []
    find.outMatches = []
    find.cur = -1
    renderInputHl()
    render()
    updateCount()
  }

  function replaceAll() {
    var q = qInput ? qInput.value : ''
    if (!q) return
    var to = replaceInput ? replaceInput.value : ''
    var text = inTa.value
    var matches = matchesOf(text, q, find.cs, find.rx)
    if (!matches.length) return
    var out
    var re = find.rx ? compileRe(q, find.cs) : null
    if (re) {
      re.lastIndex = 0
      out = text.replace(re, to)
    } else {
      out = ''
      var last = 0
      for (var i = 0; i < matches.length; i++) {
        out += text.slice(last, matches[i].start) + to
        last = matches[i].end
      }
      out += text.slice(last)
    }
    inTa.value = out
    renderGutter()
    reformat()
    refreshFind(false)
    if (find.inMatches.length) gotoMatch(0)
    if (core.setStatus) core.setStatus($('statusText'), '已替换 ' + matches.length + ' 处', true)
  }

  function replaceOne() {
    if (!find.inMatches.length || find.cur < 0) return
    var m = find.inMatches[find.cur]
    var to = replaceInput ? replaceInput.value : ''
    var text = inTa.value
    var repl = to
    if (find.rx) {
      var re = compileRe(qInput ? qInput.value : '', find.cs)
      if (re) repl = expandReplacement(re, text, m.start, to)
    }
    inTa.value = text.slice(0, m.start) + repl + text.slice(m.end)
    renderGutter()
    reformat()
    refreshFind(true)
    if (find.cur >= find.inMatches.length) find.cur = find.inMatches.length - 1
    if (find.inMatches.length) gotoMatch(Math.max(0, find.cur))
    if (core.setStatus) core.setStatus($('statusText'), '已替换 1 处', true)
  }

  function reformat() {
    var btn = $('formatButton')
    if (btn) {
      btn.click()
      return
    }
    if (core.refreshMainResult) core.refreshMainResult()
  }

  var findButton = $('findButton')
  if (findButton) findButton.addEventListener('click', openFind)
  if ($('findClose')) $('findClose').addEventListener('click', closeFind)
  if ($('findNext')) {
    $('findNext').addEventListener('click', function () {
      refreshFind(true)
      gotoMatch(find.cur + 1)
    })
  }
  if ($('findPrev')) {
    $('findPrev').addEventListener('click', function () {
      refreshFind(true)
      gotoMatch(find.cur - 1)
    })
  }
  if ($('findReplaceOne')) $('findReplaceOne').addEventListener('click', replaceOne)
  if ($('findReplaceAll')) $('findReplaceAll').addEventListener('click', replaceAll)
  if (caseBox) {
    caseBox.addEventListener('change', function () {
      refreshFind(false)
      if (find.inMatches.length) gotoMatch(0)
    })
  }
  if (rxBtn) {
    rxBtn.addEventListener('click', function () {
      var on = !rxBtn.classList.contains('is-on')
      rxBtn.classList.toggle('is-on', on)
      rxBtn.setAttribute('aria-pressed', on ? 'true' : 'false')
      if (replaceInput) {
        replaceInput.placeholder = on ? '替换为（支持 $1）' : '替换为'
      }
      refreshFind(false)
      if (find.inMatches.length) gotoMatch(0)
    })
  }
  if (qInput) {
    var qTimer = null
    qInput.addEventListener('input', function () {
      if (qTimer) clearTimeout(qTimer)
      qTimer = setTimeout(function () {
        qTimer = null
        refreshFind(false)
        if (find.inMatches.length) gotoMatch(0, false)
      }, 120)
    })
    qInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault()
        refreshFind(true)
        gotoMatch(e.shiftKey ? find.cur - 1 : find.cur + 1)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        closeFind()
      }
    })
  }
  if (replaceInput) {
    replaceInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault()
        if (e.ctrlKey || e.metaKey) replaceAll()
        else replaceOne()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        closeFind()
      }
    })
  }

  document.addEventListener('keydown', function (e) {
    var key = e.key
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (key === 'f' || key === 'F')) {
      e.preventDefault()
      openFind()
    } else if (key === 'Escape' && find.open) {
      closeFind()
    }
  })

  /* ---------------- 对外接口（规则勾选 / 页面重绘调用） ---------------- */
  window.__sfView = {
    render: function () {
      render()
      renderGutter()
      if (find.open) renderInputHl()
      return true
    },
    renderInput: function () {
      if (find.open && find.q) renderInputHl()
      else if (inHl && inTa) core.renderHl(inHl, inTa, inputBrkMarks.length ? inputBrkMarks : null)
      return true
    },
    setAutoFold: function (v) {
      foldAuto = !!v
      try {
        localStorage.setItem(STORE_AUTOFOLD, foldAuto ? '1' : '0')
      } catch (e) {}
      if (foldAuto) {
        if (outTa.value !== modelText) {
          model = buildModel(outTa.value)
          modelText = outTa.value
        }
        foldAll()
      } else {
        folded.clear()
      }
      render()
      if (core.setStatus) {
        core.setStatus(
          $('statusText'),
          foldAuto ? '结果区已自动折叠代码' : '结果区已展开代码',
          true
        )
      }
    },
    isAutoFold: function () {
      return foldAuto
    },
    setFindQuery: function (q) {
      if (qInput) qInput.value = q || ''
      openFind()
    }
  }

  /* ---------------- 初始化 ---------------- */
  function refreshRuleCount() {
    var el = document.getElementById('ruleCheckedCount')
    if (!el) return
    var boxes = document.querySelectorAll('#ruleCheckboxes input[data-cfg]')
    var n = 0
    for (var i = 0; i < boxes.length; i++) if (boxes[i].checked) n++
    el.textContent = n + ' / ' + boxes.length
  }

  var foldBox = document.querySelector('#ruleCheckboxes input[data-cfg="ishowPseudoCodeWanted"]')
  if (foldBox) foldBox.checked = foldAuto

  renderGutter()
  render()
  if (foldBox) refreshRuleCount()

  // 兜底：值被绕过 setter 写入时也能同步（低频，仅比较字符串）
  var lastIn = inTa.value
  setInterval(function () {
    if (inTa.value !== lastIn) {
      lastIn = inTa.value
      renderGutter()
    }
  }, 500)
})()
