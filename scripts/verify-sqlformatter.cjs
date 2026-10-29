// 验证 sql-formatter asar 内容完整性（临时工具，不入库最终产物）
const fs = require('fs')
const asar = require('@electron/asar')

const p = 'D:/Datas/mTools/mtools/dist-plugins/sql-formatter-1.0.0-058f74c0.asar'
const files = asar.listPackage(p).map((f) => f.replace(/^[\\/]+/, ''))
const js = files.find((f) => /^assets[\\/]index-.*\.js$/.test(f))
const bundle = asar.extractFile(p, js).toString('utf8')
const pre = asar.extractFile(p, 'preload.cjs').toString('utf8')
const html = asar.extractFile(p, 'index.html').toString('utf8')
const pj = JSON.parse(asar.extractFile(p, 'plugin.json').toString('utf8'))

const out = [
  'bundle bridge: ' + bundle.includes('formatWithEngine'),
  'preload: formatWithEngine=' + pre.includes('formatWithEngine'),
  'preload: testEngine=' + pre.includes('testEngine'),
  'preload: readSqlConfigFile=' + pre.includes('readSqlConfigFile'),
  'preload: findJavaDBeaver=' + pre.includes('DBeaver'),
  'html: settingsButton=' + html.includes('settingsButton'),
  'html: configView=' + html.includes('configView'),
  'html: cfgEditor=' + html.includes('cfgEditor'),
  'license=' + files.includes('LICENSE') + ' notices=' + files.includes('THIRD_PARTY_NOTICES.md'),
  'name=' + pj.name + ' title=' + pj.title
].join('\n')
fs.writeFileSync('D:/Datas/mTools/mtools/plugins/sqlformatter/_verify.txt', out)
