import path from 'path'
import crypto from 'crypto'
import { app } from 'electron'
import { physicalFs } from '../../utils/physicalFs'
import { getPluginsPath } from '../appData/appDataPaths'
import { readUToolsPluginJson } from './utoolsImporter'
import databaseAPI from '../../api/shared/database'
import type { PluginsAPI } from '../../api/renderer/plugins'

/**
 * 检查用户数据根是否残留已下线的预置插件（登记记录 + 实体），
 * 命中则走 deletePlugin 正式卸载，确保升级后旧预置不残留。
 */
async function removeDeprecatedPrebundled(pluginsAPI: PluginsAPI): Promise<void> {
  if (REMOVED_PREBUNDLED_FILES.length === 0) return
  const pluginsRoot = getPluginsPath()
  const plugins = databaseAPI.dbGet('plugins')

  // 优先按登记列表处理（保留 DB 中原始 path，便于精确匹配删除）。
  let removedCount = 0
  if (Array.isArray(plugins)) {
    for (const plugin of plugins) {
      const name = String(plugin?.path || '')
      if (
        REMOVED_PREBUNDLED_FILES.some(
          (file) => name === file || name.endsWith('/' + file) || name.endsWith('\\' + file)
        )
      ) {
        try {
          const result = await pluginsAPI.deletePlugin(name, { deleteData: true })
          if (result?.success) {
            console.log(`[Prebundled] 已下线预置插件移除: ${name}`)
            removedCount++
          } else {
            console.warn(`[Prebundled] 下线预置插件移除失败: ${name}`, result?.error || '未知错误')
          }
        } catch (error) {
          console.warn(`[Prebundled] 下线预置插件移除异常: ${name}`, error)
        }
      }
    }
  }

  // 兜底：登记未覆盖但实体文件仍存在时直接删除。
  for (const file of REMOVED_PREBUNDLED_FILES) {
    const destAsar = path.join(pluginsRoot, file)
    if (physicalFs.existsSync(destAsar)) {
      try {
        physicalFs.rmSync(destAsar, { recursive: true, force: true })
        console.log(`[Prebundled] 已下线预置插件实体清理: ${file}`)
        removedCount++
      } catch (error) {
        console.warn(`[Prebundled] 下线预置插件实体清理失败: ${file}`, error)
      }
    }
  }

  if (removedCount > 0) console.log(`[Prebundled] 已下线预置插件清理完成: ${removedCount} 项`)
}

export function getPrebundledPluginsDir(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, 'dist-plugins')
  // 开发模式直接指向仓库目录，便于本地联调。
  return path.join(app.getAppPath(), 'dist-plugins')
}

/**
 * 已下线的预置插件实体文件名。
 *
 * 这些实体曾随早期发行包分发并登记进用户数据，现已从 dist-plugins 移除。
 * 首次启动扫描时，若用户数据根仍存在同名登记/实体，走正式卸载链路
 * （删除登记记录、插件实体与插件数据），避免「已移除插件」残留。
 */
const REMOVED_PREBUNDLED_FILES = ['zes93rdl-2.9.2-9e2e688f.asar', 'pinshot-0.1.0-36d7fc0e.asar']

/**
 * 读取预捆绑插件实体的 plugin.json。
 * ASAR 实体经 @electron/asar 读取；目录实体直接读文件。
 */
function readPrebundledPluginJson(entityPath: string): any | null {
  try {
    if (physicalFs.statSync(entityPath).isFile()) {
      return readUToolsPluginJson(entityPath)
    }
    const raw = physicalFs.readFileSync(path.join(entityPath, 'plugin.json'), 'utf8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function fileHash(filePath: string): string {
  const buf = physicalFs.readFileSync(filePath)
  return crypto.createHash('sha1').update(buf).digest('hex')
}

/**
 * 将 src 目录树同步到 dest（目录实体语义：发行包即权威）。
 * 逐文件内容哈希比对：复制缺失/不一致文件，删除 dest 中发行包已不存在的多余文件。
 * @returns 是否发生变更
 */
function syncDirectoryTree(src: string, dest: string): boolean {
  let changed = false
  const srcRels: string[] = []
  const walk = (dir: string): void => {
    for (const name of physicalFs.readdirSync(dir)) {
      const p = path.join(dir, name)
      const st = physicalFs.statSync(p)
      if (st.isDirectory()) walk(p)
      else srcRels.push(path.relative(src, p))
    }
  }
  walk(src)
  for (const rel of srcRels) {
    const srcFile = path.join(src, rel)
    const destFile = path.join(dest, rel)
    let needCopy = false
    try {
      const st = physicalFs.statSync(destFile)
      needCopy = !st.isFile() || fileHash(srcFile) !== fileHash(destFile)
    } catch {
      needCopy = true
    }
    if (needCopy) {
      physicalFs.mkdirSync(path.dirname(destFile), { recursive: true })
      physicalFs.copyFileSync(srcFile, destFile)
      changed = true
    }
  }
  const walkDel = (dir: string): void => {
    for (const name of physicalFs.readdirSync(dir)) {
      const p = path.join(dir, name)
      const st = physicalFs.statSync(p)
      if (st.isDirectory()) walkDel(p)
      else if (!srcRels.includes(path.relative(dest, p))) {
        physicalFs.rmSync(p, { force: true })
        changed = true
      }
    }
  }
  if (physicalFs.existsSync(dest)) walkDel(dest)
  return changed
}

export async function adoptPrebundledPlugins(pluginsAPI: PluginsAPI): Promise<void> {
  const dir = getPrebundledPluginsDir()
  if (!physicalFs.existsSync(dir)) return

  // 1) 清理已下线的预置插件（针对升级自旧发行包的用户数据）。
  await removeDeprecatedPrebundled(pluginsAPI)

  // 预捆绑实体支持 ASAR 文件与目录两种形态（目录形态供自研插件直接随包分发）。
  const entries = physicalFs
    .readdirSync(dir)
    .filter((f) => {
      if (f.toLowerCase().endsWith('.asar')) return true
      if (f.endsWith('.unpacked') || f.startsWith('.')) return false
      try {
        return physicalFs.statSync(path.join(dir, f)).isDirectory()
      } catch {
        return false
      }
    })
    .sort()
  if (entries.length === 0) return

  const pluginsRoot = getPluginsPath()
  physicalFs.mkdirSync(pluginsRoot, { recursive: true })

  let adoptedNew = 0
  let synced = 0
  let skipped = 0
  for (const file of entries) {
    const srcEntity = path.join(dir, file)
    const destEntity = path.join(pluginsRoot, file)
    const isAsar = file.toLowerCase().endsWith('.asar')
    if (physicalFs.existsSync(destEntity)) {
      if (!isAsar) {
        // 目录实体（自研/移植预捆绑）：发行包即权威。数据根已存在时做一致性同步，
        // 避免数据根残留旧副本导致插件修复/升级不生效（asar 实体为市场原样分发，保持跳过）。
        try {
          const changed = syncDirectoryTree(srcEntity, destEntity)
          if (changed) {
            const config = readPrebundledPluginJson(srcEntity)
            const result = await pluginsAPI.installer.adoptExistingEntity(destEntity)
            if (result?.success) {
              console.log(`[Prebundled] 目录实体同步更新: ${config?.name || file}`)
              synced++
            } else {
              console.warn(
                `[Prebundled] 目录实体同步后登记失败: ${file}`,
                result?.error || '未知错误'
              )
            }
          } else {
            skipped++
          }
        } catch (error) {
          console.warn(`[Prebundled] 目录实体同步失败: ${file}`, error)
          skipped++
        }
        continue
      }
      skipped++
      continue
    }

    const config = readPrebundledPluginJson(srcEntity)
    if (!config?.name) {
      console.warn('[Prebundled] 跳过无法解析 plugin.json 的预置实体:', file)
      continue
    }

    try {
      if (isAsar) {
        physicalFs.copyFileSync(srcEntity, destEntity)
        const srcUnpacked = `${srcEntity}.unpacked`
        if (physicalFs.existsSync(srcUnpacked)) {
          physicalFs.cpSync(srcUnpacked, `${destEntity}.unpacked`, { recursive: true })
        }
      } else {
        physicalFs.cpSync(srcEntity, destEntity, { recursive: true })
      }
      const result = await pluginsAPI.installer.adoptExistingEntity(destEntity)
      if (result?.success) {
        if (result.adopted) adoptedNew++
        console.log(
          `[Prebundled] 预置插件就绪: ${config.name} v${config.version} (${result.adopted ? '新登记' : '已存在'})`
        )
      } else {
        console.warn(`[Prebundled] 登记失败: ${file}`, result?.error || '未知错误')
      }
    } catch (error) {
      console.warn(`[Prebundled] 预置插件处理失败: ${file}`, error)
    }
  }
  console.log(
    `[Prebundled] 预置插件处理完成: 新登记 ${adoptedNew} / 同步更新 ${synced} / 已存在跳过 ${skipped} / 总数 ${entries.length}`
  )
}
