const DEFAULT_BASE_TIMEOUT_MS = 60_000
const DEFAULT_MAX_TIMEOUT_MS = 180_000
const DEFAULT_MAX_CHARS = 25_000
const DEFAULT_CHUNK_CHARS = 5_500
const CHARS_PER_EXTRA_SECOND = 800

export function getTextLimits() {
  const base = Number(process.env.DEEPSEEK_TIMEOUT_MS) || DEFAULT_BASE_TIMEOUT_MS
  const max = Number(process.env.DEEPSEEK_MAX_TIMEOUT_MS) || DEFAULT_MAX_TIMEOUT_MS
  const maxChars = Number(process.env.DEEPSEEK_MAX_CHARS) || DEFAULT_MAX_CHARS
  const chunkChars = Number(process.env.DEEPSEEK_CHUNK_CHARS) || DEFAULT_CHUNK_CHARS
  return {
    baseTimeoutMs: base,
    maxTimeoutMs: Math.max(base, max),
    maxChars,
    chunkChars,
  }
}

/**
 * 按字数动态超时：基础 60s，每 800 字 +1s，上限 180s
 * @param {number} textLength
 */
export function computeTimeoutMs(textLength) {
  const { baseTimeoutMs, maxTimeoutMs } = getTextLimits()
  const extra = Math.floor(textLength / CHARS_PER_EXTRA_SECOND) * 1000
  return Math.min(baseTimeoutMs + extra, maxTimeoutMs)
}

/**
 * @param {number} length
 */
export function assertTextLength(length) {
  const { maxChars } = getTextLimits()
  if (length > maxChars) {
    const err = new Error(
      `文章过长（${length} 字），当前上限 ${maxChars} 字。请分段处理，或改用「已有 Markdown」模式。`,
    )
    err.code = 'TEXT_TOO_LONG'
    throw err
  }
}

/**
 * 按空行切段，再合并为适合单次 AI 请求的块
 * @param {string} text
 * @param {number} [maxChunk]
 */
export function splitTextIntoChunks(text, maxChunk) {
  const { chunkChars } = getTextLimits()
  const limit = maxChunk || chunkChars
  const paras = (text || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
  if (!paras.length) return ['']

  const chunks = []
  let buf = ''
  for (const p of paras) {
    const next = buf ? `${buf}\n\n${p}` : p
    if (next.length > limit && buf) {
      chunks.push(buf)
      buf = p
    }
    else if (p.length > limit) {
      if (buf) {
        chunks.push(buf)
        buf = ''
      }
      // 单段超长：硬切
      for (let i = 0; i < p.length; i += limit) {
        chunks.push(p.slice(i, i + limit))
      }
    }
    else {
      buf = next
    }
  }
  if (buf) chunks.push(buf)
  return chunks
}

/** 去掉 Markdown 符号后比较「内容量」 */
export function normalizedPlainLength(text) {
  return (text || '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/[#*_>`\[\]()!|~-]/g, '')
    .replace(/\s+/g, '')
    .length
}

/**
 * 检测 AI 是否过度删改（疑似摘要/改写）
 * @param {string} input
 * @param {string} output
 */
export function looksOverEdited(input, output) {
  const inLen = normalizedPlainLength(input)
  const outLen = normalizedPlainLength(output)
  if (inLen < 200) return false
  return outLen < inLen * 0.88
}
