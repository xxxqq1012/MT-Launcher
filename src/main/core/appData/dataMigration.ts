import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { DATA_PATH_CONFIG_FILE, getZToolsRoot } from './appDataPaths'

/**
 * 数据目录迁移（设置页「我的数据 - 数据迁移」）。
 *
 * 背景：数据根目录由可执行文件同目录的 `mt-data-path.txt` 引导文件决定。
 * 迁移 = 把当前根目录下的核心数据子目录复制到用户选择的新目录，并重写引导
 * 文件指向新目录，应用重启后即从新目录读写。
 *
 * 安全策略：
 * - 复制不删除旧数据，用户确认后可手动清理旧目录。
 * - 目标目录必须为空或不存在（避免与已有数据混淆）。
 * - 复制前由调用方停止自动同步，降低 LMDB 写入期间复制不一致的风险。
 */

/** 需要随根目录迁移的核心数据子目录（与首次运行迁移保持一致） */
export const DATA_MIGRATION_DIRS = [
  'plugins',
  'plugins-data',
  'lmdb',
  'clipboard',
  'avatar',
  'extends',
  'temp',
  'logs'
]

export interface DataDirInfo {
  name: string
  path: string
  exists: boolean
}

export interface DataMigrationInfo {
  success: boolean
  currentRoot?: string
  dataDirs?: DataDirInfo[]
  dataPathConfig?: string
  configWritable?: boolean
  error?: string
}

/**
 * 获取当前数据目录布局信息，供设置页展示。
 * @returns 当前数据根目录、各数据子目录路径与是否存在。
 */
export function getDataMigrationInfo(): DataMigrationInfo {
  const currentRoot = getZToolsRoot()
  const dataDirs: DataDirInfo[] = DATA_MIGRATION_DIRS.map((name) => {
    const dirPath = path.join(currentRoot, name)
    return {
      name,
      path: dirPath,
      exists: fs.existsSync(dirPath)
    }
  })
  const configPath = app?.isPackaged
    ? path.join(path.dirname(process.execPath), DATA_PATH_CONFIG_FILE)
    : ''
  return {
    success: true,
    currentRoot,
    dataDirs,
    dataPathConfig: configPath,
    configWritable: configPath ? isPathWritable(configPath) : false
  }
}

/**
 * 校验迁移目标目录是否合法。
 * @param target 用户选择的目标目录（绝对路径）。
 * @param currentRoot 当前数据根目录。
 * @returns 合法时返回 null，否则返回错误文案。
 */
export function validateMigrationTarget(target: string, currentRoot: string): string | null {
  if (typeof target !== 'string' || !target.trim()) {
    return '请先选择迁移目标目录'
  }
  if (!path.isAbsolute(target)) {
    return '迁移目标必须为绝对路径'
  }
  const resolvedTarget = path.resolve(target)
  const resolvedRoot = path.resolve(currentRoot)
  if (resolvedTarget.toLowerCase() === resolvedRoot.toLowerCase()) {
    return '迁移目标不能与当前数据目录相同'
  }
  // 目标不能是当前根目录的子目录，也不能包含当前根目录（避免循环复制 / 误删）。
  const rootWithSep = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`
  const targetWithSep = resolvedTarget.endsWith(path.sep)
    ? resolvedTarget
    : `${resolvedTarget}${path.sep}`
  if (targetWithSep.toLowerCase().startsWith(rootWithSep.toLowerCase())) {
    return '迁移目标不能位于当前数据目录内部'
  }
  if (rootWithSep.toLowerCase().startsWith(targetWithSep.toLowerCase())) {
    return '迁移目标不能是当前数据目录的上级目录'
  }
  return null
}

/**
 * 执行数据迁移：复制全部核心数据子目录到目标目录，并重写引导文件。
 * @param target 目标数据根目录（绝对路径）。
 * @returns 迁移结果；成功后需提示用户重启应用使新目录生效。
 */
export async function performDataMigration(target: string): Promise<{
  success: boolean
  migrated?: string[]
  skipped?: string[]
  target?: string
  currentRoot?: string
  dataPathConfig?: string
  error?: string
}> {
  if (!app?.isPackaged) {
    return { success: false, error: '开发模式不支持数据迁移，请使用打包后的 MT Launcher' }
  }

  const currentRoot = getZToolsRoot()
  const validationError = validateMigrationTarget(target, currentRoot)
  if (validationError) {
    return { success: false, error: validationError }
  }

  const resolvedTarget = path.resolve(target)

  // 目标目录已存在且非空时拒绝迁移，避免覆盖或混入已有数据。
  if (fs.existsSync(resolvedTarget)) {
    const entries = fs.readdirSync(resolvedTarget)
    if (entries.some((name) => !name.startsWith('.'))) {
      return {
        success: false,
        error: '目标目录非空，请选择一个空目录或新建目录'
      }
    }
  }
  fs.mkdirSync(resolvedTarget, { recursive: true })

  const migrated: string[] = []
  const skipped: string[] = []
  for (const dirName of DATA_MIGRATION_DIRS) {
    const src = path.join(currentRoot, dirName)
    const dest = path.join(resolvedTarget, dirName)
    if (!fs.existsSync(src)) continue
    if (fs.existsSync(dest)) {
      skipped.push(dirName)
      continue
    }
    try {
      fs.cpSync(src, dest, { recursive: true, force: true })
      migrated.push(dirName)
    } catch (error) {
      console.error(`[DataMigration] 迁移目录失败: ${dirName}`, error)
      return {
        success: false,
        error: `迁移 ${dirName} 目录失败：${error instanceof Error ? error.message : String(error)}`
      }
    }
  }

  // 重写引导文件，指向新数据根目录。
  const configPath = path.join(path.dirname(process.execPath), DATA_PATH_CONFIG_FILE)
  try {
    fs.writeFileSync(configPath, `${resolvedTarget}\n`, 'utf8')
  } catch (error) {
    console.error('[DataMigration] 写入数据目录引导文件失败:', error)
    return {
      success: false,
      error: `数据已复制，但写入引导文件失败（${configPath}），请以管理员权限运行后重试`
    }
  }

  console.log(
    `[DataMigration] 数据迁移完成: ${currentRoot} -> ${resolvedTarget}（迁移 ${migrated.length} 个目录，跳过 ${skipped.length} 个）`
  )
  return {
    success: true,
    migrated,
    skipped,
    target: resolvedTarget,
    currentRoot,
    dataPathConfig: configPath
  }
}

function isPathWritable(filePath: string): boolean {
  try {
    const dir = path.dirname(filePath)
    if (!fs.existsSync(dir)) return true
    fs.accessSync(dir, fs.constants.W_OK)
    return true
  } catch {
    return false
  }
}
