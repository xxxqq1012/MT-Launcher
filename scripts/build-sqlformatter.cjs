// 构建 sql-formatter 基础插件（页面 + wjz-sqlFormat 引擎）
// 用法: node scripts/build-sqlformatter.cjs
// 输入: plugins/sqlformatter/（页面与 preload，已由 patch-sqlformatter.cjs 接入引擎桥）
//       + D:\Datas\mTools\wjz-sqlFormat\{jar,lib,cfg}
// 输出: dist-plugins/sql-formatter-1.0.0-<hash8>.asar (+ .asar.unpacked 侧车)
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const asar = require('@electron/asar')

const ROOT = path.resolve(__dirname, '..')
const SRC_DIR = path.join(ROOT, 'plugins', 'sqlformatter')
const BUILD_DIR = path.join(SRC_DIR, 'build')
const ENGINE_DIR = 'D:\\Datas\\mTools\\wjz-sqlFormat'
const OUT_DIR = path.join(ROOT, 'dist-plugins')
const TMP_ASAR = path.join(SRC_DIR, 'sqlformatter.tmp.asar')

async function main() {
  // 1. 组装构建目录（页面/preload + 引擎文件）
  fs.rmSync(BUILD_DIR, { recursive: true, force: true })
  fs.mkdirSync(path.join(BUILD_DIR, 'lib'), { recursive: true })
  for (const f of [
    'plugin.json',
    'preload.cjs',
    'index.html',
    'logo.png',
    'LICENSE',
    'THIRD_PARTY_NOTICES.md'
  ]) {
    const src = path.join(SRC_DIR, f)
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(BUILD_DIR, f))
  }
  fs.cpSync(path.join(SRC_DIR, 'assets'), path.join(BUILD_DIR, 'assets'), { recursive: true })
  // 内置便携 JRE（unpacked 侧车，随插件分发，无需用户机器安装 Java）
  if (fs.existsSync(path.join(SRC_DIR, 'jre'))) {
    fs.cpSync(path.join(SRC_DIR, 'jre'), path.join(BUILD_DIR, 'jre'), { recursive: true })
  }
  const engineFiles = fs
    .readdirSync(ENGINE_DIR)
    .filter((n) => !/\.(doc|bat)$/i.test(n) && n !== 'lib')
  for (const f of engineFiles) {
    if (f.endsWith('.asar')) continue // 不把旧插件 asar 打进新包
    fs.copyFileSync(path.join(ENGINE_DIR, f), path.join(BUILD_DIR, f))
  }
  const libSrc = path.join(ENGINE_DIR, 'lib')
  if (fs.existsSync(libSrc)) {
    for (const f of fs.readdirSync(libSrc)) {
      fs.copyFileSync(path.join(libSrc, f), path.join(BUILD_DIR, 'lib', f))
    }
  }
  if (!fs.existsSync(path.join(BUILD_DIR, 'wjz-sqlFormat-1.3.jar'))) {
    console.error('[build-sqlformatter] 引擎 jar 缺失: ' + ENGINE_DIR)
    process.exit(1)
  }

  // 2. 打包 asar（jar/lib/cfg 走 unpacked 侧车，供 java 子进程直接访问）
  fs.rmSync(TMP_ASAR, { force: true })
  await asar.createPackageWithOptions(BUILD_DIR, TMP_ASAR, {
    unpack: '**/{wjz-sqlFormat-1.3.jar,**/lib/**,**/*.cfg,**/jre/**}'
  })
  finalize()
}

function finalize() {
  const buf = fs.readFileSync(TMP_ASAR)
  const hash8 = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 8)
  const dest = path.join(OUT_DIR, `sql-formatter-1.0.0-${hash8}.asar`)
  fs.rmSync(dest, { force: true })
  fs.rmSync(dest + '.unpacked', { recursive: true, force: true })
  fs.copyFileSync(TMP_ASAR, dest)
  const unpackSrc = TMP_ASAR + '.unpacked'
  if (fs.existsSync(unpackSrc)) {
    fs.cpSync(unpackSrc, dest + '.unpacked', { recursive: true })
  }
  fs.rmSync(TMP_ASAR, { force: true })
  fs.rmSync(unpackSrc, { recursive: true, force: true })
  fs.rmSync(BUILD_DIR, { recursive: true, force: true })

  console.log('[build-sqlformatter] 完成: ' + path.basename(dest))
  const entries = fs.readdirSync(dest + '.unpacked', { recursive: true })
  console.log('[build-sqlformatter] unpacked 文件数: ' + entries.length)
}

main().catch((e) => {
  console.error('[build-sqlformatter] 构建失败: ' + e.message)
  process.exit(1)
})
