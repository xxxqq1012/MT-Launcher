/**
 * mindnote-utools-shim.js —— 为随心记提供 uTools API 兼容层（MT Launcher 宿主）
 *
 * 为什么需要：
 *   MT Launcher 的插件宿主只注入 window.ztools（启动器自己的扁平 API），
 *   而随心记的 preload 强依赖 uTools 的对象式 API（utools.db / getPath / onPluginEnter 等）。
 *   本模块在 window.utools 上装一个兼容对象：合并 ztools 的方法 + 补全 utools 风格方法。
 *
 * 与 cmark 的关系：
 *   cmark 统一使用 window.ztools（其 host.js 只做别名补齐），本 shim 覆盖 window.utools
 *   不影响 cmark；为保险，shim 标记 cmark 的 PROXY_TAG（__cmark_host_proxy__），
 *   让 cmark host.js 的 target() 跳过 shim、继续返回真实 ztools。
 *
 * 数据存储：
 *   db 记录存 <userData>/mindnote-data/db.json；附件（postAttachment）存同目录 attachments/。
 *   与 uTools 语义一致：allDocs(prefix) / get / put / remove / bulkDocs / 附件三件套。
 */
'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

/**
 * 数据目录解析（与 cmark 共用 git 仓库，实现「目录一致」）：
 *   优先读 <userData>\cmark-config.json 的 workspace → 仓库根\.mindnote\
 *   （db.json / attachments 落在 git 仓库内，推送/拉取直接覆盖笔记数据）
 *   3.2.26：配置搬到宿主数据目录（便携 data\ / 安装 %APPDATA%\mt-launcher\），
 *   不再读主目录 ~/.cmark-config.json；读不到或目录不存在时回退 <userData>\.mindnote（与 cmark 默认工作区一致）
 */
function resolveDataDir(userData) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(userData, 'cmark-config.json'), 'utf8'))
    const ws = cfg && cfg.workspace ? String(cfg.workspace) : ''
    if (ws && fs.existsSync(ws)) {
      // 3.2.24：默认工作区本身就叫 .mindnote（MT 主程序下 data\.mindnote）时，
      // 数据目录直接就是工作区本身，避免 .mindnote\.mindnote 双层嵌套。
      if (path.basename(ws).toLowerCase() === '.mindnote') return ws
      return path.join(ws, '.mindnote')
    }
  } catch (e) {}
  return userData ? path.join(userData, '.mindnote') : ''
}

/** 旧数据（userData\mindnote-data）一次性迁移到仓库内目录：仅在目标无 db.json 时执行 */
function migrateLegacyData(fromDir, toDir) {
  try {
    if (!fromDir || !toDir || fromDir === toDir) return
    const src = path.join(fromDir, 'db.json')
    const dst = path.join(toDir, 'db.json')
    if (fs.existsSync(src) && !fs.existsSync(dst)) {
      fs.mkdirSync(toDir, { recursive: true })
      fs.copyFileSync(src, dst)
      const srcAtt = path.join(fromDir, 'attachments')
      if (fs.existsSync(srcAtt)) {
        fs.mkdirSync(path.join(toDir, 'attachments'), { recursive: true })
        fs.readdirSync(srcAtt).forEach(function (f) {
          const s = path.join(srcAtt, f)
          const t = path.join(toDir, 'attachments', f)
          if (!fs.existsSync(t)) {
            try {
              fs.copyFileSync(s, t)
            } catch (e) {}
          }
        })
      }
    }
  } catch (e) {}
}

function installUtoolsShim() {
  try {
    const z = (typeof window !== 'undefined' && window.ztools) || null
    const base = z && typeof z.getPath === 'function' ? String(z.getPath('userData') || '') : ''
    const fallbackDir = base ? path.join(base, 'mindnote-data') : ''
    const dataDir = resolveDataDir(base)
    const dbFile = dataDir ? path.join(dataDir, 'db.json') : ''
    const attDir = dataDir ? path.join(dataDir, 'attachments') : ''
    migrateLegacyData(fallbackDir, dataDir)

    function mkdirp(p) {
      try {
        fs.mkdirSync(p, { recursive: true })
      } catch (e) {}
    }
    if (dataDir) mkdirp(dataDir)
    if (attDir) mkdirp(attDir)

    function readAll() {
      try {
        return JSON.parse(fs.readFileSync(dbFile, 'utf8'))
      } catch (e) {
        return {}
      }
    }
    function writeAll(docs) {
      try {
        fs.writeFileSync(dbFile, JSON.stringify(docs), 'utf8')
      } catch (e) {
        console.error('[MindNote] db 写入失败', e && e.message)
      }
    }
    function attFile(id) {
      return path.join(
        attDir,
        crypto
          .createHash('md5')
          .update(String(id == null ? '' : id))
          .digest('hex')
      )
    }
    function localFile(key) {
      return path.join(dataDir, 'local-' + String(key == null ? '' : key).replace(/[^\w.-]/g, '_'))
    }

    // ============ .md 文件桥接（目录一致） ============
    // workspace 根下的 .md 是 git 仓库管理的笔记文件（cmark 同源）。mindnote 的 db.json 是 KV 行存，
    // 两者天然脱节。这里在 db 读写层把 .md 文件映射为笔记：
    //   读：扫描 workspace 根 *.md → 生成 id 为 `md_<文件名去.md>` 的笔记（列表+详情合并进返回）
    //   写：put 到 `kv/mindnote_note_md_<base>` → 内容写回 <base>.md（title 变更 → 文件改名）
    //   删：remove 该 id → 删除对应 .md 文件（git 可恢复）
    // 3.2.27 反馈①：md 桥的「workspace 根」= 配置里 workspace 本身（md 文件实际所在目录）。
    // 3.2.24 起默认工作区 = userData\.mindnote（便携 data\ / 安装 %APPDATA%\mt-launcher\），
    // resolveDataDir 的 basename 特判使数据目录就是工作区本身，md 与 db.json 同在 dataDir 内；
    // 旧布局（用户自选工作区为父目录）时 dataDir=workspace\.mindnote、md 在上级 workspace 根。
    // 旧代码恒取 dirname(dataDir)，默认布局下指到了 userData（如 data\）→ mdFileList 扫空，
    // 右键刷新/拉取后磁盘 *.md 不显示。
    var wsRoot = ''
    if (dataDir) {
      var wsFromCfg = ''
      try {
        var _cfg = JSON.parse(fs.readFileSync(path.join(base, 'cmark-config.json'), 'utf8'))
        if (_cfg && _cfg.workspace && fs.existsSync(_cfg.workspace))
          wsFromCfg = String(_cfg.workspace)
      } catch (e) {}
      wsRoot =
        wsFromCfg ||
        (path.basename(dataDir).toLowerCase() === '.mindnote' ? dataDir : path.dirname(dataDir))
    }
    var FILE_PREFIX = 'md_'

    function mdFileList() {
      var out = []
      if (!wsRoot || !fs.existsSync(wsRoot)) return out
      try {
        fs.readdirSync(wsRoot).forEach(function (name) {
          if (!/\.md$/i.test(name)) return
          var full = path.join(wsRoot, name)
          var st = null
          try {
            st = fs.statSync(full)
          } catch (e) {
            return
          }
          if (!st.isFile()) return
          out.push({ base: name.replace(/\.md$/i, ''), full: full, mtime: st.mtimeMs })
        })
      } catch (e) {}
      return out
    }
    function mdId(base) {
      return FILE_PREFIX + String(base)
    }
    // 3.2.28：md 桥笔记的排序/时间元数据不再每次从文件现算（旧实现 sortOrder 恒 0 →
    // bundle Bu 排序中 0 永远小于本地笔记（100+）导致磁盘 md 恒置顶；且 md 之间按
    // updatedAt(=文件 mtime) 降序，git pull/外部修改/空转重写都会改 mtime → 目录顺序跳动）。
    // 改为：sortOrder/updatedAt/createdAt 优先沿用 db 持久化值；首次出现的磁盘 md 按
    // 文件名字典序排在当前列表末尾之后（max+100 递增），保证多个新 md 之间也互不相同且稳定。
    function mdPersistedVal(base) {
      try {
        const all = readAll()
        const rec = all['kv/mindnote_note_' + mdId(base)]
        return rec && rec.val ? rec.val : null
      } catch (e) {
        return null
      }
    }
    function mdStableSortOrder(base) {
      const p = mdPersistedVal(base)
      if (p && p.sortOrder != null) return p.sortOrder
      let mx = 0
      try {
        const lst = readAll()['kv/mindnote_note_list']
        if (lst && Array.isArray(lst.val)) {
          lst.val.forEach(function (n) {
            if (n && typeof n.sortOrder === 'number' && n.sortOrder > mx) mx = n.sortOrder
          })
        }
      } catch (e) {}
      const files = mdFileList()
        .slice()
        .sort(function (a, b) {
          return String(a.base).localeCompare(String(b.base))
        })
      let idx = 0
      for (let i = 0; i < files.length; i++) {
        if (files[i].base === base) {
          idx = i
          break
        }
      }
      return mx + (idx + 1) * 100
    }
    function mdDoc(f) {
      var content = ''
      try {
        content = fs.readFileSync(f.full, 'utf8')
      } catch (e) {}
      const persisted = mdPersistedVal(f.base)
      const sortOrder = mdStableSortOrder(f.base)
      return {
        _id: 'kv/mindnote_note_' + mdId(f.base),
        val: {
          id: mdId(f.base),
          title: f.base,
          content: content,
          tags: persisted && Array.isArray(persisted.tags) ? persisted.tags : [],
          sortOrder: sortOrder,
          createdAt: persisted && persisted.createdAt ? persisted.createdAt : f.mtime,
          updatedAt: persisted && persisted.updatedAt ? persisted.updatedAt : f.mtime,
          _fromFile: true
        },
        size: content.length,
        _id: 'kv/mindnote_note_' + mdId(f.base)
      }
    }
    function mdListItems() {
      return mdFileList().map(function (f) {
        const p = mdPersistedVal(f.base)
        return {
          id: mdId(f.base),
          title: f.base,
          updatedAt: p && p.updatedAt ? p.updatedAt : f.mtime,
          sortOrder: mdStableSortOrder(f.base)
        }
      })
    }
    function mergeMdIntoList(val) {
      var arr = Array.isArray(val) ? val : []
      var byId = {}
      arr.forEach(function (n) {
        if (n && n.id != null) byId[n.id] = n
      })
      mdListItems().forEach(function (m) {
        if (!byId[m.id]) arr.push(m)
      })
      return arr
    }
    function mdTargetFile(base) {
      return wsRoot ? path.join(wsRoot, base + '.md') : ''
    }

    const db = {
      allDocs: function (prefix) {
        const docs = readAll()
        const p = String(prefix == null ? '' : prefix)
        const out = []
        Object.keys(docs).forEach(function (k) {
          if (k.indexOf(p) === 0) out.push(docs[k])
        })
        // 合并 workspace 根 .md 文件生成的笔记（id 前缀 md_）
        if (p === '' || p.indexOf('kv/mindnote_note_') === 0) {
          const exist = {}
          out.forEach(function (d) {
            if (d && d._id) exist[String(d._id)] = true
          })
          mdFileList().forEach(function (f) {
            const d = mdDoc(f)
            if (!exist[String(d._id)]) out.push(d)
          })
        }
        return out
      },
      get: function (id) {
        const key = String(id == null ? '' : id)
        // 文件笔记实时读（防 bundle 缓存旧内容）
        if (key.indexOf('kv/mindnote_note_' + FILE_PREFIX) === 0) {
          const base = key.slice(('kv/mindnote_note_' + FILE_PREFIX).length)
          const files = mdFileList()
          for (let i = 0; i < files.length; i++) {
            if (files[i].base === base) return mdDoc(files[i])
          }
          return null
        }
        const docs = readAll()
        // 笔记列表合并 .md 项（3.2.25：db 里还没有列表 key 时也返回纯 md 合并结果，
        // 保证「git 拉取的新仓库 / 纯文件工作区」文件夹区能显示磁盘 *.md）
        if (key === 'kv/mindnote_note_list') {
          const d = docs[key]
          const base = d && d.val ? d.val : []
          const merged = {
            _id: key,
            val: mergeMdIntoList(Array.isArray(base) ? base : []),
            size: 0
          }
          merged.size = JSON.stringify(merged.val).length
          return merged
        }
        const d = docs[key]
        return d != null ? d : null
      },
      put: function (doc) {
        if (!doc || doc._id == null) return { ok: false, error: '_id 必填' }
        const key = String(doc._id)
        const docs = readAll()
        // 文件笔记：内容写回 .md；title 变更 → 文件改名并迁移 db 记录
        if (key.indexOf('kv/mindnote_note_' + FILE_PREFIX) === 0) {
          try {
            const val = doc.val || doc
            const oldBase = key.slice(('kv/mindnote_note_' + FILE_PREFIX).length)
            const content = val.content == null ? '' : String(val.content)
            const newTitle = val.title == null ? oldBase : String(val.title)
            const oldFile = mdTargetFile(oldBase)
            if (newTitle !== oldBase) {
              const newFile = wsRoot ? path.join(wsRoot, newTitle + '.md') : ''
              if (oldFile && newFile && fs.existsSync(oldFile)) {
                try {
                  fs.renameSync(oldFile, newFile)
                } catch (e) {}
              }
              // 迁移 db 记录到新 id（bundle 后续用新 title 重建映射）
              const oldKey = 'kv/mindnote_note_' + FILE_PREFIX + oldBase
              const newKey = 'kv/mindnote_note_' + FILE_PREFIX + newTitle
              if (oldKey !== newKey) {
                delete docs[oldKey]
                const nd = {}
                for (const k in doc) nd[k] = doc[k]
                nd._id = newKey
                if (nd.val)
                  nd.val = Object.assign({}, doc.val, {
                    id: FILE_PREFIX + newTitle,
                    title: newTitle
                  })
                doc = nd
                // 同步 note_list 里的 id/title
                const lst = docs['kv/mindnote_note_list']
                if (lst && Array.isArray(lst.val)) {
                  lst.val = lst.val.map(function (n) {
                    if (n && n.id === FILE_PREFIX + oldBase)
                      return Object.assign({}, n, { id: FILE_PREFIX + newTitle, title: newTitle })
                    return n
                  })
                }
              }
              // 写回新文件
              if (newFile) {
                try {
                  fs.writeFileSync(newFile, content, 'utf8')
                } catch (e) {}
              }
              // 3.2.25：md 桥笔记落盘同样要通知 git 服务（停止编辑后自动同步）。
              // 此前只有 ndb 的 bundle 态笔记写盘会调 noteEditActivity，md 桥写盘不调，
              // 导致用户编辑工作区根 *.md（如副本.md）后 stop-edit 自动同步永不触发 —— 实机「开了自动同步但没推送」。
              try {
                if (window.__znotesGit && window.__znotesGit.noteEditActivity)
                  window.__znotesGit.noteEditActivity()
              } catch (e) {}
            } else {
              if (oldFile) {
                // 3.2.28：内容未变化不重写 .md（Uu 重排等空转保存会无条件 writeFileSync
                // → mtime 空转更新 → mdDoc.updatedAt 变化 → 目录顺序跳动 + git 假变更）
                let cur = ''
                try {
                  cur = fs.readFileSync(oldFile, 'utf8')
                } catch (e) {}
                if (cur !== content) {
                  try {
                    fs.writeFileSync(oldFile, content, 'utf8')
                  } catch (e) {}
                }
              }
              try {
                if (window.__znotesGit && window.__znotesGit.noteEditActivity)
                  window.__znotesGit.noteEditActivity()
              } catch (e) {}
            }
          } catch (e) {
            console.error('[MindNote] md 写回失败', e && e.message)
          }
        }
        docs[String(doc._id)] = doc
        writeAll(docs)
        return { ok: true, id: doc._id, rev: 1 }
      },
      remove: function (id) {
        const key = typeof id === 'string' ? id : id && id._id
        if (key == null) return { ok: false, error: 'id 为空' }
        const docs = readAll()
        const isMd = key.indexOf('kv/mindnote_note_' + FILE_PREFIX) === 0
        // md 笔记可能只有文件、无持久化 doc（扫描生成）：仍要删文件
        if (!(key in docs) && !isMd) return { ok: false, error: 'not_found' }
        // 文件笔记：同步删除对应 .md（git 可恢复）
        if (isMd) {
          try {
            const base = key.slice(('kv/mindnote_note_' + FILE_PREFIX).length)
            const f = mdTargetFile(base)
            if (f && fs.existsSync(f)) {
              try {
                fs.unlinkSync(f)
              } catch (e) {}
            }
          } catch (e) {}
        }
        delete docs[key]
        writeAll(docs)
        return { ok: true }
      },
      bulkDocs: function (docs) {
        const all = readAll()
        ;(docs || []).forEach(function (d) {
          if (d && d._id != null) {
            const k = String(d._id)
            all[k] = d
            // md 笔记批量保存也同步写回文件
            if (k.indexOf('kv/mindnote_note_' + FILE_PREFIX) === 0) {
              try {
                const val = d.val || d
                const base = k.slice(('kv/mindnote_note_' + FILE_PREFIX).length)
                const content = val.content == null ? '' : String(val.content)
                const f = mdTargetFile(base)
                if (f) {
                  // 3.2.28：同 put 分支——内容未变化不重写 .md，避免 mtime 空转造成顺序跳动
                  let cur = ''
                  try {
                    cur = fs.readFileSync(f, 'utf8')
                  } catch (e) {}
                  if (cur !== content) {
                    try {
                      fs.writeFileSync(f, content, 'utf8')
                    } catch (e) {}
                  }
                }
                // 3.2.25：批量落盘同样触发自动同步计时（与 put 分支一致）
                try {
                  if (window.__znotesGit && window.__znotesGit.noteEditActivity)
                    window.__znotesGit.noteEditActivity()
                } catch (e) {}
              } catch (e) {}
            }
          }
        })
        writeAll(all)
        return { ok: true }
      },
      getAttachment: function (id) {
        try {
          return fs.readFileSync(attFile(id))
        } catch (e) {
          return null
        }
      },
      postAttachment: function (id, data, type) {
        try {
          fs.writeFileSync(attFile(id), Buffer.isBuffer(data) ? data : Buffer.from(data || ''))
          const docs = readAll()
          docs[String(id)] = {
            _id: String(id),
            meta: { mimeType: type || 'application/octet-stream' },
            _attached: true
          }
          writeAll(docs)
          return { ok: true, id: id, rev: 1 }
        } catch (e) {
          return { ok: false, error: String((e && e.message) || e) }
        }
      },
      getAttachmentType: function (id) {
        const docs = readAll()
        const d = docs[String(id == null ? '' : id)]
        return (d && d.meta && d.meta.mimeType) || ''
      }
    }

    const shim = Object.assign({}, z || {}, {
      // 让 cmark host.js 识别为"它自己的代理"从而跳过我们、继续用真实 ztools
      __cmark_host_proxy__: true,
      db: db,
      getPath: function (name) {
        return z && typeof z.getPath === 'function'
          ? z.getPath(name)
          : name === 'userData'
            ? dataDir
            : ''
      },
      getPluginLocalDataPath: function () {
        return dataDir
      },
      getPluginLocalData: function (key) {
        try {
          return fs.readFileSync(localFile(key))
        } catch (e) {
          return null
        }
      },
      setPluginLocalData: function (key, buf) {
        try {
          fs.writeFileSync(localFile(key), buf)
        } catch (e) {}
      },
      onPluginEnter: function (cb) {
        if (typeof cb === 'function') {
          // MT 宿主没有 uTools 的进入事件，插件窗口加载即视为一次进入
          setTimeout(function () {
            try {
              cb({ code: '', type: '', payload: null })
            } catch (e) {}
          }, 0)
        }
      },
      onPluginOut: function () {},
      onPluginDetach: function () {},
      onPluginHide: function () {},
      ubrowser: {
        goto: function () {
          return Promise.resolve(null)
        },
        close: function () {}
      },
      isDarkColors: function () {
        return false
      },
      getWindowType: function () {
        return 'main'
      },
      setSubInput: function () {},
      removeSubInput: function () {},
      setSubInputValue: function () {},
      subInputFocus: function () {},
      isDev: function () {
        return false
      },
      copyText: function (t) {
        if (z && typeof z.copyToClipboard === 'function') z.copyToClipboard(t)
      },
      shellOpenExternal: function (u) {
        if (z && typeof z.openExternal === 'function') z.openExternal(u)
      }
    })

    if (typeof window !== 'undefined') {
      try {
        window.utools = shim
      } catch (e) {}
    }
    return shim
  } catch (e) {
    console.error('[MindNote] utools shim 安装失败', e && (e.stack || e.message))
    return null
  }
}

if (typeof window !== 'undefined') installUtoolsShim()

module.exports = { installUtoolsShim }
