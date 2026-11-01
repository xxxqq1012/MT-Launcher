/**
 * Q3 格式层统一入口
 * format(sql, options) —— options 对齐 wjz 规则 key（v1 消费子集，后续逐规则扩展）
 * 架构：自研 tokenizer（保真） + sqlparser-rs AST（结构上下文，后续接入） + 格式规则层
 */
const { format: doFormat, DEFAULTS } = require('./formatter.cjs')

/** 92 规则 key → 参数映射：opts 全量 merge 到 DEFAULTS（布尔/数值/字符串原样透传） */
function normalizeOptions(opts = {}) {
  const o = { ...DEFAULTS }
  for (const k of Object.keys(opts)) {
    if (opts[k] === null || opts[k] === undefined) continue
    o[k] = opts[k]
  }
  if ('upperAndLowerCaseStyle' in o) o.upperAndLowerCaseStyle = Number(o.upperAndLowerCaseStyle)
  if ('ilineLengthWanted' in o) o.ilineLengthWanted = Number(o.ilineLengthWanted)
  if ('iSpacesPerLvlWanted' in o) o.iSpacesPerLvlWanted = Number(o.iSpacesPerLvlWanted)
  if ('inbrCommasWanted' in o) o.inbrCommasWanted = Number(o.inbrCommasWanted)
  if ('inbrCommasInListWanted' in o) o.inbrCommasInListWanted = Number(o.inbrCommasInListWanted)
  return o
}

function format(sql, options = {}) {
  return doFormat(sql, normalizeOptions(options))
}

module.exports = { format, DEFAULTS }
