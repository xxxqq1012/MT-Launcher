import path from 'path'
import { app } from 'electron'
import { physicalFs } from '../../utils/physicalFs'
import { getPluginsPath } from '../appData/appDataPaths'
import { readUToolsPluginJson } from './utoolsImporter'
import type { PluginsAPI } from '../../api/renderer/plugins'

/**
 * 预置基础插件：随发行包分发的插件实体（resources/dist-plugins/*.asar）。
 *
 * 目的：安装版/便携版开箱即用，无需用户手动从 uTools 导入。
 * 首次启动扫描预置目录，未登记的插件复制到数据目录插件根并走
 * adoptExistingEntity 官方登记链路；已存在同名实体时跳过（幂等）。
 */

export function getPrebundledPluginsDir(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, 'dist-plugins')
  // 开发模式直接指向仓库目录，便于本地联调。
  return path.join(app.getAppPath(), 'dist-plugins')
}

export async function adoptPrebundledPlugins(pluginsAPI: PluginsAPI): Promise<void> {
  const dir = getPrebundledPluginsDir()
  if (!physicalFs.existsSync(dir)) return

  const asarFiles = physicalFs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.asar'))
    .sort()
  if (asarFiles.length === 0) return

  const pluginsRoot = getPluginsPath()
  physicalFs.mkdirSync(pluginsRoot, { recursive: true })

  let adoptedNew = 0
  let skipped = 0
  for (const file of asarFiles) {
    const srcAsar = path.join(dir, file)
    const destAsar = path.join(pluginsRoot, file)
    if (physicalFs.existsSync(destAsar)) {
      skipped++
      continue
    }

    const config = readUToolsPluginJson(srcAsar)
    if (!config?.name) {
      console.warn('[Prebundled] 跳过无法解析 plugin.json 的预置实体:', file)
      continue
    }

    try {
      physicalFs.copyFileSync(srcAsar, destAsar)
      const srcUnpacked = `${srcAsar}.unpacked`
      if (physicalFs.existsSync(srcUnpacked)) {
        physicalFs.cpSync(srcUnpacked, `${destAsar}.unpacked`, { recursive: true })
      }
      const result = await pluginsAPI.installer.adoptExistingEntity(destAsar)
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
    `[Prebundled] 预置插件处理完成: 新登记 ${adoptedNew} / 已存在跳过 ${skipped} / 总数 ${asarFiles.length}`
  )
}
