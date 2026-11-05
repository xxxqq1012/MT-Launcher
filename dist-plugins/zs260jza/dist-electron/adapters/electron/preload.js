'use strict'
Object.defineProperty(exports, '__esModule', { value: true })
const electron_1 = require('electron')
const bridge = {
  selectPath() {
    return electron_1.ipcRenderer.invoke('fileUnlocker:selectPath')
  },
  scanPath(path, options) {
    return electron_1.ipcRenderer.invoke('fileUnlocker:scanPath', path, options)
  },
  cancelScan(scanId) {
    return electron_1.ipcRenderer.invoke('fileUnlocker:cancelScan', scanId)
  },
  killAndRescan(path, pids, options) {
    return electron_1.ipcRenderer.invoke('fileUnlocker:killAndRescan', path, pids, options)
  },
  getPathForFile(file) {
    return electron_1.webUtils.getPathForFile(file)
  },
  controlWindow(action) {
    return electron_1.ipcRenderer.invoke('fileUnlocker:controlWindow', action)
  }
}
electron_1.contextBridge.exposeInMainWorld('fileUnlocker', bridge)
