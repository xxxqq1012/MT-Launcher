// 构建 sqlformat 基础插件（wjz-sqlFormat 引擎包装）
// 用法: node scripts/build-sqlformat.cjs
// 输入: plugins/sqlformat/{plugin.json, preload.js} + D:\Datas\mTools\wjz-sqlFormat\{jar,lib,cfg}
// 输出: dist-plugins/sqlformat-1.0.0-<hash8>.asar (+ .asar.unpacked 侧车)
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const asar = require('@electron/asar')

const ROOT = path.resolve(__dirname, '..')
const SRC_DIR = path.join(ROOT, 'plugins', 'sqlformat')
const BUILD_DIR = path.join(SRC_DIR, 'build')
const ENGINE_DIR = 'D:\\Datas\\mTools\\wjz-sqlFormat'
const OUT_DIR = path.join(ROOT, 'dist-plugins')
const TMP_ASAR = path.join(SRC_DIR, 'sqlformat.tmp.asar')

async function main() {
  // 1. 组装构建目录
  fs.rmSync(BUILD_DIR, { recursive: true, force: true })
  fs.mkdirSync(path.join(BUILD_DIR, 'lib'), { recursive: true })
  for (const f of ['plugin.json', 'preload.js']) {
    fs.copyFileSync(path.join(SRC_DIR, f), path.join(BUILD_DIR, f))
  }
  const engineFiles = fs
    .readdirSync(ENGINE_DIR)
    .filter((n) => !/\.(doc|bat)$/i.test(n) && n !== 'lib')
  for (const f of engineFiles) {
    fs.copyFileSync(path.join(ENGINE_DIR, f), path.join(BUILD_DIR, f))
  }
  const libSrc = path.join(ENGINE_DIR, 'lib')
  if (fs.existsSync(libSrc)) {
    for (const f of fs.readdirSync(libSrc)) {
      fs.copyFileSync(path.join(libSrc, f), path.join(BUILD_DIR, 'lib', f))
    }
  }
  if (!fs.existsSync(path.join(BUILD_DIR, 'wjz-sqlFormat-1.3.jar'))) {
    console.error('[build-sqlformat] 引擎 jar 缺失: ' + ENGINE_DIR)
    process.exit(1)
  }

  // 2. 打包 asar（jar/lib/cfg 走 unpacked 侧车，供 java 子进程直接访问）
  fs.rmSync(TMP_ASAR, { force: true })
  asar
    .createPackageWithOptions(BUILD_DIR, TMP_ASAR, {
      unpack: '**/{wjz-sqlFormat-1.3.jar,**/lib/**,**/*.cfg}'
    })
    .then(() => {
      finalize()
    })
    .catch((e) => {
      console.error('[build-sqlformat] 打包失败: ' + e.message)
      process.exit(1)
    })
}

function finalize() {
  const buf = fs.readFileSync(TMP_ASAR)
  const hash8 = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 8)
  const dest = path.join(OUT_DIR, `sqlformat-1.0.0-${hash8}.asar`)
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

  console.log('[build-sqlformat] 完成: ' + path.basename(dest))
  const entries = fs.readdirSync(dest + '.unpacked', { recursive: true })
  console.log('[build-sqlformat] unpacked 文件数: ' + entries.length)
}

main()
