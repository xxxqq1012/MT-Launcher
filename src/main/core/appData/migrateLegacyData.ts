import fs from 'fs'
import os from 'os'
import path from 'path'
import { getZToolsRoot } from './appDataPaths'

/**
 * 首次运行数据迁移（便携版/自定义数据目录开箱即用）。
 *
 * 背景：数据根目录可配置后，便携版默认落到 `<解压目录>/data`，旧版数据在
 * `~/.ztools`。为避免"换目录后插件/设置全丢"，首次启动（当前根未初始化且
 * 旧根存在数据）自动把核心数据子目录复制到新根，并以 `.mt-data-initialized`
 * 标记防重复。复制不删除旧数据，用户可随时清理。
 */

const INIT_MARKER = '.mt-data-initialized'

/** 需要随根目录迁移的核心数据子目录（不含可重建的 Chromium 缓存） */
const DATA_DIRS = [
  'plugins',
  'plugins-data',
  'lmdb',
  'clipboard',
  'avatar',
  'extends',
  'temp',
  'logs'
]

export function migrateLegacyDataIfNeeded(): void {
  const root = getZToolsRoot()
  const legacy = path.join(os.homedir(), '.ztools')

  // 根目录未变（开发模式/默认路径）无需迁移。
  if (path.resolve(root) === path.resolve(legacy)) return

  const marker = path.join(root, INIT_MARKER)
  if (fs.existsSync(marker)) return

  let migrated = 0
  if (fs.existsSync(legacy)) {
    for (const dir of DATA_DIRS) {
      const src = path.join(legacy, dir)
      const dest = path.join(root, dir)
      if (fs.existsSync(src) && !fs.existsSync(dest)) {
        try {
          fs.cpSync(src, dest, { recursive: true })
          migrated++
        } catch (error) {
          console.warn(`[AppData] 迁移目录失败: ${dir}`, error)
        }
      }
    }
  }

  fs.mkdirSync(root, { recursive: true })
  fs.writeFileSync(marker, '1')
  console.log(
    `[AppData] 首次运行数据目录初始化完成: ${legacy} -> ${root}（迁移 ${migrated} 个数据目录）`
  )
}
