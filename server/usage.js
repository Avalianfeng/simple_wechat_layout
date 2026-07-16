import { getDb } from './db.js'
import { shanghaiDayKey } from './auth.js'

/** 库内整数单位：微元（1 元 = 1_000_000）；表字段仍名 est_cost_cents */
const COST_SCALE = 1_000_000

/** DeepSeek V4 公开价（元 / 百万 tokens），仅展示用 */
const MODEL_PRICES = {
  'deepseek-v4-flash': {
    inputCacheHitPerMillion: 0.02,
    inputCacheMissPerMillion: 1,
    outputPerMillion: 2,
  },
  'deepseek-v4-pro': {
    inputCacheHitPerMillion: 0.025,
    inputCacheMissPerMillion: 3,
    outputPerMillion: 6,
  },
}

/** 即将废弃的别名 → flash（官方兼容说明） */
const MODEL_ALIASES = {
  'deepseek-chat': 'deepseek-v4-flash',
  'deepseek-reasoner': 'deepseek-v4-flash',
}

export function resolvePriceModel(model) {
  const raw = (model || process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash').trim()
  return MODEL_ALIASES[raw] || raw
}

/**
 * @param {string} [model]
 */
export function getTokenPrices(model) {
  const resolved = resolvePriceModel(model)
  const base = MODEL_PRICES[resolved] || MODEL_PRICES['deepseek-v4-flash']

  const inputCacheHitPerMillion = Number(process.env.DEEPSEEK_PRICE_INPUT_CACHE_HIT)
  const inputCacheMissPerMillion = Number(process.env.DEEPSEEK_PRICE_INPUT)
  const outputPerMillion = Number(process.env.DEEPSEEK_PRICE_OUTPUT)

  const prices = {
    model: resolved,
    inputCacheHitPerMillion: Number.isFinite(inputCacheHitPerMillion)
      ? inputCacheHitPerMillion
      : base.inputCacheHitPerMillion,
    inputCacheMissPerMillion: Number.isFinite(inputCacheMissPerMillion)
      ? inputCacheMissPerMillion
      : base.inputCacheMissPerMillion,
    outputPerMillion: Number.isFinite(outputPerMillion)
      ? outputPerMillion
      : base.outputPerMillion,
  }

  // 兼容旧字段：inputPerMillion = 未命中价
  return {
    ...prices,
    inputPerMillion: prices.inputCacheMissPerMillion,
  }
}

/**
 * @param {{
 *   prompt_tokens?: number,
 *   completion_tokens?: number,
 *   prompt_cache_hit_tokens?: number,
 *   prompt_cache_miss_tokens?: number,
 * }} usage
 * @returns {number} 微元（1e-6 元）
 */
export function estimateCostLi(usage) {
  const {
    inputCacheHitPerMillion,
    inputCacheMissPerMillion,
    outputPerMillion,
  } = getTokenPrices()

  const completion = Number(usage?.completion_tokens) || 0
  const hasCache =
    usage?.prompt_cache_hit_tokens != null
    || usage?.prompt_cache_miss_tokens != null

  let hit = 0
  let miss = 0
  if (hasCache) {
    hit = Number(usage?.prompt_cache_hit_tokens) || 0
    miss = Number(usage?.prompt_cache_miss_tokens) || 0
  }
  else {
    // 无 cache 字段：整段 prompt 按未命中计
    miss = Number(usage?.prompt_tokens) || 0
  }

  const yuan = (
    hit * inputCacheHitPerMillion
    + miss * inputCacheMissPerMillion
    + completion * outputPerMillion
  ) / 1_000_000
  return Math.round(yuan * COST_SCALE)
}

/**
 * @param {number} microYuan 微元
 */
export function formatYuanFromLi(microYuan) {
  const n = (Number(microYuan) || 0) / COST_SCALE
  if (n < 0.01) return `¥${n.toFixed(4)}`
  if (n < 1) return `¥${n.toFixed(3)}`
  return `¥${n.toFixed(2)}`
}

function tableHasColumn(table, column) {
  const cols = getDb().prepare(`PRAGMA table_info(${table})`).all()
  return cols.some((c) => c.name === column)
}

/** 迁移：厘→微元（v1），再补 cache 列并按 V4 价重算（v2） */
export function migrateUsageCostPrecision() {
  const database = getDb()
  let ver = Number(database.prepare('PRAGMA user_version').get()?.user_version) || 0

  if (ver < 1) {
    const rows = database.prepare(`
      SELECT id, prompt_tokens, completion_tokens FROM usage_logs
    `).all()
    const upd = database.prepare('UPDATE usage_logs SET est_cost_cents = ? WHERE id = ?')
    for (const r of rows) {
      upd.run(
        estimateCostLi({
          prompt_tokens: r.prompt_tokens,
          completion_tokens: r.completion_tokens,
        }),
        r.id,
      )
    }
    database.exec('PRAGMA user_version = 1')
    ver = 1
  }

  if (ver < 2) {
    if (!tableHasColumn('usage_logs', 'prompt_cache_hit_tokens')) {
      database.exec(`
        ALTER TABLE usage_logs ADD COLUMN prompt_cache_hit_tokens INTEGER NOT NULL DEFAULT 0;
      `)
    }
    if (!tableHasColumn('usage_logs', 'prompt_cache_miss_tokens')) {
      database.exec(`
        ALTER TABLE usage_logs ADD COLUMN prompt_cache_miss_tokens INTEGER NOT NULL DEFAULT 0;
      `)
    }

    const rows = database.prepare(`
      SELECT id, prompt_tokens, completion_tokens,
             prompt_cache_hit_tokens, prompt_cache_miss_tokens
      FROM usage_logs
    `).all()
    const upd = database.prepare('UPDATE usage_logs SET est_cost_cents = ? WHERE id = ?')
    for (const r of rows) {
      const hit = Number(r.prompt_cache_hit_tokens) || 0
      const miss = Number(r.prompt_cache_miss_tokens) || 0
      upd.run(
        estimateCostLi({
          prompt_tokens: r.prompt_tokens,
          completion_tokens: r.completion_tokens,
          ...(hit || miss
            ? {
                prompt_cache_hit_tokens: hit,
                prompt_cache_miss_tokens: miss,
              }
            : {}),
        }),
        r.id,
      )
    }
    database.exec('PRAGMA user_version = 2')
    ver = 2
  }

  if (ver < 3) {
    if (!tableHasColumn('users', 'register_ip')) {
      database.exec(`ALTER TABLE users ADD COLUMN register_ip TEXT NOT NULL DEFAULT '';`)
    }
    database.exec(`
      CREATE TABLE IF NOT EXISTS ip_bans (
        ip TEXT PRIMARY KEY,
        reason TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `)
    database.exec('PRAGMA user_version = 3')
    ver = 3
  }

  if (ver < 4) {
    if (!tableHasColumn('users', 'quota_reset_day')) {
      database.exec(`ALTER TABLE users ADD COLUMN quota_reset_day TEXT NOT NULL DEFAULT '';`)
    }
    if (!tableHasColumn('users', 'quota_reset_used')) {
      database.exec(`ALTER TABLE users ADD COLUMN quota_reset_used INTEGER NOT NULL DEFAULT 0;`)
    }
    database.exec('PRAGMA user_version = 4')
  }
}

/**
 * @param {number} userId
 */
export function summarizeUsageForUser(userId) {
  const row = getDb().prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END), 0) AS ok_count,
      COALESCE(SUM(CASE WHEN status = 'fail' THEN 1 ELSE 0 END), 0) AS fail_count,
      COALESCE(SUM(CASE WHEN status = 'ok' THEN total_tokens ELSE 0 END), 0) AS tokens,
      COALESCE(SUM(CASE WHEN status = 'ok' THEN est_cost_cents ELSE 0 END), 0) AS cost_micro
    FROM usage_logs WHERE user_id = ?
  `).get(userId)
  return {
    okCount: Number(row?.ok_count) || 0,
    failCount: Number(row?.fail_count) || 0,
    totalTokens: Number(row?.tokens) || 0,
    totalEstimatedCost: formatYuanFromLi(row?.cost_micro),
  }
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
 * 计入额度的今日次数（支持管理员「重置今日已用」）
 * @param {{ id: number, quota_reset_day?: string, quota_reset_used?: number }} user
 * @param {string} [dayKey]
 */
export function effectiveTodayOkConverts(user, dayKey = shanghaiDayKey()) {
  const used = countTodayOkConverts(user.id, dayKey)
  if (String(user.quota_reset_day || '') === dayKey) {
    return Math.max(0, used - (Number(user.quota_reset_used) || 0))
  }
  return used
}

/**
 * @param {object} user
 */
export function getQuotaState(user) {
  const limit = Number(user.daily_ai_limit)
  const used = effectiveTodayOkConverts(user)
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
    const used = effectiveTodayOkConverts(user)
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
 *   promptCacheHitTokens?: number,
 *   promptCacheMissTokens?: number,
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
  const hit = Number(row.promptCacheHitTokens) || 0
  const miss = Number(row.promptCacheMissTokens) || 0
  const total = prompt + completion
  const hasCache = row.promptCacheHitTokens != null || row.promptCacheMissTokens != null
  const estMicro = estimateCostLi({
    prompt_tokens: prompt,
    completion_tokens: completion,
    ...(hasCache
      ? {
          prompt_cache_hit_tokens: hit,
          prompt_cache_miss_tokens: miss,
        }
      : {}),
  })
  // 表字段 est_cost_cents 存「微元」，命名历史兼容；前端用 formatYuanFromLi
  getDb().prepare(`
    INSERT INTO usage_logs (
      user_id, day_key, prompt_tokens, completion_tokens, total_tokens,
      prompt_cache_hit_tokens, prompt_cache_miss_tokens,
      est_cost_cents, text_chars, chunks, retries, status, error_code
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.userId,
    shanghaiDayKey(),
    prompt,
    completion,
    total,
    hit,
    miss,
    estMicro,
    Number(row.textChars) || 0,
    Number(row.chunks) || 1,
    Number(row.retries) || 0,
    row.status,
    row.errorCode || null,
  )
  return { totalTokens: total, estCostLi: estMicro, estimatedCost: formatYuanFromLi(estMicro) }
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
           prompt_cache_hit_tokens, prompt_cache_miss_tokens,
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
    promptCacheHitTokens: r.prompt_cache_hit_tokens,
    promptCacheMissTokens: r.prompt_cache_miss_tokens,
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
 * @param {{
 *   prompt_tokens?: number,
 *   completion_tokens?: number,
 *   total_tokens?: number,
 *   prompt_cache_hit_tokens?: number,
 *   prompt_cache_miss_tokens?: number,
 * } | null} a
 * @param {{
 *   prompt_tokens?: number,
 *   completion_tokens?: number,
 *   total_tokens?: number,
 *   prompt_cache_hit_tokens?: number,
 *   prompt_cache_miss_tokens?: number,
 * } | null} b
 */
export function mergeUsage(a, b) {
  return {
    prompt_tokens: (Number(a?.prompt_tokens) || 0) + (Number(b?.prompt_tokens) || 0),
    completion_tokens: (Number(a?.completion_tokens) || 0) + (Number(b?.completion_tokens) || 0),
    total_tokens: (Number(a?.total_tokens) || 0) + (Number(b?.total_tokens) || 0),
    prompt_cache_hit_tokens:
      (Number(a?.prompt_cache_hit_tokens) || 0) + (Number(b?.prompt_cache_hit_tokens) || 0),
    prompt_cache_miss_tokens:
      (Number(a?.prompt_cache_miss_tokens) || 0) + (Number(b?.prompt_cache_miss_tokens) || 0),
  }
}

/** 按输入字数粗估将产生的分段数（给确认弹层用） */
export function estimateChunks(textChars) {
  const chunkChars = Number(process.env.DEEPSEEK_CHUNK_CHARS) || 5500
  if (!textChars || textChars <= 0) return 1
  return Math.max(1, Math.ceil(textChars / chunkChars))
}
