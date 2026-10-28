import { ipcMain } from 'electron'
import clipboardManager from '../../managers/clipboardManager'

/**
 * uTools 官方「剪贴板」插件兼容服务（`clipboard.services` IPC）。
 *
 * uTools 官方剪贴板插件（clipboard-4.3.2）依赖 uTools 主程序内置的
 * `clipboard.services` IPC（readAllRecords / clearAllRecords / removeRecords）
 * 读取剪贴板历史记录。MT Launcher 主程序已有自研的剪贴板历史服务
 * （ClipboardManager，记录存 LMDB、图片存 data/clipboard/images），
 * 本适配层将其按 uTools 官方剪贴板插件期望的格式暴露，修复该插件
 * 「读取记录出现错误或超时」问题。
 */
export class ClipboardServicesAPI {
  public init(): void {
    ipcMain.handle('clipboard.services', async (_event, method: string, ...args: any[]) => {
      try {
        switch (method) {
          case 'readAllRecords':
            return await this.readAllRecords()
          case 'clearAllRecords':
            return await this.clearAllRecords()
          case 'removeRecords':
            return await this.removeRecords(args[0])
          default:
            console.warn('[ClipboardServices] 未支持的方法:', method)
            return { error: `unsupported method: ${method}` }
        }
      } catch (error) {
        console.error('[ClipboardServices]', method, '处理失败:', error)
        return { error: error instanceof Error ? error.message : String(error) }
      }
    })
  }

  /**
   * 返回剪贴板历史记录（按时间倒序），格式与 uTools 官方剪贴板插件期望一致：
   * text -> { type:'text', value, timestamp, hash, id }
   * file -> { type:'files', value:[{name,path}], timestamp, hash, id }
   * image -> { type:'image', value: 图片路径, timestamp, hash, id, size }
   */
  private async readAllRecords(): Promise<any[]> {
    const { items } = await clipboardManager.getHistory(1, 1000)
    return (items || [])
      .map((item: any) => {
        if (item.type === 'text') {
          return {
            type: 'text',
            value: item.content ?? '',
            timestamp: item.timestamp,
            hash: item.hash,
            id: item.id
          }
        }
        if (item.type === 'file') {
          const files = (item.files ?? []).map((f: any) => ({
            name: f.name,
            path: f.path
          }))
          return {
            type: 'files',
            value: files,
            timestamp: item.timestamp,
            hash: item.hash,
            id: item.id
          }
        }
        if (item.type === 'image') {
          return {
            type: 'image',
            value: item.imagePath ?? '',
            timestamp: item.timestamp,
            hash: item.hash,
            id: item.id,
            size: item.size ?? 0
          }
        }
        return null
      })
      .filter(Boolean)
  }

  private async clearAllRecords(): Promise<{ ok: boolean }> {
    await clipboardManager.clear()
    return { ok: true }
  }

  private async removeRecords(records?: any[]): Promise<{ ok: boolean }> {
    const list = Array.isArray(records) ? records : []
    for (const record of list) {
      const id = record?.id || record?.hash
      if (id) {
        try {
          await clipboardManager.deleteItem(id)
        } catch (error) {
          console.warn('[ClipboardServices] 删除记录失败:', id, error)
        }
      }
    }
    return { ok: true }
  }
}

export default new ClipboardServicesAPI()
