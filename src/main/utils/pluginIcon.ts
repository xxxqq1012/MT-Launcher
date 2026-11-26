import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

/**
 * 把插件清单中的 logo 值解析为可作为窗口图标的本地物理路径。
 *
 * 宿主登记的 logo 通常是 `file://` URL（asar 实体也走 Electron 虚拟文件系统，
 * patched fs.existsSync 可识别包内路径）；窗口图标（BrowserWindow icon / HICON）
 * 只接受本地路径或 NativeImage，不接受 file:// URL 与网络地址，因此统一在此解码。
 *
 * @param logo 插件登记的 logo 字段（file:// URL / 绝对路径 / 相对路径 / 网络地址 / 空）
 * @param pluginPath 插件实体路径（目录或 .asar），logo 为相对路径时基于它拼接
 * @returns 存在的本地图标绝对路径；无法作为本地窗口图标时返回 null
 */
export function resolvePluginIconPath(logo: unknown, pluginPath?: string): string | null {
  if (typeof logo !== 'string' || !logo.trim()) return null
  const raw = logo.trim()

  // 网络地址 / data URL 不能作为本地窗口图标。
  if (/^(https?:|data:)/i.test(raw)) return null

  let absolutePath: string
  if (raw.startsWith('file:')) {
    try {
      absolutePath = fileURLToPath(raw)
    } catch {
      return null
    }
  } else if (path.isAbsolute(raw)) {
    absolutePath = raw
  } else if (pluginPath) {
    absolutePath = path.join(pluginPath, raw)
  } else {
    return null
  }

  try {
    if (!fs.existsSync(absolutePath)) return null
  } catch {
    return null
  }
  return absolutePath
}
