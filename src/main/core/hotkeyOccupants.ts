import { execFile } from 'child_process'

/**
 * 全局热键占用者候选匹配。
 *
 * Windows 没有公开 API 可直接枚举「哪个进程注册了某个全局热键」，
 * 因此采用「常见占用软件静态库 + 当前正在运行的进程」交叉匹配：
 * 命中该组合键的常见占用软件若正在运行，则优先列出；即使未运行也给出
 * 常见候选供用户排查。进程名列表来自 tasklist 枚举。
 */

export interface OccupantCandidate {
  /** 展示名（软件/类别） */
  name: string
  /** 对应的可执行文件进程名（不含路径，全小写比较） */
  processNames: string[]
  /** 当前是否有对应进程正在运行 */
  running: boolean
}

/** 单个候选：组合键精确匹配 或 修饰键规则匹配 */
interface OccupantRule {
  /** 精确组合键（大小写不敏感，Win/Super 归一为 Win） */
  combos?: string[]
  /** 修饰键规则（组合键拆解后的子串包含关系） */
  pattern?: string[]
  name: string
  processNames: string[]
}

const OCCUPANT_RULES: OccupantRule[] = [
  // ===== 精确组合（与插件预设数据对应） =====
  {
    combos: ['Ctrl+Alt+A'],
    name: '微信 / QQ / 钉钉（全局截图）',
    processNames: ['WeChat.exe', 'Weixin.exe', 'QQ.exe', 'QQNT.exe', 'DingTalk.exe']
  },
  {
    combos: ['Ctrl+Alt+S'],
    name: 'QQ 录屏 / 网易云音乐（全局热键）',
    processNames: ['QQ.exe', 'QQNT.exe', 'cloudmusic.exe']
  },
  {
    combos: ['Ctrl+Shift+F'],
    name: '微软拼音 / 搜狗输入法（简繁切换）',
    processNames: ['ChsIME.exe', 'PinyinIME.exe', 'SogouImeBroker.exe', 'SogouIme.exe']
  },
  {
    combos: ['Alt+Z'],
    name: 'NVIDIA GeForce Experience（游戏内覆盖）',
    processNames: ['GeForceExperience.exe', 'nvcontainer.exe', 'NVIDIA Share.exe']
  },
  {
    combos: ['Alt+R'],
    name: 'NVIDIA / AMD 显卡驱动（性能图层）',
    processNames: [
      'GeForceExperience.exe',
      'nvcontainer.exe',
      'radeonsoftware.exe',
      'RadeonSoftware.exe'
    ]
  },
  {
    combos: ['Ctrl+Alt+P'],
    name: '网易云音乐 / QQ音乐（播放暂停）',
    processNames: ['cloudmusic.exe', 'QQMusic.exe']
  },
  {
    combos: ['Ctrl+Alt+D'],
    name: '网易云桌面歌词 / 欧路词典（划词翻译）',
    processNames: ['cloudmusic.exe', 'eudic.exe']
  },
  {
    combos: ['Ctrl+Alt+W'],
    name: '微信（打开主窗口全局呼出）',
    processNames: ['WeChat.exe', 'Weixin.exe']
  },
  {
    combos: ['Ctrl+Alt+Z'],
    name: 'QQ（提取未读消息全局热键）',
    processNames: ['QQ.exe', 'QQNT.exe']
  },
  {
    combos: ['Ctrl+Space'],
    name: '系统输入法（中英文切换）',
    processNames: [
      'ChsIME.exe',
      'PinyinIME.exe',
      'SogouImeBroker.exe',
      'SogouIme.exe',
      'WubiLex.exe'
    ]
  },
  {
    combos: ['Ctrl+Alt+Up'],
    name: 'Intel 核显控制面板（屏幕旋转）',
    processNames: ['igfxTray.exe', 'igfxHK.exe', 'igfxCUIService.exe', 'igfxext.exe']
  },
  {
    combos: ['Ctrl+Alt+Down'],
    name: 'Intel 核显 / 网易云音乐（音量调节）',
    processNames: ['igfxTray.exe', 'igfxHK.exe', 'igfxCUIService.exe', 'cloudmusic.exe']
  },
  {
    combos: ['F1'],
    name: 'Snipaste / PixPin（截图触发键）',
    processNames: ['Snipaste.exe', 'PixPin.exe']
  },
  { combos: ['Win+L'], name: 'Windows 系统（锁定屏幕保留热键）', processNames: [] },

  // ===== 常见修饰键规则（自定义组合回退） =====
  {
    pattern: ['Ctrl', 'Alt'],
    name: '截图 / 录屏工具',
    processNames: [
      'Snipaste.exe',
      'PixPin.exe',
      'QQ.exe',
      'QQNT.exe',
      'WeChat.exe',
      'Weixin.exe',
      'DingTalk.exe',
      'Bandicam.exe',
      'OBS Studio.exe',
      'obs64.exe'
    ]
  },
  {
    pattern: ['Alt'],
    name: '显卡驱动 / 音乐软件全局热键',
    processNames: [
      'GeForceExperience.exe',
      'nvcontainer.exe',
      'radeonsoftware.exe',
      'igfxTray.exe',
      'igfxHK.exe',
      'cloudmusic.exe',
      'QQMusic.exe'
    ]
  },
  {
    pattern: ['Ctrl', 'Shift'],
    name: '输入法 / 文字服务全局热键',
    processNames: [
      'ChsIME.exe',
      'PinyinIME.exe',
      'SogouImeBroker.exe',
      'SogouIme.exe',
      'WubiLex.exe'
    ]
  },
  {
    pattern: ['Ctrl', 'Space'],
    name: '系统输入法（中英文切换）',
    processNames: ['ChsIME.exe', 'PinyinIME.exe', 'SogouImeBroker.exe', 'SogouIme.exe']
  }
]

/** 进程名缓存（5 秒有效，避免每个热键都跑一次 tasklist） */
let cachedProcessNames: Set<string> | null = null
let cacheExpireAt = 0
const CACHE_TTL_MS = 5000

/**
 * 枚举当前正在运行的进程可执行文件名（小写）。
 * @returns 进程文件名集合（如 "wechat.exe"）。
 */
function getRunningProcessNames(): Promise<Set<string>> {
  const now = Date.now()
  if (cachedProcessNames && now < cacheExpireAt) {
    return Promise.resolve(cachedProcessNames)
  }
  return new Promise((resolve) => {
    execFile(
      'tasklist.exe',
      ['/FO', 'CSV', '/NH'],
      { windowsHide: true, timeout: 4000 },
      (error, stdout) => {
        const names = new Set<string>()
        if (!error && stdout) {
          const lines = stdout.split(/\r?\n/)
          for (const line of lines) {
            const match = /^"([^"]+)"/.exec(line)
            if (match && match[1]) names.add(match[1].toLowerCase())
          }
        }
        cachedProcessNames = names
        cacheExpireAt = now + CACHE_TTL_MS
        resolve(names)
      }
    )
  })
}

/** 归一化组合键：转小写，并把 Super / Win 统一为 win */
function normalizeCombo(combo: string): string {
  return combo
    .toLowerCase()
    .replace(/\bsuper\b/g, 'win')
    .replace(/\s+/g, '')
}

/**
 * 匹配指定组合键的可能占用程序。
 * @param shortcut 组合键（如 "Ctrl+Alt+A"）。
 * @returns 候选列表；空数组表示无法给出候选。
 */
export async function matchOccupantCandidates(shortcut: string): Promise<OccupantCandidate[]> {
  if (typeof shortcut !== 'string' || !shortcut.trim()) return []
  const running = await getRunningProcessNames()
  const normalized = normalizeCombo(shortcut)
  const parts = normalized.split('+')
  const candidates: OccupantCandidate[] = []
  const seen = new Set<string>()

  const pushCandidate = (rule: OccupantRule): void => {
    if (seen.has(rule.name)) return
    seen.add(rule.name)
    const runningProcesses = rule.processNames.filter((p) => running.has(p.toLowerCase()))
    candidates.push({
      name: rule.name,
      processNames: rule.processNames,
      running: runningProcesses.length > 0
    })
  }

  for (const rule of OCCUPANT_RULES) {
    if (rule.combos && rule.combos.some((c) => normalizeCombo(c) === normalized)) {
      pushCandidate(rule)
      continue
    }
    if (!rule.combos && rule.pattern) {
      const matched = rule.pattern.every((mod) => parts.includes(mod.toLowerCase()))
      if (matched) pushCandidate(rule)
    }
  }

  // 精确命中时只保留最相关的候选；规则命中可能同时匹配多条，保留全部但去重。
  return candidates
}
