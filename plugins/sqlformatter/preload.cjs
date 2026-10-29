const { clipboard } = require('electron')
const cp = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const JAR_NAME = 'wjz-sqlFormat-1.3.jar'
const CFG_NAME = 'sqlFormat.cfg'
const SETTINGS_NAME = 'mt-settings.json'
const FORMAT_TIMEOUT = 15000

/**
 * 插件实体目录。preload.cjs 位于插件根：
 * - 打包运行（Electron asar 内）：__dirname 形如 ...\<plugin>.asar
 * - 侧车目录 = <plugin>.asar.unpacked（引擎文件所在）
 * - 开发运行（实体目录）：__dirname 即插件目录本身
 */
const pluginDir = __dirname
const unpackedDir = pluginDir.replace(/\.asar[\\/]?$/, '.asar.unpacked')

/** 定位引擎 jar（侧车优先，实体目录兜底） */
function findJar() {
  const candidates = [path.join(unpackedDir, JAR_NAME), path.join(pluginDir, JAR_NAME)]
  return candidates.find((p) => fs.existsSync(p)) || null
}

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

/** 探测可用的 java（优先级：内置 jre > 用户指定 > PATH > JAVA_HOME > Oracle > Program Files\Java > DBeaver jre） */
function findJava(settings) {
  const win = process.platform === 'win32'
  const bundledJre = path.join(unpackedDir, 'jre', 'bin', win ? 'java.exe' : 'java')
  if (fs.existsSync(bundledJre)) return bundledJre

  const userPath = settings?.javaPath
  if (userPath && fs.existsSync(userPath)) return userPath

  const candidates = []
  candidates.push('java')
  if (process.env.JAVA_HOME) {
    candidates.push(path.join(process.env.JAVA_HOME, 'bin', win ? 'java.exe' : 'java'))
  }
  const pf = process.env.ProgramFiles || 'C:\\Program Files'
  const pfx = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
  candidates.push(path.join(pf, 'Common Files', 'Oracle', 'Java', 'javapath', 'java.exe'))
  for (const base of [pf, pfx]) {
    const jroot = path.join(base, 'Java')
    if (fs.existsSync(jroot)) {
      try {
        for (const sub of fs.readdirSync(jroot)) {
          if (/^(jdk|jre|java)/i.test(sub)) {
            candidates.push(path.join(jroot, sub, 'bin', win ? 'java.exe' : 'java'))
          }
        }
      } catch {}
    }
    for (const name of ['DBeaver', 'dbeaver']) {
      candidates.push(path.join(base, name, 'jre', 'bin', 'java.exe'))
    }
  }
  for (const cmd of candidates) {
    try {
      cp.execFileSync(cmd, ['-version'], { timeout: 6000, stdio: 'ignore', windowsHide: true })
      return cmd
    } catch {
      // 继续尝试下一个候选
    }
  }
  return null
}

function formatWithEngine(sqlText) {
  const text = String(sqlText ?? '')
  if (!text.trim()) return null
  const jar = findJar()
  if (!jar) return null
  const javaCmd = findJava(readSettings())
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
    // wjz 引擎结果输出到 stdout（DBeaver 外部工具协议），execFileSync 默认捕获并返回
    const stdout = cp.execFileSync(
      javaCmd,
      ['-Dfile.encoding=utf-8', '-jar', jar, '-filePath', tmpFile, '-fileEncoding', 'utf-8'],
      { timeout: FORMAT_TIMEOUT, cwd: unpackedDir, windowsHide: true }
    )
    const result = String(stdout || '')
    if (!result.trim()) return null
    return result
  } catch {
    return null
  } finally {
    try {
      fs.rmSync(tmpFile, { force: true })
    } catch {}
  }
}

/** 静态引擎探测：不执行 java，仅检查路径可用性（快，供页面加载时提示） */
function engineProbe() {
  const settings = readSettings()
  const win = process.platform === 'win32'
  const bundledJre = path.join(unpackedDir, 'jre', 'bin', win ? 'java.exe' : 'java')
  let java = null
  let javaFrom = null
  if (fs.existsSync(bundledJre)) {
    java = bundledJre
    javaFrom = '内置 JRE'
  } else {
    const userPath = settings?.javaPath
    if (userPath && fs.existsSync(userPath)) {
      java = userPath
      javaFrom = '用户指定'
    }
  }
  return {
    java,
    javaFrom,
    jar: findJar(),
    bundled: !!java,
    settingsPath: path.join(unpackedDir, SETTINGS_NAME),
    cfgPath: path.join(unpackedDir, CFG_NAME)
  }
}

/** 引擎诊断：供配置页展示 java/jar/执行链路状态 */
function testEngine(sqlText) {
  const settings = readSettings()
  const jar = findJar()
  const javaCmd = findJava(settings)
  const diag = {
    java: javaCmd,
    javaFrom: javaCmd && javaCmd === settings?.javaPath ? '用户指定' : javaCmd ? '自动探测' : null,
    jar: jar,
    settingsPath: path.join(unpackedDir, SETTINGS_NAME),
    cfgPath: path.join(unpackedDir, CFG_NAME),
    ran: false,
    output: null,
    error: null
  }
  if (!jar) {
    diag.error = '未找到引擎 jar（wjz-sqlFormat-1.3.jar）'
    return diag
  }
  if (!javaCmd) {
    diag.error = '未找到 Java 运行时（请安装 JDK 8+，或在配置页手动指定 java 路径）'
    return diag
  }
  const sample = String(sqlText || 'select a,b from tab1 where a>1')
  const tmpFile = path.join(os.tmpdir(), `mt-sqlformat-diag-${Date.now()}.sql`)
  try {
    fs.writeFileSync(tmpFile, sample, 'utf-8')
  } catch (e) {
    diag.error = '无法写入临时文件: ' + e.message
    return diag
  }
  try {
    const stdout = cp.execFileSync(
      javaCmd,
      ['-Dfile.encoding=utf-8', '-jar', jar, '-filePath', tmpFile, '-fileEncoding', 'utf-8'],
      { timeout: FORMAT_TIMEOUT, cwd: unpackedDir, windowsHide: true }
    )
    diag.ran = true
    diag.output = String(stdout || '')
  } catch (e) {
    diag.ran = false
    diag.error = '引擎执行失败: ' + (e && e.message ? e.message : String(e))
  } finally {
    try {
      fs.rmSync(tmpFile, { force: true })
    } catch {}
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

window.sqlFormatterBridge = Object.freeze({
  readClipboardText,
  formatWithEngine,
  readSettings,
  writeSettings,
  engineProbe,
  testEngine,
  readSqlConfigFile,
  writeSqlConfigFile,
  readBundledConfigFile
})
