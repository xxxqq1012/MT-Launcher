/**
 * mTools · ESLint 校验脚本（node 工具，ESLint API 方式，非命令行）
 *
 * 用法: node scripts/eslint-check.cjs [文件或目录...]
 * 默认: 校验本次 mTools 改动相关路径（src/main）
 * 退出码: 0=无 error；1=存在 error（warning 不阻断）
 */

const { ESLint } = require('eslint')

async function main() {
  const targets = process.argv.slice(2)
  const files = targets.length ? targets : ['src/main/core/utoolsCompat', 'src/main/api/index.ts']

  const eslint = new ESLint({ cache: false })
  const results = await eslint.lintFiles(files)
  const formatter = await eslint.loadFormatter('stylish')
  const output = formatter.format(results)
  if (output) console.log(output)

  const errorCount = results.reduce((n, r) => n + r.errorCount, 0)
  const warningCount = results.reduce((n, r) => n + r.warningCount, 0)
  console.log(
    `[eslint-check] files=${results.length} errors=${errorCount} warnings=${warningCount}`
  )
  process.exit(errorCount > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('[eslint-check] 执行失败:', err)
  process.exit(2)
})
