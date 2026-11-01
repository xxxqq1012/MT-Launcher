const { clipboard } = require('electron')
const fs = require('fs')
const path = require('path')

const CFG_NAME = 'sqlFormat.cfg'
const SETTINGS_NAME = 'mt-settings.json'

// 自研 JS 引擎（q3：engine/formatter/tokenizer，无 Java 依赖）
const engine = require('./engine/engine.cjs')

/**
 * 插件实体目录。preload.cjs 位于插件根：
 * - 打包运行（Electron asar 内）：__dirname 形如 ...\<plugin>.asar
 * - 侧车目录 = <plugin>.asar.unpacked（cfg / 设置所在）
 * - 开发运行（实体目录）：__dirname 即插件目录本身
 */
const pluginDir = __dirname
const unpackedDir = pluginDir.replace(/\.asar[\\/]?$/, '.asar.unpacked')

function readSettings() {
  try {
    const p = path.join(unpackedDir, SETTINGS_NAME)
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'))
  } catch {}
  return {}
}

function writeSettings(settings) {
  try {
    fs.writeFileSync(
      path.join(unpackedDir, SETTINGS_NAME),
      JSON.stringify(settings, null, 2),
      'utf-8'
    )
    return true
  } catch {
    return false
  }
}

/** 解析 sqlFormat.cfg（key=value，值为 true/false / 数字 / 字符串）为引擎 options */
function parseCfg(content) {
  const o = {}
  for (const line of String(content || '').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z]\w*)\s*=\s*(.*)$/)
    if (!m) continue
    const raw = m[2].trim()
    o[m[1]] =
      raw === 'true'
        ? true
        : raw === 'false'
          ? false
          : /^-?\d+(\.\d+)?$/.test(raw)
            ? Number(raw)
            : raw
  }
  return o
}

function formatWithEngine(sqlText) {
  const text = String(sqlText ?? '')
  if (!text.trim()) return null
  try {
    const cfg = readSqlConfigFile()
    const result = engine.format(text, cfg ? parseCfg(cfg) : {})
    if (result == null || !String(result).trim()) return null
    return String(result)
  } catch {
    return null
  }
}

/** 静态引擎探测：自研引擎无外部运行时依赖 */
function engineProbe() {
  return {
    engine: '自研 JS 引擎（无 Java 依赖）',
    ready: true,
    settingsPath: path.join(unpackedDir, SETTINGS_NAME),
    cfgPath: path.join(unpackedDir, CFG_NAME)
  }
}

/** 引擎诊断：自研引擎实跑样例，展示引擎 / 配置链路状态 */
function testEngine(sqlText) {
  const diag = {
    engine: '自研 JS 引擎（无 Java 依赖）',
    settingsPath: path.join(unpackedDir, SETTINGS_NAME),
    cfgPath: path.join(unpackedDir, CFG_NAME),
    ran: false,
    output: null,
    error: null
  }
  const sample = String(sqlText || 'select a,b from tab1 where a>1')
  try {
    const cfg = readSqlConfigFile()
    const out = engine.format(sample, cfg ? parseCfg(cfg) : {})
    diag.ran = true
    diag.output = String(out ?? '')
  } catch (e) {
    diag.ran = false
    diag.error = '引擎执行失败: ' + (e && e.message ? e.message : String(e))
  }
  return diag
}

function readSqlConfigFile() {
  try {
    const p = path.join(unpackedDir, CFG_NAME)
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : null
  } catch {
    return null
  }
}

function writeSqlConfigFile(content) {
  try {
    fs.writeFileSync(path.join(unpackedDir, CFG_NAME), String(content ?? ''), 'utf-8')
    return true
  } catch {
    return false
  }
}

/** 读取 asar 内打包的内置默认 cfg（用于恢复默认） */
function readBundledConfigFile() {
  try {
    return fs.readFileSync(path.join(pluginDir, CFG_NAME), 'utf-8')
  } catch {
    return null
  }
}

/** 读取系统剪贴板文本（"粘贴"按钮使用；uTools 兼容层由 preload 注入 electron.clipboard） */
function readClipboardText() {
  try {
    return clipboard.readText()
  } catch {
    return null
  }
}

/** 写入系统剪贴板（"复制结果"按钮使用；Electron clipboard 不依赖页面权限） */
function writeClipboardText(text) {
  try {
    clipboard.writeText(String(text ?? ''))
    return true
  } catch {
    return false
  }
}

window.sqlFormatterBridge = Object.freeze({
  readClipboardText,
  writeClipboardText,
  formatWithEngine,
  readSettings,
  writeSettings,
  engineProbe,
  testEngine,
  readSqlConfigFile,
  writeSqlConfigFile,
  readBundledConfigFile
})
