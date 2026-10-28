import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
import { getPluginsPath } from '../appData/appDataPaths.js'
import { physicalFs } from '../../utils/physicalFs.js'

/**
 * mTools · uTools 插件兼容导入器（T04 骨架）
 *
 * 背景（T02 结论）：uTools 市场分发包 .upxs 是加密容器无法解包，但安装后的插件在
 * %APPDATA%\uTools\plugins\ 下是标准 Electron asar，可完整读取。
 *
 * 本模块把已装 uTools 插件的 asar（+ .asar.unpacked 原生模块侧车目录）复制到
 * ZTools 插件根目录（~/.ztools/plugins），实体形态保持 asar（Electron fs 补丁可直接
 * 读取 asar 内文件），再由 adoptExistingEntity 登记进插件注册表。
 *
 * 命名：<name>-<version>-<hash8>.asar，hash8 取 uTools 侧文件名前 8 字符便于溯源。
 *
 * 触发：进程启动参数 --import-utools 或环境变量 ZTOOLS_IMPORT_UTOOLS=1（见 api/index.ts）。
 */

// ZTools 直接依赖 @electron/asar，主进程可直接 require。
const require = createRequire(import.meta.url)
const asar = require('@electron/asar')

export interface UToolsImportResult {
  imported: string[]
  alreadyExists: string[]
  failed: string[]
}

export function getUToolsPluginsDir(): string {
  if (process.env.UTOOLS_PLUGINS_DIR) return process.env.UTOOLS_PLUGINS_DIR
  if (process.platform === 'win32') {
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
      'uTools',
      'plugins'
    )
  }
  // v1 仅支持 Windows（uTools 插件目录约定仅 Windows/macOS 一致，macOS 留待后续）。
  return ''
}

export function readUToolsPluginJson(asarPath: string): any | null {
  try {
    const buf = asar.extractFile(asarPath, 'plugin.json')
    return buf ? JSON.parse(buf.toString('utf8')) : null
  } catch {
    return null
  }
}

export async function importUToolsPlugins(): Promise<UToolsImportResult> {
  const result: UToolsImportResult = { imported: [], alreadyExists: [], failed: [] }
  const utoolsDir = getUToolsPluginsDir()
  if (!utoolsDir || !physicalFs.existsSync(utoolsDir)) {
    console.log('[UToolsCompat] 未找到 uTools 插件目录，跳过导入:', utoolsDir || '(不可用)')
    return result
  }

  const pluginsRoot = getPluginsPath()
  physicalFs.mkdirSync(pluginsRoot, { recursive: true })

  const asarFiles = physicalFs
    .readdirSync(utoolsDir)
    .filter((f) => f.toLowerCase().endsWith('.asar'))
    .sort()

  for (const file of asarFiles) {
    const srcAsar = path.join(utoolsDir, file)
    const config = readUToolsPluginJson(srcAsar)
    if (!config?.name) {
      result.failed.push(srcAsar)
      console.warn('[UToolsCompat] 跳过无法解析 plugin.json 的实体:', file)
      continue
    }
    const name = String(config.name).replace(/[\\/:*?"<>|]/g, '_')
    const version = config.version ? String(config.version) : '0.0.0'
    const installId = path.basename(file, '.asar').slice(0, 8)
    const destAsar = path.join(pluginsRoot, `${name}-${version}-${installId}.asar`)

    if (physicalFs.existsSync(destAsar)) {
      result.alreadyExists.push(destAsar)
      continue
    }

    try {
      physicalFs.copyFileSync(srcAsar, destAsar)
      const srcUnpacked = `${srcAsar}.unpacked`
      if (physicalFs.existsSync(srcUnpacked)) {
        physicalFs.cpSync(srcUnpacked, `${destAsar}.unpacked`, { recursive: true })
      }
      result.imported.push(destAsar)
      console.log(
        `[UToolsCompat] 已导入 uTools 插件实体: ${config.name} v${version} -> ${destAsar}`
      )
    } catch (error) {
      result.failed.push(srcAsar)
      console.error(`[UToolsCompat] 复制失败: ${file}`, error)
    }
  }

  console.log(
    `[UToolsCompat] 导入完成: 新增 ${result.imported.length} / 已存在 ${result.alreadyExists.length} / 失败 ${result.failed.length}`
  )
  return result
}

/** 是否请求本次启动执行 uTools 插件导入（--import-utools 或 ZTOOLS_IMPORT_UTOOLS=1） */
export function shouldImportUToolsPlugins(): boolean {
  return process.argv.includes('--import-utools') || process.env.ZTOOLS_IMPORT_UTOOLS === '1'
}
