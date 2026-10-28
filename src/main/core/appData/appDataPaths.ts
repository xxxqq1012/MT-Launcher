import fs from 'fs'
import os from 'os'
import path from 'path'
import { app } from 'electron'
import { assertSafePluginArtifactPart } from '../../utils/pluginStorage.js'

export interface AppDataPathOptions {
  dataRoot?: string
  homeDir?: string
  legacyUserDataPath?: string
}

export interface ZToolsDataLayout {
  root: string
  lmdbRoot: string
  deviceLmdbPath: string
  accountsRoot: string
  defaultAccountLmdbPath: string
  pluginsPath: string
  avatarPath: string
  clipboardPath: string
  extendsPath: string
  tempPath: string
  logsPath: string
  legacyLmdbPath: string
  legacyUserDataPath: string
}

/**
 * 数据根目录引导配置文件名（位于可执行文件同目录，由安装器/设置写入）。
 * 内容为纯文本路径（首行为数据根目录绝对路径），避免 JSON 转义问题。
 */
export const DATA_PATH_CONFIG_FILE = 'mt-data-path.txt'

/**
 * 获取 ZTools 数据根目录，测试进程可通过显式配置隔离真实用户数据。
 *
 * 解析优先级（打包版）：
 * 1. `options.dataRoot`（测试/调用方显式指定）
 * 2. 环境变量 `ZTOOLS_DATA_ROOT`
 * 3. 可执行文件同目录的 `mt-data-path.txt` 引导文件（安装器选择页 / 便携版配置写入）
 * 4. 便携版默认：可执行文件同目录的 `data/`
 * 5. 旧版默认：`~/.ztools`（开发模式与未配置的旧安装）
 *
 * @param options 数据目录解析选项。
 * @returns ZTools 数据根目录绝对路径。
 */
export function getZToolsRoot(options: AppDataPathOptions = {}): string {
  if (options.dataRoot) return options.dataRoot
  if (process.env.ZTOOLS_DATA_ROOT) return process.env.ZTOOLS_DATA_ROOT
  if (app?.isPackaged) {
    const exeDir = path.dirname(process.execPath)
    const configPath = path.join(exeDir, DATA_PATH_CONFIG_FILE)
    try {
      const dataRoot = fs.readFileSync(configPath, 'utf8').trim()
      if (dataRoot && path.isAbsolute(dataRoot)) return dataRoot
    } catch {
      // 无引导文件：便携版，走默认程序根目录 data/
    }
    return path.join(exeDir, 'data')
  }
  return path.join(options.homeDir || os.homedir(), '.ztools')
}

export function getLmdbRoot(options: AppDataPathOptions = {}): string {
  return path.join(getZToolsRoot(options), 'lmdb')
}

export function getDeviceLmdbPath(options: AppDataPathOptions = {}): string {
  return path.join(getLmdbRoot(options), 'device')
}

export function getAccountsRoot(options: AppDataPathOptions = {}): string {
  return path.join(getLmdbRoot(options), 'accounts')
}

export function getDefaultAccountLmdbPath(options: AppDataPathOptions = {}): string {
  return path.join(getAccountsRoot(options), 'default')
}

export function getPluginsPath(options: AppDataPathOptions = {}): string {
  return path.join(getZToolsRoot(options), 'plugins')
}

/**
 * 获取插件数据目录的根容器（存放所有插件的专属数据目录）。
 *
 * @param options 数据目录解析选项
 * @returns 插件数据根目录绝对路径
 */
export function getPluginDataRoot(options: AppDataPathOptions = {}): string {
  return path.join(getZToolsRoot(options), 'plugins-data')
}

/**
 * 获取指定插件的专属数据目录（`ztools.getPath('pluginData')` 指向的目录）。
 * 该目录随插件卸载且勾选「同时删除插件数据」时一并删除，禁止存放插件实体。
 *
 * @param pluginName 插件名，用作数据根下的子目录名
 * @param options 数据目录解析选项
 * @returns 插件数据目录绝对路径
 * @throws 插件名不合法（空、`.`、`..`、含分隔符或绝对路径）时抛出异常，避免目录穿越
 */
export function getPluginDataPath(pluginName: string, options: AppDataPathOptions = {}): string {
  assertSafePluginArtifactPart(pluginName, '插件名称')
  return path.join(getPluginDataRoot(options), pluginName)
}

export function getAvatarPath(options: AppDataPathOptions = {}): string {
  return path.join(getZToolsRoot(options), 'avatar')
}

export function getClipboardPath(options: AppDataPathOptions = {}): string {
  return path.join(getZToolsRoot(options), 'clipboard')
}

export function getExtendsPath(options: AppDataPathOptions = {}): string {
  return path.join(getZToolsRoot(options), 'extends')
}

export function getTempPath(options: AppDataPathOptions = {}): string {
  return path.join(getZToolsRoot(options), 'temp')
}

export function getLogsPath(options: AppDataPathOptions = {}): string {
  return path.join(getZToolsRoot(options), 'logs')
}

export function getLegacyUserDataPath(options: AppDataPathOptions = {}): string {
  return options.legacyUserDataPath || getDefaultLegacyUserDataPath(options)
}

export function getLegacyLmdbPath(options: AppDataPathOptions = {}): string {
  return path.join(getLegacyUserDataPath(options), 'lmdb')
}

export function getZToolsDataLayout(options: AppDataPathOptions = {}): ZToolsDataLayout {
  return {
    root: getZToolsRoot(options),
    lmdbRoot: getLmdbRoot(options),
    deviceLmdbPath: getDeviceLmdbPath(options),
    accountsRoot: getAccountsRoot(options),
    defaultAccountLmdbPath: getDefaultAccountLmdbPath(options),
    pluginsPath: getPluginsPath(options),
    avatarPath: getAvatarPath(options),
    clipboardPath: getClipboardPath(options),
    extendsPath: getExtendsPath(options),
    tempPath: getTempPath(options),
    logsPath: getLogsPath(options),
    legacyLmdbPath: getLegacyLmdbPath(options),
    legacyUserDataPath: getLegacyUserDataPath(options)
  }
}

export function hasZToolsRoot(options: AppDataPathOptions = {}): boolean {
  return fs.existsSync(getZToolsRoot(options))
}

export function hasLegacyLmdb(options: AppDataPathOptions = {}): boolean {
  return fs.existsSync(getLegacyLmdbPath(options))
}

export function ensure3Layout(options: AppDataPathOptions = {}): ZToolsDataLayout {
  const layout = getZToolsDataLayout(options)
  fs.mkdirSync(layout.deviceLmdbPath, { recursive: true })
  fs.mkdirSync(layout.defaultAccountLmdbPath, { recursive: true })
  fs.mkdirSync(layout.pluginsPath, { recursive: true })
  fs.mkdirSync(layout.avatarPath, { recursive: true })
  fs.mkdirSync(layout.clipboardPath, { recursive: true })
  fs.mkdirSync(layout.extendsPath, { recursive: true })
  fs.mkdirSync(layout.tempPath, { recursive: true })
  fs.mkdirSync(layout.logsPath, { recursive: true })
  return layout
}

function getDefaultLegacyUserDataPath(options: AppDataPathOptions): string {
  if (process.env.ZTOOLS_LEGACY_USER_DATA_PATH) {
    return process.env.ZTOOLS_LEGACY_USER_DATA_PATH
  }
  try {
    const userData = app?.getPath?.('userData')
    if (userData) return userData
  } catch {
    // fall back to the production macOS path below
  }

  if (process.platform === 'darwin') {
    return path.join(options.homeDir || os.homedir(), 'Library', 'Application Support', 'ZTools')
  }
  if (process.platform === 'win32') {
    return path.join(
      process.env.APPDATA || path.join(options.homeDir || os.homedir(), 'AppData', 'Roaming'),
      'ZTools'
    )
  }
  return path.join(options.homeDir || os.homedir(), '.config', 'ZTools')
}
