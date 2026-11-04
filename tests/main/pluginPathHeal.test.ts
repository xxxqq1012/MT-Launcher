import { describe, expect, it } from 'vitest'
import {
  healPluginPaths,
  relocateLogoUrl,
  relocatePluginPaths
} from '../../src/main/core/appData/pluginPathHeal'

const noBundled = () => false

const existsOf = (existing: string[]) => (filePath: string) => existing.includes(filePath)

function makeCallbacks(existing: string[], logoByPath: Record<string, string>) {
  return {
    exists: existsOf(existing),
    rebuildLogo: (pluginPath: string) => logoByPath[pluginPath] ?? '',
    isBundled: noBundled
  }
}

describe('healPluginPaths 自愈失效插件路径', () => {
  it('path 不存在且当前数据根 plugins 下存在同名实体时重定位并重算 logo', () => {
    const plugins: any[] = [
      {
        name: 'sql-format',
        path: 'C:\\old\\MT\\data\\plugins\\sql-format',
        logo: 'file:///C:/old/MT/data/plugins/sql-format/logo.png'
      },
      {
        name: 'json-editor',
        path: 'C:\\old\\MT\\data\\plugins\\json-editor',
        logo: 'file:///C:/old/MT/data/plugins/json-editor/logo.png'
      }
    ]
    const healed = healPluginPaths(plugins, 'D:\\myData\\MT Launcher Datas\\plugins', {
      exists: existsOf([
        'D:\\myData\\MT Launcher Datas\\plugins\\sql-format',
        'D:\\myData\\MT Launcher Datas\\plugins\\json-editor'
      ]),
      rebuildLogo: (p) => `file:///${p.replace(/\\/g, '/')}/logo.png`,
      isBundled: noBundled
    })
    expect(healed).toBe(2)
    expect(plugins[0].path).toBe('D:\\myData\\MT Launcher Datas\\plugins\\sql-format')
    expect(plugins[0].logo).toBe('file:///D:/myData/MT Launcher Datas/plugins/sql-format/logo.png')
    expect(plugins[1].path).toBe('D:\\myData\\MT Launcher Datas\\plugins\\json-editor')
  })

  it('path 仍然有效时不重定位', () => {
    const plugins: any[] = [{ name: 'ok', path: 'D:\\data\\plugins\\ok', logo: '' }]
    const healed = healPluginPaths(plugins, 'D:\\data\\plugins', {
      exists: existsOf(['D:\\data\\plugins\\ok']),
      rebuildLogo: () => '',
      isBundled: noBundled
    })
    expect(healed).toBe(0)
    expect(plugins[0].path).toBe('D:\\data\\plugins\\ok')
  })

  it('候选实体不存在时不重定位', () => {
    const plugins: any[] = [{ name: 'gone', path: 'C:\\old\\plugins\\gone', logo: '' }]
    const healed = healPluginPaths(plugins, 'D:\\new\\plugins', {
      exists: existsOf([]),
      rebuildLogo: () => '',
      isBundled: noBundled
    })
    expect(healed).toBe(0)
    expect(plugins[0].path).toBe('C:\\old\\plugins\\gone')
  })

  it('开发插件与内置插件不参与自愈', () => {
    const plugins: any[] = [
      { name: 'dev-plugin__dev', path: 'C:\\dev\\x', logo: '', isDevelopment: true },
      { name: 'setting', path: 'C:\\app\\resources\\internal-plugins\\setting', logo: '' }
    ]
    const healed = healPluginPaths(plugins, 'D:\\new\\plugins', {
      exists: existsOf([]),
      rebuildLogo: () => '',
      isBundled: (name) => name === 'setting'
    })
    expect(healed).toBe(0)
  })
})

describe('relocatePluginPaths 数据迁移后重定位注册表路径', () => {
  it('旧根前缀的 path 与 file:// logo 一并切到新根', () => {
    const plugins: any[] = [
      {
        name: 'sql-format',
        path: 'C:\\old\\MT\\data\\plugins\\sql-format',
        logo: 'file:///C:/old/MT/data/plugins/sql-format/logo.png'
      }
    ]
    const count = relocatePluginPaths(plugins, 'C:\\old\\MT\\data', 'D:\\myData\\MT Launcher Datas')
    expect(count).toBe(1)
    expect(plugins[0].path).toBe('D:\\myData\\MT Launcher Datas\\plugins\\sql-format')
    expect(plugins[0].logo).toBe(
      'file:///D:/myData/MT%20Launcher%20Datas/plugins/sql-format/logo.png'
    )
  })

  it('path 恰等于旧根时直接替换为新根', () => {
    const plugins: any[] = [{ name: 'x', path: 'C:\\old\\root', logo: '' }]
    const count = relocatePluginPaths(plugins, 'C:\\old\\root', 'D:\\new\\root')
    expect(count).toBe(1)
    expect(plugins[0].path).toBe('D:\\new\\root')
  })

  it('前缀不匹配（内置/开发/外部路径）保持原样，Windows 路径大小写不敏感', () => {
    const plugins: any[] = [
      { name: 'setting', path: 'C:\\app\\resources\\internal-plugins\\setting', logo: '' },
      {
        name: 'match',
        path: 'c:\\old\\root\\plugins\\a',
        logo: 'file:///C:/old/root/plugins/a/logo.png'
      }
    ]
    const count = relocatePluginPaths(plugins, 'C:\\OLD\\ROOT', 'D:\\new\\root')
    expect(count).toBe(1)
    expect(plugins[0].path).toBe('C:\\app\\resources\\internal-plugins\\setting')
    expect(plugins[1].path).toBe('D:\\new\\root\\plugins\\a')
  })

  it('空参数返回 0', () => {
    const count = relocatePluginPaths([], '', '')
    expect(count).toBe(0)
  })
})

describe('relocateLogoUrl file:// logo URL 重定位', () => {
  it('URL 编码（空格/中文）还原后按前缀替换', () => {
    const logo = 'file:///C:/old/MT%20Launcher%20Datas/plugins/sql-format/logo.png'
    expect(relocateLogoUrl(logo, 'C:\\old\\MT Launcher Datas', 'D:\\new\\Datas')).toBe(
      'file:///D:/new/Datas/plugins/sql-format/logo.png'
    )
  })

  it('非 file:// 或前缀不匹配时原样返回', () => {
    expect(relocateLogoUrl('data:image/png;base64,xx', 'C:\\old', 'D:\\new')).toBe(
      'data:image/png;base64,xx'
    )
    expect(relocateLogoUrl('file:///C:/other/plugins/a/logo.png', 'C:\\old', 'D:\\new')).toBe(
      'file:///C:/other/plugins/a/logo.png'
    )
  })
})
