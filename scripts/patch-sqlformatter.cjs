// 为 sql-formatter 插件的页面 bundle 接入 wjz-sqlFormat 引擎桥：
// 格式化入口优先调用 window.sqlFormatterBridge.formatWithEngine（wjz 引擎，
// sqlFormat.cfg 自定义规则生效）；引擎不可用（无 Java/无 jar）时回退页面原有 JS 格式化。
const fs = require('fs')
const path = require('path')

const BUNDLE = path.resolve(
  __dirname,
  '..',
  'plugins',
  'sqlformatter',
  'assets',
  'index-BxN7U9Pp.js'
)

const OLD =
  'DO=(T,E={})=>{if(typeof E.language=="string"&&!sO.includes(E.language))throw new w(`Unsupported SQL dialect: ${E.language}`);const R=rT[E.language||"sql"];return aO(T,Object.assign(Object.assign({},E),{'

const NEW =
  'DO=(T,E={})=>{const _b=window.sqlFormatterBridge;if(_b&&typeof _b.formatWithEngine==="function"){const _r=_b.formatWithEngine(String(T??""));if(typeof _r==="string"&&_r)return _r}if(typeof E.language=="string"&&!sO.includes(E.language))throw new w(`Unsupported SQL dialect: ${E.language}`);const R=rT[E.language||"sql"];return aO(T,Object.assign(Object.assign({},E),{'

const c = fs.readFileSync(BUNDLE, 'utf8')
const idx = c.indexOf(OLD)
if (idx < 0) {
  console.error('[patch-sqlformatter] 未找到 DO 定义原文，bundle 结构已变化，需人工处理')
  process.exit(1)
}
const next = c.indexOf(OLD, idx + OLD.length)
if (next >= 0) {
  console.error('[patch-sqlformatter] DO 定义出现多次，替换目标不唯一，需人工处理')
  process.exit(1)
}
const patched = c.slice(0, idx) + NEW + c.slice(idx + OLD.length)
fs.writeFileSync(BUNDLE, patched, 'utf8')
console.log('[patch-sqlformatter] 已接入 wjz 引擎桥，替换偏移: ' + idx)
