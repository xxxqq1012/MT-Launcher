// 检查本次 cmark 内置化改动的 TS 文件（node ESLint API，不落盘修复）
import { ESLint } from 'eslint'

const eslint = new ESLint({ fix: false, cache: false })
const files = ['src/main/core/internalPlugins.ts']
const results = await eslint.lintFiles(files)
let err = 0
let warn = 0
for (const r of results) {
  err += r.errorCount
  warn += r.warningCount
  console.log(`\n== ${r.filePath}  errors=${r.errorCount} warnings=${r.warningCount}`)
  for (const m of r.messages) {
    console.log(
      `   [${m.severity === 2 ? 'error' : 'warn'}] ${m.ruleId || 'parse'}: ${m.message} (line ${m.line || '-'}:${m.column || '-'})`
    )
  }
}
console.log(`\nTOTAL errors=${err} warnings=${warn}`)
process.exit(err > 0 ? 1 : 0)
