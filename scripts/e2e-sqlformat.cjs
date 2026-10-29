// 端到端实测：内置 JRE + wjz jar + stdout 捕获（模拟 preload formatWithEngine）
const cp = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const base = 'D:/Datas/mTools/mtools/plugins/sqlformatter'
const javaCmd = path.join(base, 'jre', 'bin', 'java.exe')
const jar = 'D:/Datas/mTools/wjz-sqlFormat/wjz-sqlFormat-1.3.jar'
const cwd = 'D:/Datas/mTools/wjz-sqlFormat'

const sample = [
  '-- 查询sql',
  'SELECT COLUMN1,COLUMN2,COLUMN3',
  'FROM tab5',
  'WHERE COLUMN1>0 AND COLUMN3=1',
  'UNION ALL',
  'SELECT tab12.column111,tab2.column101 || tab3.column301 AS COLUMN1',
  'FROM tab1 LEFT JOIN tab2 ON tab1.column101=tab2.column201',
  "WHERE tab1.column105='test' AND TAB2.column206 IN (1,2,3)"
].join('\n')

const tmp = path.join(os.tmpdir(), `mt-test-${Date.now()}.sql`)
fs.writeFileSync(tmp, sample, 'utf-8')

try {
  const stdout = cp.execFileSync(
    javaCmd,
    ['-Dfile.encoding=utf-8', '-jar', jar, '-filePath', tmp, '-fileEncoding', 'utf-8'],
    { timeout: 15000, cwd, windowsHide: true }
  )
  const out = String(stdout || '')
  fs.writeFileSync(
    'D:/Datas/mTools/mtools/plugins/sqlformatter/_e2e.txt',
    'exit: 0\n--- formatted stdout ---\n' +
      out +
      '\n--- original file unchanged? ' +
      (fs.readFileSync(tmp, 'utf-8') === sample) +
      ' ---'
  )
} catch (e) {
  fs.writeFileSync(
    'D:/Datas/mTools/mtools/plugins/sqlformatter/_e2e.txt',
    'FAIL: ' + (e && e.message) + '\nstdout=' + String(e && e.stdout)
  )
}
