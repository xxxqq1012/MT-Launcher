/**
 * MindNote（随心记 Markdown）聚合 preload
 *
 * 两个 preload 体系并存，互不冲突：
 *   1. cmark-preload.js  —— 挂载 window.__ZNOTES / __znotesGit / __CMARK / __CMARK_REMOTE / __zgsOpen 等
 *      （Git 服务 + 设置面板 + 绑定向导 + 自动同步，全部为独立 DOM 模块，原样复用）
 *   2. mindnote-preload.js —— 原随心记业务（window.mindnote，utools.db 存储）
 *
 * 顺序：
 *   1. cmark-preload.js —— 挂载 Git 服务与 DOM 面板（其 host 适配确保 window.ztools 可用）
 *   2. mindnote-utools-shim.js —— 在 window.utools 上装 uTools 兼容层（合并 ztools + db/getPath 等）
 *   3. mindnote-preload.js —— 原随心记业务（window.mindnote）
 *
 * 注意：shim 覆盖 window.utools 不影响 cmark（cmark 统一走 window.ztools），
 * 且 shim 带 cmark 的代理标记，host.js 会跳过它继续使用真实 ztools。
 */
try {
  require('./cmark-preload.js')
} catch (e) {
  console.error('[MindNote] cmark Git 服务挂载失败', e && (e.stack || e.message))
}
try {
  require('./mindnote-utools-shim.js')
} catch (e) {
  console.error('[MindNote] utools 兼容层挂载失败', e && (e.stack || e.message))
}
try {
  require('./mindnote-preload.js')
} catch (e) {
  console.error('[MindNote] mindnote 业务挂载失败', e && (e.stack || e.message))
}
