// 构建 sql-formatter 基础插件（页面 + preload + 自研 JS 引擎，无 Java 依赖）
// 用法: node scripts/build-sqlformatter.cjs
// 输入: plugins/sqlformatter/（页面与 preload）
//       + plugins/sqlformatter/engine/（自研引擎 engine/formatter/tokenizer 三件）
//       + dist-plugins 旧侧车的 sqlFormat.cfg（延续用户配置，无则用默认）
// 输出: dist-plugins/sql-formatter-<version>-<hash8>.asar (+ .asar.unpacked 侧车)
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const asar = require('@electron/asar')

const ROOT = path.resolve(__dirname, '..')
const SRC_DIR = path.join(ROOT, 'plugins', 'sqlformatter')
const BUILD_DIR = path.join(SRC_DIR, 'build')
const ENGINE_DIR = path.join(SRC_DIR, 'engine')
const OUT_DIR = path.join(ROOT, 'dist-plugins')
const TMP_ASAR = path.join(SRC_DIR, 'sqlformatter.tmp.asar')

async function main() {
  // 0. 插件版本（与启动器版本同步：3.2.1）
  const pkg = JSON.parse(fs.readFileSync(path.join(SRC_DIR, 'plugin.json'), 'utf-8'))
  const version = String(pkg.version || '1.0.0')

  // 1. 组装构建目录（页面/preload + 引擎 JS）
  fs.rmSync(BUILD_DIR, { recursive: true, force: true })
  fs.mkdirSync(path.join(BUILD_DIR, 'engine'), { recursive: true })
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
  for (const f of fs.readdirSync(ENGINE_DIR)) {
    if (f.endsWith('.asar')) continue
    fs.copyFileSync(path.join(ENGINE_DIR, f), path.join(BUILD_DIR, 'engine', f))
  }
  if (!fs.existsSync(path.join(BUILD_DIR, 'engine', 'engine.cjs'))) {
    console.error('[build-sqlformatter] 自研引擎缺失: ' + ENGINE_DIR)
    process.exit(1)
  }
  // cfg：优先延续 dist-plugins 旧侧车配置，无则生成默认（与引擎 DEFAULTS 一致）
  const cfgIn = findLatestCfg()
  if (cfgIn) {
    fs.copyFileSync(cfgIn, path.join(BUILD_DIR, 'sqlFormat.cfg'))
  } else {
    fs.writeFileSync(
      path.join(BUILD_DIR, 'sqlFormat.cfg'),
      '# 默认规则配置（与自研引擎 DEFAULTS 一致）\n',
      'utf-8'
    )
  }

  // 2. 打包 asar（cfg 走 unpacked 侧车，供运行时读写；引擎 JS 留在 asar 内）
  fs.rmSync(TMP_ASAR, { force: true })
  await asar.createPackageWithOptions(BUILD_DIR, TMP_ASAR, {
    unpack: '**/*.cfg'
  })
  finalize(version)
}

/** 在 dist-plugins 找最新旧侧车的 sqlFormat.cfg（延续用户配置） */
function findLatestCfg() {
  if (!fs.existsSync(OUT_DIR)) return null
  const dirs = fs
    .readdirSync(OUT_DIR)
    .filter((n) => /^sql-formatter-[\w.-]+\.asar\.unpacked$/.test(n))
    .sort()
  for (let i = dirs.length - 1; i >= 0; i--) {
    const p = path.join(OUT_DIR, dirs[i], 'sqlFormat.cfg')
    if (fs.existsSync(p)) return p
  }
  return null
}

function finalize(version) {
  const buf = fs.readFileSync(TMP_ASAR)
  const hash8 = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 8)
  const dest = path.join(OUT_DIR, `sql-formatter-${version}-${hash8}.asar`)
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
