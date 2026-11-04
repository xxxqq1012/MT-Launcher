import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const shimPath = path.resolve(
  __dirname,
  '../../internal-plugins/mindnote/public/mindnote-utools-shim.js'
)

let tmpRoot: string
let userData: string
let wsRoot: string

function loadShim(): { db: any } {
  delete require.cache[require.resolve(shimPath)]
  const mod = require(shimPath) as { installUtoolsShim: () => any }
  return mod.installUtoolsShim()
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mindnote-shim-'))
  userData = path.join(tmpRoot, 'userData')
  fs.mkdirSync(userData, { recursive: true })
  // 默认布局：工作区本身就是 .mindnote（3.2.24 起 data\.mindnote），数据目录=工作区
  wsRoot = path.join(userData, '.mindnote')
  fs.mkdirSync(wsRoot, { recursive: true })
  fs.writeFileSync(
    path.join(userData, 'cmark-config.json'),
    JSON.stringify({ workspace: wsRoot }),
    'utf8'
  )
  ;(globalThis as any).window = {
    ztools: { getPath: (name: string) => (name === 'userData' ? userData : '') },
    __znotesGit: { noteEditActivity: vi.fn() }
  }
})

afterEach(() => {
  delete (globalThis as any).window
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

describe('mindnote-utools-shim 普通笔记落盘（导入文件/文件夹）', () => {
  it('导入文件：db.put 新笔记 → 工作区 .md 实际落盘，且不产生 md_ 重复条目', () => {
    const { db } = loadShim()
    db.put({
      _id: 'kv/mindnote_note_a1',
      val: { id: 'a1', title: '测试笔记', content: '# hello', folderId: undefined }
    })
    const f = path.join(wsRoot, '测试笔记.md')
    expect(fs.existsSync(f)).toBe(true)
    expect(fs.readFileSync(f, 'utf8')).toBe('# hello')
    const docs = db.allDocs('kv/mindnote_note_')
    expect(docs.some((d: any) => d._id === 'kv/mindnote_note_md_测试笔记')).toBe(false)
    // git 自动同步计时已触发
    expect((globalThis as any).window.__znotesGit.noteEditActivity).toHaveBeenCalled()
  })

  it('编辑同步：内容变化更新文件；内容未变化不重写（mtime 稳定）', () => {
    const { db } = loadShim()
    db.put({ _id: 'kv/mindnote_note_a1', val: { id: 'a1', title: '测试笔记', content: '# v1' } })
    const f = path.join(wsRoot, '测试笔记.md')
    db.put({ _id: 'kv/mindnote_note_a1', val: { id: 'a1', title: '测试笔记', content: '# v2' } })
    expect(fs.readFileSync(f, 'utf8')).toBe('# v2')
    const m1 = fs.statSync(f).mtimeMs
    db.put({ _id: 'kv/mindnote_note_a1', val: { id: 'a1', title: '测试笔记', content: '# v2' } })
    expect(fs.statSync(f).mtimeMs).toBe(m1)
  })

  it('重命名：title 变更 → 旧文件改名迁移', () => {
    const { db } = loadShim()
    db.put({ _id: 'kv/mindnote_note_a1', val: { id: 'a1', title: '旧名', content: 'x' } })
    expect(fs.existsSync(path.join(wsRoot, '旧名.md'))).toBe(true)
    db.put({ _id: 'kv/mindnote_note_a1', val: { id: 'a1', title: '新名', content: 'x' } })
    expect(fs.existsSync(path.join(wsRoot, '旧名.md'))).toBe(false)
    expect(fs.readFileSync(path.join(wsRoot, '新名.md'), 'utf8')).toBe('x')
  })

  it('删除：remove 笔记 → 对应 .md 删除', () => {
    const { db } = loadShim()
    db.put({ _id: 'kv/mindnote_note_a1', val: { id: 'a1', title: '待删', content: 'x' } })
    expect(fs.existsSync(path.join(wsRoot, '待删.md'))).toBe(true)
    db.remove('kv/mindnote_note_a1')
    expect(fs.existsSync(path.join(wsRoot, '待删.md'))).toBe(false)
  })

  it('导入文件夹：folder 树 → 笔记落盘到对应子目录，且子目录文件不重复生成 md_ 条目', () => {
    const { db } = loadShim()
    db.put({
      _id: 'kv/mindnote_folder_list',
      val: [{ id: 'f1', name: 'Android', parentId: undefined }]
    })
    db.put({
      _id: 'kv/mindnote_note_b1',
      val: { id: 'b1', title: 'SDK闪退', folderId: 'f1', content: 'c' }
    })
    expect(fs.existsSync(path.join(wsRoot, 'Android', 'SDK闪退.md'))).toBe(true)
    expect(fs.readFileSync(path.join(wsRoot, 'Android', 'SDK闪退.md'), 'utf8')).toBe('c')
    const docs = db.allDocs('kv/mindnote_note_')
    expect(docs.some((d: any) => d._id === 'kv/mindnote_note_md_Android__SDK闪退')).toBe(false)
  })

  it('同名冲突：目标文件被外部文件占用 → title 自动加 " (n)" 去重', () => {
    const { db } = loadShim()
    fs.writeFileSync(path.join(wsRoot, 't1.md'), 'external', 'utf8')
    db.put({ _id: 'kv/mindnote_note_c1', val: { id: 'c1', title: 't1', content: 'mine' } })
    expect(fs.readFileSync(path.join(wsRoot, 't1.md'), 'utf8')).toBe('external')
    expect(fs.existsSync(path.join(wsRoot, 't1 (2).md'))).toBe(true)
    expect(fs.readFileSync(path.join(wsRoot, 't1 (2).md'), 'utf8')).toBe('mine')
  })

  it('同名冲突：目标被另一篇普通笔记映射 → 第二篇自动去重', () => {
    const { db } = loadShim()
    db.put({ _id: 'kv/mindnote_note_d1', val: { id: 'd1', title: 'same', content: 'one' } })
    db.put({ _id: 'kv/mindnote_note_d2', val: { id: 'd2', title: 'same', content: 'two' } })
    expect(fs.existsSync(path.join(wsRoot, 'same.md'))).toBe(true)
    expect(fs.existsSync(path.join(wsRoot, 'same (2).md'))).toBe(true)
    expect(fs.readFileSync(path.join(wsRoot, 'same.md'), 'utf8')).toBe('one')
    expect(fs.readFileSync(path.join(wsRoot, 'same (2).md'), 'utf8')).toBe('two')
  })

  it('历史空笔记不落盘；内容非空后才落盘', () => {
    const { db } = loadShim()
    db.put({ _id: 'kv/mindnote_note_e1', val: { id: 'e1', title: '空笔记', content: '' } })
    expect(fs.existsSync(path.join(wsRoot, '空笔记.md'))).toBe(false)
    db.put({
      _id: 'kv/mindnote_note_e1',
      val: { id: 'e1', title: '空笔记', content: 'now has content' }
    })
    expect(fs.existsSync(path.join(wsRoot, '空笔记.md'))).toBe(true)
  })
})

describe('mindnote-utools-shim md 桥（目录一致）', () => {
  it('磁盘子目录 *.md → 合并为 md 笔记并挂到虚拟 folder', () => {
    const { db } = loadShim()
    fs.mkdirSync(path.join(wsRoot, 'git-dir'))
    fs.writeFileSync(path.join(wsRoot, 'git-dir', 'r.md'), '# R', 'utf8')
    const list = db.get('kv/mindnote_note_list').val as any[]
    const mdNote = list.find((n: any) => n.id === 'md_git-dir__r')
    expect(mdNote).toBeTruthy()
    expect(mdNote!.folderId).toBe('md_folder_git-dir')
    const folders = db.get('kv/mindnote_folder_list').val as any[]
    expect(folders.some((f: any) => f.id === 'md_folder_git-dir' && f.name === 'git-dir')).toBe(
      true
    )
    const doc = db.get('kv/mindnote_note_md_git-dir__r')
    expect(doc!.val.content).toBe('# R')
  })

  it('根目录 *.md → 旧 id 兼容（md_<base>）且首次排序稳定', () => {
    const { db } = loadShim()
    fs.writeFileSync(path.join(wsRoot, 'README.md'), '# readme', 'utf8')
    const list = db.get('kv/mindnote_note_list').val as any[]
    const mdNote = list.find((n: any) => n.id === 'md_README')
    expect(mdNote).toBeTruthy()
    const s1 = mdNote!.sortOrder
    const s2 = (db.get('kv/mindnote_note_list').val as any[]).find(
      (n: any) => n.id === 'md_README'
    )!.sortOrder
    expect(s2).toBe(s1)
  })

  it('目录/文件名含 "__" 时 id 编码不歧义', () => {
    const { db } = loadShim()
    fs.mkdirSync(path.join(wsRoot, 'a__b'))
    fs.writeFileSync(path.join(wsRoot, 'a__b', 'c__d.md'), 'x', 'utf8')
    const list = db.get('kv/mindnote_note_list').val as any[]
    // 精确命中：目录段与 base 段都转义（'_'→'_u'），不被 __ 拆散
    expect(list.some((n: any) => n.id === 'md_a_u_ub__c_u_ud')).toBe(true)
    expect(list.some((n: any) => n.id === 'md_a__b__c')).toBe(false)
    // get 按编码 id 可读回内容
    const doc = db.get('kv/mindnote_note_md_a_u_ub__c_u_ud')
    expect(doc!.val.content).toBe('x')
  })
})
