import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { app } from 'electron'
import { DATA_PATH_CONFIG_FILE, getZToolsRoot } from '../../src/main/core/appData/appDataPaths'

vi.mock('electron', () => ({
  app: { getPath: vi.fn() }
}))

describe('getZToolsRoot 数据目录解析优先级', () => {
  const originalExecPath = process.execPath
  const existingDataRoot = process.env.ZTOOLS_DATA_ROOT
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'mtl-dataroot-'))
  let packagedValue = false

  beforeEach(() => {
    packagedValue = false
    if (existingDataRoot === undefined) {
      delete process.env.ZTOOLS_DATA_ROOT
    } else {
      process.env.ZTOOLS_DATA_ROOT = existingDataRoot
    }
    Object.defineProperty(process, 'execPath', {
      value: originalExecPath,
      configurable: true
    })
    Object.defineProperty(app, 'isPackaged', {
      get: () => packagedValue,
      configurable: true
    })
  })

  afterEach(() => {
    Object.defineProperty(process, 'execPath', {
      value: originalExecPath,
      configurable: true
    })
  })

  it('开发模式（非打包）默认使用 ~/.ztools', () => {
    expect(getZToolsRoot()).toBe(path.join(os.homedir(), '.ztools'))
  })

  it('环境变量 ZTOOLS_DATA_ROOT 优先于一切', () => {
    process.env.ZTOOLS_DATA_ROOT = path.join(tmpBase, 'env-root')
    expect(getZToolsRoot()).toBe(path.join(tmpBase, 'env-root'))
  })

  it('打包版读取 exe 同目录引导文件 mt-data-path.txt', () => {
    packagedValue = true
    const exeDir = path.join(tmpBase, 'app-install')
    fs.mkdirSync(exeDir, { recursive: true })
    const dataRoot = path.join('D:', 'MT-Data', 'my-data')
    fs.writeFileSync(path.join(exeDir, DATA_PATH_CONFIG_FILE), `${dataRoot}\r\n`, 'utf8')
    Object.defineProperty(process, 'execPath', {
      value: path.join(exeDir, 'MTLauncher.exe'),
      configurable: true
    })
    expect(getZToolsRoot()).toBe(dataRoot)
  })

  it('打包版无引导文件时默认程序根目录 data/（便携版）', () => {
    packagedValue = true
    const exeDir = path.join(tmpBase, 'portable')
    fs.mkdirSync(exeDir, { recursive: true })
    Object.defineProperty(process, 'execPath', {
      value: path.join(exeDir, 'MTLauncher.exe'),
      configurable: true
    })
    expect(getZToolsRoot()).toBe(path.join(exeDir, 'data'))
  })

  it('引导文件内容为空或非法路径时回退便携默认', () => {
    packagedValue = true
    const exeDir = path.join(tmpBase, 'portable-empty')
    fs.mkdirSync(exeDir, { recursive: true })
    fs.writeFileSync(path.join(exeDir, DATA_PATH_CONFIG_FILE), '   \r\n', 'utf8')
    Object.defineProperty(process, 'execPath', {
      value: path.join(exeDir, 'MTLauncher.exe'),
      configurable: true
    })
    expect(getZToolsRoot()).toBe(path.join(exeDir, 'data'))
  })
})
