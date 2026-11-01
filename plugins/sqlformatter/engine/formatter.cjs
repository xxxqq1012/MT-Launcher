/**
 * Q3 格式层 v3 —— 格式化管线
 * token 流 → 语句切分 → 子句断行（展开/inline 两态）→ 行内排版 → 折行 → 输出（对齐 wjz golden）
 *
 * v3 新增（相对 v2）：
 *  - 复合子句头白名单（LEFT JOIN / GROUP BY / CREATE TABLE / SELECT DISTINCT / UNION ALL / ON DUPLICATE KEY UPDATE），
 *    joinKw 跳过空白 token 且只收 FOLLOW 合法组合（修 HAVING COUNT 误并段头）
 *  - 顶层子查询块 (SELECT...) 前换行、独立行缩进 8；块后 AND/OR/分号继续同行；) ; 前 1 空格
 *  - CASE 展开：expr 同行，每个 WHEN 独立行缩进 16，ELSE/END 留在最后 WHEN 行
 *  - WITH CTE 展开：WITH 独立行；name AS 行缩进 8；( 独立行缩进 8 + 子查询单行；) 独立行缩进 8；逗号前导缩进 8；主 SELECT inline
 *  - SELECT DISTINCT 后对齐 1 空格；LIMIT/OFFSET 并入前段不断行；列行尾逗号单化
 *  - CREATE TABLE 列清单贪心折行（行宽 120）
 * 校准清单：#1 对齐空格固定值（007 型 1 空格 vs 展开型多空格，已按基线固化）；#2 SELECT 展开阈值（v2=4，006 待证）
 *  #7 窗口块：OVER ( 内 PARTITION BY/ORDER BY 换行缩进（004 未实现，缩进=开括号后列位置层级）；#8 方言组结构（反引号/REPLACE/MERGE/
 *  LATERAL VIEW/窗口帧/数组/JSON 操作符/CAST 等，见 03-08 组）；#9 92 规则变体专项（t-* 翻转规则）
 */

const { tokenize } = require('./tokenizer.cjs')

const DEFAULTS = {
  upperAndLowerCaseStyle: 1, // 0 原样 / 1 大写 / 2 小写
  ilineLengthWanted: 120,
  iSpacesPerLvlWanted: 8,
  inbrCommasWanted: 6,
  inbrCommasInListWanted: 6,
  icommaSpacesWanted: 'oneSpaceAfterComma',
  iequalSpacesWanted: 'oneSpaceAroundEqual',
  ibracketSpacesWanted: 'oneSpaceOutsideBracket',
  // --- wjz cfg 布尔项（默认值 = sqlFormat.cfg）---
  isuppressCommentWanted: false,
  isuppressLinebreakWanted: true,
  isuppressSpacesWanted: true,
  // --- cfg 有但 DEFAULTS 缺失（B 组 22 条，默认值 = sqlFormat.cfg）---
  ishowPseudoCodeWanted: false,
  iuseTabWanted: false,
  ikeepEmptyLinesWanted: false,
  idoubleLinebreakUNIONWanted: false,
  iput1SpaceAfterCommaWanted: false,
  ireplaceCommentWanted: false,
  ishowIndentWanted: false,
  ishowLineNumber: false,
  ioneLineSQLWanted: false,
  // 折行
  ilinebreakBeforeAND: false,
  ilinebreakAfterAND: false,
  ilinebreakAfterFROM: false,
  ilinebreakAfterGROUPBY: false,
  ilinebreakAfterHAVING: false,
  ilinebreakAfterINSERT: false,
  ilinebreakAfterInsertOfInto: false,
  ilinebreakBeforeOpenInsertBracketWanted: false,
  ilinebreakAfterOpenInsertBracketWanted: false,
  ilinebreakBeforeCloseInsertBracketWanted: false,
  ilinebreakAfterCloseInsertBracketWanted: false,
  ilinebreakAfterJOINWanted: false,
  ilinebreakBeforeJoinOnWanted: false,
  ilinebreakAfterONWanted: false,
  ilinebreakAfterORDERBY: false,
  ilinebreakAfterSELECT: false,
  ilinebreakAfterSubSelectBrWanted: false,
  ilinebreakAfterUPDATE: false,
  ilinebreakAfterWHERE: false,
  ilinebreakAfterSET: false,
  ilinebreakBeforeSET: false,
  ilinebreakAfterComma: true,
  ilinebreakBeforeComma: false,
  ilinebreakAfterCloseCaseBracketWanted: false,
  ilinebreakAfterOpenCaseBracketWanted: false,
  ilinebreakBeforeCloseCaseBracketWanted: false,
  ilinebreakBeforeOpenCaseBracketWanted: false,
  ilinebreakAfterConditionBrWanted: false,
  ilinebreakBeforeConditionBrWanted: false,
  ilinebreakAfterCloseConditionBrWanted: false,
  ilinebreakBeforeCloseConditionBrWanted: false,
  ilinebreakAfterCloseSelectBrWanted: false,
  ilinebreakBeforeCloseSelectBrWanted: false,
  ilinebreakBeforeSelectBrWanted: true,
  ilinebreakAfterConcatWanted: false,
  ilinebreakBeforeConcatWanted: false,
  ilinebreakBeforeParaCommentWanted: true,
  ilinebreakBeforeLineCommentWanted: false,
  ilinebreakBeforeSemikolon: false,
  ilinebreakCaseAndOrWanted: false,
  ilinebreakCaseWhenNoExpressWanted: false,
  ilinebreakCaseWanted: true,
  ilinebreakCaseElseWanted: false,
  ilinebreakCaseEndWanted: false,
  ilinebreakCaseThenWanted: false,
  ilinebreakCaseWhenWanted: true,
  ilinebreakBeforeInsertOfValues: true,
  // 缩进
  iandOrIndentionWanted: true,
  icaseElseIndentionWanted: false,
  icaseThenIndentionWanted: false,
  idoubleIndentionMasterKeywordWanted: false,
  iindentAfterSubSelectBrWanted: false,
  iindentAfterConditionBrWanted: false,
  iindentCaseBracketWanted: false,
  iindentParaCommentWanted: true,
  iindentInsertBracketWanted: false,
  isetIndentJoinOnWanted: false,
  isetIndentJoinWanted: false,
  // 堆叠
  istackListGROUPBYWanted: true,
  istackListORDERBYWanted: true,
  // 对齐
  ialignmentCommentWanted: true,
  ialignmentConcatWanted: false,
  ialignmentDeclarationWanted: false,
  ialignmentEqualWanted: false,
  ialignmentOperatorWanted: false,
  ialignmentAsWanted: false,
  ialignmentCommaWanted: false,
  ialignmentAssociationOperatorWanted: false,
  ialignmentKeywordWanted: false,
  ileftAlignParaCommentWanted: true
}

// 子句断行关键字（顶层、括号外；LIMIT/OFFSET 不断行，并入前段）
const CLAUSE_STARTS = [
  'SELECT',
  'FROM',
  'WHERE',
  'GROUP',
  'HAVING',
  'ORDER',
  'UNION',
  'INSERT',
  'INTO',
  'VALUES',
  'UPDATE',
  'SET',
  'DELETE',
  'WITH',
  'CREATE',
  'REPLACE',
  'RETURNING',
  'CLUSTER',
  'DISTRIBUTE',
  'SORT',
  'MERGE',
  'TRUNCATE',
  'LEFT',
  'RIGHT',
  'FULL',
  'INNER',
  'CROSS',
  'JOIN',
  'ON',
  'DUPLICATE',
  'CONFLICT',
  'EXCLUDED'
]

// 主子句关键字 → 后置对齐空格
const ALIGN = {
  SELECT: 2,
  FROM: 4,
  WHERE: 3,
  HAVING: 2,
  GROUP: 1,
  ORDER: 1,
  UNION: 1,
  LIMIT: 1,
  SET: 5,
  VALUES: 1,
  INTO: 1,
  UPDATE: 1,
  DELETE: 1,
  WITH: 1,
  INSERT: 1,
  CREATE: 1,
  RETURNING: 1,
  JOIN: 4,
  ON: 1,
  LATERAL: 1,
  CLUSTER: 1,
  DISTRIBUTE: 1,
  SORT: 1
}

// 括号前需空格但文本原样的函数/类型名（wjz 行为：concat (x)、VARCHAR (50)）
const FUNC_PAD = new Set([
  'CONCAT',
  'CONCAT_WS',
  'SUBSTR',
  'SUBSTRING',
  'TRIM',
  'LTRIM',
  'RTRIM',
  'REPLACE',
  'CHAR',
  'VARCHAR',
  'VARCHAR2',
  'NVARCHAR',
  'NVARCHAR2',
  'INT',
  'INTEGER',
  'BIGINT',
  'SMALLINT',
  'TINYINT',
  'DECIMAL',
  'NUMERIC',
  'DOUBLE',
  'FLOAT',
  'REAL',
  'BOOL',
  'BOOLEAN',
  'DATE',
  'DATETIME',
  'TIMESTAMP',
  'TIME',
  'TEXT',
  'STRING',
  'BINARY',
  'BYTES',
  'COALESCE',
  'NVL',
  'IFNULL',
  'NULLIF',
  'DECODE',
  'CAST',
  'CONVERT',
  'TO_CHAR',
  'TO_DATE',
  'TO_TIMESTAMP',
  'EXTRACT',
  'DATE_FORMAT',
  'DATE_ADD',
  'DATE_SUB',
  'UPPER',
  'LOWER',
  'LENGTH',
  'CHAR_LENGTH',
  'ABS',
  'ROUND',
  'CEIL',
  'FLOOR',
  'MOD',
  'POWER',
  'SQRT',
  'LEAD',
  'LAG',
  'FIRST_VALUE',
  'LAST_VALUE',
  'NTILE',
  'GROUP_CONCAT',
  'EXPLODE',
  'SYS_CONNECT_BY_PATH',
  'JSON_EXTRACT',
  'JSON_UNQUOTE'
])

// 需要转大写的关键字表（upperAndLowerCaseStyle=1）
function kwText(word, style) {
  if (style === 2) return word.toLowerCase()
  if (style === 1) return word === 'TO_DATE' ? 'to_date' : word.toUpperCase()
  return word
}

function isTop(depth, i) {
  return depth[i] === 0
}

/** 主入口 */
function format(sql, opts = {}) {
  const o = { ...DEFAULTS, ...opts }
  const tokens = tokenize(sql)
  const depth = []
  let d = 0
  for (const t of tokens) {
    depth.push(d)
    if (t.type === 'paren') d += t.text === '(' ? 1 : -1
  }
  const statements = splitStatements(tokens)
  const outLines = []
  for (let si = 0; si < statements.length; si++) {
    const st = statements[si].toks
    if (si > 0) {
      // 语句间分隔行跟随输入：间隙 ≥2 个换行 → 空行；否则 1 空格行（wjz 保真）
      const g = statements[si - 1].gapWs || ''
      outLines.push((g.match(/\n/g) || []).length >= 2 ? '' : ' ')
    }
    const stLines = formatStatement(st, depth, o)
    outLines.push(...stLines)
  }
  // 展示类后处理（逐物理行，outLines 元素是含 CRLF 的多行块）
  const expand = (fn) => {
    const all = []
    for (const blk of outLines) {
      const rows = blk.split('\r\n')
      if (rows[rows.length - 1] === '') rows.pop() // 块以分隔符结尾时去掉尾随空段
      for (const ln of rows) all.push(fn(ln, all.length))
    }
    return all
  }
  if (o.ishowPseudoCodeWanted) {
    // 近似：仅当行内容明显超宽（> ilineLengthWanted）时折叠为前 2 个空白记号 + '... '（wjz 折叠点不定，近似；简单行不折叠——t-ishowPseudoCodeWanted wjz 全保留）
    return expand((ln) => {
      const m = ln.match(/^(\s*)(.*?)(\s*)$/)
      if (m[2].length <= o.ilineLengthWanted) return ln + '\r\n'
      const keep = m[2].match(/^\s*\S+(\s+\S+)?/)
      if (keep === null || m[2].slice(keep[0].length).trim() === '') return ln + '\r\n'
      return m[1] + keep[0] + ' ...\r\n'
    }).join('')
  }
  if (o.ishowIndentWanted) {
    return expand((ln) => {
      const m = ln.match(/^( *)(.*)$/)
      return (
        '|       '.repeat(Math.floor(m[1].length / 8)) + ' '.repeat(m[1].length % 8) + m[2] + '\r\n'
      )
    }).join('')
  }
  if (o.ishowLineNumber) {
    // 逐物理行行号：仅多行输出（>1 行）时加 '001 ' 前缀（t-ishowLineNumber 单行 wjz 不加）
    const all2 = expand((ln) => ln)
    if (all2.length > 1)
      return all2
        .map((ln, idx) => String(idx + 1).padStart(3, '0') + ' ' + ln.trimEnd() + '\r\n')
        .join('')
    return all2.map((ln) => ln.trimEnd() + '\r\n').join('')
  }
  return outLines.map((l) => l + '\r\n').join('')
}

function splitStatements(tokens) {
  const sts = []
  let cur = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    cur.push(t)
    if (t.type === 'semicolon') {
      // 收集分号后间隙 ws（语句间分隔保真）
      let g = ''
      while (i + 1 < tokens.length && tokens[i + 1].type === 'ws') {
        g += tokens[i + 1].text
        i++
      }
      // 分号后行注释：间隙 ws 不含换行（同行）→ 并入当前语句（= 2; -- 注释）；
      // 间隙含换行 → 注释独立成语句（wjz：';' 换行后 '-- 注释' 独立行缩进 0）
      if (
        i + 1 < tokens.length &&
        tokens[i + 1].type === 'comment' &&
        tokens[i + 1].text.startsWith('--') &&
        !/[\r\n]/.test(g)
      ) {
        cur.push(tokens[i + 1])
        i++
        while (i + 1 < tokens.length && tokens[i + 1].type === 'ws') {
          i++
        }
      }
      sts.push({ toks: cur, gapWs: g })
      cur = []
      continue
    }
  }
  if (cur.some((t) => t.type !== 'ws')) sts.push({ toks: cur, gapWs: '' })
  return sts.filter((s) => s.toks.some((t) => t.type !== 'ws'))
}

// 复合子句头白名单：word1 → 可续接的 word2/word3（joinKw 只收集这些组合）
const FOLLOW = {
  SELECT: ['DISTINCT', 'TOP'],
  GROUP: ['BY'],
  ORDER: ['BY'],
  CLUSTER: ['BY'],
  DISTRIBUTE: ['BY'],
  SORT: ['BY'],
  LEFT: ['JOIN'],
  RIGHT: ['JOIN'],
  FULL: ['JOIN'],
  INNER: ['JOIN'],
  CROSS: ['JOIN'],
  UNION: ['ALL'],
  CREATE: ['TABLE'],
  ALTER: ['TABLE'],
  INSERT: ['INTO'],
  REPLACE: ['INTO'],
  DELETE: ['FROM'],
  ON: ['DUPLICATE', 'CONFLICT'],
  DUPLICATE: ['KEY'],
  KEY: ['UPDATE'],
  LATERAL: ['VIEW']
}

/** 连续子句头关键字序列（跳过空白，仅收集 FOLLOW 白名单组合） */
function joinKw(st, i) {
  const out = []
  let prev = null
  while (i < st.length) {
    if (st[i].type === 'ws') {
      i++
      continue
    }
    if (st[i].type !== 'keyword') break
    const w = st[i].upper
    if (prev === null) {
      out.push(w)
      prev = w
      i++
      continue
    }
    if (FOLLOW[prev] && FOLLOW[prev].includes(w)) {
      out.push(w)
      prev = w
      i++
      continue
    }
    break
  }
  return out
}

/** 从 i 起跳过 count 个 keyword token（含其间 ws），返回下一 token 索引 */
function kwEnd(st, i, count) {
  let seen = 0
  while (i < st.length) {
    if (st[i].type === 'ws') {
      i++
      continue
    }
    if (st[i].type !== 'keyword') break
    seen++
    i++
    if (seen >= count) break
  }
  return i
}

function isClauseStart(joined) {
  const head = joined[0]
  if (!CLAUSE_STARTS.includes(head)) return false
  if (head === 'GROUP' && joined[1] !== 'BY') return false
  if (head === 'ORDER' && joined[1] !== 'BY') return false
  if (
    head === 'LEFT' ||
    head === 'RIGHT' ||
    head === 'FULL' ||
    head === 'INNER' ||
    head === 'CROSS'
  ) {
    return joined[1] === 'JOIN'
  }
  if (head === 'LATERAL') return joined[1] === 'VIEW'
  if (head === 'CLUSTER' || head === 'DISTRIBUTE' || head === 'SORT') return joined[1] === 'BY'
  if (head === 'ON') return joined[1] === 'DUPLICATE' || joined[1] === 'CONFLICT'
  return true
}

/** 子句切分：段 toks 以「段头关键字 token」开头（关键字不丢失，供 inline 合并重建） */
function splitClauses(st, depth, o) {
  const segments = []
  let cur = null
  const flush = () => {
    if (cur) {
      segments.push(cur)
      cur = null
    }
  }
  const push = (t) => {
    cur = cur || { kw: null, joined: null, toks: [] }
    cur.toks.push(t)
  }
  let i = 0
  const n = st.length
  while (i < n) {
    const t = st[i]
    if (t.type === 'ws') {
      if (cur) cur.toks.push(t)
      i++
      continue
    } // 保留 ws（归属当前段；渲染时跳过，分号前空格按输入保真）
    const up = t.type === 'keyword' ? t.upper : null
    if (up === 'WITH') {
      // WITH 拆段仅限 CTE（WITH ident AS ...）；'WITH a = 1'（表达式）不拆（Oracle START WITH）
      let q = i + 1
      while (q < n && st[q].type === 'ws') q++
      let r = q + 1
      while (r < n && st[r].type === 'ws') r++
      if (
        !(
          st[q] &&
          st[q].type === 'ident' &&
          st[r] &&
          st[r].type === 'keyword' &&
          st[r].upper === 'AS'
        )
      ) {
        push(t)
        i++
        continue
      }
    }
    if (up && CLAUSE_STARTS.includes(up) && isTop(depth, i)) {
      const joined = joinKw(st, i)
      if (isClauseStart(joined)) {
        // JOIN 组合段：LEFT JOIN ... ON ... 合成一段
        if (joined.some((w) => w === 'JOIN')) {
          flush()
          cur = { kw: joined[0], joined, toks: st.slice(i, kwEnd(st, i, joined.length)) }
          i = kwEnd(st, i, joined.length)
          while (i < n) {
            const t2 = st[i]
            if (t2.type === 'ws') {
              i++
              continue
            }
            const u2 = t2.type === 'keyword' ? t2.upper : null
            if (u2 && u2 !== 'ON' && isClauseStart(joinKw(st, i))) break
            cur.toks.push(t2)
            i++
          }
          continue
        }
        flush()
        cur = { kw: joined[0], joined, toks: st.slice(i, kwEnd(st, i, joined.length)) }
        i = kwEnd(st, i, joined.length)
        continue
      }
    }
    push(t)
    i++
  }
  flush()
  return segments
}

/** 语句 → 行列表 */
function formatStatement(st, depth, o) {
  const segments = splitClauses(st, depth, o)
  const head = segments[0]
  const headKw = head && head.joined ? head.joined[0] : null

  // 语句类型分派
  if (headKw === 'CREATE' && head.joined[1] === 'TABLE') return formatCreateTable(st, depth, o)
  if (headKw === 'INSERT' || headKw === 'REPLACE') return formatInsert(st, depth, o, segments)
  if (headKw === 'UPDATE') return formatUpdate(st, depth, o, segments)
  if (headKw === 'MERGE') return formatMerge(st, depth, o)
  if (headKw === 'DELETE') {
    // DELETE 单行
    const seg = mergeSegments(segments)
    return [renderSegment(seg, o)]
  }
  if (headKw === 'WITH') {
    return formatWith(st, depth, o)
  }
  // SELECT 型（含 UNION）
  // 注释/ws 前缀 + 主语句：注释段按现状渲染，主体交给对应语句格式器（真实 SQL 常见结构）
  if (headKw === null) {
    const nz = st.findIndex(
      (t) => t.type !== 'ws' && t.type !== 'comment' && t.type !== 'lineComment'
    )
    if (nz > 0) {
      const lead = st.slice(0, nz)
      const body = st.slice(nz)
      const leadSegs = splitClauses(lead, depth, o)
      const leadLines = leadSegs.map((s) => renderSegment(s, o))
      const b0 = body[0]
      if (b0 && b0.type === 'keyword') {
        const bu = b0.upper
        if (bu === 'CREATE') {
          let nk = 1
          while (nk < body.length && body[nk].type === 'ws') nk++
          if (body[nk] && body[nk].type === 'keyword' && body[nk].upper === 'TABLE')
            return [...leadLines, ...formatCreateTable(body, depth, o)]
        } else if (bu === 'UPDATE') return [...leadLines, ...formatUpdate(body, depth, o)]
        else if (bu === 'INSERT' || bu === 'REPLACE')
          return [...leadLines, ...formatInsert(body, depth, o)]
        else if (bu === 'MERGE') return [...leadLines, ...formatMerge(body, depth, o)]
        else if (bu === 'DELETE') {
          const seg = mergeSegments(splitClauses(body, depth, o))
          return [...leadLines, renderSegment(seg, o)]
        } else if (bu === 'WITH') return [...leadLines, ...formatWith(body, depth, o)]
      }
    }
  }
  return formatSelect(st, depth, o, segments)
}

function mergeSegments(segs) {
  const toks = []
  for (const s of segs) toks.push(...s.toks)
  return { kw: null, joined: null, toks }
}

/** WITH CTE 展开：
 *  WITH 独立行；每个 CTE name AS 独立行缩进 8、( 独立行缩进 8 + 子查询单行、) 独立行缩进 8；
 *  后续 CTE 前导逗号缩进 8；主 SELECT 段 inline。 */
function formatWith(st, depth, o) {
  const toks = st.filter((t) => t.type !== 'ws')
  const lines = ['WITH ']
  const pad8 = ' '.repeat(8)
  let i = 1
  let first = true
  while (i < toks.length) {
    const t0 = toks[i]
    if (t0.type === 'keyword' && t0.upper === 'SELECT') break
    if (t0.type === 'comma') {
      i++
      continue
    } // 逗号由行前缀表示
    // CTE: name [AS] ( ... )
    const name = t0.text
    i++
    if (i < toks.length && toks[i].type === 'keyword' && toks[i].upper === 'AS') i++
    if (i < toks.length && toks[i].type === 'paren' && toks[i].text === '(') {
      let d = 0
      let k = i
      for (; k < toks.length; k++) {
        if (toks[k].type === 'paren') {
          d += toks[k].text === '(' ? 1 : -1
          if (d === 0) break
        }
      }
      const sub = renderSimple(toks.slice(i + 1, k), o)
      lines.push(pad8 + (first ? '' : ', ') + name + ' AS ')
      lines.push(pad8 + '(' + sub + ' ')
      lines.push(pad8 + ') ')
      first = false
      i = k + 1
      continue
    }
    i++
  }
  const mainToks = toks.slice(i)
  lines.push(renderSegmentInline({ kw: null, joined: null, toks: mainToks }, o))
  return lines
}

/** 顶层 SELECT 投影项数 */
function topCommaCount(seg) {
  const toks = seg ? seg.toks : []
  let d = 0
  let c = 0
  for (const t of toks) {
    if (t.type === 'paren') d += t.text === '(' ? 1 : -1
    if (t.type === 'comma' && d === 0) c++
  }
  return c + 1
}

/** SELECT 型语句（含 UNION） */
function formatSelect(st, depth, o, segments) {
  // 按 UNION 切段
  const parts = []
  let cur = []
  const hasUnion = segments.some((s) => s.joined && s.joined[0] === 'UNION')
  for (const seg of segments) {
    if (seg.joined && seg.joined[0] === 'UNION') {
      parts.push(cur)
      parts.push({ union: true, joined: seg.joined, toks: seg.toks })
      cur = []
    } else cur.push(seg)
  }
  if (cur.length) parts.push(cur)
  const lines = []
  // 输入行尾 token 集合：wjz 展开行尾若对齐输入行尾 → 该行无尾空格（rmy-005/024/002/014 实验确认；UNION 行 t-idouble 单行→有、ror-008 多行→无）
  const eolSet = new Set()
  for (let ei = 1; ei < st.length; ei++) {
    if (st[ei].type === 'ws' && st[ei].text.includes('\n')) {
      let ej = ei - 1
      while (ej >= 0 && st[ej].type === 'ws') ej--
      if (ej >= 0 && st[ej].type !== 'comment') eolSet.add(st[ej].text)
    }
  }
  for (let pi = 0; pi < parts.length; pi++) {
    const p = parts[pi]
    if (p.union) {
      // UNION ALL 独占行（ror-008 E10 无尾空格；t-idouble 单行输入有尾空格）
      const txt = p.joined.map((w) => kwText(w, o.upperAndLowerCaseStyle)).join(' ')
      const uTail = txt.trimEnd().split(/\s+/).pop() || ''
      lines.push(txt + (eolSet.has(uTail) ? '' : ' '))
      continue
    }
    // 前导注释段（无段头关键字、首 token 为注释）独立行输出
    let li = 0
    while (li < p.length && !p[li].joined && p[li].toks[0] && p[li].toks[0].type === 'comment') {
      lines.push(renderSegment(p[li], o))
      li++
    }
    const lead = li
    const rest = p.slice(lead)
    if (rest.length === 0) continue // 纯注释/未拆段语句（SHOW 等）：前导注释段已整段渲染，不追加空行
    const first = rest[0]
    const isTopLevelSelect = first && first.joined && first.joined[0] === 'SELECT'
    // 展开判定：语句首 SELECT 且（本 part 块 token 长 ≥80 或 段中/段尾含注释）。按块长而非整条 stLen：
    // UNION 多块时 wjz 每块独立判定（007 块<80 inline、ror-008 块≥80 展开）；segments 内 ws 已被 splitClauses 丢弃
    const partLen = rest.reduce(
      (b2, s) => b2 + s.toks.reduce((c2, t2) => c2 + t2.text.length, 0),
      0
    )
    const hasMidComment = rest.some((s) => s.toks.some((t) => t.type === 'comment'))
    const expand = isTopLevelSelect && (partLen >= 80 || hasMidComment)
    if (!expand) {
      // inline：整段合成一行（段头后 1 空格）
      const seg = mergeSegments(rest)
      const line = renderSegmentInline(seg, o)
      lines.push(pi < parts.length - 1 ? line + ' ' : line)
      continue
    }
    // 展开：每段一行 + 对齐空格（注释触发的展开无对齐，1 空格）
    const commentInFirst = rest[0] && rest[0].toks.some((t) => t.type === 'comment')
    const blockOnly =
      rest.some((s) => s.toks.some((t) => t.type === 'comment' && !t.text.startsWith('--'))) &&
      !rest.some((s) => s.toks.some((t) => t.type === 'comment' && t.text.startsWith('--')))
    if (partLen < 80 && hasMidComment && commentInFirst && blockOnly) {
      // 短 SQL + SELECT 段尾块注释：注释段独立行，其余段 inline 合并（wjz：SELECT a /* 注释 */ \r\nFROM t1 WHERE a > 0;）
      const headTxt = renderSegment(p[lead], o, false, true)
      const tailTxt = p
        .slice(lead + 1)
        .map((s) => renderSegmentInline(s, o))
        .join(' ')
      lines.push(headTxt + ' ')
      lines.push(pi === parts.length - 1 ? tailTxt : tailTxt + ' ')
      continue
    }
    // JOIN 区对齐预扫描：连续 JOIN 段组内表名+别名最长（ror-008 E5/E7 两处 2 空格；02-rules 等长区仍 1 空格）
    const joinAlignMax = new Map()
    {
      let zone = []
      let zMax = 0
      const flush = () => {
        for (const zs of zone) joinAlignMax.set(zs, zMax)
        zone = []
        zMax = 0
      }
      for (let zi = lead; zi < p.length; zi++) {
        const s = p[zi]
        const isJoin =
          s.joined &&
          (s.joined[0] === 'JOIN' ||
            s.joined[0] === 'INNER' ||
            s.joined[0] === 'LEFT' ||
            s.joined[0] === 'RIGHT' ||
            s.joined[0] === 'CROSS')
        if (isJoin) {
          const tt = s.toks
          let kwi = 0
          while (kwi < tt.length && !(tt[kwi].type === 'keyword' && tt[kwi].upper === 'JOIN')) kwi++
          let b = kwi + 1
          while (b < tt.length && tt[b].type === 'ws') b++
          let c = b + 1
          while (c < tt.length && tt[c].type === 'ws') c++
          if (b < tt.length) {
            // 无别名 JOIN（JOIN tab2 ON ...）：c 为 ON/WHERE 等关键字，只计表名宽
            const hasAlias =
              c < tt.length &&
              !(
                tt[c].type === 'keyword' &&
                [
                  'ON',
                  'WHERE',
                  'USING',
                  'LEFT',
                  'RIGHT',
                  'INNER',
                  'CROSS',
                  'JOIN',
                  'OUTER'
                ].includes(tt[c].upper)
              )
            const w = hasAlias
              ? renderToken(tt[b], o).length + 1 + renderToken(tt[c], o).length
              : renderToken(tt[b], o).length
            if (w > zMax) zMax = w
          }
          zone.push(s)
        } else flush()
      }
      flush()
    }
    for (let si = lead; si < p.length; si++) {
      const seg = p[si]
      const txt = renderSegment(
        seg,
        o,
        partLen >= 80,
        !(partLen >= 80) && hasMidComment,
        undefined,
        eolSet,
        joinAlignMax && joinAlignMax.get(seg)
      )
      const isLast = pi === parts.length - 1 && si === p.length - 1
      // 段尾 token 对齐输入行尾 → 无尾空格（rmy-005 SELECT/FROM）；注释行恒无尾空格
      const segToks = seg.toks
      let tailTok = null
      for (let tk = segToks.length - 1; tk >= 0; tk--) {
        if (segToks[tk].type !== 'ws' && segToks[tk].type !== 'comment') {
          tailTok = segToks[tk]
          break
        }
      }
      const eolTrail = tailTok && eolSet.has(tailTok.text) ? '' : ' '
      const trail =
        eolTrail === '' ||
        (/\/\*-- /.test(txt) && txt.trimEnd().endsWith('*/')) ||
        /-- [^\r\n]*$/.test(txt)
          ? ''
          : ' '
      lines.push(isLast ? txt : txt + (txt.endsWith(' ') ? '' : trail)) // 段末行尾空格（560 保留）与段间拼接去重（004/009/010 WHERE/HAVING 尾）
    }
  }
  return lines
}

/** inline 渲染：整段单行；第一个子句关键字后 1 空格，其余按常规空格规则 */
function renderSegmentInline(seg, o) {
  const toks = seg.toks
  const parts = []
  let i = 0
  const n = toks.length
  // 第一个子句关键字（段头）
  let kwi = -1
  for (let j = 0; j < n; j++) {
    if (toks[j].type === 'keyword' && CLAUSE_STARTS.includes(toks[j].upper)) {
      kwi = j
      break
    }
  }
  let last = null
  while (i < n) {
    const t = toks[i]
    if (t.type === 'ws') {
      i++
      continue
    }
    if (t.type === 'comment') {
      if (parts.length && !/ $/.test(parts.join(''))) parts.push(' ')
      parts.push(t.text)
      last = t
      i++
      continue
    }
    if (t.type === 'semicolon') {
      // 分号前空格：paren 恒 1 空格；string 跟随输入 ws
      const prevWs = i > 0 && toks[i - 1].type === 'ws'
      if (last && last.type === 'paren' && parts.length && !/ $/.test(parts.join('')))
        parts.push(' ')
      else if (
        last &&
        last.type === 'string' &&
        prevWs &&
        parts.length &&
        !/ $/.test(parts.join(''))
      )
        parts.push(' ')
      parts.push(';')
      last = t
      i++
      continue
    }
    if (i === kwi) {
      // 段头关键字：大写 + 1 空格
      const joined = joinKw(toks, i)
      parts.push(joined.map((w) => kwText(w, o.upperAndLowerCaseStyle)).join(' ') + ' ')
      i = kwEnd(toks, i, joined.length)
      last = joined.length
        ? { type: 'keyword', upper: joined[joined.length - 1], text: joined[joined.length - 1] }
        : last
      continue
    }
    if (needSpaceBefore(t, last, i + 1 < n ? toks[i + 1] : null, o)) {
      if (parts.length && !/ $/.test(parts.join(''))) parts.push(' ')
    }
    parts.push(renderToken(t, o))
    last = t
    i++
  }
  return parts.join('').trimEnd()
}

/** 段渲染（含对齐空格）；段 toks 以段头关键字 token 开头，渲染头后跳过。
 *  顶层子查询块（(SELECT...) 独立行缩进 8，块后 AND/OR 独立行缩进 8）。
 *  返回单字符串；中间行保留行尾 1 空格（wjz 行为），末行去尾空格。 */
function renderSegment(seg, o, lenExpand, commentExpand, depth, eolSet, joinAlignMax) {
  const toks = seg.toks
  let first = ''
  let i = 0
  const n = toks.length
  if (seg.joined && seg.joined.length) {
    const hdr = seg.joined.map((w) => kwText(w, o.upperAndLowerCaseStyle)).join(' ')
    // 注释触发的展开（<80 含注释）：关键字不按 ALIGN 对齐（07/003 等：SELECT 后 1 空格）
    let pad = seg.joined.includes('DISTINCT')
      ? 1
      : commentExpand
        ? 1
        : Math.max(ALIGN[seg.joined[0]] ?? 1, 1)
    first = hdr + ' '.repeat(pad)
    i = kwEnd(toks, 0, seg.joined.length) // 跳过段头关键字 token（含其间 ws）
    // FROM 段后接子查询 '('（05/002）：subLen<80 inline → 1 空格；展开（≥80）保持 ALIGN 4（019）
    if (seg.joined[0] === 'FROM' && pad > 1) {
      let m = i
      while (m < n && toks[m].type === 'ws') m++
      if (m < n && toks[m].type === 'paren' && toks[m].text === '(') {
        let dd = 0,
          kk = m
        for (; kk < n; kk++) {
          if (toks[kk].type === 'paren') {
            dd += toks[kk].text === '(' ? 1 : -1
            if (dd === 0) break
          }
        }
        const subLen = renderSimple(toks.slice(m + 1, kk), o).length
        if (subLen < 80) {
          pad = 1
          first = hdr + ' '
        }
      }
    }
  }
  const body = renderBody(
    toks,
    i,
    o,
    first.length,
    seg.joined ? seg.joined[0] : null,
    lenExpand,
    depth,
    eolSet,
    joinAlignMax
  )
  if (body.length) {
    // JOIN 段后接展开子查询 '('（ror-007 E56-E57）：段头独立行（无尾空格）+ 子查询首行缩进 8
    if (seg.joined && seg.joined.includes('JOIN') && /^\s*\(/.test(body[0])) {
      first = first.trimEnd() + '\r\n' + ' '.repeat(8) + body[0].trimStart()
    } else if (/^SELECT ?$/.test(first.trimEnd()) && /^CASE/.test(body[0].trim())) {
      // CASE WHEN（无 expr）为 SELECT 段唯一内容：'SELECT' 独立行 + CASE 块缩进 8（02/017/018）
      first = 'SELECT ' + '\r\n' + ' '.repeat(8) + body[0].replace(/^\s+/, '')
    } else {
      first += body[0]
    }
  }
  for (let b = 1; b < body.length; b++) first += '\r\n' + body[b]
  // 段末行尾空格：按段类型（condSeg/FROM 多行保留，ror-009 E16/E17）；';' 尾与注释尾不保留
  const tailSeg =
    seg.joined &&
    (seg.joined[0] === 'WHERE' || seg.joined[0] === 'HAVING' || seg.joined[0] === 'ON')
  if (
    ((tailSeg && !/;\s*$/.test(first) && !/-- [^\r\n]*\s*$/.test(first)) ||
      (seg.joined && seg.joined[0] === 'FROM' && body.length > 1 && !/;\s*$/.test(first))) &&
    / $/.test(first)
  )
    return first
  return first.trimEnd()
}

/** 子查询内部展开（019 布局）：首行 'SELECT '（1 空格）；FROM 段整段 inline（含内层子查询）；
 *  WHERE 段 'WHERE   '（3 空格）；后续段缩进 8；非末行尾 1 空格 */
function renderSubSelect(subToks, o, depth, externPad, multiNL, joinLvl) {
  externPad = externPad || 0 // FROM 表列表 inline 子查询：SELECT 段折判据计入外部前缀（ror-004 头行列 1-4）
  let si0 = 0
  while (si0 < subToks.length && subToks[si0].type === 'ws') si0++
  if (si0 > 0) subToks = subToks.slice(si0) // 跳过开头 ws：ror-004 FROM 子查询 '( SELECT' → SELECT 段正确识别
  const segs = []
  let d = 0
  let curSeg = []
  const HEAD = ['SELECT', 'FROM', 'WHERE', 'GROUP', 'HAVING', 'ORDER', 'UNION']
  for (const t of subToks) {
    if (t.type === 'paren') d += t.text === '(' ? 1 : -1
    if (d === 0 && t.type === 'keyword' && HEAD.includes(t.upper) && curSeg.length) {
      segs.push(curSeg)
      curSeg = [t]
      continue
    }
    curSeg.push(t)
  }
  if (curSeg.length) segs.push(curSeg)
  const lvl = o.idoubleIndentionMasterKeywordWanted || joinLvl ? depth || 1 : 1
  const out = []
  const wl2Idx = []
  const keepIdx = [] // 已带尾空格的行（HAVING WHEN 展开行），893 循环跳过 trimEnd
  for (let s = 0; s < segs.length; s++) {
    const seg = segs[s]
    const hdr = seg[0]
    const pref = s === 0 ? '' : ' '.repeat(8 * lvl)
    let line
    if (hdr.upper === 'WHERE') {
      // 子查询 WHERE：超宽贪心折行，续行 pref+8（iindentAfterSubSelectBr：16 = pref8+8）
      const wtoks = seg.slice(1)
      const txt = renderSimple(wtoks, o)
      if (txt.length + 7 + pref.length > o.ilineLengthWanted) {
        let iS = -1,
          iE = -1,
          p2Idx = -1
        for (let x = 0; x + 2 < wtoks.length; x++) {
          if (wtoks[x].type === 'ws') continue
          let x1 = x + 1
          while (x1 < wtoks.length && wtoks[x1].type === 'ws') x1++
          let x2 = x1 + 1
          while (x2 < wtoks.length && wtoks[x2].type === 'ws') x2++
          if (
            x1 < wtoks.length &&
            x2 < wtoks.length &&
            wtoks[x].type === 'ident' &&
            wtoks[x1].type === 'paren' &&
            wtoks[x1].text === '(' &&
            wtoks[x2].type === 'paren' &&
            wtoks[x2].text === '('
          ) {
            let dd = 0
            for (let y = x2; y < wtoks.length; y++) {
              if (wtoks[y].type === 'paren') {
                dd += wtoks[y].text === '(' ? 1 : -1
                if (dd === 0) {
                  iS = x
                  iE = y
                  p2Idx = x2
                  break
                }
              }
            }
            if (iS >= 0) break
          }
        }
        if (iS >= 0) {
          for (let p = 0; p < out.length; p++) {
            out[p] = out[p].trimEnd()
            wl2Idx.push(p)
          }
          const wl2 = []
          wl2.push(pref + 'WHERE   ' + renderToken(wtoks[iS], o) + ' (')
          const subPref = ' '.repeat(8 * ((depth || 0) + 1))
          const subLines = renderSubSelect(
            wtoks.slice(p2Idx + 1, iE),
            o,
            (depth || 0) + 1,
            0,
            multiNL
          )
          for (let s2 = 0; s2 < subLines.length; s2++) {
            const rows = subLines[s2].split('\r\n')
            for (let r2 = 0; r2 < rows.length; r2++)
              wl2.push(
                (subPref + (s2 === 0 && r2 === 0 ? '(' : '') + rows[r2].trimStart()).trimEnd()
              )
          }
          // 剩余（内层 ')' 起，含闭 ')'）贪心续拼到递归末行（pop 出避免重复）；超宽折 restPad（16 = 8*lvl+8）
          const rest = wtoks.slice(iE)
          const restPad = ' '.repeat(8 * lvl + 8)
          let rl = wl2.pop()
          let rLast = null
          for (let r2 = 0; r2 < rest.length; r2++) {
            const rt = rest[r2]
            if (rt.type === 'ws') continue
            const sp = needSpaceBefore(rt, rLast, r2 + 1 < rest.length ? rest[r2 + 1] : null, o)
              ? 1
              : 0
            if (rl.length + sp + renderToken(rt, o).length > o.ilineLengthWanted) {
              wl2.push(rl + ' ')
              rl = restPad
            }
            if (sp && !/ $/.test(rl)) rl += ' '
            rl += renderToken(rt, o)
            rLast = rt
          }
          wl2.push(rl)
          for (let s2 = 0; s2 < wl2.length; s2++) {
            out.push(wl2[s2])
            wl2Idx.push(out.length - 1)
          }
          continue
        }
        const pad8b = ' '.repeat(8)
        let wl = 'WHERE   '
        let wlInd = pref.length // 当前行缩进（主行 pref，续行 8）
        const subLines = []
        let wlast = null
        const wlMultiNL = multiNL
        let wParen = 0 // 当前 wtoks 括号深度（IN ( 参数组内续行对齐）
        let inAlignIdx = -1 // 最近 IN ( 开括号在 wl 内的 0-indexed 位置（wjz：IN 长列表续行对齐 '(' 后）
        for (let x = 0; x < wtoks.length; x++) {
          const xt = wtoks[x]
          if (xt.type === 'ws') continue
          if (xt.type === 'paren') {
            const bP = wParen
            wParen += xt.text === '(' ? 1 : -1
            if (wParen < 0) wParen = 0
            // IN ( 组闭合 → 对齐位失效（函数参数续行回到当前行缩进，ror-005 to_date 24）
            if (bP > 0 && wParen === 0) inAlignIdx = -1
          }
          if (xt.type === 'keyword' && xt.upper === 'IN') {
            // IN ( 记录开括号对齐位（wjz：IN 长列表续行缩进 = '(' 后列）
            let nx0 = x + 1
            while (nx0 < wtoks.length && wtoks[nx0].type === 'ws') nx0++
            if (nx0 < wtoks.length && wtoks[nx0].type === 'paren' && wtoks[nx0].text === '(') {
              const spIn = needSpaceBefore(xt, wlast, nx0, o) ? 1 : 0
              inAlignIdx = wl.length + spIn + 3 + 1
            }
          }
          const sp = needSpaceBefore(xt, wlast, x + 1 < wtoks.length ? wtoks[x + 1] : null, o)
            ? 1
            : 0
          const isCond = xt.type === 'keyword' && (xt.upper === 'AND' || xt.upper === 'OR')
          // ① AND NOT EXISTS (SELECT...) 子查询展开（拼入前无条件；ror-009 E8-E13）
          if (isCond && xt.upper === 'AND') {
            let n2 = x + 1
            while (n2 < wtoks.length && wtoks[n2].type === 'ws') n2++
            const neNot =
              n2 < wtoks.length && wtoks[n2].type === 'keyword' && wtoks[n2].upper === 'NOT'
            let n3 = n2 + 1
            while (n3 < wtoks.length && wtoks[n3].type === 'ws') n3++
            const neEx =
              n3 < wtoks.length && wtoks[n3].type === 'keyword' && wtoks[n3].upper === 'EXISTS'
            let n4 = n3 + 1
            while (n4 < wtoks.length && wtoks[n4].type === 'ws') n4++
            const neP = n4 < wtoks.length && wtoks[n4].type === 'paren' && wtoks[n4].text === '('
            if (neNot && neEx && neP) {
              let dd = 0,
                neEnd = -1
              for (let y = n4; y < wtoks.length; y++) {
                if (wtoks[y].type === 'paren') {
                  dd += wtoks[y].text === '(' ? 1 : -1
                  if (dd === 0) {
                    neEnd = y
                    break
                  }
                }
              }
              if (neEnd > 0) {
                wl += (sp ? ' ' : '') + 'AND NOT EXISTS'
                subLines.push(wl + ' ')
                const subT2 = wtoks.slice(n4 + 1, neEnd)
                const o2 = Object.assign({}, o, { idoubleIndentionMasterKeywordWanted: true })
                const subL2 = renderSubSelect(subT2, o2, (depth || 0) + 1, 0, multiNL)
                // NOT EXISTS 子查询闭后紧跟「外层闭 ) + AND/OR」时，一并收进末行尾（ror-005 E60「))) AND」）
                let neT1 = neEnd + 1
                while (neT1 < wtoks.length && wtoks[neT1].type === 'ws') neT1++
                let neT2 = neT1 + 1
                while (neT2 < wtoks.length && wtoks[neT2].type === 'ws') neT2++
                const neTail =
                  neT1 < wtoks.length &&
                  wtoks[neT1].text === ')' &&
                  neT2 < wtoks.length &&
                  (wtoks[neT2].upper === 'AND' || wtoks[neT2].upper === 'OR')
                for (let s2 = 0; s2 < subL2.length; s2++) {
                  const rows = subL2[s2].split('\r\n')
                  for (let r2 = 0; r2 < rows.length; r2++) {
                    const row = rows[r2]
                    const isLast = s2 === subL2.length - 1 && r2 === rows.length - 1
                    // 非末行补尾空格（(SELECT 1 尾 / FROM...col 尾 / = 尾）；')'、',' 或已带尾空格不加（ror-009 E9-E13）
                    const tail = isLast
                      ? neTail
                        ? ')) ' + wtoks[neT2].upper
                        : ')'
                      : row.endsWith(' ') || /[,)(']\s*$/.test(row) || /(AND|OR)\s*$/.test(row)
                        ? ''
                        : ' '
                    subLines.push(
                      (s2 === 0 && r2 === 0
                        ? ' '.repeat(pref.length) + '(' + row.trimStart()
                        : row.slice(pref.length)) + tail
                    )
                  }
                }
                wl = pad8b
                wlast = null
                x = neTail ? neT2 : neEnd
                continue
              }
            }
          }
          // ② (ident IN (...) 括号组拆（ror-009 E6-E8 拼入；ror-007 超限时 AND 留尾、组独立行）
          if (isCond) {
            let ax = x + 1
            while (ax < wtoks.length && wtoks[ax].type === 'ws') ax++
            if (ax < wtoks.length && wtoks[ax].type === 'paren' && wtoks[ax].text === '(') {
              let dd = 0,
                inIdx = -1,
                grpEnd = -1
              for (let y = ax; y < wtoks.length; y++) {
                const gy = wtoks[y]
                if (gy.type === 'paren') {
                  dd += gy.text === '(' ? 1 : -1
                  if (dd === 0) {
                    grpEnd = y
                    break
                  }
                }
                if (dd === 1 && inIdx < 0 && gy.type === 'keyword' && gy.upper === 'IN') inIdx = y
              }
              if (xt.upper === 'OR' && grpEnd > 0) {
                // OR ( 组：强制断行，OR + 整组拼入后继续贪心（ror-007 E66/E68）
                const grp = renderSimple(wtoks.slice(ax, grpEnd + 1), o)
                subLines.push(wl)
                wl = pad8b + 'OR ' + grp
                wlInd = pref.length + 8
                wlast = wtoks[grpEnd]
                x = grpEnd
                continue
              }
              if (inIdx > 0 && grpEnd > 0) {
                let dd2 = 0,
                  inEnd = -1
                for (let y = inIdx; y < wtoks.length; y++) {
                  if (wtoks[y].type === 'paren') {
                    dd2 += wtoks[y].text === '(' ? 1 : -1
                    if (dd2 === 0) {
                      inEnd = y
                      break
                    }
                  }
                }
                if (inEnd > 0 && inEnd < grpEnd && !joinLvl) {
                  const prefix = renderSimple(wtoks.slice(ax, inIdx), o)
                  const inGrp = renderSimple(wtoks.slice(inIdx, inEnd + 1), o)
                  const rest = renderSimple(wtoks.slice(inEnd + 1, grpEnd + 1), o)
                  const headLen = wl.trimEnd().length + 1 + 3 + 1 + prefix.trim().length + 1
                  const fullLen =
                    wl.trimEnd().length + 1 + 3 + 1 + prefix.trim().length + 1 + inGrp.trim().length
                  if (headLen > o.ilineLengthWanted - pref.length) {
                    wl += (sp ? ' ' : '') + 'AND'
                    subLines.push(wl)
                    subLines.push(pad8b + prefix + ' ' + inGrp)
                  } else if (fullLen > o.ilineLengthWanted - pref.length) {
                    // 拼入会超宽：AND prefix 留尾 + inGrp 独立行（ror-009 E6-E7）
                    wl += (sp ? ' ' : '') + 'AND ' + prefix
                    subLines.push(wl.endsWith(' ') ? wl : wl + ' ')
                    subLines.push(pad8b + inGrp)
                  } else {
                    // 拼入不超宽：AND prefix inGrp 直接拼（ror-005 E55），rest 交由后续 token（OR 处 742 断）
                    wl += (sp ? ' ' : '') + 'AND ' + prefix + ' ' + inGrp
                    wlast = wtoks[inEnd]
                    x = inEnd
                    continue
                  }
                  wl = pad8b + rest
                  wlInd = pref.length + 8
                  wlast = wtoks[grpEnd]
                  x = grpEnd
                  continue
                }
              }
            }
          }
          // token 级宽折判定（AND/OR 含下一个 token 预宽；运算符后第一个 ident 整段回溯 ror-009 E12；joinLvl 内层=剩余全段预宽，wjz 语义 ror-005 E43-E47）
          let wNxtTok = 0
          if (joinLvl) {
            let z2 = x + 1
            while (z2 < wtoks.length && wtoks[z2].type === 'ws') z2++
            if (
              xt.upper === 'IN' &&
              z2 < wtoks.length &&
              wtoks[z2].type === 'paren' &&
              wtoks[z2].text === '('
            ) {
              let dd = 0,
                z3 = z2
              for (; z3 < wtoks.length; z3++) {
                const t3 = wtoks[z3]
                if (t3.type === 'ws') continue
                if (t3.type === 'paren' && t3.text === '(') dd++
                else if (t3.type === 'paren' && t3.text === ')') {
                  dd--
                  if (dd === 0) break
                }
              }
              const wc2 = []
              for (let z4 = z2; z4 <= z3 && z4 < wtoks.length; z4++) wc2.push(wtoks[z4])
              wNxtTok = renderSimple(wc2, o).trim().length
              let z5 = z3 + 1
              const wc3 = []
              for (; z5 < wtoks.length; z5++) {
                const t5 = wtoks[z5]
                if (t5.type === 'ws') continue
                wc3.push(t5)
                if (t5.type === 'keyword' && (t5.upper === 'AND' || t5.upper === 'OR')) break
              }
              wNxtTok += renderSimple(wc3, o).trim().length
            } else {
              wNxtTok = z2 < wtoks.length ? renderToken(wtoks[z2], o).length + 1 : 0
            }
          } else if (isCond) {
            let z = x + 1
            while (z < wtoks.length && wtoks[z].type === 'ws') z++
            wNxtTok = z < wtoks.length ? renderToken(wtoks[z], o).length + 1 : 0
          } else if (wlast && wlast.type === 'op' && xt.type === 'ident') {
            const wNxt2 = []
            for (let m2 = x + 1; m2 < wtoks.length; m2++) {
              const t2 = wtoks[m2]
              if (t2.type === 'ws') continue
              if (
                wNxt2.length > 0 &&
                t2.type === 'keyword' &&
                (t2.upper === 'AND' || t2.upper === 'OR')
              )
                break
              wNxt2.push(t2)
            }
            wNxtTok = renderSimple(wNxt2, o).trim().length
          }
          const wWide =
            wl !== 'WHERE   ' &&
            wl.trim() &&
            wl.length -
              (wlInd === pref.length + 8 ? 8 : 0) +
              sp +
              renderToken(xt, o).length +
              wNxtTok >=
              o.ilineLengthWanted - wlInd
          if (wWide && !(joinLvl && isCond)) {
            if (xt.type === 'paren' && xt.text === ')' && wl.includes(' IN (')) {
              // IN 组闭断点回溯到 IN 词（wjz：断在 IN，IN 组随新行首；ror-005 E98/E99）
              const mi = wl.lastIndexOf(' IN (')
              subLines.push(wl.slice(0, mi).endsWith(' ') ? wl.slice(0, mi) : wl.slice(0, mi) + ' ')
              wl = pad8b + wl.slice(mi + 1) + renderToken(xt, o)
              wlInd = pref.length + 8
            } else if (isCond && xt.upper === 'AND') {
              // ③ AND 断点：段首 WHERE 主行（wlInd===pref.length）AND 留行尾（ror-004 E8）；续行（wlInd===pref.length+8）AND 到下一行首（ror-005 E54）
              if (wlInd === pref.length + 8) {
                subLines.push(wl.endsWith(' ') ? wl : wl + ' ')
                wl = pad8b + 'AND'
                wlInd = pref.length + 8
              } else {
                wl += (sp ? ' ' : '') + 'AND'
                subLines.push(wl)
                wl = pad8b
                wlInd = pref.length + 8
              }
            } else if (isCond) {
              subLines.push(wl)
              wl = pad8b + 'OR'
              wlInd = pref.length + 8
            } else {
              // 非 cond 断：若断点落在谓词中间（wl 尾为 'AND/OR + token'），截断回 AND/OR（ror-004 E8 断 AND 后），被截 token 移到下一行首
              const mAND = wl.search(/(?:AND|OR) [^ ]+$/)
              if (mAND >= 0 && !joinLvl && wlInd === pref.length) {
                const rest = wl.slice(mAND + 3).trimStart()
                wl = wl.slice(0, mAND + 3)
                subLines.push(wl.endsWith(' ') ? wl : wl + ' ')
                wl = pad8b + rest + renderToken(xt, o)
                wlInd = pref.length + 8
              } else {
                // IN ( 参数组内续行：缩进对齐 '(' 后（wjz：IN 长列表续行）；组外固定 pad8b
                const contPadW = inAlignIdx >= 0 && wParen > 0 ? ' '.repeat(inAlignIdx) : pad8b
                subLines.push(wl.endsWith(' ') ? wl : wl + ' ')
                wl = contPadW + renderToken(xt, o)
                wlInd = pref.length + 8
              }
              wlast = xt
              continue
            }
            wlast = xt
            continue
          }
          // 算术运算符空格跟随输入（wjz：1+1 无空格、column106 + 200 保留输入 ws）
          let sp2 = sp
          if (
            (xt.type === 'op' && (xt.text === '+' || xt.text === '-')) ||
            (wlast && wlast.type === 'op' && (wlast.text === '+' || wlast.text === '-'))
          ) {
            sp2 = x > 0 && wtoks[x - 1].type === 'ws'
          }
          if (sp2 && !/ $/.test(wl)) wl += ' '
          wl += renderToken(xt, o)
          wlast = xt
        }
        if (wl.trim()) subLines.push(wl)
        for (let si = 0; si < subLines.length; si++) out.push(pref + subLines[si])
        continue
      }
      line = pref + 'WHERE   ' + txt
    } else if (hdr.upper === 'FROM') {
      const rest = seg.slice(1)
      let m = 0
      while (m < rest.length && rest[m].type === 'ws') m++
      if (m < rest.length && rest[m].type === 'paren' && rest[m].text === '(') {
        // FROM 后 '(' 子查询：subLen<80 inline 1 空格；≥80 ALIGN 4（05/002、019）
        let dd = 0,
          kk = m
        for (; kk < rest.length; kk++) {
          if (rest[kk].type === 'paren') {
            dd += rest[kk].text === '(' ? 1 : -1
            if (dd === 0) break
          }
        }
        const subLen = renderSimple(rest.slice(m + 1, kk), o).length
        const subTxt = renderSimple(rest.slice(m), o, depth).replace(/^\s+/, '') // renderSimple 会给 '(' 加 pad8，剔除
        if (subLen < 80) line = pref + 'FROM ' + subTxt
        else line = pref + 'FROM' + ' '.repeat(Math.max(ALIGN.FROM ?? 4, 4)) + subTxt
      } else {
        // FROM 表列表 + JOIN 段：表 1 拼 FROM 行；首个 JOIN 起独立行（缩进 pref，wjz：LEFT JOIN 独立行）
        let jIdx = -1
        for (let x = 1; x < rest.length; x++) {
          if (
            rest[x].type === 'keyword' &&
            (rest[x].upper === 'JOIN' ||
              rest[x].upper === 'LEFT' ||
              rest[x].upper === 'RIGHT' ||
              rest[x].upper === 'FULL' ||
              rest[x].upper === 'INNER' ||
              rest[x].upper === 'CROSS')
          ) {
            jIdx = x
            break
          }
        }
        if (jIdx > 0) {
          line =
            pref +
            'FROM' +
            ' '.repeat(Math.max(ALIGN.FROM ?? 4, 4)) +
            renderSimple(rest.slice(0, jIdx), o)
          out.push(line)
          // JOIN 段独立行：renderSegment 对 JOIN 段自带 pad8，去前导避免与 pref 叠加（wjz：JOIN 段缩进 = pref）
          line = pref + renderSimple(rest.slice(jIdx), o).trimStart()
        } else {
          line = pref + 'FROM' + ' '.repeat(Math.max(ALIGN.FROM ?? 4, 4)) + renderSimple(rest, o)
        }
      }
    } else if (hdr.upper === 'SELECT') {
      // SELECT 列折行：超宽 → 首行 'SELECT ' 贪心填充，逗号前导续行缩进 lvl*8+8
      const unionPrev = s > 0 && segs[s - 1][0].upper === 'UNION' // UNION 断段后 SELECT：首行 externPad 预算扣 8（ror-005 E63 limit=104）而非 17（E1 FROM 段首行 limit=95）
      const colToks = seg.slice(1)
      const contPad = ' '.repeat(8 * lvl + 8)
      if (o.idoubleIndentionMasterKeywordWanted) {
        if (lvl === 1) {
          // 第一层子查询：同标准 SELECT 折行（6 列 + 逗号前导）
          if (renderSimple(colToks, o).length + 7 + 8 > o.ilineLengthWanted) {
            const cols = splitByComma(colToks)
            const subLines = []
            let cl = 'SELECT '
            for (let ci = 0; ci < cols.length; ci++) {
              const g = renderSimple(cols[ci], o)
              const sep = cl === 'SELECT ' ? '' : ', '
              const cand = cl + sep + g
              if (ci > 0 && cl !== 'SELECT ' && cand.length + 8 > o.ilineLengthWanted) {
                subLines.push(cl)
                cl = contPad + ', ' + g
              } else cl = cand
            }
            subLines.push(cl)
            for (let si = 0; si < subLines.length; si++)
              out.push(si === 0 ? pref + subLines[si] : subLines[si])
            continue
          }
          line = pref + 'SELECT ' + renderSimple(colToks, o)
        } else {
          // 深层子查询（双缩进主关键字）：贪心逗号行尾；续行缩进 lvl*8+8
          const cols = splitByComma(colToks)
          const bud = 8 * (lvl - 1) + 16
          const subLines = []
          let cl = 'SELECT '
          for (let ci = 0; ci < cols.length; ci++) {
            const g = renderSimple(cols[ci], o)
            if (ci === 0) {
              cl += g
              continue
            }
            const cand = cl + ', ' + g
            if (cand.length + bud > o.ilineLengthWanted) {
              subLines.push(cl + ', ')
              cl = g
              continue
            }
            cl = cand
          }
          subLines.push(cl)
          for (let si = 0; si < subLines.length; si++)
            out.push(si === 0 ? pref + subLines[si] : contPad + subLines[si])
          continue
        }
      } else {
        if (renderSimple(colToks, o).length + 7 + 8 + externPad > o.ilineLengthWanted) {
          const cols = splitByComma(colToks)
          const subLines = []
          let cl = 'SELECT '
          let inCaseRow = false // 当前行是 CASE 展开行（WHEN 起）：后续列折尾用 ', '（ror-009 E3）
          // 无 expr CASE 列（(CASE WHEN 紧跟）→ 词级流（ror-007 E57-E62）：全部列逐词贪心；
          // 断 = 行内容+词 > 120-行缩进；断点词在 CASE 列内 → 24 空格续行（断行尾空格：满限或 ')' 尾不补）；
          // 普通列断 → contPad 前导逗号（末行去前导，ror-007 E62）
          const bareCase = cols.some((c) => {
            for (let i2 = 0; i2 < c.length; i2++) {
              if (c[i2].type === 'keyword' && c[i2].upper === 'CASE') {
                let j = i2 + 1
                while (j < c.length && c[j].type === 'ws') j++
                return j < c.length && c[j].type === 'keyword' && c[j].upper === 'WHEN'
              }
            }
            return false
          })
          if (bareCase) {
            const wseq = []
            let lastTok = null
            let caseDepth = 0 // CASE 嵌套深度（ror-005 续行缩进：CASE 内 32、嵌套 48，E13/E17/E18）
            let maxCaseDepth = 0
            for (let ci = 0; ci < cols.length; ci++) {
              const inC = cols[ci].some((t) => t.type === 'keyword' && t.upper === 'CASE')
              if (ci > 0) {
                wseq.push({ s: ', ', t: null, inCase: false, noMerge: true })
                lastTok = null
              }
              const c = cols[ci]
              for (let i2 = 0; i2 < c.length; i2++) {
                const t = c[i2]
                if (t.type === 'ws') continue
                if (t.type === 'keyword' && t.upper === 'IN') {
                  let j = i2 + 1
                  while (j < c.length && c[j].type === 'ws') j++
                  if (j < c.length && c[j].type === 'paren' && c[j].text === '(') {
                    let dd = 0
                    const u = [t]
                    for (; j < c.length; j++) {
                      u.push(c[j])
                      if (c[j].type === 'paren') {
                        dd += c[j].text === '(' ? 1 : -1
                        if (dd === 0) break
                      }
                    }
                    wseq.push({
                      s:
                        (lastTok && needSpaceBefore(u[0], lastTok, null, o) ? ' ' : '') +
                        renderSimple(u, o),
                      t: u[u.length - 1],
                      inCase: inC,
                      caseDepth
                    })
                    i2 = j
                    lastTok = u[u.length - 1]
                    continue
                  }
                }
                const isCaseHeadWhen =
                  t.type === 'keyword' &&
                  t.upper === 'WHEN' &&
                  !!lastTok &&
                  lastTok.type === 'paren' &&
                  lastTok.text === '('
                const isCondWord =
                  inC &&
                  !isCaseHeadWhen &&
                  !!lastTok &&
                  lastTok.type === 'keyword' &&
                  lastTok.upper === 'WHEN'
                const sep = lastTok && needSpaceBefore(t, lastTok, null, o) ? ' ' : ''
                // 词边界对齐 wjz：'(' 独立成词（ror-005 E1 cnt_264 (cnt_264 ( TO_CHAR 断在第 3 层 '(' 后、TO_CHAR 前）
                const isOpenParen = t.type === 'paren' && t.text === '('
                if (!sep && wseq.length && !wseq[wseq.length - 1].noMerge && !isOpenParen) {
                  wseq[wseq.length - 1].s += renderToken(t, o)
                  lastTok = t
                  continue
                }
                if (t.type === 'keyword' && t.upper === 'CASE') {
                  caseDepth++
                  if (caseDepth > maxCaseDepth) maxCaseDepth = caseDepth
                } else if (t.type === 'keyword' && t.upper === 'END') caseDepth--
                wseq.push({
                  s: sep + renderToken(t, o),
                  t,
                  inCase: inC,
                  caseDepth,
                  isCond: isCondWord,
                  noMerge: isOpenParen,
                  force:
                    (t.type === 'keyword' &&
                      t.upper === 'WHEN' &&
                      !!lastTok &&
                      lastTok.type === 'paren' &&
                      lastTok.text === ')') ||
                    isCondWord
                })
                lastTok = t
              }
            }
            const pad16 = ' '.repeat(8 * lvl + 8)
            let ind = 8 // 当前行缩进（首行 8 由 renderSegment JOIN 布局补，subLines[0] 无缩进）
            let limit = o.ilineLengthWanted - ind - (externPad > 0 ? (unionPrev ? 8 : 17) : 0) // 首行：FROM 段子查询首行行前缀（FROM    ( ）额外预算（ror-005 E1 断 97）；UNION 断段后 SELECT 段仅扣 8（E63 limit=104）
            let joinCm = '' // joinCtx 场景：', ' 词挂起并入下词判据（ror-005 E36 断 END) 后、col_95 前；避免 ', ' 独立触发断点把 col_95 吃进上行）
            // 外层 FROM（列流与条件流分界）：FROM 后 3 词内出现逗号（多表列表=外层 FROM）；内联子查询 FROM 后是单表+WHERE（3 词内无逗号）
            let outerFrom = -1
            for (let fi = 0; fi < wseq.length; fi++) {
              if (wseq[fi].s.toUpperCase().trim() === 'FROM') {
                let cIn3 = false
                for (let j = 1; j <= 3 && fi + j < wseq.length; j++)
                  if (wseq[fi + j].s.trim() === ',') {
                    cIn3 = true
                    break
                  }
                if (cIn3) {
                  outerFrom = fi
                  break
                }
              }
            }
            for (let k = 0; k < wseq.length; k++) {
              const w = wseq[k]

              const effForce =
                w.force &&
                !(w.isCond && (ind === 8 || /^\s*WHEN\s*$/.test(cl) || w.s.trimStart() !== '('))
              const clw = cl.length + joinCm.length + w.s.length
              const asOff = w.s.trimStart() === 'AS' ? 1 : 0
              // 子查询 FROM 行 WHERE 强制换行（ror-005 E82-E84/E101-E103）：FROM 行累积中遇 WHERE → push FROM 行、WHERE 从新行续
              if (cl.startsWith('FROM') && w.s.trim() === 'WHERE') {
                subLines.push(
                  (ind === 8 ? '' : ' '.repeat(ind)) +
                    cl +
                    (cl.length >= limit || cl.endsWith(')') ? '' : ' ')
                )
                cl = 'WHERE  '
                ind = 8 * lvl + 8
                limit = o.ilineLengthWanted - ind
                continue
              }
              // joinLvl 内层（ror-005 INNER JOIN 子查询）hasCASE 去限定 + >= 判据（col_95 79>=79 断，E36-41）；外层保持 caseDepth0 限定 + > 判据（L0-32 锚点）。', ' 词仅 joinLvl 内层不触发断点（wjz 语义：内层逗号直接累积进 cl，E40 尾 col.amt_333, 带逗号；外层逗号可断——E9 断 '，' 后 E10 行首 ', col.col_283'）
              if (
                cl !== 'SELECT ' &&
                (!joinLvl || w.s.trim() !== ',') &&
                (effForce || (joinLvl ? clw >= limit - asOff : clw > limit - asOff))
              ) {
                joinCm = '' // 判据已并入 joinCm，断点触发后不残留
                // 行含 CASE 检测：caseDepth0 断点且断点后新行将出现 caseDepth>=1 词 → 行宽预算减 1（E13/E15/E16/E23/E24/E25）；joinLvl 内层无条件扫（IN 断点 caseDepth=1 也 hC=true→limit=79 供 col_95）；', ' 词跳过 hC（ror-005 E64 断 col.code_39 时 limit=104 不减，逗号词断点不减——E9 断 '，' 后行首 ', '）；unionPrev 段首行断点不 hC（E63 断 TO_CHAR 后 limit=104 供 E64 逗号词 104>104 不断、拼入 col_267, ）
                let hasCASE = false
                if (
                  (joinLvl || w.caseDepth === 0) &&
                  w.s.trim() !== ',' &&
                  !(unionPrev && ind === 8)
                ) {
                  if (unionPrev) hasCASE = true
                  else {
                    let acc = w.s.trimStart().length
                    for (let kk = k + 1; kk < wseq.length; kk++) {
                      const ww = wseq[kk]
                      if (ww.caseDepth >= 1) {
                        hasCASE = true
                        break
                      }
                      acc += ww.s.length
                      if (acc > limit * 4) break
                    }
                  }
                }
                if (cl.includes('(SELECT') && / FROM\s*$/.test(cl)) {
                  // 子查询展开（FROM 已拼入形态，ror-005 E82-E84）：断前 cl 去 FROM 尾 push；FROM+表名续行；WHERE 强制换行由前置分支承接
                  const frI = cl.lastIndexOf('FROM')
                  subLines.push(
                    (ind === 8 ? '' : ' '.repeat(ind)) + cl.slice(0, frI).trimEnd() + ' '
                  )
                  cl = 'FROM    ' + w.s.trimStart()
                  ind = 8 * lvl + 8
                  limit = o.ilineLengthWanted - ind - (hasCASE ? 1 : 0)
                  continue
                }
                if (cl.trimEnd().endsWith('(SELECT')) {
                  // 子查询展开（ror-005 E20-E23）：'(SELECT' 断点后 SELECT/FROM/WHERE 段独立行
                  subLines.push(
                    (ind === 8 ? '' : ' '.repeat(ind)) +
                      cl +
                      (cl.length >= limit || cl.endsWith(')') ? '' : ' ')
                  )
                  let dd = 0,
                    kEnd = -1,
                    subWords = []
                  for (let kk = k; kk < wseq.length; kk++) {
                    const s2 = wseq[kk].s
                    subWords.push(s2)
                    for (let ci2 = 0; ci2 < s2.length; ci2++) {
                      const ch = s2[ci2]
                      if (ch === '(') dd++
                      else if (ch === ')') {
                        dd--
                        if (dd < 0) {
                          kEnd = kk
                          break
                        }
                      }
                    }
                    if (kEnd >= k) break
                  }
                  const subs = subWords.map((s) => s.trimStart())
                  const fi = subs.findIndex((s) => s.toUpperCase() === 'FROM')
                  const wi = subs.findIndex((s) => s.toUpperCase() === 'WHERE')
                  if (fi > 0)
                    subLines.push(' '.repeat(8 * lvl + 16) + subs.slice(0, fi).join(' ') + ' ')
                  if (fi >= 0)
                    subLines.push(
                      ' '.repeat(8 * lvl + 8) +
                        'FROM    ' +
                        (wi > fi ? subs.slice(fi + 1, wi).join(' ') : subs.slice(fi + 1).join(' '))
                    )
                  cl = wi >= 0 ? 'WHERE   ' + subs.slice(wi + 1).join(' ') : ''
                  ind = 8 * lvl + 8
                  limit = o.ilineLengthWanted - ind
                  k = kEnd
                  continue
                }
                if (w.caseDepth > 0) {
                  subLines.push(
                    (ind === 8 ? '' : ' '.repeat(ind)) +
                      cl +
                      (cl.length >= limit || cl.endsWith(')') ? '' : ' ')
                  )
                  ind =
                    w.t.type === 'keyword' && w.t.upper === 'WHEN'
                      ? 8 * lvl + 16
                      : 8 * lvl + 8 + 16 * w.caseDepth // WHEN 子句续 8*lvl+16（lvl=2→32，E38），CASE 内续 8*lvl+8+16*caseDepth（E36/E39=40）
                  cl = w.s.trimStart()
                } else {
                  subLines.push(
                    (ind === 8 ? '' : ' '.repeat(ind)) +
                      cl +
                      (cl.length >= limit || cl.endsWith(')') ? '' : ' ')
                  )
                  ind = 8 * lvl + 8
                  cl = w.s.trimStart()
                }
                limit = o.ilineLengthWanted - ind - (hasCASE ? 1 : 0)
                continue
              }
              cl += joinCm + w.s
              joinCm = ''
            }
            cl += joinCm
            subLines.push(ind === 8 ? cl : ' '.repeat(ind) + cl)
            for (let si = 0; si < subLines.length; si++) {
              const _ol = si === 0 ? pref + subLines[si] : subLines[si]
              out.push(_ol)
            }
            continue
          }
          for (let ci = 0; ci < cols.length; ci++) {
            const g = renderSimple(cols[ci], o)
            const wIdx = cols[ci].findIndex((t2) => t2.type === 'keyword' && t2.upper === 'WHEN')
            if (wIdx > 0) {
              // CASE 列展开：前段拼当前行（到 WHEN 前），WHEN 起 pref+16 独立行（ror-009 E2-E3）
              const preT = renderSimple(cols[ci].slice(0, wIdx), o)
              const postT = renderSimple(cols[ci].slice(wIdx), o)
              const cand = cl + (cl === 'SELECT ' ? '' : ', ') + preT
              if (ci > 0 && cl !== 'SELECT ' && cand.length + 8 > o.ilineLengthWanted) {
                subLines.push(cl + ', ')
                cl = contPad + ', ' + preT
              } else cl = cand
              subLines.push(cl)
              cl = ' '.repeat(8 * lvl + 16) + postT
              inCaseRow = true
              continue
            }
            const sep = cl === 'SELECT ' ? '' : ', '
            const cand = cl + sep + g
            if (
              cl === 'SELECT ' &&
              cols.length === 1 &&
              cand.length + 8 + externPad > o.ilineLengthWanted
            ) {
              // 单列超宽：SELECT 头留尾 + 列独立续行（ror-007 E40-E41，cur+(SELECT +列 恰 120 界宽）
              subLines.push('SELECT ')
              cl = contPad + g
            } else if (
              ci > 0 &&
              cl !== 'SELECT ' &&
              cand.length + 8 + (cl.startsWith('SELECT ') ? externPad : 0) > o.ilineLengthWanted
            ) {
              subLines.push(cl + (inCaseRow ? ', ' : cl.startsWith('SELECT ') ? '' : ',')) // 续行尾逗号（E5 尾）；头行无（E4）；CASE 行尾 ', '
              cl = contPad + ', ' + g
            } else cl = cand
          }
          subLines.push(
            cl.startsWith(contPad + ', ') && !cl.slice((contPad + ', ').length).includes(', ')
              ? contPad + cl.slice((contPad + ', ').length)
              : cl
          ) // 末行单列去前导逗号（ror-004 E6 SUM）
          for (let si = 0; si < subLines.length; si++) {
            out.push(si === 0 ? pref + subLines[si] : subLines[si])
            if (si === subLines.length - 1 && !subLines[si].includes(', '))
              wl2Idx.push(out.length - 1) // 单列末行无尾空格（E6）
          }
          continue
        }
        line = pref + 'SELECT ' + renderSimple(colToks, o)
      }
    } else if (hdr.upper === 'GROUP' || hdr.upper === 'ORDER') {
      // GROUP BY / ORDER BY 列折行：头行 pref + 段头 + 贪心列（尾逗号），续行 contPad + 前导逗号（ror-004 E10/E11）
      const headTxt = renderSimple(seg.slice(0, 2), o) // 'GROUP BY' / 'ORDER BY'
      const colToks = seg.slice(2)
      if (renderSimple(colToks, o).length + headTxt.length + 1 + 8 > o.ilineLengthWanted) {
        const contPad = ' '.repeat(8 * lvl + 8)
        const cols = splitByComma(colToks)
        const subLines = []
        let cl = headTxt + ' '
        for (let ci = 0; ci < cols.length; ci++) {
          const g = renderSimple(cols[ci], o)
          const sep = cl === headTxt + ' ' ? '' : ', '
          const cand = cl + sep + g
          if (ci > 0 && cl !== headTxt + ' ' && cand.length + 22 >= o.ilineLengthWanted) {
            subLines.push(cl)
            cl = contPad + ', ' + g
          } else cl = cand
        }
        subLines.push(cl)
        for (let si = 0; si < subLines.length; si++)
          out.push(si === 0 ? pref + subLines[si] : subLines[si])
        continue
      }
      line = pref + renderSimple(seg, o)
    } else if (hdr.upper === 'HAVING') {
      // HAVING 段：段头 ALIGN 2 空格；含 WHEN 时展开（CASE 表达式拼首行，WHEN 起 8*lvl+16 独立行，ror-009 E15-E16）
      const wIdx = seg.findIndex((t2) => t2.type === 'keyword' && t2.upper === 'WHEN')
      if (wIdx > 1) {
        const preT = renderSimple(seg.slice(1, wIdx), o)
        const postT = renderSimple(seg.slice(wIdx), o)
        out.push(pref + 'HAVING' + ' '.repeat(2) + preT)
        out.push(
          ' '.repeat(8 * lvl + 16) + postT + (/ $/.test(postT) || /[);]$/.test(postT) ? '' : ' ')
        )
        keepIdx.push(out.length - 1)
        continue
      }
      line = pref + 'HAVING' + ' '.repeat(2) + renderSimple(seg.slice(1), o)
    } else {
      line = pref + renderSimple(seg, o)
    }
    out.push(line)
  }
  for (let i = 0; i < out.length - 1; i++) {
    if (wl2Idx.includes(i) || keepIdx.includes(i)) continue
    const tl = out[i].trimEnd()
    // 单行输入（019 等）：行尾一律补空格；多行输入（ror-004）：行尾为分隔符（,/AND/OR）才补（E9/E10/E11 普通 token 无尾空格）
    if (!multiNL || /[,(]\s*$/.test(tl) || /(AND|OR)\s*$/.test(tl)) out[i] = tl + ' '
  }
  out.condSegTail =
    segs.length > 0 && ['WHERE', 'HAVING', 'ON'].includes(segs[segs.length - 1][0].upper)
  return out
}

/** 渲染 token 序列为行数组；每行行尾含 1 空格（末行除外，由调用方 trim）。
 *  子查询块规则：顶层 (SELECT...) 前换行、独立行缩进 8；块后内容（AND/OR/分号）继续同行。
 *  segKw：段头关键字（SELECT 段投影列 >6 折行，每行 6 列、续行前导逗号缩进 8） */
function renderBody(toks, from, o, baseW, segKw, lenExpand, depth, eolSet, joinAlignMax) {
  baseW = baseW || 0
  const pad8 = ' '.repeat(8)
  const lines = []
  let cur = ''
  let last = null
  let windowExpanded = false
  let pendingBreak = false
  let colCount = 0
  const n = toks.length
  // 投影列含行注释 → 每列一行 + 列尾注释对齐（02/024）
  let colWrapped = false
  let colWidest = 0
  let colStart = false
  let colLens = []
  let pendingSub = [] // inline 子查询展开行：cur 完成后再追加（ror-006 投影子查询）
  let inSubRest = false // cur = 子查询 rest 末行后：列流续接不适用外层 6 列固定折（EXP 宽度驱动）
  let inSubRestFirst = false // 子查询 rest 起始行首次列级预折（ror-006 E19 列边界折；续行走 814+1153）
  let onRest = false // FROM rest 段 ON（ror-005 E51-52）：8sp 起 + 表列表词级贪心折（16sp 续）
  if (segKw === 'SELECT') {
    let d0 = 0
    let segStart = from
    for (let i = from; i < n; i++) {
      const tt = toks[i]
      if (tt.type === 'paren') d0 += tt.text === '(' ? 1 : -1
      if (d0 === 0 && tt.type === 'comment' && tt.text.startsWith('--')) colWrapped = true
      if (d0 === 0 && tt.type === 'comma') {
        const colT = toks
          .slice(segStart, i)
          .filter((tt2) => tt2.type !== 'ws' && tt2.type !== 'comment')
        let cl = renderSimple(colT, o).length + 1
        // 子查询列（含 '('）：折行预估按首行截断（wjz 子查询 inline 首行展开，ror-006）
        if (colT.some((tt2) => tt2.type === 'paren')) cl = Math.min(cl, 25)
        colLens.push(cl)
        segStart = i + 1
      }
    }
    if (colWrapped) {
      if (segStart < n)
        colLens.push(
          renderSimple(
            toks.slice(segStart, n).filter((tt2) => tt2.type !== 'ws' && tt2.type !== 'comment'),
            o
          ).length
        )
      colWidest = Math.max(0, ...colLens)
      colStart = true
    }
  }
  let d0 = 0
  for (let i = from; i < n; i++) {
    const t = toks[i]
    if (t.type === 'paren') d0 += t.text === '(' ? 1 : -1
    if (t.type === 'ws') continue
    if (pendingBreak) {
      // 段中行注释后断行：当前行推入，后续内容（AND/OR 等）缩进 8
      lines.push(cur.trimEnd() + ' ')
      cur = pad8
      pendingBreak = false
    }
    if (segKw === 'SELECT' && t.type === 'comma') {
      // 括号内逗号（函数参数/IN 参数）不参与列折行：wjz 函数调用整体保持（_rules-clean concat 列）
      // 子查询展开（1660）d0 残留 +1：ror-006 投影列流 inSubRest 的普通列逗号需走列折（wjz 列首预折判据）
      if (d0 > 0 && !inSubRest) {
        cur += ','
        last = t
        continue
      }
      // 投影列折行：宽度驱动（当前行含 SELECT 头 baseW + 下一列 > 120 → 折）；逗号位置随输入行数
      // 单行输入 → 逗号置续行行首（014/t-）；多行输入 → 逗号留行尾（ror-004）
      colCount++
      const multiNL = eolSet && eolSet.size >= 2
      let nxtColW = 0
      if (inSubRest) {
        // 子查询 rest 续接列：colLens 不覆盖，实时算下一列宽（ror-006 EXP 宽度驱动折行）
        let cEnd = n
        let cd = 0
        for (let c2 = i + 1; c2 < n; c2++) {
          if (toks[c2].type === 'paren') {
            cd += toks[c2].text === '(' ? 1 : -1
            if (cd < 0) {
              cEnd = c2
              break
            }
          }
          if (cd === 0 && toks[c2].type === 'comma') {
            cEnd = c2
            break
          }
        }
        nxtColW = renderSimple(
          toks.slice(i + 1, cEnd).filter((tt2) => tt2.type !== 'ws' && tt2.type !== 'comment'),
          o
        ).length
        if (toks.slice(i + 1, cEnd).some((tt2) => tt2.type === 'paren'))
          nxtColW = Math.min(nxtColW, 25)
      }
      if (colWrapped) {
        cur += ','
        colStart = true
      } else if (
        colCount === 6 ||
        (colCount > 1 &&
          (function () {
            // 列折行判据：整列估算（ror-004 满行逗号折、续行省 8）；复杂列（CASE/函数/子查询，含 '(' 或 CASE 族）→ 词级（首词放行、AS 后折 1847）；
            // CASE 展开后的列（cur 含 CASE 族）也词级（_rules-clean END 后列 7 续接）
            let nx = i + 1
            while (nx < n && toks[nx].type === 'ws') nx++
            const fw = nx < n ? renderToken(toks[nx], o).length : 0
            let complex = false
            for (let k = nx; k < n && toks[k].type !== 'comma'; k++) {
              if (
                toks[k].type === 'paren' ||
                (toks[k].type === 'keyword' &&
                  ['CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'SELECT', 'FROM'].includes(toks[k].upper))
              ) {
                complex = true
                break
              }
            }
            const afterCase = /(?:CASE|WHEN|THEN|ELSE|END)\b/.test(cur)
            // colLens 只覆盖内层 SELECT 已枚举列；ror-006 后段列（子查询展开/续接列）不在 colLens → 实时渲染下一列宽（wjz 列首预折判据）
            let subq = false
            for (let k = nx; k < n && toks[k].type !== 'comma'; k++) {
              if (toks[k].type === 'keyword' && ['SELECT', 'FROM'].includes(toks[k].upper)) {
                subq = true
                break
              }
            }
            let colW
            if (inSubRest) colW = nxtColW
            else if (complex && !subq) {
              // 函数括号类复杂列按整列宽度预判列首折（ror-007 L1 第 3 列 %col_360_(...) 整列≈45，cur+45>120 → wjz 列首折）；
              // 旧 fw（首词宽）对 cur 已≈117 的 ror-006 CASE 列等效，但对 cur≈105 的 ror-007 短列不足（105+8<120 不折）
              let ce = n
              let cdd = 0
              for (let c2 = i + 1; c2 < n; c2++) {
                // OVER 列例外：wjz 把 "SUM (column3) OVER (" 拼入当前行、括号内再展开（列宽只算到 OVER 前，06-hive/003），不计 OVER (…) 整段
                if (toks[c2].type === 'keyword' && toks[c2].upper === 'OVER') {
                  ce = c2
                  break
                }
                if (toks[c2].type === 'paren') {
                  cdd += toks[c2].text === '(' ? 1 : -1
                  if (cdd < 0) {
                    ce = c2
                    break
                  }
                }
                if (cdd === 0 && toks[c2].type === 'comma') {
                  ce = c2
                  break
                }
              }
              colW = renderSimple(
                toks.slice(i + 1, ce).filter((tt2) => tt2.type !== 'ws' && tt2.type !== 'comment'),
                o
              ).length
            } else if (afterCase || subq) colW = fw
            else if (colLens[colCount] !== undefined) colW = colLens[colCount]
            else {
              let ce = n
              let cdd = 0
              for (let c2 = i + 1; c2 < n; c2++) {
                if (toks[c2].type === 'paren') {
                  cdd += toks[c2].text === '(' ? 1 : -1
                  if (cdd < 0) {
                    ce = c2
                    break
                  }
                }
                if (cdd === 0 && toks[c2].type === 'comma') {
                  ce = c2
                  break
                }
              }
              colW = renderSimple(
                toks.slice(i + 1, ce).filter((tt2) => tt2.type !== 'ws' && tt2.type !== 'comment'),
                o
              ).length
            }
            const sum = cur.trim().length + (inSubRest ? 0 : baseW) + colW + (inSubRest ? 0 : 1)
            return sum > o.ilineLengthWanted
          })())
      ) {
        if (colCount === 6) {
          // 6 列固定折：EXP 强制前导逗号样式（ror-006 E33/E37/E45 尾无逗号无空格 + 下面前导逗号）；inSubRest 列流同款（ror-006 L34 col_373 后折）
          cur = cur.replace(/,\s*$/, '')
          lines.push(cur.trimEnd() + (multiNL ? '' : ' '))
          cur = pad8 + ','
        } else if (multiNL) {
          cur += ','
          lines.push(cur.trimEnd() + ' ')
          cur = pad8
        } else {
          cur = cur.replace(/,\s*$/, '')
          lines.push(cur.trimEnd() + ' ')
          cur = pad8 + ','
        }
        colCount = 0
      } else {
        cur += ','
      }
      last = t
      continue
    }
    if (
      (segKw === 'INNER' ||
        segKw === 'LEFT' ||
        segKw === 'RIGHT' ||
        segKw === 'CROSS' ||
        segKw === 'JOIN') &&
      t.type === 'comma'
    ) {
      // JOIN 段表列表折行：cur（ON 条件 + 表）+ 下一表超 120 → 断行，续行 pad8（ror-007 E72-E73）
      let nt = i + 1
      while (nt < n && toks[nt].type === 'ws') nt++
      const ntT = nt < n ? toks[nt] : null
      const nxtLen = ntT ? renderToken(ntT, o).length + 1 : 0
      if (cur.trim() && cur.trim().length + 2 + nxtLen > o.ilineLengthWanted) {
        lines.push(cur.trimEnd() + ', ')
        cur = pad8
      } else cur += ','
      last = t
      continue
    }
    if ((segKw === 'GROUP' || segKw === 'ORDER') && t.type === 'comma') {
      // GROUP BY/ORDER BY 列折行：下个 token 拼入预估超 120 → 本行截断，逗号置续行行首（缩进 8）
      const segHeadLen = baseW + segKw.length + 2 // 'GROUP BY' + 对齐空格
      const nt = i + 1 < n ? toks[i + 1] : null
      const nxtLen = nt ? renderToken(nt, o).length + 1 : 0
      if (cur.trim() && cur.trim().length + segHeadLen + 1 + nxtLen > o.ilineLengthWanted) {
        lines.push(cur.trimEnd() + ' ')
        cur = pad8 + ','
      } else cur += ','
      last = t
      continue
    }
    if (colWrapped && colStart && t.type !== 'comment') {
      // 列首 token：上一列（尾逗号）推入，新列缩进 8（首列不缩进）
      if (cur.trim()) lines.push(cur.trimEnd() + ' ')
      cur = cur.length ? pad8 : ''
      colStart = false
    }
    if (t.type === 'comment') {
      // 注释后下一个非 ws token（段尾判定：后是段头关键字或语句结束）
      let m = i + 1
      while (m < n && toks[m].type === 'ws') m++
      const afterTok = m < n ? toks[m] : null
      const atSegEnd =
        !afterTok || (afterTok.type === 'keyword' && CLAUSE_STARTS.includes(afterTok.upper))
      if (t.text.startsWith('--')) {
        if (colWrapped) {
          // 列折行（含注释）：注释原文保留 + 对齐；行尾无空格（02/024）
          const curEnd = cur.trimEnd()
          const curLen = curEnd.length - (curEnd.startsWith(pad8) ? 8 : 0)
          const padN = Math.max(1, colWidest - curLen + 1)
          cur = curEnd + ' '.repeat(padN) + t.text.trimEnd()
          lines.push(cur.trimEnd())
          cur = pad8
          colStart = true
          last = t
          continue
        }
        // 行注释
        if (cur.trim()) {
          if (atSegEnd) {
            // 段尾行注释：转块 /*-- x*/（07/003）；ilinebreakBeforeLineCommentWanted=true 保留原文（t- 变体）
            if (!/ $/.test(cur)) cur += ' '
            cur += o.ilinebreakBeforeLineCommentWanted ? t.text.trimEnd() : '/*' + t.text + '*/'
            lines.push(cur.trimEnd())
            cur = ''
          } else {
            // 段中行注释：lenExpand → 原文保留；否则转块；其后内容断行缩进 8，行尾无尾空格
            const content = lenExpand ? t.text.trimEnd() : '/*' + t.text + '*/'
            if (!/ $/.test(cur)) cur += ' '
            cur += content
            lines.push(cur.trimEnd())
            cur = pad8
          }
        } else {
          // 行首行注释：独立行（保留原文），行尾无尾空格（wjz 行为：-- 说明\r\n）
          lines.push(t.text.trimEnd())
          cur = ''
        }
      } else {
        // 块注释：内部换行删除（wjz 保留行首缩进、不 CRLF 化）
        const txt = t.text.replace(/\r?\n/g, '')
        if (cur.trim()) {
          if (atSegEnd && lenExpand) {
            // 段尾块注释 + 长度展开：独立行缩进 8（02/002、d1/d3）
            lines.push(cur.trimEnd() + ' ')
            cur = pad8 + txt.trimEnd()
          } else {
            // 其余（段中 / 注释触发展开）：行内续接
            if (!/ $/.test(cur)) cur += ' '
            cur += txt.trimEnd()
          }
        } else {
          // 行首块注释：独立行，行尾无尾空格（wjz 行为：/* 说明 */\r\n）
          lines.push(txt.trimEnd())
          cur = ''
        }
      }
      last = t
      continue
    }
    if (t.type === 'semicolon') {
      // 分号前空格：last 为 paren 恒 1 空格；last 为 string 跟随输入（输入有 ws → 1 空格）
      const prevWs = i > 0 && toks[i - 1].type === 'ws'
      if (last && last.type === 'paren' && !/ $/.test(cur)) cur += ' '
      else if (last && last.type === 'string' && prevWs && !/ $/.test(cur)) cur += ' '
      cur += ';'
      last = t
      // 分号后行注释：拼入同行（wjz：= 2; -- 注释），行尾无尾空格
      let mn = i + 1
      while (mn < n && toks[mn].type === 'ws') mn++
      if (mn < n && toks[mn].type === 'comment' && toks[mn].text.startsWith('--')) {
        cur += ' ' + toks[mn].text.trimEnd()
        last = toks[mn]
        i = mn
      }
      continue
    }
    if (
      t.type === 'keyword' &&
      t.upper === 'CASE' &&
      !(last && last.type === 'paren' && last.text === '(')
    ) {
      // CASE 展开：expr 拼入当前行；每个 WHEN 独立行缩进 16；ELSE/END 留在最后 WHEN 行
      let d = 0
      let end = -1
      for (let m = i; m < n; m++) {
        if (toks[m].type === 'keyword') {
          const u = toks[m].upper
          if (u === 'CASE') d++
          else if (u === 'END') {
            d--
            if (d === 0) {
              end = m
              break
            }
          }
        }
      }
      let w1 = -1
      if (end > i) {
        for (let m = i + 1; m < end; m++)
          if (toks[m].type === 'keyword' && toks[m].upper === 'WHEN') {
            w1 = m
            break
          }
      }
      if (end > i && w1 > i) {
        // expr：CASE 后第一个非 ws 是否为 WHEN（CASE 关键字本身不算 expr）
        let m2 = i + 1
        while (m2 < end && toks[m2].type === 'ws') m2++
        const hasExpr = !(m2 < end && toks[m2].type === 'keyword' && toks[m2].upper === 'WHEN')
        if (hasExpr) {
          // CASE 关键字拼入当前行
          if (cur && !/ $/.test(cur)) cur += ' '
          cur += 'CASE'
          last = toks[i]
        }
        for (let e = i + 1; e < w1; e++) {
          const et = toks[e]
          if (et.type === 'ws') continue
          if (needSpaceBefore(et, last, e + 1 < w1 ? toks[e + 1] : null, o)) {
            if (cur && !/ $/.test(cur)) cur += ' '
          }
          cur += renderToken(et, o)
          last = et
        }
        // WHEN 段
        const pad16 = ' '.repeat(16)
        let from = w1
        let firstWhen = true
        while (from < end + 1) {
          let to = from + 1
          while (to < end + 1 && !(toks[to].type === 'keyword' && toks[to].upper === 'WHEN')) to++
          const segTxt = renderSimple(toks.slice(from, to), o)
          if (hasExpr) {
            // CASE expr 型：WHEN 独立行缩进 16（01/005）
            if (cur.trim()) lines.push(cur.trimEnd() + ' ')
            cur = pad16 + segTxt
          } else {
            // CASE WHEN 型（无 expr）：'CASE' + 首 WHEN 同行（02/017/018）
            if (needSpaceBefore(toks[i], last, i + 1 < n ? toks[i + 1] : null, o)) {
              if (!/ $/.test(cur)) cur += ' '
            }
            if (firstWhen) cur += 'CASE '
            // 贪心拼 WHEN 段：超宽折行；断点 = 下一个词放不下（不含 +8 预留，wjz 填满 120 后断 THEN 前）；
            // 续行缩进：断点词为 WHEN/THEN → 16（展开行）；条件词（AND/比较后）→ 24（t-ilinebreakCaseWanted 条件续 24）
            let xl = null
            for (let x = from; x < to; x++) {
              const xt = toks[x]
              if (xt.type === 'ws') continue
              const sp = needSpaceBefore(xt, xl, x + 1 < to ? toks[x + 1] : null, o) ? 1 : 0
              if (cur.trim() && cur.length + sp + renderToken(xt, o).length > o.ilineLengthWanted) {
                const contPad =
                  xt.type === 'keyword' && (xt.upper === 'WHEN' || xt.upper === 'THEN') ? 16 : 24
                lines.push(cur.trimEnd() + ' ')
                cur = ' '.repeat(contPad)
              }
              if (sp && !/ $/.test(cur)) cur += ' '
              cur += renderToken(xt, o)
              xl = xt
            }
            firstWhen = false
            if (to <= end) {
              // 非末段（后面还有 WHEN）：push，下一 WHEN 缩进 16
              if (cur.trim()) lines.push(cur.trimEnd() + ' ')
              cur = pad16
            }
          }
          last = toks[to - 1]
          from = to
        }
        i = end
        continue
      }
    }
    if (t.type === 'keyword' && t.upper === 'OVER' && !windowExpanded) {
      // 窗口块展开：OVER ( 后子句（PARTITION BY/ORDER BY）折行；
      // 触发：'(' 前已渲染宽度 + 括号内内容长度 ≥ 62（probe 定阈）；每语句只展开首个窗口块
      let j = i + 1
      while (j < n && toks[j].type === 'ws') j++
      if (j < n && toks[j].type === 'paren' && toks[j].text === '(') {
        let d = 0
        let k = j
        for (; k < n; k++) {
          if (toks[k].type === 'paren') {
            d += toks[k].text === '(' ? 1 : -1
            if (d === 0) break
          }
        }
        const overKw = kwText('OVER', o.upperAndLowerCaseStyle)
        const openIdx = baseW + cur.length + (cur ? 1 : 0) + overKw.length + 1 // '(' 的 0-indexed 位置（整行坐标）
        const innerLen = renderSimple(toks.slice(j + 1, k), o).length
        if (openIdx + innerLen >= 62) {
          windowExpanded = true
          if (cur && !/ $/.test(cur)) cur += ' '
          lines.push(cur.trimEnd() + ' ' + overKw + ' ( ')
          const padClause = ' '.repeat(Math.max(openIdx - 7, 0))
          const padContent = ' '.repeat(openIdx + 1)
          // 顶层窗口子句头（PARTITION/ORDER）
          const heads = []
          let dd = 0
          for (let m = j + 1; m < k; m++) {
            const tt = toks[m]
            if (tt.type === 'paren') dd += tt.text === '(' ? 1 : -1
            if (
              dd === 0 &&
              tt.type === 'keyword' &&
              (tt.upper === 'PARTITION' || tt.upper === 'ORDER')
            )
              heads.push(m)
          }
          for (let hi = 0; hi < heads.length; hi++) {
            const h = heads[hi]
            const hEnd = hi + 1 < heads.length ? heads[hi + 1] : k + 1 // 最后段含 ')'（slice 端点 +1）
            const isLast = hi === heads.length - 1
            let contentStart = h + 1
            while (contentStart < k && toks[contentStart].type === 'ws') contentStart++
            if (
              contentStart < k &&
              toks[contentStart].type === 'keyword' &&
              toks[contentStart].upper === 'BY'
            ) {
              contentStart++
              while (contentStart < k && toks[contentStart].type === 'ws') contentStart++
            }
            const contentTxt = renderSimple(toks.slice(contentStart, hEnd), o)
            if (toks[h].upper === 'PARTITION') {
              lines.push(padClause + 'PARTITION BY' + ' ')
              if (isLast) cur = padContent + contentTxt
              else lines.push(padContent + contentTxt + ' ')
            } else {
              // ORDER BY 头与内容同行
              cur = padClause + 'ORDER BY' + (contentTxt ? ' ' + contentTxt : '')
            }
          }
          i = k
          last = k < n ? toks[k] : last
          continue
        }
      }
    }
    if (t.type === 'paren' && t.text === '(') {
      // 下一个非 ws token 是 SELECT → 子查询块
      let j = i + 1
      while (j < n && toks[j].type === 'ws') j++
      if (j < n && toks[j].type === 'keyword' && toks[j].upper === 'SELECT') {
        let pDepth = 0
        let k = i
        for (; k < n; k++) {
          if (toks[k].type === 'paren') {
            pDepth += toks[k].text === '(' ? 1 : -1
            if (pDepth === 0) break
          }
        }
        const subToks = toks.slice(i + 1, k)
        const subLen = renderSimple(subToks, o).length // 子查询渲染后长度（近似原文；展开阈值同 80）
        const isFromHead = segKw === 'FROM' || cur.trim() === 'FROM' // FROM 段直接子查询：inline 时同行 'FROM ('
        // 子查询 inline：FROM 段"表列表后"（cur 非空）或 SELECT 投影列内（ror-004/006）；FROM 段首独立行（019）
        const inlineSub =
          (segKw === 'FROM' && cur.trim() !== '' && cur.trim() !== 'FROM') ||
          (segKw === 'SELECT' && cur.trim())
        if (subLen >= 80) {
          // 子查询内部展开：inline 场景首行拼入当前行；独立场景 '(' + SELECT 段独立行（renderSubSelect）
          // externPad：SELECT 投影段含缩进（ror-007 E40 cur+(SELECT+列 恰 120 界宽折）；FROM 段无缩进保持原语义
          // ror-005 E33-E50：cur 尾为 INNER/LEFT/RIGHT/FULL/CROSS JOIN（renderSimple FROM 段）→ 子查询整体深一级渲染（断点+缩进一次对齐）
          const joinCtx = /(INNER|LEFT|RIGHT|FULL|CROSS)\s+JOIN\s*$/.test(cur) ? 1 : 0
          const subLines = renderSubSelect(
            subToks,
            o,
            (depth || 0) + 1 + joinCtx,
            inlineSub || isFromHead
              ? segKw === 'FROM'
                ? cur.trim().length + 1
                : cur.length + 1
              : 0,
            eolSet && eolSet.size >= 2,
            joinCtx
          )
          // 闭合 ')' 拼到最后一行（EXP：...< 100) s2）
          subLines[subLines.length - 1] = subLines[subLines.length - 1].replace(/\s+$/, '') + ')'
          // 别名（')' 后非 ws、非子句头、非分号 token）拼入最后一行
          // 别名（')' 后非 ws、非子句头、非分号 token）拼入最后一行（ror-006 EXP：...'v_') AS code_73, (SELECT...）
          let a = k + 1
          while (a < n && toks[a].type === 'ws') a++
          if (
            a < n &&
            !(toks[a].type === 'keyword' && CLAUSE_STARTS.includes(toks[a].upper)) &&
            toks[a].type !== 'semicolon'
          ) {
            // 连续闭括号 '))'：外层 ')' 紧贴拼入（ror-004 E18）；其他别名加空格
            subLines[subLines.length - 1] +=
              (toks[a].type === 'paren' && toks[a].text === ')' ? '' : ' ') +
              renderToken(toks[a], o)
            const aStart = a
            a++
            // 「=」后值+谓词链贪心续拼（ror-005 E103：子查询外 "= 'N' AND (col.type_127...) AND col.time_107" 拼入子查询末行，超宽断在值运算符前）
            if (toks[aStart].text === '=') {
              let aLast2 = toks[aStart]
              while (
                a < n &&
                !(toks[a].type === 'keyword' && CLAUSE_STARTS.includes(toks[a].upper)) &&
                toks[a].type !== 'semicolon'
              ) {
                if (toks[a].type === 'ws') {
                  a++
                  continue
                }
                const aN2 = a + 1
                let a2 = aN2
                while (a2 < n && toks[a2].type === 'ws') a2++
                const aSp = needSpaceBefore(toks[a], aLast2, a2 < n ? toks[a2] : null, o) ? 1 : 0
                if (
                  subLines[subLines.length - 1].length + aSp + renderToken(toks[a], o).length >
                  o.ilineLengthWanted
                )
                  break
                subLines[subLines.length - 1] += (aSp ? ' ' : '') + renderToken(toks[a], o)
                aLast2 = toks[a]
                a++
              }
            }
          }
          // 分号紧随别名/子查询末行：尾 ')' 时 ' ;'（ror-004 E18 ')) ;'）；别名后 's;' 紧贴（ror-006）
          if (a < n && toks[a].type === 'semicolon') {
            subLines[subLines.length - 1] += subLines[subLines.length - 1].trimEnd().endsWith(')')
              ? ' ;'
              : ';'
            a++
          }
          // 子查询末行尾空格：仅 condSeg 末段（WHERE/HAVING/ON，ror-009 E16）且尾非 ')' 非 ';' 时补；非 condSeg（ror-004 GROUP BY 末行）与 ';' 尾（ror-004 E18）不补
          const ltail = subLines[subLines.length - 1].trimEnd()
          if ((subLines.condSegTail || joinCtx) && !ltail.endsWith(')') && !ltail.endsWith(';'))
            subLines[subLines.length - 1] += ' '
          if (inlineSub) {
            if (segKw === 'SELECT') {
              // ror-006 投影子查询列：首行拼 cur → 行 A 完成 push（行尾按 eolSet）→ 展开行 push → 末行作为新 cur（后续列 inline 续接）
              if (cur.trim()) {
                if (!/ $/.test(cur)) cur += ' '
                cur += '(' + subLines[0].trimEnd()
              } else cur = '(' + subLines[0].trimEnd()
              const tailTok = subLines[0].trimEnd().slice(-1)
              // SELECT 头留尾（ror-007 E40 subLines[0]='SELECT '）：行尾恒留空格（后面接展开行）；否则按 eolSet（E1 列尾无空格）
              const headOnly = subLines[0].trimEnd() === 'SELECT'
              lines.push(cur.trimEnd() + (headOnly ? ' ' : eolSet.has(')') ? '' : ' '))
              cur = subLines[subLines.length - 1]
              colCount = 0
              inSubRest = true
              // rest 末行若是段头行（WHERE/SELECT/FROM 起头）：列级预折不适用（ror-006 行 42 后不预折）；折行尾行（'v__' AND...）才预折（行 19）
              inSubRestFirst = !/^(WHERE|SELECT|FROM|GROUP|ORDER|HAVING|ON)\s+/.test(
                subLines[subLines.length - 1].trimStart()
              )
              for (let s = 1; s < subLines.length - 1; s++) {
                lines.push(
                  /^FROM /.test(subLines[s].trimStart()) ? subLines[s].trimEnd() : subLines[s]
                )
              }
            } else {
              if (cur.trim()) {
                if (!/ $/.test(cur)) cur += ' '
                cur += '(' + subLines[0].trimEnd() + (segKw === 'FROM' ? '' : ' ')
              } else cur = '(' + subLines[0].trimEnd() + (segKw === 'FROM' ? '' : ' ')
              pendingSub = pendingSub.concat(subLines.slice(1))
            }
          } else {
            // 非 inline 子查询展开：cur 尾是留尾 AND/OR/逗号且子查询前缀短 → 前缀合并到该行尾（ror-004 E14 'AND (NOT EXISTS'）；否则 cur 独立行
            let joinInd = false
            const prevLine = lines[lines.length - 1]
            const merged =
              cur.trim() &&
              prevLine &&
              /(AND|OR|,)\s*$/.test(prevLine.trimEnd()) &&
              prevLine.trimEnd().length + cur.trim().length + 1 <= o.ilineLengthWanted
            if (merged) {
              lines[lines.length - 1] = prevLine.trimEnd() + ' ' + cur.trim()
              lines.push(pad8 + '(' + subLines[0].trimEnd() + (subLines.length > 1 ? '' : ' '))
              cur = ''
            } else {
              // ror-005 E33-E34：FROM 表列表尾 INNER/LEFT/RIGHT/FULL/CROSS JOIN（renderSimple 段内）→ 表列表独立行 + INNER JOIN 独立行（8）
              const jm = cur.match(/(INNER|LEFT|RIGHT|FULL|CROSS)\s+JOIN\s*$/)
              if (jm) {
                const head = cur.slice(0, jm.index).trimEnd()
                if (head) lines.push(head + ' ')
                cur = ' '.repeat(8) + jm[0].trimEnd()
                joinInd = true
              }
              if (cur.trim()) {
                if (!/ $/.test(cur)) cur += ' '
                const ce1 = cur.trimEnd()
                lines.push(
                  ce1 +
                    ((segKw === 'WHERE' || segKw === 'HAVING' || segKw === 'ON') &&
                    /(AND|OR)\s*$/.test(ce1)
                      ? ' '
                      : segKw === 'FROM' || /(AND|OR|,|NOT EXISTS)\s*$/.test(ce1)
                        ? ''
                        : ' ')
                )
                cur = ''
              } // 条件段 AND/OR 尾留空格（ror-005 E100）；FROM/NOT EXISTS/逗号尾无（ror-009 E2、ror-007 E79）
              // 首行尾空格：subLines 后续为段头行（FROM/SELECT/WHERE...）时保留（019 E1）；后续为列续行（, ...）时无（ror-009 E2）
              const nx1 = subLines[1] ? subLines[1].trimStart() : ''
              const moreHead =
                !!nx1 &&
                /^(FROM|SELECT|WHERE|GROUP|ORDER|HAVING|ON|JOIN|INNER|LEFT|RIGHT|CROSS|AND|OR)\b/.test(
                  nx1
                )
              // subLines[0] 原始带尾空格（t- SELECT 末行）原样保留；无尾时按续行类型补（019 段头行 ' '；ror-009 列续行 ''）
              const s0raw = subLines[0]
              lines.push(
                (segKw === 'FROM' ? '' : joinInd ? ' '.repeat(16) : pad8) +
                  '(' +
                  (s0raw.endsWith(' ') ? s0raw : s0raw.trimEnd())
              )
            }
            for (let s = 1; s < subLines.length; s++) lines.push(subLines[s])
          }
          last = k < n ? toks[k] : null
          i = a - 1
          continue
        }
        const sub = renderSimple(subToks, o)
        if (isFromHead) {
          cur = cur.trim() ? cur.trimEnd() + ' (' + sub + ')' : '(' + sub + ')'
        } else if (segKw === 'SELECT' && cur.trim()) {
          // SELECT 投影列内短子查询：inline 拼入 cur（ror-006 E21），超宽词级折行续 16（E22）
          if (!/ $/.test(cur)) cur += ' '
          const words = ('(' + sub + ')').split(' ')
          for (const w of words) {
            const add = (cur.trim() ? 1 : 0) + w.length
            if (cur.trim() && pad8.length + cur.trim().length + add > o.ilineLengthWanted) {
              lines.push(cur.trimEnd() + ' ')
              cur = '                ' + w
              colCount = 0
            } else {
              if (cur.trim()) {
                if (!/ $/.test(cur)) cur += ' '
              }
              cur += w
            }
          }
        } else {
          if (cur.trim()) lines.push(cur.trimEnd() + ' ')
          cur = pad8 + '(' + sub + ')'
        }
        last = k < n ? toks[k] : null
        i = k
        continue
      }
    }
    // 条件段（WHERE/HAVING/ON）超长折行：wjz 回溯到最近的 AND/OR 边界——AND 断后（AND 留行尾）、OR 断前（OR 到行首）
    const condSeg = segKw === 'WHERE' || segKw === 'HAVING' || segKw === 'ON'
    if (condSeg && cur.trim() && t.type === 'keyword' && (t.upper === 'AND' || t.upper === 'OR')) {
      const sp = needSpaceBefore(t, last, i + 1 < n ? toks[i + 1] : null, o) ? 1 : 0
      const segHeadLen = segKw ? baseW + segKw.length : 0 // 段头 'WHERE' + 对齐空格占行宽预算
      const multiNL = eolSet && eolSet.size >= 2 // 多行输入（ror-006 类）走 wjz 条件折；单行输入保持 168 门判据
      let nx = i + 1
      while (nx < n && toks[nx].type === 'ws') nx++
      const nxt = nx < n ? toks[nx] : null
      let nxtLen
      if (multiNL && nxt) {
        // 多行输入：完整下一谓词宽度（ror-006 E57 AND 处按谓词全宽判定）
        const nxtToks = []
        let depth0 = 0
        for (let m = nx; m < n; m++) {
          const tm = toks[m]
          if (tm.type === 'ws') continue
          if (
            depth0 <= 0 &&
            nxtToks.length > 0 &&
            tm.type === 'keyword' &&
            (tm.upper === 'AND' || tm.upper === 'OR')
          )
            break
          // 谓词主体边界：IN 关键字或函数调用（ident/keyword 后跟 '('）前停——IN 参数组/子查询整体不计入下谓词预算（ror-007 E76 拼 col.st_71、E79 拼 AND NOT EXISTS）
          if (depth0 <= 0 && nxtToks.length > 0 && tm.type === 'keyword' && tm.upper === 'IN') break
          // 赋值谓词 '=' 后停：值字面量不计入下谓词预算，由 token 级折处理（ror-008 E8 断在 = 后、E16 拼满整组）；谓词头为函数调用（NVL (...) =）时值计入（ror-006 E57 NVL 谓词全宽 29）
          const headIsFn =
            nxtToks.length >= 2 &&
            (nxtToks[0].type === 'ident' || nxtToks[0].type === 'keyword') &&
            nxtToks[1].type === 'paren' &&
            nxtToks[1].text === '('
          if (depth0 <= 0 && nxtToks.length > 0 && tm.text === '=' && !headIsFn) break
          // 谓词主体边界：IN 关键字或函数调用（ident/keyword 后跟 '('）前停——IN 参数组/子查询整体不计入下谓词预算（ror-007 E76 拼 col.st_71、E79 拼 AND NOT EXISTS）；谓词头函数（ident 后 '('，如 AND NVL (...) =）全宽计 26（ror-006 E57 NVL 前折），keyword 头（NOT EXISTS）与非谓词头（to_date 值）截断
          if (
            depth0 <= 0 &&
            nxtToks.length > 0 &&
            (tm.type === 'ident' || tm.type === 'keyword') &&
            (nxtToks.length > 1 || tm.type === 'keyword')
          ) {
            let n2 = m + 1
            while (n2 < n && toks[n2].type === 'ws') n2++
            if (n2 < n && toks[n2].type === 'paren' && toks[n2].text === '(') break
          }
          if (tm.type === 'paren') depth0 += tm.text === '(' ? 1 : -1
          nxtToks.push(tm)
        }
        nxtLen = renderSimple(nxtToks, o).trim().length
      } else {
        nxtLen = nxt
          ? (needSpaceBefore(nxt, t, nx + 1 < n ? toks[nx + 1] : null, o) ? 1 : 0) +
            renderToken(nxt, o).length
          : 0
      }
      // 函数调用谓词（nxt 后跟 '('，如 NVL/TO_DATE）且行已较长 → 强制折（ror-006 E57 NVL 前 AND 折；行短时放行如 E56 to_date）
      let nx2 = nx + 1
      while (nx2 < n && toks[nx2].type === 'ws') nx2++
      const fnCall =
        multiNL &&
        nxt &&
        (nxt.type === 'ident' || nxt.type === 'keyword') &&
        nx2 < n &&
        toks[nx2].type === 'paren' &&
        toks[nx2].text === '('
      const wide = multiNL
        ? (fnCall &&
            cur.trim().length + sp + renderToken(t, o).length + nxtLen + 3 >=
              o.ilineLengthWanted) ||
          cur.trim().length + sp + renderToken(t, o).length + nxtLen >= o.ilineLengthWanted
        : cur.trim().length + segHeadLen + sp + renderToken(t, o).length + nxtLen >
          o.ilineLengthWanted
      if (wide) {
        let wideSkip = false
        if (t.upper === 'AND') {
          const andNxtParen = nxt && nxt.type === 'paren' && nxt.text === '('
          const andLastBreak =
            (last && last.type === 'paren' && last.text === ')') || (last && last.type === 'number')
          const andBudgetWide =
            last &&
            last.type !== 'string' &&
            last.type !== 'ident' &&
            cur.trim().length + sp + 3 + (nxtLen > 0 ? 1 + nxtLen : 0) > o.ilineLengthWanted
          if (multiNL && !andNxtParen && (andLastBreak || andBudgetWide)) {
            // 多行输入：AND 后随 '('（IN/子查询括号组）留行尾；last==')'（ror-006 E56）或数字字面量后（ror-004 E12）或谓词全宽超 120 时断前；string/ident 后留尾（ror-004 E13、ror-006 E57）
            lines.push(cur.trimEnd())
            cur = pad8 + 'AND'
          } else {
            if (andNxtParen) {
              // ror-009 E6-E8：括号组总宽超限 → 仅 IN ( 参数组拆；AND ( 条件组不折（ror-004 E13 拼入后由 token 级折处理）
              let pp = i + 1,
                dd0 = 0,
                grpEnd = -1
              for (; pp < n; pp++) {
                if (toks[pp].type === 'paren') {
                  dd0 += toks[pp].text === '(' ? 1 : -1
                  if (dd0 === 0) {
                    grpEnd = pp
                    break
                  }
                }
              }
              if (grpEnd >= 0) {
                let o0 = i + 1
                while (o0 < grpEnd && !(toks[o0].type === 'paren' && toks[o0].text === '(')) o0++
                const grpFull = renderSimple(toks.slice(o0, grpEnd + 1), o).trim()
                if (cur.trim().length + sp + 3 + grpFull.length > o.ilineLengthWanted) {
                  let q = o0 + 1
                  while (q < grpEnd && !(toks[q].type === 'paren' && toks[q].text === '(')) q++
                  let qPre = q - 1
                  while (qPre > o0 && toks[qPre].type === 'ws') qPre--
                  const qPrevIsIn =
                    qPre > o0 && toks[qPre].type === 'keyword' && toks[qPre].upper === 'IN' // 仅「IN (」参数组拆（ror-009）；AND ( 条件组不折（ror-004 E13）
                  // ror-007 E77：AND ( 复合组（NOT IN (...) OR (...)) 参数组留行尾（wjz 不拆 IN 参数）；ror-009 的 IN 参数独立行由 renderSubSelect 子查询路径处理，此处不拆
                  wideSkip = true // AND ( 条件组超宽不在此断（ror-004 E13），AND 与括号组由后续 token 级折与正常拼入处理
                }
              }
            }
            if (!wideSkip) {
              cur += (sp ? ' ' : '') + 'AND' // AND 留行尾
              lines.push(cur.trimEnd() + ' ')
              cur = pad8
            }
          }
        } else {
          lines.push(cur.trimEnd() + (eolSet.has(last.text) ? '' : ' ')) // 行尾=OR 前 token
          cur = pad8 + 'OR' // OR 到续行行首
        }
        if (!wideSkip) {
          last = t
          continue
        }
      }
    }
    // 条件段 token 级宽度折（仅多行输入，ror-006 E55 ...col.type_40 \r\n LIKE）：续行前导 8 + token 尾空格计入预算；排除括号内（last=='('）与 AND/OR/逗号/分号
    if (
      condSeg &&
      eolSet &&
      eolSet.size >= 2 &&
      cur.trim() &&
      t.type !== 'comma' &&
      t.type !== 'semicolon' &&
      !(t.type === 'paren' && t.text === ')') &&
      !(last && last.type === 'paren' && last.text === '(') &&
      !(t.type === 'keyword' && (t.upper === 'AND' || t.upper === 'OR'))
    ) {
      // 后续必拼 token（非 AND/OR/闭括号）计入预算：ror-006 E55 LIKE 后 'v__' 必拼 → 折；ror-004 E13 'CD' 后 AND 可留尾 → 不折
      let ni2 = i + 1
      while (ni2 < n && toks[ni2].type === 'ws') ni2++
      const nxtTok = ni2 < n ? toks[ni2] : null
      let nxtAdd = 0
      if (
        nxtTok &&
        !(nxtTok.type === 'keyword' && (nxtTok.upper === 'AND' || nxtTok.upper === 'OR')) &&
        !(nxtTok.type === 'paren' && nxtTok.text === ')') &&
        nxtTok.type !== 'semicolon'
      ) {
        // 引用组：dot + 后 ident 连续（.code_272）合并计宽（ror-007 E74/E75 断 col 前）；段尾分号不计入预算（ror-008 E16 值+分号拼满）
        // string 不计：IN ('CD00000000')/LIKE 'v__' 的值不在 '(' / 运算符前提前折，拼上后由值 token 自身判定（ror-006 E56 IN 组拼满、rmy-005 LIKE 链拼满）；LIKE 不计：type_40 后 LIKE 不提前触发折点（ror-006 E55 type_40 留行尾、LIKE 起行）
        let grpLen =
          nxtTok.type === 'string' || nxtTok.upper === 'LIKE' ? 0 : renderToken(nxtTok, o).length
        let g2 = ni2 + 1
        while (g2 < n && toks[g2].type === 'ws') g2++
        if (nxtTok.type === 'dot' && g2 < n && toks[g2].type === 'ident')
          grpLen += renderToken(toks[g2], o).length
        nxtAdd = grpLen + 1
        // 再后一个是 AND/OR（谓词边界）：追加预算（ror-006 E55 'LIKE 'v__' AND' 超宽折）
        let ni3 = nxtTok.type === 'dot' ? g2 + 1 : ni2 + 1
        while (ni3 < n && toks[ni3].type === 'ws') ni3++
        const nxtTok2 = ni3 < n ? toks[ni3] : null
        if (
          nxtTok2 &&
          nxtTok2.type === 'keyword' &&
          (nxtTok2.upper === 'AND' || nxtTok2.upper === 'OR')
        )
          nxtAdd += 4
      }
      const segHeadPad2 = (cur.match(/^\s*/)[0] || '').length === 0 ? baseW : 0
      const tl =
        cur.length +
        segHeadPad2 +
        1 +
        renderToken(t, o).length +
        (t.text === '=' ? 0 : nxtAdd) +
        (nxtAdd > 0 ? 1 : 0) // t 后空格仅在仍有必拼后续(nxtAdd>0)时计：ror-008 IN 第二个值(nxtAdd=2)折 120、rmy-005 第3个 LIKE 值(nxtAdd=0)拼 119；'=' 后值由值 token 自身判定（ror-008 E8 断在 = 后留 = 行尾）
      if (tl >= o.ilineLengthWanted) {
        // 断行尾空格：下一 token 为段头关键字（如 UNION）或不存在时无尾空格（ror-008 E9 值后 UNION）；AND/OR/续行谓词保留尾空格
        lines.push(
          cur.trimEnd() +
            (nxtTok && nxtTok.type === 'keyword' && !['AND', 'OR'].includes(nxtTok.upper)
              ? ''
              : ' ')
        )
        cur = pad8
      }
    }
    // AS 拼入前折：cur 已超宽 → 折行，AS 起行（ror-006 E25/E28 ...col_277 \r\n AS col_277）
    // wjz 词级判据：cur+AS(3) < 120 时 AS 留行尾（alias 由 1905 折）；cur+3 >= 120 时 AS 起行（ror-006 L26 恰好 120 边界）
    if (segKw === 'SELECT' && t.type === 'keyword' && t.upper === 'AS') {
    }
    if (
      segKw === 'SELECT' &&
      t.type === 'keyword' &&
      t.upper === 'AS' &&
      cur.trim() &&
      (cur.match(/^\s*/)[0] || '').length + cur.trim().length + 3 >= o.ilineLengthWanted
    ) {
      lines.push(cur.trimEnd() + ' ')
      cur = pad8
      colCount = 0
    }
    // SELECT 投影列内超宽：在 AS 后折（ror-004/006：...AS \r\n col_xxx），续行缩进 8，折后重置列计数
    // ror-006 列流 colCount 恒 0（inSubRest 每逗号重置），放宽为 (colCount > 0 || inSubRest) 使 AS 后折生效
    if (
      segKw === 'SELECT' &&
      cur.trim() &&
      (colCount > 0 || inSubRest) &&
      last &&
      last.type === 'keyword' &&
      last.upper === 'AS'
    ) {
      const spAs = needSpaceBefore(t, last, i + 1 < n ? toks[i + 1] : null, o) ? 1 : 0
      // 物理列宽：首行前缀 = baseW（段头拼在 first）；续行前缀 = cur 前导空格（pad8/16）
      const curPref = lines.length === 0 ? baseW : (cur.match(/^\s*/)[0] || '').length
      // +3：AS 与其后随空格计入 alias 宽度预算（wjz 词级判据 cur+AS+alias>120 → 断 AS 后，ror-006 group-having 行 20）；
      // 仅当 alias 后仍有同段列内容时生效（hive 003 alias 后 FROM 段尾不折）
      // 20261102 实测：ror-006 L28 col_287（inSubRest）需无 +3（119<120 不折、wjz 拼完整列）；ror-007 普通列流需 +3 → +3 仅在非 inSubRest 生效
      let afterAs = i + 1
      while (afterAs < n && toks[afterAs].type === 'ws') afterAs++
      const hasMoreCol =
        afterAs < n &&
        toks[afterAs].type !== 'semicolon' &&
        !(toks[afterAs].type === 'keyword' && CLAUSE_STARTS.includes(toks[afterAs].upper))
      const sum =
        curPref +
        cur.trim().length +
        (hasMoreCol && !inSubRest ? 3 : 0) +
        spAs +
        renderToken(t, o).length
      const fold = lines.length === 0 ? sum >= o.ilineLengthWanted : sum > o.ilineLengthWanted
      if (fold) {
        lines.push(cur.trimEnd() + ' ')
        cur = pad8
        colCount = 0
      }
    }
    // CASE 块闭合 ')':cur 超宽 → 折行，')' 起行 8（ror-006 E23-24 ...END \r\n ) AS；ror-007 D23 119+1=120 恰好折 → >=）
    if (
      segKw === 'SELECT' &&
      t.type === 'paren' &&
      t.text === ')' &&
      last &&
      last.type === 'keyword' &&
      last.upper === 'END' &&
      cur.trim() &&
      baseW + cur.trim().length + 1 >= o.ilineLengthWanted
    ) {
      lines.push(cur.trimEnd() + ' ')
      cur = pad8
      colCount = 0
    }
    // 子查询闭合 ')' 后别名：当前行超宽 → 折行续 8（ror-006 投影子查询 ...'v_') AS \r\n code_73, (SELECT...）
    if (
      segKw === 'SELECT' &&
      last &&
      last.type === 'paren' &&
      t.type === 'ident' &&
      baseW + cur.trim().length + 1 + renderToken(t, o).length >= o.ilineLengthWanted
    ) {
      lines.push(cur.trimEnd() + ' ')
      cur = pad8
    }
    // 子查询 rest 列级预折：cur 仍为 rest 起始行（未折行）时逐列检查（ror-006 E19 列边界折）；折行后走 814+1153
    if (
      segKw === 'SELECT' &&
      inSubRest &&
      inSubRestFirst &&
      cur.trim() &&
      /,\s*$/.test(cur) &&
      t.type === 'ident'
    ) {
      let cEnd2 = n
      let cd2 = 0
      for (let c3 = i; c3 < n; c3++) {
        if (toks[c3].type === 'paren') {
          cd2 += toks[c3].text === '(' ? 1 : -1
          if (cd2 < 0) {
            cEnd2 = c3
            break
          }
        }
        if (cd2 === 0 && toks[c3].type === 'comma') {
          cEnd2 = c3
          break
        }
      }
      const colW2 = renderSimple(
        toks.slice(i, cEnd2).filter((tt2) => tt2.type !== 'ws' && tt2.type !== 'comment'),
        o
      ).length
      if (colW2 > 0 && cur.trim().length + baseW + colW2 + 1 > o.ilineLengthWanted) {
        lines.push(cur.trimEnd() + ' ')
        cur = pad8
        colCount = 0
        inSubRestFirst = false
      }
    }
    // 括号内 CASE 块超宽折行：THEN 内容续行缩进 前导+16*CASE深度（ror-006 E34-35 嵌套 CASE ...col_95 * \r\n 40 缩进）
    if (segKw === 'SELECT' && cur.trim() && cur.includes('CASE')) {
      const cdepth = (cur.match(/CASE/g) || []).length - (cur.match(/END/g) || []).length
      const kwBlock =
        t.type === 'keyword' && ['WHEN', 'THEN', 'ELSE', 'END', 'CASE'].includes(t.upper)
      const opTok = /^[+\-*/%<>=!.]$/.test(t.text) || (t.type === 'paren' && t.text === '(')
      if (
        cdepth > 0 &&
        cur.trim().length >= 100 &&
        !kwBlock &&
        !opTok &&
        t.type !== 'comma' &&
        t.type !== 'semicolon' &&
        !(t.type === 'paren' && t.text === ')')
      ) {
        const lead = (cur.match(/^\s*/)[0] || '').length
        lines.push(cur.trimEnd() + ' ')
        cur = ' '.repeat(lead + 16 * cdepth)
      }
    }
    // FROM rest 段 ON 触发（子查询展开后 cur 清空、last 为闭括号）：8sp 起（ror-005 E51）
    if (
      t.type === 'keyword' &&
      t.upper === 'ON' &&
      cur.trim() === '' &&
      last &&
      last.type === 'paren' &&
      last.text === ')' &&
      segKw !== 'JOIN' &&
      segKw !== 'INNER' &&
      segKw !== 'LEFT' &&
      segKw !== 'RIGHT' &&
      segKw !== 'CROSS' &&
      segKw !== 'WHERE' &&
      segKw !== 'HAVING' &&
      segKw !== 'ON'
    ) {
      onRest = true
      cur = ' '.repeat(8) + 'ON'
      last = t
      continue
    }
    // FROM rest 段 ON（renderSimple FROM 段内子查询展开后、表列表续接）：8sp 起 + 括号组整体拼入 + 表列表词级贪心折行（16sp 续，ror-005 E51-52）
    if (onRest && t.type === 'keyword' && CLAUSE_STARTS.includes(t.upper) && t.upper !== 'ON')
      onRest = false
    if (onRest && t.type === 'paren' && t.text === '(') {
      let dd = 0,
        ke = i
      for (; ke < n; ke++) {
        if (toks[ke].type === 'paren') {
          dd += toks[ke].text === '(' ? 1 : -1
          if (dd === 0) break
        }
      }
      const grpTxt = renderSimple(toks.slice(i, ke + 1), o)
      const spGrp = needSpaceBefore(t, last, i + 1 < n ? toks[i + 1] : null, o) ? 1 : 0
      if (cur.trim() && cur.length + spGrp + grpTxt.length >= o.ilineLengthWanted) {
        lines.push(cur.trimEnd() + ' ')
        cur = ' '.repeat(16)
      }
      if (spGrp && !/ $/.test(cur)) cur += ' '
      cur += grpTxt
      last = toks[ke]
      i = ke
      continue
    }
    if (
      onRest &&
      t.type !== 'comma' &&
      t.type !== 'semicolon' &&
      !(t.type === 'paren' && t.text === ')')
    ) {
      const spOn = needSpaceBefore(t, last, i + 1 < n ? toks[i + 1] : null, o) ? 1 : 0
      const wOn = renderToken(t, o).length
      if (cur.trim() && cur.length + spOn + wOn >= o.ilineLengthWanted) {
        lines.push(cur.trimEnd() + ' ')
        cur = ' '.repeat(16)
      }
    }
    // JOIN 段内 ON 拼入：表名+别名右对齐到本 JOIN 区最长 + 1（ror-008 E5/E7 两处 2 空格；02-rules 等长区仍 1 空格）
    if (
      (segKw === 'JOIN' ||
        segKw === 'INNER' ||
        segKw === 'LEFT' ||
        segKw === 'RIGHT' ||
        segKw === 'CROSS') &&
      t.type === 'keyword' &&
      t.upper === 'ON' &&
      cur.trim()
    ) {
      // renderBody 的 cur 以表名起（JOIN 前缀由 renderSegment 的 first 拼入），cur.trim().length 即表名+别名宽
      const curW = cur.trim().length
      let zMax = curW
      if (typeof joinAlignMax === 'number') zMax = joinAlignMax
      else {
        for (let z = i + 1; z < n; z++) {
          const zt = toks[z]
          if (
            zt.type === 'keyword' &&
            [
              'WHERE',
              'GROUP',
              'ORDER',
              'HAVING',
              'UNION',
              'SELECT',
              'LIMIT',
              'FETCH',
              'RETURNING'
            ].includes(zt.upper)
          )
            break
          if (zt.type === 'keyword' && zt.upper === 'JOIN') {
            let a = z + 1
            while (a < n && toks[a].type === 'ws') a++
            let b = a + 1
            while (b < n && toks[b].type === 'ws') b++
            if (a < n) {
              const hasAlias =
                b < n &&
                !(
                  toks[b].type === 'keyword' &&
                  [
                    'ON',
                    'WHERE',
                    'USING',
                    'LEFT',
                    'RIGHT',
                    'INNER',
                    'CROSS',
                    'JOIN',
                    'OUTER'
                  ].includes(toks[b].upper)
                )
              const w = hasAlias
                ? renderToken(toks[a], o).length + 1 + renderToken(toks[b], o).length
                : renderToken(toks[a], o).length
              if (w > zMax) zMax = w
            }
          }
        }
      }
      cur += ' '.repeat(zMax + 1 - curW)
    }
    if (
      condSeg &&
      !cur.trim() &&
      last &&
      last.type === 'paren' &&
      last.text === ')' &&
      needSpaceBefore(t, last, i + 1 < n ? toks[i + 1] : null, o)
    ) {
      cur = pad8 // 子查询展开后 condSeg 续行 8sp（ror-005 E104 '>= to_date' 起行）
    }
    if (needSpaceBefore(t, last, i + 1 < n ? toks[i + 1] : null, o)) {
      if (cur && !/ $/.test(cur)) cur += ' '
    }
    cur += renderToken(t, o)
    last = t
  }
  if (cur.trim()) {
    const tailTok = cur.trimEnd().split(/\s+/).pop() || ''
    const eolTail =
      eolSet &&
      eolSet.size >= 2 &&
      eolSet.has(tailTok) &&
      (/^['"]/.test(tailTok) || tailTok === ';') // 段尾对齐输入行尾的字面量/分号无尾空格（ror-008 E9 值后 UNION、E16 分号）；数字/标识符保留（ror-009 E18）
    lines.push(
      cur.trimEnd() +
        ((pendingSub.length && segKw === 'FROM' && cur.includes('(SELECT')) || eolTail ? '' : ' ')
    ) // FROM inline 折行子查询主行/段尾字面量无尾空格（ror-004 E4、ror-008 E9）
  }
  for (const pl of pendingSub) lines.push(/^FROM /.test(pl.trimStart()) ? pl.trimEnd() : pl) // FROM 行无尾空格（ror-004 E7）
  return lines
}

function renderToken(t, o) {
  if (t.type === 'keyword') return kwText(t.upper, o.upperAndLowerCaseStyle)
  return t.text
}

/** token 间空格判定（next 为当前 token 的后一个 token，用于 COUNT(*) 特判） */
function needSpaceBefore(t, last, next, o) {
  if (!last) return false
  if (t.type === 'comma') return false
  if (t.type === 'semicolon') return last.type === 'paren' || last.type === 'string' // ) ; 与 '...' ; 前 1 空格
  if (t.type === 'dot') return false
  if (last.type === 'dot') return false
  if (last.type === 'comma') return true
  if (t.type === 'paren') {
    if (t.text === '(') {
      // 嵌套开括号 '((', → '( ('（ror-004 E12；全基线仅此一处）
      if (last.type === 'paren' && last.text === '(') return true
      // COUNT(*) 特判：括号参数为 * 时括号前无空格
      if (next && next.type === 'op' && next.text === '*') return false
      // 空参数 ()：仅 keyword/op/FUNC_PAD 前有空格（row_number()/NOW()/rank() 无空格，wjz 实证）
      if (next && next.type === 'paren' && next.text === ')') {
        return (
          last.type === 'keyword' ||
          last.type === 'op' ||
          (last.type === 'ident' && FUNC_PAD.has(last.upper))
        )
      }
      // 有参数 (x)：ident 函数调用也加空格（wjz：instr (x)、SQLTOINT$1 (x)、cnt_264 (x)）
      return last.type === 'keyword' || last.type === 'op' || last.type === 'ident'
    }
    return false
  }
  if (last.type === 'paren') return last.text === ')' && t.text !== ')' // 连续闭括号 '))' 紧贴（ror-004 E18/ror-005 E104）；'(' 后无空格；')' 后非 ')' 有空格
  if (t.type === 'op') {
    // 紧贴运算符：:: -> ->(后接op除外) [ ] 算术 + - concat ||；% 两侧无空格（wjz：%col_360_）
    if (t.text === '::' || t.text === '->' || t.text === '[' || t.text === ']') return false
    if (t.text === '%') return last.type === 'keyword' // % 前缀（%col_360_）紧贴标识符；WHEN/THEN 后 % 加空格（ror-006 WHEN %col_236__）
    if (t.text === '||')
      return !(
        o &&
        (o.ialignmentConcatWanted ||
          o.ilinebreakAfterConcatWanted ||
          o.ilinebreakBeforeConcatWanted)
      ) // concat 默认两侧空格；翻转规则压缩
    if (t.text === '+' || t.text === '-') {
      // 算术空格：ident 间空格；含 number 操作数无空格（wjz：SYSDATE-7、1+1）
      const numL = last.type === 'number'
      const numR = !!(next && next.type === 'number')
      if (numL || numR) return false
      return true
    }
    return true
  }
  if (last.type === 'op') {
    if (last.text === '::') return false // :: 后无空格（column1::BIGINT）
    if (last.text === '->') return t.type === 'op' // -> 后仅 op 前空格（-> > 来自 ->>）
    if (last.text === '%') return false // % 后无空格（wjz：%col_360_）
    if (last.text === '||')
      return !(
        o &&
        (o.ialignmentConcatWanted ||
          o.ilinebreakAfterConcatWanted ||
          o.ilinebreakBeforeConcatWanted)
      ) // concat 后空格同前
    if (last.text === '+' || last.text === '-') return t.type !== 'number' // 数字操作数后无空格（1+1、SYSDATE-7）
    if (last.text === '[') return false // [ 后无空格（column2[1]、ARRAY[1）
    return t.type !== 'paren' || t.text === '('
  }
  return true
}

/** 顶层逗号分组（保留各组 token） */
function splitByComma(toks) {
  const groups = []
  let cur = []
  let d = 0
  for (const t of toks) {
    if (t.type === 'paren') d += t.text === '(' ? 1 : -1
    if (t.type === 'comma' && d === 0) {
      groups.push(cur)
      cur = []
      continue
    }
    cur.push(t)
  }
  if (cur.length) groups.push(cur)
  return groups
}

/** CREATE TABLE 括号块 */
function formatCreateTable(st, depth, o) {
  const indent = o.iSpacesPerLvlWanted
  const toks = st.filter((t) => t.type !== 'ws')
  // CTAS：CREATE TABLE [schema.]name AS SELECT/WITH ...（无列块，AS 在表名后、首个 '(' 前）
  const asPos = toks.findIndex((t) => t.type === 'keyword' && t.upper === 'AS')
  const selPos = toks.findIndex(
    (t) => t.type === 'keyword' && (t.upper === 'SELECT' || t.upper === 'WITH')
  )
  if (asPos >= 2 && selPos > asPos) {
    const headToks = toks.slice(0, asPos + 1) // CREATE TABLE name AS
    const selToks = toks.slice(selPos)
    const lines = []
    // headToks 手工渲染（renderBody 对 kw=null 段不输出，故逐 token 拼）
    let ht = ''
    let hl = null
    for (const tt of headToks) {
      if (needSpaceBefore(tt, hl, null, o)) ht += ' '
      ht += renderToken(tt, o)
      hl = tt
    }
    lines.push(ht + ' ') // 非末行尾 1 空格
    // SELECT 子查询逐段（顶层布局：无缩进、ALIGN 对齐）
    const ss = []
    let d2 = 0
    let c2 = []
    const HEAD3 = ['FROM', 'WHERE', 'GROUP', 'HAVING', 'ORDER', 'UNION']
    for (const t of selToks) {
      if (t.type === 'paren') d2 += t.text === '(' ? 1 : -1
      if (d2 === 0 && t.type === 'keyword' && HEAD3.includes(t.upper) && c2.length) {
        ss.push(c2)
        c2 = [t]
        continue
      }
      c2.push(t)
    }
    if (c2.length) ss.push(c2)
    for (let s = 0; s < ss.length; s++) {
      const sseg = ss[s]
      const hdr = sseg[0].upper
      const joined = joinKw(sseg, 0)
      const segTxt =
        hdr === 'SELECT'
          ? 'SELECT ' + renderSimple(sseg.slice(joined.length), o)
          : renderSegment({ kw: hdr, joined, toks: sseg }, o)
      const isLast = s === ss.length - 1
      lines.push(isLast ? segTxt : segTxt + ' ')
    }
    return lines
  }
  const openIdx = toks.findIndex((t) => t.type === 'paren' && t.text === '(')
  if (openIdx < 0) {
    const seg = { kw: 'CREATE', joined: ['CREATE', 'TABLE'], toks: toks.slice(2) }
    return [renderSegment(seg, o)]
  }
  let d = 0
  let closeIdx = -1
  for (let i = openIdx; i < toks.length; i++) {
    if (toks[i].type === 'paren') d += toks[i].text === '(' ? 1 : -1
    if (d === 0 && i > openIdx) {
      closeIdx = i
      break
    }
  }
  const head = toks.slice(0, openIdx)
  const inner = toks.slice(openIdx + 1, closeIdx)
  const tail = toks.slice(closeIdx + 1)

  const lines = []
  lines.push('CREATE TABLE' + ' ') // "CREATE TABLE " + 尾空格（后续由非末行规则再加？012: "CREATE TABLE \r\n" 1 空格）
  // 表名行：缩进 8
  const ct = head.filter(
    (t) => t.type === 'keyword' && (t.upper === 'CREATE' || t.upper === 'TABLE')
  ).length
  const rest = head.slice(ct)
  lines.push(' '.repeat(indent) + renderSimple(rest, o) + ' ')
  lines.push(' '.repeat(indent) + '(' + ' ') // "( "
  // 列清单：按行宽 120 贪心折行（缩进 16）
  const colGroups = splitByComma(inner)
  const base = ' '.repeat(indent * 2)
  let curLine = base
  const colLines = []
  for (let gi = 0; gi < colGroups.length; gi++) {
    const gTok = colGroups[gi]
    // 列定义内 ON UPDATE：'ON ' 后断行，续行 'UPDATE ...' 无缩进（03/007 wjz 实证）
    const onU = (() => {
      for (let x = 0; x < gTok.length; x++) {
        if (
          gTok[x].type === 'keyword' &&
          gTok[x].upper === 'ON' &&
          gTok[x + 1] &&
          gTok[x + 1].type === 'keyword' &&
          gTok[x + 1].upper === 'UPDATE'
        )
          return x
      }
      return -1
    })()
    if (onU >= 0) {
      const pre = renderSimple(gTok.slice(0, onU), o)
      const upd = renderSimple(gTok.slice(onU + 2), o)
      const gFull = pre + ' ON ' + upd // 完整组（含 ON UPDATE）参与贪心折行判定
      const sep = /, $/.test(curLine) ? '' : /,$/.test(curLine) ? ' ' : curLine === base ? '' : ' '
      const cand = curLine + sep + gFull + (gi < colGroups.length - 1 ? ',' : '')
      if (gi > 0 && curLine !== base && cand.length > o.ilineLengthWanted) {
        // 折行：本列起新行，'ON' 行尾 + 无缩进 'UPDATE ...' 行（03/007）
        colLines.push(curLine)
        colLines.push(base + pre + ' ON')
        colLines.push('UPDATE ' + upd + (gi < colGroups.length - 1 ? ',' : ''))
      } else {
        colLines.push(curLine + sep + pre + ' ON')
        colLines.push('UPDATE ' + upd + (gi < colGroups.length - 1 ? ',' : ''))
      }
      curLine = base
      continue
    }
    const g = renderSimple(gTok, o)
    // curLine 自带上一组尾逗号（首组无）；衔接空格由尾逗号后补
    const sep = /, $/.test(curLine) ? '' : /,$/.test(curLine) ? ' ' : ''
    const cand = curLine + sep + g + (gi < colGroups.length - 1 ? ',' : '')
    if (gi > 0 && curLine !== base && cand.length > o.ilineLengthWanted) {
      colLines.push(curLine)
      curLine = base + g + (gi < colGroups.length - 1 ? ',' : '')
    } else curLine = cand
  }
  if (curLine !== base) colLines.push(curLine)
  // 非末列行行尾空格由 colLines 内尾逗号自然带出；统一补：
  const lastCol = colLines.length - 1
  for (let ci = 0; ci < colLines.length; ci++) {
    if (ci < lastCol) lines.push(colLines[ci] + ' ')
    else lines.push(colLines[ci] + ' ') // 列块末行仍是非末行（后面还有 ) ; 行）
  }
  // 尾段：CLUSTERED BY (...) SORTED BY (...) INTO n BUCKETS 展开（wjz 硬编码布局）
  const tailToks = tail.filter((t) => t.type !== 'semicolon')
  const semi = tail.some((t) => t.type === 'semicolon') ? ';' : ''
  const tailLines = []
  let ti = 0
  while (ti < tailToks.length) {
    const t0 = tailToks[ti]
    if (t0.type === 'keyword' && (t0.upper === 'CLUSTERED' || t0.upper === 'SORTED')) {
      const w = t0.upper
      tailLines.push(' '.repeat(indent) + w + ' BY' + ' ')
      ti++
      if (tailToks[ti] && tailToks[ti].type === 'keyword' && tailToks[ti].upper === 'BY') ti++
      if (tailToks[ti] && tailToks[ti].type === 'paren' && tailToks[ti].text === '(') {
        tailLines.push(' '.repeat(indent) + '( ')
        let d3 = 0
        let ci = ti
        for (; ci < tailToks.length; ci++) {
          if (tailToks[ci].type === 'paren') {
            d3 += tailToks[ci].text === '(' ? 1 : -1
            if (d3 === 0) break
          }
        }
        tailLines.push(' '.repeat(indent * 2) + renderSimple(tailToks.slice(ti + 1, ci), o) + ' ')
        tailLines.push(' '.repeat(indent) + ') ')
        ti = ci + 1
        continue
      }
      continue
    }
    if (t0.type === 'keyword' && t0.upper === 'INTO') {
      tailLines.push('INTO' + ' ')
      ti++
      if (ti < tailToks.length)
        tailLines.push(' '.repeat(indent) + renderSimple(tailToks.slice(ti), o) + semi)
      ti = tailToks.length
      continue
    }
    tailLines.push(renderSimple(tailToks.slice(ti), o) + semi)
    break
  }
  if (tailLines.length) {
    lines.push(' '.repeat(indent) + ') ')
    for (const tl of tailLines) lines.push(tl)
  } else {
    lines.push(' '.repeat(indent) + ')' + (semi ? ' ;' : ''))
  }
  return lines
}

function renderSimple(toks, o, depth) {
  const seg = { kw: null, joined: null, toks }
  return renderSegment(seg, o, undefined, undefined, depth)
}

/** INSERT / REPLACE 语句（基线：列/值 ≤3 整句单行；尾段 ON DUPLICATE/ON CONFLICT/UPDATE/RETURNING 单独处理） */
function formatInsert(st, depth, o, segments) {
  // 输入行尾 token 集合：多行输入时列清单末行 `)` 无尾空格（_rules-clean）；单行输入（005）有尾空格
  const eolSet = new Set()
  for (let ei = 1; ei < st.length; ei++) {
    if (st[ei].type === 'ws' && st[ei].text.includes('\n')) {
      let ej = ei - 1
      while (ej >= 0 && st[ej].type === 'ws') ej--
      if (ej >= 0 && st[ej].type !== 'comment') eolSet.add(st[ej].text)
    }
  }
  const multiNL = st.some((t) => t.type === 'ws' && t.text.includes('\n'))
  const toks = st.filter((t) => t.type !== 'ws')
  const openIdx = toks.findIndex((t) => t.type === 'paren' && t.text === '(')
  if (openIdx < 0) {
    return segments.map((seg, i) =>
      i < segments.length - 1 ? renderSegment(seg, o) + ' ' : renderSegment(seg, o)
    )
  }
  let d = 0
  let closeIdx = -1
  for (let i = openIdx; i < toks.length; i++) {
    if (toks[i].type === 'paren') d += toks[i].text === '(' ? 1 : -1
    if (d === 0 && i > openIdx) {
      closeIdx = i
      break
    }
  }
  const before = toks.slice(0, openIdx) // INSERT INTO tab1
  const cols = toks.slice(openIdx + 1, closeIdx)
  const after = toks.slice(closeIdx + 1) // VALUES (...) / SELECT ... / 尾段

  const indent = o.iSpacesPerLvlWanted
  const colGroups = splitByComma(cols)
  const headTxt = renderSimple(before, o)
  const colTxt = colGroups.map((g) => renderSimple(g, o)).join(', ')
  // 值组列表（multiRow 检测）：VALUES 后的顶层 '(' 闭合组
  const afterToks = after
  const vi0 = afterToks.findIndex((t) => t.type === 'keyword' && t.upper === 'VALUES')
  const valGroups = []
  if (vi0 >= 0) {
    let gd = 0,
      gs = -1
    for (let i = vi0 + 1; i < afterToks.length; i++) {
      const tt = afterToks[i]
      if (tt.type === 'keyword' && (tt.upper === 'ON' || tt.upper === 'RETURNING')) break
      if (tt.type === 'paren') {
        if (tt.text === '(') {
          if (gd === 0) gs = i
          gd++
        } else {
          gd--
          if (gd === 0 && gs >= 0) {
            valGroups.push({ start: gs, end: i })
            gs = -1
          }
        }
      }
    }
  }
  const multiRow = valGroups.length > 1
  const lines = []
  if (colGroups.length <= 3 && !multiRow) {
    lines.push(headTxt + ' (' + colTxt + ')' + ' ') // 单行头（含尾空格）
  } else {
    lines.push(headTxt + ' (' + renderSimple(colGroups[0], o) + ' ')
    for (let i = 1; i < colGroups.length; i++) {
      lines.push(' '.repeat(indent) + ', ' + renderSimple(colGroups[i], o) + ' ')
    }
    lines[lines.length - 1] =
      ' '.repeat(indent) + ', ' + renderSimple(colGroups[colGroups.length - 1], o) + ')'
  }
  // VALUES / SELECT / 尾段
  const vi = afterToks.findIndex((t) => t.type === 'keyword' && t.upper === 'VALUES')
  if (vi >= 0) {
    const vo = afterToks.findIndex((t, i) => i > vi && t.type === 'paren' && t.text === '(')
    if (vo >= 0) {
      let d2 = 0
      let vc = -1
      for (let i = vo; i < afterToks.length; i++) {
        if (afterToks[i].type === 'paren') d2 += afterToks[i].text === '(' ? 1 : -1
        if (d2 === 0 && i > vo) {
          vc = i
          break
        }
      }
      const vinner = afterToks.slice(vo + 1, vc)
      const vtail = afterToks.slice(vc + 1) // ON DUPLICATE / ON CONFLICT / RETURNING / ;
      const vgroups = splitByComma(vinner)
      const valTxt = vgroups.map((g) => renderSimple(g, o)).join(', ')
      if (multiRow) {
        // 多值组（02/006）：每组值折行，组间衔接同行；首组 'VALUES ('，末组 ')' 收尾
        for (let gi = 0; gi < valGroups.length; gi++) {
          const g = valGroups[gi]
          const inner = splitByComma(afterToks.slice(g.start + 1, g.end))
          if (gi === 0) lines.push('VALUES (' + renderSimple(inner[0], o) + ' ')
          for (let k = 1; k < inner.length; k++) {
            const isLastVal = k === inner.length - 1
            let line =
              ' '.repeat(indent) + ', ' + renderSimple(inner[k], o) + (isLastVal ? ')' : '')
            if (isLastVal && gi < valGroups.length - 1) {
              const nextInner = splitByComma(
                afterToks.slice(valGroups[gi + 1].start + 1, valGroups[gi + 1].end)
              )
              line += ', (' + renderSimple(nextInner[0], o) + ' '
            }
            lines.push(line + ' ')
          }
        }
        // 尾段（仅 ON/RETURNING 起；多组时 vtail 含后续值组，跳过）
        const tailStart = vtail.findIndex(
          (t) => t.type === 'keyword' && (t.upper === 'ON' || t.upper === 'RETURNING')
        )
        const tts = (tailStart >= 0 ? vtail.slice(tailStart) : []).filter(
          (t) => t.type !== 'semicolon'
        )
        if (tts.length) {
          const headU = tts.findIndex(
            (t) => t.type === 'keyword' && (t.upper === 'UPDATE' || t.upper === 'RETURNING')
          )
          if (headU >= 0 && tts[headU].upper === 'RETURNING') {
            lines[lines.length - 1] =
              lines[lines.length - 1].replace(/\s+$/, '') + ' ' + renderSimple(tts, o)
          } else if (headU >= 0) {
            const pre = renderSimple(tts.slice(0, headU), o)
            lines[lines.length - 1] = lines[lines.length - 1].replace(/\s+$/, '') + ' ' + pre
            const upd = renderSimple(tts.slice(headU), o)
            if (upd.trim()) lines.push(upd)
          } else {
            lines[lines.length - 1] =
              lines[lines.length - 1].replace(/\s+$/, '') + ' ' + renderSimple(tts, o)
          }
        }
        if (vtail.some((t) => t.type === 'semicolon')) {
          const lastL = lines[lines.length - 1]
          lines[lines.length - 1] = /\)\s*$/.test(lastL)
            ? lastL.replace(/\s+$/, '') + ' ;'
            : lastL.replace(/\s+$/, '') + ';'
        }
        const out = []
        for (let i = 0; i < lines.length; i++) {
          let l = lines[i]
          if (i < lines.length - 1) l = l.replace(/ +$/, '') + ' '
          else l = l.replace(/ +$/, '')
          out.push(l)
        }
        return out
      } else if (vgroups.length <= 3) {
        lines[0] = lines[0].replace(/ +$/, '') + ' VALUES (' + valTxt + ')'
        // 尾段：RETURNING 同行；ON DUPLICATE KEY UPDATE / ON CONFLICT (...) DO UPDATE 拆行
        const tts = vtail.filter((t) => t.type !== 'semicolon')
        if (tts.length) {
          const headU = tts.findIndex(
            (t) => t.type === 'keyword' && (t.upper === 'UPDATE' || t.upper === 'RETURNING')
          )
          if (headU >= 0 && tts[headU].upper === 'RETURNING') {
            lines[0] += ' ' + renderSimple(tts, o)
          } else if (headU >= 0) {
            // ON DUPLICATE KEY / ON CONFLICT (...) DO 留当前行，UPDATE 起另起一行（无缩进）
            const pre = renderSimple(tts.slice(0, headU), o)
            lines[0] += ' ' + pre
            const upd = renderSimple(tts.slice(headU), o)
            if (upd.trim()) lines.push(upd)
          } else {
            lines[0] += ' ' + renderSimple(tts, o)
          }
        }
        // 分号：接末行（paren 尾 ')' 后 1 空格 → ' ;'）
        if (vtail.some((t) => t.type === 'semicolon')) {
          const lastL = lines[lines.length - 1]
          lines[lines.length - 1] = /\)\s*$/.test(lastL)
            ? lastL.replace(/\s+$/, '') + ' ;'
            : lastL.replace(/\s+$/, '') + ';'
        }
        // 行尾空格：除末行外 +1 空格
        const out = []
        for (let i = 0; i < lines.length; i++) {
          let l = lines[i]
          if (i < lines.length - 1) l = l.replace(/ +$/, '') + ' '
          else l = l.replace(/ +$/, '')
          out.push(l)
        }
        return out
      } else {
        const colLastIdx = multiNL ? lines.length - 1 : -1 // 多行输入：列清单末行 `)` 无尾空格（_rules-clean）；单行（005）有
        lines.push('VALUES (' + renderSimple(vgroups[0], o) + ' ')
        for (let i = 1; i < vgroups.length; i++) {
          lines.push(' '.repeat(indent) + ', ' + renderSimple(vgroups[i], o) + ' ')
        }
        lines[lines.length - 1] =
          ' '.repeat(indent) + ', ' + renderSimple(vgroups[vgroups.length - 1], o) + ') '
        if (vtail.some((t) => t.type === 'semicolon')) {
          const lastL = lines[lines.length - 1]
          lines[lines.length - 1] = /\)\s*$/.test(lastL)
            ? lastL.replace(/\s+$/, '') + ' ;'
            : lastL.replace(/\s+$/, '') + ';'
        }
        const out = []
        for (let i = 0; i < lines.length; i++) {
          let l = lines[i]
          if (i < lines.length - 1 && i !== colLastIdx) l = l.replace(/ +$/, '') + ' '
          else l = l.replace(/ +$/, '')
          out.push(l)
        }
        return out
      }
    } else {
      lines.push(renderSimple(afterToks.slice(vi), o))
    }
  } else {
    // INSERT ... SELECT：SELECT inline
    const segAll = { kw: null, joined: null, toks: afterToks }
    lines.push(renderSegmentInline(segAll, o, null) + ' ')
  }
  const out = []
  for (let i = 0; i < lines.length; i++) {
    let l = lines[i]
    if (i === lines.length - 1) l = l.replace(/ +$/, '')
    out.push(l)
  }
  return out
}

/** MERGE 语句（wjz 硬编码布局：MERGE/INTO/USING/ON/WHEN 行、内容缩进 8、THEN 缩进 8、UPDATE/INSERT 尾行） */
function formatMerge(st, depth, o) {
  const toks = st.filter((t) => t.type !== 'ws' && t.type !== 'semicolon')
  const indent = o.iSpacesPerLvlWanted
  const lines = []
  const kw = (u) => toks.findIndex((t) => t.type === 'keyword' && t.upper === u)
  const iInto = kw('INTO')
  const iUsing = kw('USING')
  const iOn = kw('ON')
  const iWhen = kw('WHEN')
  const iThen = toks.findIndex(
    (t, idx) => idx > iWhen && t.type === 'keyword' && t.upper === 'THEN'
  )
  const iUpd = toks.findIndex(
    (t, idx) => idx > iThen && t.type === 'keyword' && t.upper === 'UPDATE'
  )
  const iIns = toks.findIndex(
    (t, idx) => idx > iUpd && t.type === 'keyword' && t.upper === 'INSERT'
  )
  lines.push('MERGE' + ' ')
  lines.push('INTO' + ' ')
  lines.push(' '.repeat(indent) + renderSimple(toks.slice(iInto + 1, iUsing), o) + ' ')
  lines.push('USING' + ' ')
  const usingFirst = toks[iUsing + 1]
  const usingTxt = renderSimple(toks.slice(iUsing + 1, iOn), o)
  // 子查询 '(' 开头的 USING 内容：renderSimple 的 inline 分支自带 pad8，不再叠加缩进
  lines.push(
    (usingFirst && usingFirst.type === 'paren' && usingFirst.text === '('
      ? ''
      : ' '.repeat(indent)) +
      usingTxt +
      ' '
  )
  lines.push(renderSimple(toks.slice(iOn, iWhen), o) + ' ') // ON (...) 行
  lines.push('WHEN MATCHED' + ' ')
  lines.push(' '.repeat(indent) + 'THEN' + ' ')
  lines.push(renderSimple(toks.slice(iThen + 1, iIns), o) + ' ') // UPDATE SET ... WHEN NOT MATCHED THEN 行（尾空格）
  lines.push(renderSimple(toks.slice(iIns), o) + ' ;') // INSERT (...) VALUES (...)
  const out = []
  for (let i = 0; i < lines.length; i++) {
    let l = lines[i]
    if (i === lines.length - 1) l = l.replace(/ +$/, '')
    out.push(l)
  }
  return out
}

/** UPDATE 语句：输入原文 ≥80 拆 SET/WHERE 行；否则单行 */
function formatUpdate(st, depth, o, segments) {
  const toks = st.filter((t) => t.type !== 'ws')
  const stLen = st.reduce((b, t) => b + t.text.length, 0)
  if (stLen < 80) {
    const segAll = { kw: null, joined: null, toks }
    return [renderSegmentInline(segAll, o, null).replace(/ +$/, '')]
  }
  const si = toks.findIndex((t) => t.type === 'keyword' && t.upper === 'SET')
  const wi = toks.findIndex((t, i) => i > si && t.type === 'keyword' && t.upper === 'WHERE')
  const lines = []
  if (wi < 0) {
    // 无 WHERE：整行
    const segAll = { kw: null, joined: null, toks }
    return [renderSegmentInline(segAll, o, null)]
  }
  const head = toks.slice(0, si) // UPDATE tab1
  const setToks = toks.slice(si + 1, wi)
  const whereToks = toks.slice(wi)
  // 第一行：UPDATE tab1 SET     col1 = 'x', ...（超宽按组折行，续行缩进 8，逗号留行尾）
  const setGroups = splitByComma(setToks)
  const headTxt = renderSimple(head, o)
  const setHead = headTxt + ' SET' + ' '.repeat(ALIGN.SET)
  const pad8u = ' '.repeat(8)
  const setLines = []
  let curSet = setHead
  for (let gi = 0; gi < setGroups.length; gi++) {
    const g = renderSimple(setGroups[gi], o)
    const sep = curSet === setHead ? '' : ', '
    const cand = curSet + sep + g
    if (gi > 0 && curSet !== setHead && cand.length > o.ilineLengthWanted) {
      setLines.push(curSet + ',')
      curSet = pad8u + g
    } else curSet = cand
  }
  if (curSet.trim()) setLines.push(curSet)
  lines.push(...setLines)
  // WHERE 行：WHERE + 3 空格（若超宽再折，v2 先不折子查询块）
  const eolSetU = new Set()
  for (let ei = 1; ei < st.length; ei++) {
    if (st[ei].type === 'ws' && st[ei].text.includes('\n')) {
      let ej = ei - 1
      while (ej >= 0 && st[ej].type === 'ws') ej--
      if (ej >= 0 && st[ej].type !== 'comment') eolSetU.add(st[ej].text)
    }
  }
  const whereSeg = { kw: 'WHERE', joined: ['WHERE'], toks: whereToks.slice(1) }
  lines.push(renderSegment(whereSeg, o, undefined, undefined, undefined, eolSetU))
  // 行尾空格统一
  const out = []
  for (let i = 0; i < lines.length; i++) {
    let l = lines[i]
    if (i < lines.length - 1) l = l + ' '
    out.push(l)
  }
  return out
}

module.exports = { format, DEFAULTS }
