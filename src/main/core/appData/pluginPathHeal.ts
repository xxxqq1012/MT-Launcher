import path from 'path'
import { pathToFileURL } from 'url'

/**
 * 插件注册路径自愈与迁移重定位的纯逻辑。
 *
 * 背景：便携版把数据根迁移到外部目录后，插件注册表（LMDB `plugins` 记录）里的
 * path / logo 仍是迁移前的旧位置（例如旧程序目录内 `data/plugins/...`）；随后
 * 覆盖式更新程序目录若使旧位置消失，插件图标（file:// 绝对 URL）会全部无法
 * 显示、插件实体加载也会失败。此处提供两条修复路径：
 * 1. 枚举自愈：path 不存在时，按实体文件名（目录名或 .asar）在当前数据根
 *    plugins 下重定位，并重算 logo；
 * 2. 迁移重定位：数据迁移完成后，把注册表中以旧数据根为前缀的 path / logo
 *    整体切换到新数据根，避免下一次覆盖更新踩坑。
 * 逻辑保持纯函数（依赖注入 fs 判定与 logo 重建），便于独立单测。
 */

/** 参与路径修复的插件注册记录（取自数据库 `plugins` 数组中的单项） */
export interface PluginHealRecord {
  name?: unknown
  path?: unknown
  logo?: unknown
  isDevelopment?: unknown
}

/** 依赖注入：文件存在性判定与 logo 重建均可在测试中替换 */
export interface PluginHealCallbacks {
  /** 判定物理路径是否存在（真实 fs 或测试注入） */
  exists: (filePath: string) => boolean
  /** 按新实体路径重建 logo（读 plugin.json / asar 内 plugin.json） */
  rebuildLogo: (pluginPath: string, currentLogo: unknown) => string
  /** 判定插件名是否为随包内置插件（其 path 指向程序目录 resources，不做自愈） */
  isBundled: (name: unknown) => boolean
}

/**
 * 自愈注册表中失效的插件物理路径：path 不存在时，尝试在当前数据根 plugins
 * 下按同名实体（目录或 .asar 文件）重定位，并重算 logo。
 * @param plugins 注册表记录（就地修改）
 * @param pluginsRoot 当前数据根下的 plugins 目录
 * @param callbacks 依赖注入
 * @returns 修复的插件数量
 */
export function healPluginPaths(
  plugins: PluginHealRecord[],
  pluginsRoot: string,
  callbacks: PluginHealCallbacks
): number {
  let healed = 0
  for (const plugin of plugins) {
    if (!plugin || typeof plugin.path !== 'string' || !plugin.path) continue
    if (plugin.isDevelopment || callbacks.isBundled(plugin.name)) continue
    if (callbacks.exists(plugin.path)) continue
    const candidate = path.join(pluginsRoot, path.basename(plugin.path))
    if (!callbacks.exists(candidate)) continue
    plugin.path = candidate
    plugin.logo = callbacks.rebuildLogo(candidate, plugin.logo)
    healed++
  }
  return healed
}

/**
 * 数据迁移完成后重定位注册表路径：把以旧数据根为前缀的 path 与 file:// logo
 * 切换到新数据根；前缀不匹配的（内置 / 开发 / 其他位置的插件）保持原样。
 * @param plugins 注册表记录（就地修改）
 * @param oldRoot 旧数据根（迁移前根目录）
 * @param newRoot 新数据根（迁移目标根目录）
 * @param callbacks 依赖注入
 * @returns 重定位的插件数量
 */
export function relocatePluginPaths(
  plugins: PluginHealRecord[],
  oldRoot: string,
  newRoot: string
): number {
  if (!oldRoot || !newRoot) return 0
  const oldNorm = oldRoot.replace(/[\\/]+$/, '')
  const newNorm = newRoot.replace(/[\\/]+$/, '')
  const oldPrefix = `${oldNorm}${path.sep}`
  let count = 0
  for (const plugin of plugins) {
    if (!plugin || typeof plugin.path !== 'string' || !plugin.path) continue
    const lower = plugin.path.toLowerCase()
    if (lower === oldNorm.toLowerCase()) {
      plugin.path = newNorm
    } else if (lower.startsWith(oldPrefix.toLowerCase())) {
      plugin.path = path.join(newNorm, plugin.path.slice(oldPrefix.length))
    } else {
      continue
    }
    if (typeof plugin.logo === 'string' && plugin.logo) {
      plugin.logo = relocateLogoUrl(plugin.logo, oldNorm, newNorm)
    }
    count++
  }
  return count
}

/**
 * 把基于旧根的 file:// 绝对 logo URL 重定位到新根；非 file:// 或前缀不匹配时原样返回。
 * 支持 URL 编码（空格/中文）与正反斜杠混用（pathToFileURL 产出正斜杠）。
 * @param logo 注册表内的 logo 字段
 * @param oldRoot 旧数据根（已去除尾部斜杠）
 * @param newRoot 新数据根（已去除尾部斜杠）
 * @returns 重定位后的 logo URL
 */
export function relocateLogoUrl(logo: string, oldRoot: string, newRoot: string): string {
  if (!logo.startsWith('file://')) return logo
  try {
    const rawPath = path.normalize(
      decodeURIComponent(logo.slice('file://'.length).replace(/^\/+/, ''))
    )
    const lower = rawPath.toLowerCase()
    if (lower === oldRoot.toLowerCase()) return logo
    if (!lower.startsWith(`${oldRoot.toLowerCase()}${path.sep}`)) return logo
    return pathToFileURL(path.join(newRoot, rawPath.slice(oldRoot.length))).href
  } catch {
    return logo
  }
}
