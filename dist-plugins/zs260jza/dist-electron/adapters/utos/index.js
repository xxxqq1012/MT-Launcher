'use strict'
Object.defineProperty(exports, '__esModule', { value: true })
require('../shared/bridge')
const lock_1 = require('../../core/lock')
const windows_1 = require('../platform/windows')
const service = (0, lock_1.createLockService)({
  scan: windows_1.scanWindowsPath,
  killProcesses: windows_1.killWindowsProcesses
})
let initialPath
function readPayloadPath(payload) {
  if (typeof payload === 'string') {
    return payload
  }
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const itemPath = readPayloadPath(item)
      if (itemPath) {
        return itemPath
      }
    }
    return undefined
  }
  if (payload && typeof payload === 'object') {
    const record = payload
    if (typeof record.path === 'string') {
      return record.path
    }
    if (typeof record.filePath === 'string') {
      return record.filePath
    }
    return readPayloadPath(record.files)
  }
  return undefined
}
window.utools?.onPluginEnter?.((action) => {
  if (action.type !== 'files') {
    return
  }
  // 接收超级面板传入的文件或文件夹路径，页面已加载时立即通知，未加载时先缓存。
  const selectedPath = readPayloadPath(action.payload)
  if (!selectedPath) {
    return
  }
  initialPath = selectedPath
  window.dispatchEvent(
    new CustomEvent('fileUnlocker:pathSelected', { detail: { path: selectedPath } })
  )
})
window.fileUnlocker = {
  async selectPath() {
    return undefined
  },
  getInitialPath() {
    return initialPath
  },
  scanPath: service.scanPath,
  killAndRescan: service.killAndRescan,
  getPathForFile(file) {
    const dragFile = file
    return dragFile.path || file.webkitRelativePath || undefined
  }
}
