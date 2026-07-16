import { getDb } from './db.js'
import { shanghaiDayKey } from './auth.js'

/** DeepSeek 公开价参考（元 / 百万 tokens），仅展示用 */
export function getTokenPrices() {
  return {
    inputPerMillion: Number(process.env.DEEPSEEK_PRICE_INPUT) || 0.14,
    outputPerMillion: Number(process.env.DEEPSEEK_PRICE_OUTPUT) || 0.28,
  }
}

/**
 * @param {{ prompt_tokens?: number, completion_tokens?: number }} usage
 * @returns {number} 厘（0.001 元）
 */
export function estimateCostLi(usage) {
  const { inputPerMillion, outputPerMillion } = getTokenPrices()
  const prompt = Number(usage?.prompt_tokens) || 0
  const completion = Number(usage?.completion_tokens) || 0
  const yuan = (prompt * inputPerMillion + completion * outputPerMillion) / 1_000_000
  return Math.round(yuan * 1000)
}

/**
 * @param {number} li
 */
export function formatYuanFromLi(li) {
  const n = (Number(li) || 0) / 1000
  if (n < 0.001) return `¥${n.toFixed(4)}`
  if (n < 0.01) return `¥${n.toFixed(3)}`
  return `¥${n.toFixed(2)}`
}

/**
 * @param {number} userId
 * @param {string} [dayKey]
 */
export function countTodayOkConverts(userId, dayKey = shanghaiDayKey()) {
  const row = getDb().prepare(`
    SELECT COUNT(*) AS c FROM usage_logs
    WHERE user_id = ? AND day_key = ? AND status = 'ok'
  `).get(userId, dayKey)
  return Number(row?.c) || 0
}

/**
 * @param {object} user
 */
export function getQuotaState(user) {
  const limit = Number(user.daily_ai_limit)
  const used = countTodayOkConverts(user.id)
  const unlimited = limit === -1
  const aiEnabled = Boolean(user.ai_enabled)
  let remaining = 0
  if (!aiEnabled) remaining = 0
  else if (unlimited) remaining = -1
  else remaining = Math.max(0, limit - used)

  return {
    aiEnabled,
    dailyAiLimit: limit,
    unlimited,
    usedToday: used,
    remainingToday: remaining,
    dayKey: shanghaiDayKey(),
  }
}

/**
 * @param {object} user
 */
export function assertCanConvert(user) {
  if (!user) {
    const err = new Error('请先登录')
    err.code = 'UNAUTHORIZED'
    throw err
  }
  if (!user.ai_enabled) {
    const err = new Error('当前账号未开通 AI 整理，可用「已有 Markdown」模式，或联系管理员')
    err.code = 'AI_DISABLED'
    throw err
  }
  const limit = Number(user.daily_ai_limit)
  if (limit === 0) {
    const err = new Error('今日 AI 次数为 0，请联系管理员调整额度')
    err.code = 'QUOTA_ZERO'
    throw err
  }
  if (limit !== -1) {
    const used = countTodayOkConverts(user.id)
    if (used >= limit) {
      const err = new Error(`今日 AI 整理已用完（${limit} 次）。明天再试，或改用「已有 Markdown」模式。`)
      err.code = 'QUOTA_EXCEEDED'
      throw err
    }
  }
}

/**
 * @param {{
 *   userId: number,
 *   promptTokens?: number,
 *   completionTokens?: number,
 *   textChars?: number,
 *   chunks?: number,
 *   retries?: number,
 *   status: string,
 *   errorCode?: string | null,
 * }} row
 */
export function insertUsageLog(row) {
  const prompt = Number(row.promptTokens) || 0
  const completion = Number(row.completionTokens) || 0
  const total = prompt + completion
  const estLi = estimateCostLi({ prompt_tokens: prompt, completion_tokens: completion })
  // 表字段 est_cost_cents 存「厘」，命名历史兼容；前端用 formatYuanFromLi
  getDb().prepare(`
    INSERT INTO usage_logs (
      user_id, day_key, prompt_tokens, completion_tokens, total_tokens,
      est_cost_cents, text_chars, chunks, retries, status, error_code
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.userId,
    shanghaiDayKey(),
    prompt,
    completion,
    total,
    estLi,
    Number(row.textChars) || 0,
    Number(row.chunks) || 1,
    Number(row.retries) || 0,
    row.status,
    row.errorCode || null,
  )
  return { totalTokens: total, estCostLi: estLi, estimatedCost: formatYuanFromLi(estLi) }
}

/**
 * @param {number} userId
 * @param {{ limit?: number, offset?: number }} [opts]
 */
export function listUsageForUser(userId, opts = {}) {
  const limit = Math.min(100, Math.max(1, Number(opts.limit) || 20))
  const offset = Math.max(0, Number(opts.offset) || 0)
  const rows = getDb().prepare(`
    SELECT id, day_key, prompt_tokens, completion_tokens, total_tokens,
           est_cost_cents, text_chars, chunks, retries, status, error_code, created_at
    FROM usage_logs
    WHERE user_id = ?
    ORDER BY id DESC
    LIMIT ? OFFSET ?
  `).all(userId, limit, offset)

  return rows.map((r) => ({
    id: r.id,
    dayKey: r.day_key,
    promptTokens: r.prompt_tokens,
    completionTokens: r.completion_tokens,
    totalTokens: r.total_tokens,
    estimatedCost: formatYuanFromLi(r.est_cost_cents),
    textChars: r.text_chars,
    chunks: r.chunks,
    retries: r.retries,
    status: r.status,
    errorCode: r.error_code,
    createdAt: r.created_at,
  }))
}

/**
 * @param {{ prompt_tokens?: number, completion_tokens?: number, total_tokens?: number } | null} a
 * @param {{ prompt_tokens?: number, completion_tokens?: number, total_tokens?: number } | null} b
 */
export function mergeUsage(a, b) {
  return {
    prompt_tokens: (Number(a?.prompt_tokens) || 0) + (Number(b?.prompt_tokens) || 0),
    completion_tokens: (Number(a?.completion_tokens) || 0) + (Number(b?.completion_tokens) || 0),
    total_tokens: (Number(a?.total_tokens) || 0) + (Number(b?.total_tokens) || 0),
  }
}

/** 按输入字数粗估将产生的分段数（给确认弹层用） */
export function estimateChunks(textChars) {
  const chunkChars = Number(process.env.DEEPSEEK_CHUNK_CHARS) || 5500
  if (!textChars || textChars <= 0) return 1
  return Math.max(1, Math.ceil(textChars / chunkChars))
}
