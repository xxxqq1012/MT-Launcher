/* global utools */
// preload.js - uTools API 桥接层（CommonJS，不压缩）
// 挂载到 window.mindnote，供 Vue 应用调用

/** preload 版本标识：用于确认 uTools 是否加载了最新的 preload.js */
var PRELOAD_VERSION = 'file-store-v4'

console.log('[MindNote] preload.js 开始执行... 版本:', PRELOAD_VERSION)

// 检查 uTools 环境是否可用
if (typeof utools === 'undefined') {
  console.error('[MindNote] utools 对象不可用，preload.js 可能在错误的上下文中执行')
} else {
  console.log('[MindNote] utools 对象可用')
}

// 安全的 require 包装
function safeRequire(moduleName) {
  try {
    if (typeof require === 'undefined') {
      console.error('[MindNote] require 不可用，无法加载模块:', moduleName)
      return null
    }
    return require(moduleName)
  } catch (e) {
    console.error('[MindNote] 加载模块失败:', moduleName, e)
    return null
  }
}

// 文件版存储：utools.dbStorage 是只读 getter，赋值无效（覆盖不生效，仍走主进程同步 IPC），故改用独立对象
var USE_DB = true
var mfStorage = (function () {
  var fs = safeRequire('fs'),
    os = safeRequire('os'),
    path = safeRequire('path')
  var realDb = typeof utools !== 'undefined' && utools.dbStorage ? utools.dbStorage : null
  var realGet = realDb ? realDb.getItem.bind(realDb) : null
  if (!fs || !os || !path) {
    console.error('[MindNote] fs/os/path 不可用，回落 uTools dbStorage')
    return (
      realDb || {
        getItem: function () {
          return null
        },
        setItem: function () {},
        removeItem: function () {}
      }
    )
  }
  var dir = path.join(os.homedir(), '.mindnote-data')
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch (e) {
    /* 已存在 */
  }
  var flag = path.join(dir, '.migrated')
  var fileName = function (key) {
    return path.join(dir, String(key).replace(/[^a-zA-Z0-9_\-]/g, '_') + '.json')
  }
  if (USE_DB && realDb) {
    var backFlag = path.join(dir, '.db-back-migrated')
    if (!fs.existsSync(backFlag)) {
      try {
        var copied = 0
        var read = function (k) {
          try {
            return JSON.parse(fs.readFileSync(fileName(k), 'utf-8'))
          } catch (e) {
            return null
          }
        }
        ;(read('mindnote_note_list') || []).forEach(function (n) {
          var v = read('mindnote_note_' + n.id)
          if (v != null) {
            realDb.setItem('mindnote_note_' + n.id, v)
            copied++
          }
        })
        ;(read('mindnote_asset_index') || []).forEach(function (a) {
          var v = read('mindnote_asset_' + a.id)
          if (v != null) {
            realDb.setItem('mindnote_asset_' + a.id, v)
            copied++
          }
        })
        ;[
          'mindnote_note_list',
          'mindnote_folder_list',
          'mindnote_settings',
          'mindnote_asset_index'
        ].forEach(function (k) {
          var v = read(k)
          if (v != null) {
            realDb.setItem(k, v)
            copied++
          }
        })
        fs.writeFileSync(backFlag, 'ok')
        console.log('[MindNote] 数据迁回 db:', copied, '条')
      } catch (e) {
        console.error('[MindNote] 迁回 db 失败:', e)
      }
    }
    return {
      getItem: function (k) {
        return realDb.getItem(k)
      },
      setItem: function (k, v) {
        realDb.setItem(k, JSON.parse(JSON.stringify(v)))
      },
      removeItem: function (k) {
        realDb.removeItem(k)
      }
    }
  }
  var storage = {
    getItem: function (key) {
      try {
        return JSON.parse(fs.readFileSync(fileName(key), 'utf-8'))
      } catch (e) {
        return null
      }
    },
    setItem: function (key, val) {
      try {
        var f = fileName(key),
          t = f + '.tmp'
        fs.writeFileSync(t, JSON.stringify(val), 'utf-8')
        fs.renameSync(t, f)
      } catch (e) {
        console.error('[MindNote] setItem 失败:', key, e)
      }
    },
    removeItem: function (key) {
      try {
        fs.unlinkSync(fileName(key))
      } catch (e) {
        /* 不存在 */
      }
    }
  }
  console.log('[MindNote] 文件版存储就绪（目录: ' + dir + '）')
  // 一次性迁移：从 uTools db 拷贝 mindnote_* 旧数据（仅在从未迁移过时执行）
  try {
    if (realGet && !fs.existsSync(flag)) {
      var copied = 0
      var noteList = realGet('mindnote_note_list') || []
      noteList.forEach(function (n) {
        var v = realGet('mindnote_note_' + n.id)
        if (v != null) {
          storage.setItem('mindnote_note_' + n.id, v)
          copied++
        }
      })
      var assetIndex = realGet('mindnote_asset_index') || []
      assetIndex.forEach(function (a) {
        var v = realGet('mindnote_asset_' + a.id)
        if (v != null) {
          storage.setItem('mindnote_asset_' + a.id, v)
          copied++
        }
      })
      ;[
        'mindnote_note_list',
        'mindnote_folder_list',
        'mindnote_settings',
        'mindnote_asset_index'
      ].forEach(function (k) {
        var v = realGet(k)
        if (v != null) {
          storage.setItem(k, v)
          copied++
        }
      })
      fs.writeFileSync(flag, 'ok')
      console.log('[MindNote] 旧数据迁移完成:', copied, '条')
    }
  } catch (e) {
    console.error('[MindNote] 旧数据迁移失败:', e)
  }
  return storage
})()

/**
 * 稳健写入文件：目标被占用 / 只读时先尝试覆盖，仍失败则自动改用不冲突的文件名。
 * 返回实际写入的路径。
 */
function writeFileWithFallback(targetPath, data) {
  var fs = safeRequire('fs')
  if (!fs) throw new Error('无法加载 fs 模块')

  try {
    fs.writeFileSync(targetPath, data)
    return targetPath
  } catch (firstErr) {
    console.warn('[MindNote] 直接写入失败:', firstErr && firstErr.message)
  }

  try {
    if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath)
    fs.writeFileSync(targetPath, data)
    return targetPath
  } catch (secondErr) {
    console.warn('[MindNote] 覆盖写入失败，改用新文件名:', secondErr && secondErr.message)
  }

  var dot = targetPath.lastIndexOf('.')
  var base = dot > 0 ? targetPath.slice(0, dot) : targetPath
  var ext = dot > 0 ? targetPath.slice(dot) : ''
  for (var i = 1; i < 100; i++) {
    var candidate = base + ' (' + i + ')' + ext
    try {
      fs.writeFileSync(candidate, data)
      return candidate
    } catch (e) {
      /* 继续尝试下一个文件名 */
    }
  }
  throw new Error('无法写入文件：' + targetPath)
}

/** PNG 导出时的截图宽度（CSS px） */
var PNG_CAPTURE_WIDTH = 1200

/** Chromium 单张渲染表面的边长上限（物理像素），超过则纹理创建失败 */
var PNG_MAX_SURFACE_SIDE = 16000

/** 原生截图的像素总量上限（物理像素） */
var PNG_MAX_CAPTURE_PIXELS = 60000000

/** 打印页就绪判定：DOM、字体、图片都完成，避免截到未排版的内容 */
function isPrintPageReady() {
  if (document.readyState === 'loading') return false
  if (document.fonts && document.fonts.status !== 'loaded') return false
  var imgs = document.images
  for (var i = 0; i < imgs.length; i++) {
    if (!imgs[i].complete) return false
  }
  return true
}

/** 读取 PNG 尺寸（IHDR 位于固定偏移，无需解码整张图） */
function readPngSize(filePath) {
  var fs = safeRequire('fs')
  if (!fs) return null
  try {
    var fd = fs.openSync(filePath, 'r')
    var head = Buffer.alloc(24)
    fs.readSync(fd, head, 0, 24, 0)
    fs.closeSync(fd)
    if (head.readUInt32BE(0) !== 0x89504e47) return null
    return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) }
  } catch (e) {
    return null
  }
}

/**
 * uTools 会把 evaluate 的结果包成数组（有时多层）交给 run()，这里统一解包。
 */
function unwrapEvaluateResult(result) {
  var value = result
  while (Array.isArray(value) && value.length) value = value[0]
  return value
}

/**
 * 从 run() 的返回值里定位测量对象。
 * 容忍 uTools 对 evaluate 结果的各种包裹形式（数组、对象再套数组等）。
 */
function extractMeasured(result) {
  var stack = [result]
  var guard = 0
  while (stack.length && guard < 20) {
    guard++
    var current = stack.shift()
    if (!current || typeof current !== 'object') continue
    if (!Array.isArray(current) && typeof current.height === 'number') return current
    for (var key in current) {
      if (Object.prototype.hasOwnProperty.call(current, key)) stack.push(current[key])
    }
  }
  return null
}

/**
 * 测量打印文档的完整高度，返回 Promise<{width,height,dpr} | null>。
 * 注意：evaluate 必须是 run 之前的最后一步，否则 run() 不会把测量结果回传。
 */
function measurePrintDocument(fileUrl) {
  return utools.ubrowser
    .goto(fileUrl)
    .wait(isPrintPageReady, 20000)
    .evaluate(function () {
      return {
        width: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth),
        height: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
        dpr: window.devicePixelRatio || 1
      }
    })
    .run({ show: false, width: PNG_CAPTURE_WIDTH, height: 900 })
    .then(function (result) {
      var measured = extractMeasured(result)
      console.log(
        '[MindNote] 文档测量结果:',
        measured,
        '原始返回:',
        JSON.stringify(result).slice(0, 200)
      )
      return measured
    })
    .catch(function (err) {
      console.warn('[MindNote] 测量文档高度失败:', err && err.message)
      return null
    })
}

/**
 * 用 ubrowser 原生截图导出 PNG，返回 Promise<boolean>。
 *
 * ubrowser.screenshot 只截取视窗内的内容，因此这里先用测量结果把视窗撑到
 * 文档完整高度，再截图，避免「只截一屏、后面的内容消失」。
 * 截图由 Chromium 自己渲染，字体/表格/高亮与预览一致，且 PNG 由浏览器直接写盘，
 * 不需要把整张图的 base64 经自动化通道回传（大图回传会被截断）。
 */
function capturePngByNativeScreenshot(fileUrl, savePath, measured) {
  var cssHeight = Math.ceil(measured.height)
  var dpr = measured.dpr || 1
  var physicalHeight = Math.round(cssHeight * dpr)

  if (physicalHeight > PNG_MAX_SURFACE_SIDE) {
    console.warn(
      '[MindNote] 文档过高（' +
        cssHeight +
        'px × ' +
        dpr +
        ' = ' +
        physicalHeight +
        'px），跳过原生截图'
    )
    return Promise.resolve(false)
  }
  if (PNG_CAPTURE_WIDTH * dpr * physicalHeight > PNG_MAX_CAPTURE_PIXELS) {
    console.warn('[MindNote] 截图像素过多，跳过原生截图')
    return Promise.resolve(false)
  }

  return utools.ubrowser
    .viewport(PNG_CAPTURE_WIDTH, cssHeight)
    .goto(fileUrl)
    .wait(isPrintPageReady, 20000)
    .screenshot('body', savePath)
    .run({ show: false, width: PNG_CAPTURE_WIDTH, height: cssHeight })
    .then(function () {
      var size = readPngSize(savePath)
      console.log('[MindNote] 原生截图尺寸:', size, '期望高度:', physicalHeight)
      if (!size || !size.height) return false
      // 实际高度与文档高度明显不符（被视窗裁剪或留白过多）时判定失败
      return Math.abs(size.height - physicalHeight) <= Math.max(16, physicalHeight * 0.03)
    })
    .catch(function (err) {
      console.warn('[MindNote] 原生截图失败:', err && err.message)
      return false
    })
}

/** html2canvas 兜底方案：注入 CDN 脚本后在页面内渲染并回传 base64 */
function capturePngByHtml2Canvas(html, savePath, fs, tmpPath, cleanupTmp) {
  var htmlWithCanvas = html.replace(
    '</head>',
    '<script src="https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js"></script></head>'
  )

  try {
    fs.writeFileSync(tmpPath, htmlWithCanvas, 'utf-8')
  } catch (e) {
    console.error('[MindNote] 写入临时文件失败:', e)
    cleanupTmp()
    return Promise.resolve({ ok: false, reason: 'error' })
  }

  var fileUrl = safeRequire('url').pathToFileURL(tmpPath).href

  return utools.ubrowser
    .goto(fileUrl)
    .wait(function () {
      // 等待页面和 html2canvas 加载完成
      if (document.readyState === 'loading') return false
      if (typeof html2canvas === 'undefined') return false
      if (document.fonts && document.fonts.status !== 'loaded') return false
      var imgs = document.images
      for (var i = 0; i < imgs.length; i++) {
        if (!imgs[i].complete) return false
      }
      return true
    }, 30000)
    .evaluate(function () {
      // 使用 html2canvas 截图并返回 base64
      return html2canvas(document.body, {
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        scale: 2
      })
        .then(function (canvas) {
          return canvas.toDataURL('image/png')
        })
        .catch(function (err) {
          console.error('html2canvas 错误:', err)
          return null
        })
    })
    .run({ show: false, width: PNG_CAPTURE_WIDTH, height: 900 })
    .then(function (result) {
      var base64Data = unwrapEvaluateResult(result)
      console.log(
        '[MindNote] 收到截图数据:',
        base64Data ? '成功' : '失败',
        '类型:',
        typeof base64Data
      )

      if (!base64Data) {
        cleanupTmp()
        return { ok: false, reason: 'error' }
      }

      var base64String = String(base64Data)
      if (
        base64String === 'null' ||
        base64String === 'undefined' ||
        base64String === '[object Object]'
      ) {
        console.error('[MindNote] 截图数据无效')
        cleanupTmp()
        return { ok: false, reason: 'error' }
      }

      var base64 = base64String.replace(/^data:image\/png;base64,/, '')
      var buffer = Buffer.from(base64, 'base64')
      var finalPath
      try {
        finalPath = writeFileWithFallback(savePath, buffer)
      } catch (writeErr) {
        console.error('[MindNote] PNG 写入失败:', writeErr)
        cleanupTmp()
        return {
          ok: false,
          reason: 'error',
          message: String((writeErr && writeErr.message) || writeErr)
        }
      }

      console.log('[MindNote] PNG 文件已保存:', finalPath)
      cleanupTmp()
      return { ok: true, path: finalPath }
    })
    .catch(function (err) {
      console.error('[MindNote] PNG 导出失败:', err)
      cleanupTmp()
      return { ok: false, reason: 'error' }
    })
}

window.mindnote = {
  // ---- 笔记存储 ----
  getNoteList: function () {
    return mfStorage.getItem('mindnote_note_list') || []
  },

  saveNoteList: function (list) {
    mfStorage.setItem('mindnote_note_list', list)
  },

  getNote: function (id) {
    return mfStorage.getItem('mindnote_note_' + id) || null
  },

  saveNote: function (id, data) {
    mfStorage.setItem('mindnote_note_' + id, data)
  },

  removeNote: function (id) {
    mfStorage.removeItem('mindnote_note_' + id)
  },

  // ---- 文件夹存储 ----
  getFolderList: function () {
    return mfStorage.getItem('mindnote_folder_list') || []
  },

  saveFolderList: function (list) {
    mfStorage.setItem('mindnote_folder_list', list)
  },

  // ---- 设置 ----
  getSettings: function () {
    return mfStorage.getItem('mindnote_settings') || { theme: 'light', fontSize: 14 }
  },

  saveSettings: function (settings) {
    mfStorage.setItem('mindnote_settings', settings)
  },

  // ---- 系统能力 ----
  showNotification: function (msg) {
    console.log('[MindNote] notification:', msg)
  },

  // 在系统默认浏览器打开链接（插件窗口内 target=_blank 点击不会跳转）
  openExternal: function (url) {
    try {
      utools.shellOpenExternal(url)
      return true
    } catch (e) {
      console.error('[MindNote] shellOpenExternal 失败:', url, e)
      return false
    }
  },

  // 导出 .md 文件到本地
  saveMarkdownFile: function (filename, content) {
    var path = utools.showSaveDialog({
      title: '导出 Markdown 文件',
      defaultPath: filename,
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    })
    if (path) {
      try {
        writeFileWithFallback(path, content)
      } catch (e) {
        console.error('[MindNote] Markdown/HTML 写入失败:', e)
        return false
      }
      return true
    }
    return false
  },

  // 读取本地 .md 文件（导入）：返回 { content, filename }，标题取文件名
  openMarkdownFile: function () {
    var paths = utools.showOpenDialog({
      title: '导入 Markdown 文件',
      filters: [{ name: 'Markdown', extensions: ['md'] }],
      properties: ['openFile']
    })
    if (paths && paths.length > 0) {
      var fullPath = String(paths[0])
      var base = fullPath.slice(Math.max(fullPath.lastIndexOf('/'), fullPath.lastIndexOf('\\')) + 1)
      return {
        content: safeRequire('fs').readFileSync(fullPath, 'utf-8'),
        filename: base.replace(/\.[^.]+$/, '')
      }
    }
    return null
  },

  // 选择文件夹并扫描 Markdown 文件（导入文件夹，异步分批避免阻塞 UI）
  openMarkdownFolder: function () {
    var paths = utools.showOpenDialog({
      title: '导入文件夹',
      properties: ['openDirectory']
    })
    if (!paths || !paths.length) return Promise.resolve(null)
    return scanMarkdownFolderAsync(paths[0])
  },

  /**
   * 导出 PDF（Typora 路线：完整 HTML + ubrowser Chromium printToPDF）
   * options: { pageSize, margin, printBackground }
   * 返回 Promise<{ ok: true } | { ok: false, reason: 'cancel' | 'error' }>
   */
  savePdfFromHtml: function (filename, html, options) {
    var savePath = utools.showSaveDialog({
      title: '导出 PDF',
      defaultPath: filename.replace(/\.md$/, '.pdf'),
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (!savePath) return Promise.resolve({ ok: false, reason: 'cancel' })

    var opts = options || {}
    var pageSize = opts.pageSize || 'A4'
    var printBackground = opts.printBackground !== false

    var fs = safeRequire('fs')
    var os = safeRequire('os')
    var path = safeRequire('path')
    var pathToFileURL = safeRequire('url').pathToFileURL
    var tmpPath = path.join(os.tmpdir(), 'mindnote-print-' + Date.now() + '.html')

    function cleanupTmp() {
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath)
      } catch (e) {
        /* ignore */
      }
    }

    try {
      fs.writeFileSync(tmpPath, html, 'utf-8')
      var fileUrl = pathToFileURL(tmpPath).href

      if (!utools.ubrowser || typeof utools.ubrowser.goto !== 'function') {
        cleanupTmp()
        console.error('[MindNote] utools.ubrowser 不可用')
        return Promise.resolve({ ok: false, reason: 'error' })
      }

      return utools.ubrowser
        .goto(fileUrl)
        .wait(function () {
          // 等待 DOM 解析完成，避免 document.images 为空导致图片未被捕获
          if (document.readyState === 'loading') return false
          var imgs = document.images
          for (var i = 0; i < imgs.length; i++) {
            if (!imgs[i].complete) return false
          }
          return true
        }, 20000)
        .pdf(
          {
            printBackground: printBackground,
            pageSize: pageSize
          },
          savePath
        )
        .run({ show: false, width: 1024, height: 768 })
        .then(function () {
          cleanupTmp()
          return { ok: true, path: savePath }
        })
        .catch(function (err) {
          cleanupTmp()
          console.error('[MindNote] PDF 导出失败:', err)
          return { ok: false, reason: 'error' }
        })
    } catch (err) {
      cleanupTmp()
      console.error('[MindNote] PDF 导出初始化失败:', err)
      return Promise.resolve({ ok: false, reason: 'error' })
    }
  },

  /**
   * PNG 导出。
   *
   * 优先走 ubrowser 原生截图：由 Chromium 自己渲染，字体/表格/高亮与预览完全一致，
   * 且 PNG 由浏览器直接写盘，不需要把整张图的 base64 经自动化通道回传
   * （大图回传会被截断，表现为导出图片尾部内容缺失）。
   * 原生截图高度不完整或失败时，自动回退到 html2canvas 方案。
   */
  savePngFromHtml: function (filename, html) {
    console.log('[MindNote] savePngFromHtml 开始执行:', filename)

    var savePath = utools.showSaveDialog({
      title: '导出 PNG',
      defaultPath: filename,
      filters: [{ name: 'PNG Image', extensions: ['png'] }]
    })

    if (!savePath) {
      console.log('[MindNote] 用户取消了 PNG 保存')
      return Promise.resolve({ ok: false, reason: 'cancel' })
    }

    console.log('[MindNote] PNG 保存路径:', savePath)

    var fs = safeRequire('fs')
    var os = safeRequire('os')
    var path = safeRequire('path')
    var urlModule = safeRequire('url')

    if (!fs || !os || !path || !urlModule) {
      console.error('[MindNote] 无法加载必需的 Node.js 模块')
      return Promise.resolve({ ok: false, reason: 'error' })
    }

    var pathToFileURL = urlModule.pathToFileURL
    var tmpPath = path.join(os.tmpdir(), 'mindnote-png-' + Date.now() + '.html')

    function cleanupTmp() {
      try {
        if (fs.existsSync(tmpPath)) {
          fs.unlinkSync(tmpPath)
          console.log('[MindNote] 清理临时文件:', tmpPath)
        }
      } catch (e) {
        console.warn('[MindNote] 清理临时文件失败:', e)
      }
    }

    try {
      fs.writeFileSync(tmpPath, html, 'utf-8')

      if (!utools.ubrowser || typeof utools.ubrowser.goto !== 'function') {
        console.error('[MindNote] utools.ubrowser 不可用')
        cleanupTmp()
        return Promise.resolve({ ok: false, reason: 'error' })
      }

      var fileUrl = pathToFileURL(tmpPath).href

      return measurePrintDocument(fileUrl)
        .then(function (measured) {
          if (!measured) {
            console.warn('[MindNote] 无法测量文档高度，直接回退 html2canvas')
            return false
          }
          return capturePngByNativeScreenshot(fileUrl, savePath, measured)
        })
        .then(function (captured) {
          if (captured) {
            console.log('[MindNote] PNG 已保存（原生截图）:', savePath)
            cleanupTmp()
            return { ok: true, path: savePath }
          }
          console.warn('[MindNote] 原生截图不可用，回退 html2canvas')
          return capturePngByHtml2Canvas(html, savePath, fs, tmpPath, cleanupTmp)
        })
        .catch(function (err) {
          console.error('[MindNote] PNG 导出失败:', err)
          cleanupTmp()
          return { ok: false, reason: 'error' }
        })
    } catch (err) {
      console.error('[MindNote] PNG 初始化失败:', err)
      cleanupTmp()
      return Promise.resolve({ ok: false, reason: 'error' })
    }
  },

  // 获取 uTools 主题（dark/light）
  isDarkTheme: function () {
    return utools.isDarkColors()
  },

  // 隐藏 uTools 主窗口
  hideMainWindow: function () {
    utools.hideMainWindow()
  },

  // 获取当前窗口类型：'main' 主窗口 / 'detach' 分离窗口 / 'browser' 独立窗口
  getWindowType: function () {
    try {
      return utools.getWindowType()
    } catch (e) {
      return null
    }
  },

  // 设置子输入框（uTools 顶部搜索条变为插件搜索框），onChange 收到输入文本
  setSubInput: function (onChange, placeholder, isFocus) {
    try {
      return utools.setSubInput(
        function (details) {
          onChange((details && details.text) || '')
        },
        placeholder,
        isFocus
      )
    } catch (e) {
      console.error('[MindNote] setSubInput 失败:', e)
      return false
    }
  },

  // 移除子输入框
  removeSubInput: function () {
    try {
      utools.removeSubInput()
    } catch (e) {
      /* ignore */
    }
  },

  // 设置子输入框文本
  setSubInputValue: function (text) {
    try {
      utools.setSubInputValue(text)
    } catch (e) {
      /* ignore */
    }
  },

  // 聚焦子输入框
  subInputFocus: function () {
    try {
      utools.subInputFocus()
    } catch (e) {
      /* ignore */
    }
  },

  // 插件进入回调（每次进入插件应用时触发）
  onPluginEnter: function (callback) {
    try {
      utools.onPluginEnter(function () {
        callback()
      })
      return true
    } catch (e) {
      console.error('[MindNote] onPluginEnter 注册失败:', e)
      return false
    }
  },

  // 复制文本到剪贴板（uTools 原生 API，比 Clipboard API 更可靠）
  copyText: function (text) {
    try {
      utools.copyText(text)
      return true
    } catch (e) {
      console.error('[MindNote] utools.copyText 失败:', e)
      return false
    }
  },

  // ---- 图片资源存储 ----
  getAssetIndex: function () {
    return mfStorage.getItem('mindnote_asset_index') || []
  },

  saveAssetIndex: function (index) {
    mfStorage.setItem('mindnote_asset_index', index)
  },

  getAsset: function (id) {
    return mfStorage.getItem('mindnote_asset_' + id) || null
  },

  saveAsset: function (id, record) {
    mfStorage.setItem('mindnote_asset_' + id, record)
  },

  removeAsset: function (id) {
    mfStorage.removeItem('mindnote_asset_' + id)
  },

  saveBackupFile: function (jsonString, defaultName) {
    var path = utools.showSaveDialog({
      title: '导出 随心记 Markdown 备份',
      defaultPath: defaultName,
      filters: [{ name: '随心记 Markdown Backup', extensions: ['json'] }]
    })
    if (!path) return { ok: false, reason: 'cancel' }
    try {
      safeRequire('fs').writeFileSync(path, jsonString, 'utf-8')
      return { ok: true, path: path }
    } catch (e) {
      return { ok: false, reason: 'error' }
    }
  },

  openBackupFile: function () {
    var paths = utools.showOpenDialog({
      title: '从备份恢复',
      filters: [{ name: '随心记 Markdown Backup', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (paths && paths.length > 0) {
      return safeRequire('fs').readFileSync(paths[0], 'utf-8')
    }
    return null
  },

  selectBackupDirectory: function () {
    var paths = utools.showOpenDialog({
      title: '选择自动备份目录',
      properties: ['openDirectory']
    })
    if (!paths || !paths.length) return null
    return paths[0]
  },

  writeBackupFileSilent: function (dirPath, filename, content) {
    try {
      var fs = safeRequire('fs')
      var path = safeRequire('path')
      if (!dirPath || !path.isAbsolute(dirPath)) {
        return { ok: false, reason: 'error' }
      }
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true })
      }
      var fullPath = path.join(dirPath, filename)
      fs.writeFileSync(fullPath, content, 'utf-8')
      return { ok: true, path: fullPath }
    } catch (e) {
      return { ok: false, reason: 'error' }
    }
  },

  cleanOldBackupFiles: function (dirPath, maxCopies) {
    try {
      var fs = safeRequire('fs')
      var path = safeRequire('path')
      if (!dirPath || !path.isAbsolute(dirPath)) {
        return { ok: false, reason: 'error' }
      }
      if (!fs.existsSync(dirPath)) return { ok: true, deleted: 0 }
      if (maxCopies <= 0) return { ok: true, deleted: 0 }
      var entries = fs
        .readdirSync(dirPath)
        .filter(function (f) {
          return /^mindnote-backup-\d{8}T\d{6}\.json$/.test(f)
        })
        .map(function (f) {
          var full = path.join(dirPath, f)
          return { full: full, mtime: fs.statSync(full).mtimeMs }
        })
        .sort(function (a, b) {
          return b.mtime - a.mtime
        })
      var toDelete = entries.slice(maxCopies)
      for (var i = 0; i < toDelete.length; i++) {
        fs.unlinkSync(toDelete[i].full)
      }
      return { ok: true, deleted: toDelete.length }
    } catch (e) {
      return { ok: false, reason: 'error' }
    }
  },

  getDefaultBackupDirectory: function () {
    try {
      var fs = safeRequire('fs')
      var path = safeRequire('path')
      var base = utools.getPath('appData')
      var dir = path.join(base, 'mindnote-backups')
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      return dir
    } catch (e) {
      return null
    }
  },

  getAutoBackupCapabilities: function () {
    return {
      version: 1,
      available:
        typeof this.selectBackupDirectory === 'function' &&
        typeof this.writeBackupFileSilent === 'function' &&
        typeof this.cleanOldBackupFiles === 'function' &&
        typeof this.getDefaultBackupDirectory === 'function',
      isDev: typeof utools.isDev === 'function' ? utools.isDev() : false
    }
  },

  openBackupDirectory: function (dirPath) {
    try {
      if (!dirPath) return false
      utools.shellOpenPath(dirPath)
      return true
    } catch (e) {
      return false
    }
  }
}

// ---- 文件夹导入扫描（异步分批，扩展名规则与 importFolderHelpers.ts 保持一致） ----
var SKIP_DIR_NAMES = {
  '.git': 1,
  node_modules: 1,
  '.svn': 1,
  __pycache__: 1,
  '.idea': 1,
  dist: 1,
  build: 1
}
// 文件夹导入只收 Markdown 文件，其余文件（代码 / 配置 / 独立图片等）一律忽略
var MARKDOWN_EXT = { md: 1, markdown: 1, mdown: 1, mkd: 1 }
var IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i
var REL_IMAGE_MD_RE = /!\[[^\]]*\]\((?!https?:|mindnote-asset:|data:)([^)\s]+)(?:\s+"[^"]*")?\)/g
var SCAN_MAX_DEPTH = 20
var SCAN_DIRS_PER_TICK = 12

function getFileExtension(name) {
  var dot = name.lastIndexOf('.')
  if (dot <= 0) return ''
  return name.slice(dot + 1).toLowerCase()
}

function isMarkdownFilename(name) {
  return !!MARKDOWN_EXT[getFileExtension(name)]
}

function shouldSkipImportDir(name) {
  if (SKIP_DIR_NAMES[name]) return true
  return name.charAt(0) === '.'
}

function collectImages(content, mdFullPath, fs, path) {
  var images = []
  var m
  REL_IMAGE_MD_RE.lastIndex = 0
  while ((m = REL_IMAGE_MD_RE.exec(content)) !== null) {
    var relImg = m[1].trim().replace(/^<|>$/g, '')
    var imgPath = path.resolve(path.dirname(mdFullPath), relImg)
    try {
      if (!fs.existsSync(imgPath) || !IMAGE_EXT_RE.test(imgPath)) continue
      var buf = fs.readFileSync(imgPath)
      var ext = path.extname(imgPath).slice(1).toLowerCase()
      var mime = ext === 'jpg' ? 'image/jpeg' : 'image/' + ext
      images.push({ relPath: relImg, base64: buf.toString('base64'), mime: mime })
    } catch (e) {
      /* skip unreadable image */
    }
  }
  return images
}

function scanMarkdownFolderAsync(rootPath) {
  var fs = safeRequire('fs')
  var path = safeRequire('path')
  var files = []
  var queue = [{ dir: rootPath, relBase: '', depth: 0 }]
  var visited = Object.create(null)
  var startTime = Date.now()
  var SCAN_TIMEOUT_MS = 60000
  var totalDirs = 0

  function resolveVisited(dir) {
    try {
      return fs.realpathSync.native ? fs.realpathSync.native(dir) : fs.realpathSync(dir)
    } catch (e) {
      return path.resolve(dir)
    }
  }

  return new Promise(function (resolve) {
    function processTick() {
      if (Date.now() - startTime > SCAN_TIMEOUT_MS) {
        console.warn(
          '[MindNote] scanMarkdownFolderAsync 超时，已扫描',
          totalDirs,
          '个目录，找到',
          files.length,
          '个文件'
        )
        resolve({ rootPath: rootPath, files: files })
        return
      }
      var batch = 0
      while (queue.length > 0 && batch < SCAN_DIRS_PER_TICK) {
        batch++
        var item = queue.shift()
        if (item.depth > SCAN_MAX_DEPTH) continue

        var absDir = path.resolve(item.dir)
        var visitKey = resolveVisited(absDir)
        if (visited[visitKey]) continue
        visited[visitKey] = true
        totalDirs++

        var entries
        try {
          entries = fs.readdirSync(absDir, { withFileTypes: true })
        } catch (e) {
          continue
        }

        for (var i = 0; i < entries.length; i++) {
          var entry = entries[i]
          if (entry.isDirectory()) {
            if (shouldSkipImportDir(entry.name)) continue
            var nextRel = item.relBase ? item.relBase + '/' + entry.name : entry.name
            queue.push({
              dir: path.join(absDir, entry.name),
              relBase: nextRel,
              depth: item.depth + 1
            })
          } else if (entry.isFile()) {
            var relPath = item.relBase ? item.relBase + '/' + entry.name : entry.name
            var fullPath = path.join(absDir, entry.name)
            relPath = relPath.replace(/\\/g, '/')

            if (isMarkdownFilename(entry.name)) {
              try {
                var content = fs.readFileSync(fullPath, 'utf-8')
                files.push({
                  relativePath: relPath,
                  content: content,
                  images: collectImages(content, fullPath, fs, path)
                })
              } catch (e) {
                /* skip unreadable markdown */
              }
            }
          }
        }
      }

      if (queue.length > 0) {
        setImmediate(processTick)
      } else {
        resolve({ rootPath: rootPath, files: files })
      }
    }

    setImmediate(processTick)
  })
}

console.log('[MindNote] preload.js 执行完毕')
