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

/** 用户运行时配置：同步 unpacked 侧车时保留下，不用发行包默认值覆盖。 */
const PRESERVED_RUNTIME_FILES = new Set(['mt-settings.json', 'sqlformat.cfg'])

/**
 * 同步 asar 的 .unpacked 侧车目录（发行包即权威）。
 * 覆盖发行包分发的文件、清理已下线文件，但保留用户运行时配置。
 */
function syncUnpackedTree(src: string, dest: string): boolean {
  if (!physicalFs.existsSync(src)) return false
  physicalFs.mkdirSync(dest, { recursive: true })
  let changed = false
  for (const name of physicalFs.readdirSync(src)) {
    const srcPath = path.join(src, name)
    const destPath = path.join(dest, name)
    const st = physicalFs.statSync(srcPath)
    if (st.isDirectory()) {
      if (syncUnpackedTree(srcPath, destPath)) changed = true
      continue
    }
    if (PRESERVED_RUNTIME_FILES.has(name.toLowerCase()) && physicalFs.existsSync(destPath)) continue
    let needCopy = false
    try {
      const dst = physicalFs.statSync(destPath)
      needCopy = !dst.isFile() || fileHash(srcPath) !== fileHash(destPath)
    } catch {
      needCopy = true
    }
    if (needCopy) {
      physicalFs.copyFileSync(srcPath, destPath)
      changed = true
    }
  }
  // 清理发行包已不再分发的多余文件与目录，避免旧引擎残留。
  for (const name of physicalFs.readdirSync(dest)) {
    const srcPath = path.join(src, name)
    const destPath = path.join(dest, name)
    const st = physicalFs.statSync(destPath)
    if (st.isDirectory()) {
      if (syncUnpackedTree(srcPath, destPath)) changed = true
      if (!physicalFs.existsSync(srcPath)) {
        physicalFs.rmSync(destPath, { recursive: true, force: true })
        changed = true
      }
      continue
    }
    if (PRESERVED_RUNTIME_FILES.has(name.toLowerCase())) continue
    if (!physicalFs.existsSync(srcPath)) {
      physicalFs.rmSync(destPath, { force: true })
      changed = true
    }
  }
  return changed
}

/**
 * 同步单个 ASAR 实体的归档与侧车（发行包即权威，用户运行时配置保留）。
 * @returns 是否发生了归档替换
 */
function syncAsarEntity(srcEntity: string, destEntity: string): boolean {
  if (!physicalFs.existsSync(destEntity)) return false
  let changed = false
  try {
    if (fileHash(srcEntity) !== fileHash(destEntity)) {
      physicalFs.copyFileSync(srcEntity, destEntity)
      changed = true
    }
  } catch (error) {
    console.warn('[Prebundled] asar 实体写入失败:', path.basename(destEntity), error)
    return false
  }
  if (changed) {
    const srcUnpacked = `${srcEntity}.unpacked`
    if (physicalFs.existsSync(srcUnpacked)) {
      syncUnpackedTree(srcUnpacked, `${destEntity}.unpacked`)
    }
  }
  return changed
}

/**
 * 启动最早期预同步 ASAR 实体（只动文件，不碰插件登记）。
 * Electron 在同一进程内按路径缓存 asar 目录头：若先读到旧归档、随后同名原地覆盖，
 * 之后所有读取都会落在错位字节上（表现为 `plugin.json` JSON.parse 失败、插件打不开）。
 * 所以替换必须发生在任何 asar 读取之前。
 */
export function syncPrebundledAsarEntities(): void {
  const dir = getPrebundledPluginsDir()
  if (!physicalFs.existsSync(dir)) return
  const pluginsRoot = getPluginsPath()
  physicalFs.mkdirSync(pluginsRoot, { recursive: true })
  let synced = 0
  for (const file of physicalFs.readdirSync(dir).sort()) {
    if (file.startsWith('.') || !file.toLowerCase().endsWith('.asar')) continue
    if (syncAsarEntity(path.join(dir, file), path.join(pluginsRoot, file))) {
      synced++
      console.log(`[Prebundled] asar 实体预同步: ${file}`)
    }
  }
  if (synced > 0) console.log(`[Prebundled] 启动预同步完成: ${synced} 个 asar 实体`)
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

  // 已登记的插件路径（小写归一）。数据根实体存在但登记被删（用户在设置页删插件）时，
  // 仅比对目录内容不会触发登记，插件会一直"消失"，需要按登记缺失补回来。
  const registeredPlugins = databaseAPI.dbGet('plugins')
  const registeredPaths = new Set<string>(
    (Array.isArray(registeredPlugins) ? registeredPlugins : [])
      .map((item: any) => String(item?.path || '').toLowerCase())
      .filter(Boolean)
  )

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
        // 避免数据根残留旧副本导致插件修复/升级不生效；登记缺失时同步补登记。
        try {
          const changed = syncDirectoryTree(srcEntity, destEntity)
          const registered = registeredPaths.has(destEntity.toLowerCase())
          if (changed || !registered) {
            const config = readPrebundledPluginJson(srcEntity)
            const result = await pluginsAPI.installer.adoptExistingEntity(destEntity)
            if (result?.success) {
              if (changed) {
                console.log(`[Prebundled] 目录实体同步更新: ${config?.name || file}`)
                synced++
              } else {
                console.log(`[Prebundled] 补登记残留实体: ${config?.name || file}`)
                adoptedNew++
              }
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
      // asar 实体按文件名版本分发：同名但内容哈希不一致时说明发行包已重建，
      // 需要按「发行包即权威」同步，否则升级后仍旧运行旧页面。
      // 同步只覆盖 unpacked 侧车中发行包分发的文件，用户运行时配置保留。
      let asarChanged = false
      if (syncAsarEntity(srcEntity, destEntity)) {
        asarChanged = true
        console.log(`[Prebundled] asar 实体同步更新: ${file}`)
      }
      // 登记缺失时把残留实体补回来。
      if (asarChanged || !registeredPaths.has(destEntity.toLowerCase())) {
        const config = readPrebundledPluginJson(srcEntity)
        try {
          const result = await pluginsAPI.installer.adoptExistingEntity(destEntity)
          if (result?.success) {
            if (result.adopted) {
              console.log(`[Prebundled] 补登记残留实体: ${config?.name || file}`)
              adoptedNew++
            } else if (asarChanged) {
              synced++
            }
          } else {
            console.warn('[Prebundled] 补登记失败:', file, result?.error || '未知错误')
          }
        } catch (error) {
          console.warn('[Prebundled] 补登记异常:', file, error)
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
