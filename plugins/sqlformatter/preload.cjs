const { clipboard } = require('electron')
const cp = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const JAR_NAME = 'wjz-sqlFormat-1.3.jar'
const FORMAT_TIMEOUT = 10000

/**
 * 插件实体目录（Electron asar 补丁会把本目录下的 unpacked 文件透明映射到真实文件）
 * preload.cjs 位于 asar 根，__dirname 即插件目录。
 */
const pluginDir = __dirname
const unpackedDir = pluginDir.replace(/\.asar[\\/]?$/, '.asar.unpacked')
const jarPath = () => path.join(unpackedDir, JAR_NAME)

/**
 * 为页面提供只读剪贴板桥接，避免依赖浏览器权限弹窗。
 * @returns {string} 当前剪贴板中的纯文本。
 */
function readClipboardText() {
  return clipboard.readText()
}

/**
 * 探测可用的 java 命令（PATH 优先，其次 JAVA_HOME）。
 * @returns {string|null} java 命令名或绝对路径；不可用时返回 null。
 */
function findJava() {
  const candidates = ['java']
  if (process.env.JAVA_HOME) {
    const base = path.join(process.env.JAVA_HOME, 'bin')
    candidates.unshift(path.join(base, process.platform === 'win32' ? 'java.exe' : 'java'))
  }
  for (const cmd of candidates) {
    try {
      cp.execFileSync(cmd, ['-version'], {
        timeout: 6000,
        stdio: 'ignore',
        windowsHide: true
      })
      return cmd
    } catch {
      // 继续尝试下一个候选
    }
  }
  return null
}

/**
 * 调用 wjz-sqlFormat 引擎格式化 SQL（DBeaver 外部工具同款协议）：
 * 写入临时 SQL 文件 -> java -jar ... -filePath <tmp> -fileEncoding utf-8
 * 格式化结果写回临时文件，再读回。cwd 设为插件 unpacked 目录以读取 sqlFormat.cfg。
 * @param {string} sqlText 原始 SQL 文本
 * @returns {string|null} 格式化结果；引擎不可用或执行失败时返回 null（页面回退 JS 格式化）
 */
function formatWithEngine(sqlText) {
  const text = String(sqlText ?? '')
  if (!text.trim()) return null
  const jar = jarPath()
  if (!fs.existsSync(jar)) return null

  const javaCmd = findJava()
  if (!javaCmd) return null

  const tmpFile = path.join(
    os.tmpdir(),
    `mt-sqlformat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.sql`
  )
  try {
    fs.writeFileSync(tmpFile, text, 'utf-8')
  } catch {
    return null
  }

  try {
    cp.execFileSync(
      javaCmd,
      ['-Dfile.encoding=utf-8', '-jar', jar, '-filePath', tmpFile, '-fileEncoding', 'utf-8'],
      {
        timeout: FORMAT_TIMEOUT,
        cwd: unpackedDir,
        windowsHide: true,
        stdio: 'ignore'
      }
    )
    let result = null
    try {
      result = fs.readFileSync(tmpFile, 'utf-8')
    } catch {
      result = null
    }
    if (!result || !String(result).trim() || String(result) === text) return null
    return String(result)
  } catch {
    return null
  } finally {
    try {
      fs.rmSync(tmpFile, { force: true })
    } catch {}
  }
}

window.sqlFormatterBridge = Object.freeze({
  readClipboardText,
  formatWithEngine
})
