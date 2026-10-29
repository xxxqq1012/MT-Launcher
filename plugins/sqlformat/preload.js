// MT Launcher 基础插件：SQL 格式化
// 引擎：wjz-sqlFormat-1.3.jar（DBeaver 外部格式化工具，基于 Druid SQL 解析器）
// 依赖：JDK 8+（java 需在 PATH 中可用）
// 模式：写临时 SQL 文件 -> java -jar ... -filePath <tmp> -fileEncoding utf-8
//       格式化结果写回临时文件，再读回。cwd 设为插件 unpacked 目录以读取 sqlFormat.cfg。
const cp = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const JAR_NAME = 'wjz-sqlFormat-1.3.jar'
const CFG_NAME = 'sqlFormat.cfg'
const FORMAT_TIMEOUT = 30000

// 插件实体目录（Electron asar 补丁会把本目录下的 unpacked 文件透明映射到真实文件）
const pluginDir = __dirname
const unpackedDir = pluginDir.replace(/\.asar[\\/]?$/, '.asar.unpacked')

function jarPath() {
  return path.join(unpackedDir, JAR_NAME)
}

function cfgPath() {
  return path.join(unpackedDir, CFG_NAME)
}

function findJava(callback) {
  // 优先 PATH 中的 java；其次 JAVA_HOME
  const envJavaHome = process.env.JAVA_HOME
  const candidates = ['java']
  if (envJavaHome) {
    candidates.unshift(
      path.join(envJavaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
    )
  }
  let idx = 0
  const probe = () => {
    if (idx >= candidates.length) {
      callback(null)
      return
    }
    const cmd = candidates[idx++]
    cp.execFile(cmd, ['-version'], { timeout: 8000 }, (err) => {
      if (err) {
        probe()
      } else {
        callback(cmd)
      }
    })
  }
  probe()
}

function formatSql(sqlText, callback) {
  if (!sqlText || !String(sqlText).trim()) {
    callback({ error: 'SQL 文本为空' })
    return
  }
  const jar = jarPath()
  if (!fs.existsSync(jar)) {
    callback({ error: `未找到格式化引擎 ${JAR_NAME}` })
    return
  }

  findJava((javaCmd) => {
    if (!javaCmd) {
      callback({
        error: '未检测到 Java。请安装 JDK 8+ 并将 java 加入 PATH（或配置 JAVA_HOME）后重试。'
      })
      return
    }

    const tmpFile = path.join(
      os.tmpdir(),
      `mt-sqlformat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.sql`
    )
    try {
      fs.writeFileSync(tmpFile, sqlText, 'utf-8')
    } catch (e) {
      callback({ error: `写入临时文件失败: ${e.message}` })
      return
    }

    const args = [
      '-Dfile.encoding=utf-8',
      '-jar',
      jar,
      '-filePath',
      tmpFile,
      '-fileEncoding',
      'utf-8'
    ]

    cp.execFile(
      javaCmd,
      args,
      { timeout: FORMAT_TIMEOUT, cwd: unpackedDir, windowsHide: true, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err && !fs.existsSync(tmpFile)) {
          try {
            fs.rmSync(tmpFile, { force: true })
          } catch {}
          callback({ error: `格式化失败: ${err.message}` })
          return
        }
        // 引擎约定：格式化结果写回 -filePath 指向的临时文件
        let result = null
        try {
          result = fs.readFileSync(tmpFile, 'utf-8')
        } catch {
          result = null
        }
        // 兜底：文件未写回时尝试 stdout（不同版本引擎行为差异）
        if (!result || !String(result).trim() || result === sqlText) {
          const so = stdout ? String(stdout).trim() : ''
          if (so && so !== sqlText) {
            result = so
          }
        }
        try {
          fs.rmSync(tmpFile, { force: true })
        } catch {}

        if (!result || !String(result).trim()) {
          callback({ error: `格式化无输出${err ? '（' + err.message + '）' : ''}` })
          return
        }
        callback({ result: String(result) })
      }
    )
  })
}

function handleText(text) {
  formatSql(text, ({ result, error }) => {
    if (error) {
      window.utools.showNotification(`SQL 格式化失败：${error}`)
      window.utools.out({ type: 'text', text: `SQL 格式化失败：${error}` })
      return
    }
    try {
      window.utools.copyText(result)
    } catch {}
    window.utools.out({
      type: 'text',
      text: result,
      copy: true
    })
  })
}

window.utools.onPluginEnter(({ code, type, payload }) => {
  if (code === 'sqlformat-over') {
    handleText(payload)
  } else if (code === 'sqlformat') {
    handleText(payload)
  }
})

window.utools.onPluginOut(() => {})
