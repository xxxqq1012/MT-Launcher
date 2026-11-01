/**
 * Q3 格式层 —— 自研 tokenizer（保真层）
 * 目标：把 SQL 文本切成保留「原文切片 + 位置 + 类型」的 token 流，
 * 注释/字符串/标识符大小写一律原样保留，供格式层精确重排（对齐 wjz 行为）。
 * 后续由 sqlparser-rs AST 提供结构/方言上下文（见 engine.cjs）。
 */

// 关键字集合（v1：四个方言 + 常用；大小写不敏感匹配，输出时按规则转写）
const KEYWORDS = new Set(
  `SELECT FROM WHERE GROUP BY HAVING ORDER UNION ALL LEFT RIGHT FULL INNER OUTER CROSS JOIN ON
   AND OR NOT IN IS NULL AS DISTINCT TOP LIMIT OFFSET INSERT INTO VALUES UPDATE SET DELETE CREATE USING
   TABLE ALTER ADD DROP COLUMN PRIMARY KEY FOREIGN REFERENCES INDEX DEFAULT UNIQUE CONSTRAINT
   CASE WHEN THEN ELSE END MAX MIN SUM AVG COUNT DESC ASC EXISTS BETWEEN LIKE WITH DATABASE USE
   EXPLAIN DESCRIBE PARTITION OVER LATERAL VIEW CLUSTER DISTRIBUTE SORT ANALYZE MERGE TRUNCATE
   GRANT REVOKE COMMIT ROLLBACK BEGIN TRANSACTION CAST CONVERT TRIM SUBSTR SUBSTRING COALESCE NVL
   DECODE ROWNUM DUAL RETURNING CONFLICT EXCLUDED DUPLICATE IF REPLACE PROCEDURE FUNCTION RETURN
   ROUND
   DECLARE ROW ROWS PRECEDING FOLLOWING CURRENT INTERVAL EXTRACT TO_CHAR TO_DATE TRUNCATE SIGN
   CLUSTERED SORTED BUCKETS ILIKE`.split(/\s+/)
)

const TOKEN_TYPES = [
  'keyword',
  'ident',
  'number',
  'string',
  'comment',
  'op',
  'paren',
  'comma',
  'semicolon',
  'dot',
  'ws'
]

/**
 * 分词：返回 token 数组 [{type, text, start, end}]
 * - text 为原文切片（大小写/注释/字符串逐字节保留）
 * - start/end 为原文 UTF-16 下标
 */
function tokenize(sql) {
  const tokens = []
  let i = 0
  const n = sql.length
  const isIdentStart = (c) => /[A-Za-z_\u4e00-\u9fa5$]/.test(c)
  const isIdentChar = (c) => /[A-Za-z0-9_\u4e00-\u9fa5$]/.test(c)

  while (i < n) {
    const c = sql[i]

    // 空白
    if (/\s/.test(c)) {
      const s = i
      while (i < n && /\s/.test(sql[i])) i++
      tokens.push({ type: 'ws', text: sql.slice(s, i), start: s, end: i })
      continue
    }

    // 行注释 --
    if (c === '-' && sql[i + 1] === '-') {
      const s = i
      while (i < n && sql[i] !== '\n' && sql[i] !== '\r') i++
      tokens.push({ type: 'comment', text: sql.slice(s, i), start: s, end: i })
      continue
    }
    // 块注释 /* */
    if (c === '/' && sql[i + 1] === '*') {
      const s = i
      i += 2
      while (i < n && !(sql[i] === '*' && sql[i + 1] === '/')) i++
      i = Math.min(i + 2, n)
      tokens.push({ type: 'comment', text: sql.slice(s, i), start: s, end: i })
      continue
    }

    // 字符串 '...'（含 '' 转义）与 "..."（MySQL 标识符/字符串兼容）
    if (c === "'" || c === '"') {
      const s = i
      const q = c
      i++
      while (i < n) {
        if (sql[i] === q) {
          if (sql[i + 1] === q) {
            i += 2
            continue
          } // 转义引号
          i++
          break
        }
        i++
      }
      tokens.push({ type: 'string', text: sql.slice(s, i), start: s, end: i })
      continue
    }

    // 反引号标识符 `...`
    if (c === '`') {
      const s = i
      i++
      while (i < n && sql[i] !== '`') i++
      i = Math.min(i + 1, n)
      tokens.push({ type: 'ident', text: sql.slice(s, i), start: s, end: i })
      continue
    }

    // 数字
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(sql[i + 1] || ''))) {
      const s = i
      while (i < n && /[0-9a-zA-Z.]/.test(sql[i])) i++
      tokens.push({ type: 'number', text: sql.slice(s, i), start: s, end: i })
      continue
    }

    // 标识符 / 关键字（含点前限定名分段，但点单独成 token）
    if (isIdentStart(c)) {
      const s = i
      while (i < n && isIdentChar(sql[i])) i++
      const word = sql.slice(s, i)
      tokens.push({
        type: KEYWORDS.has(word.toUpperCase()) ? 'keyword' : 'ident',
        text: word,
        start: s,
        end: i,
        upper: word.toUpperCase()
      })
      continue
    }

    // 运算符（最长优先）
    const two = sql.slice(i, i + 2)
    if (['<=', '>=', '<>', '!=', '!~', '||', '::', '->', '=>'].includes(two)) {
      tokens.push({ type: 'op', text: two, start: i, end: i + 2 })
      i += 2
      continue
    }
    if ('=<>+-*/%'.includes(c)) {
      tokens.push({ type: 'op', text: c, start: i, end: i + 1 })
      i++
      continue
    }

    // 括号 / 逗号 / 分号 / 点
    if (c === '(' || c === ')') {
      tokens.push({ type: 'paren', text: c, start: i, end: i + 1 })
      i++
      continue
    }
    if (c === ',') {
      tokens.push({ type: 'comma', text: c, start: i, end: i + 1 })
      i++
      continue
    }
    if (c === ';') {
      tokens.push({ type: 'semicolon', text: c, start: i, end: i + 1 })
      i++
      continue
    }
    if (c === '.') {
      tokens.push({ type: 'dot', text: c, start: i, end: i + 1 })
      i++
      continue
    }

    // 未知字符：单字符原样
    tokens.push({ type: 'op', text: c, start: i, end: i + 1 })
    i++
  }
  return tokens
}

module.exports = { tokenize, TOKEN_TYPES, KEYWORDS }
