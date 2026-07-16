import {
  getDb,
  defaultDailyAiLimit,
  getRegisterInviteCode,
  registerPerIpPerDay,
} from './db.js'
import {
  countTodayOkConverts,
  effectiveTodayOkConverts,
  formatYuanFromLi,
  listUsageForUser,
  getTokenPrices,
} from './usage.js'
import { shanghaiDayKey, normalizeIp } from './auth.js'
import { getDeepSeekConfig } from './convert.js'
import { historyLimit } from './history.js'

export function getAdminToken() {
  return (process.env.ADMIN_TOKEN || '').trim()
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function requireAdmin(req, res, next) {
  const expected = getAdminToken()
  if (!expected) {
    res.status(503).json({ error: '未配置 ADMIN_TOKEN', code: 'NO_ADMIN_TOKEN' })
    return
  }
  const got = String(req.get('X-Admin-Token') || req.body?.adminToken || '').trim()
  if (got !== expected) {
    res.status(401).json({ error: '管理员令牌无效', code: 'ADMIN_UNAUTHORIZED' })
    return
  }
  next()
}

export function getAdminOverview() {
  const dayKey = shanghaiDayKey()
  const db = getDb()
  const users = db.prepare(`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0) AS active,
      COALESCE(SUM(CASE WHEN status = 'disabled' THEN 1 ELSE 0 END), 0) AS disabled
    FROM users
  `).get()

  const todayUsage = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END), 0) AS ok,
      COALESCE(SUM(CASE WHEN status = 'fail' THEN 1 ELSE 0 END), 0) AS fail,
      COALESCE(SUM(CASE WHEN status = 'ok' THEN total_tokens ELSE 0 END), 0) AS tokens,
      COALESCE(SUM(CASE WHEN status = 'ok' THEN est_cost_cents ELSE 0 END), 0) AS cost_micro
    FROM usage_logs WHERE day_key = ?
  `).get(dayKey)

  const todayRegister = db.prepare(`
    SELECT COALESCE(SUM(count), 0) AS c FROM register_ips WHERE day_key = ?
  `).get(dayKey)

  const failRows = db.prepare(`
    SELECT error_code, COUNT(*) AS c
    FROM usage_logs
    WHERE day_key = ? AND status = 'fail'
    GROUP BY error_code
    ORDER BY c DESC
    LIMIT 8
  `).all(dayKey)

  const bannedCount = db.prepare('SELECT COUNT(*) AS c FROM ip_bans').get()
  const cfg = getDeepSeekConfig()
  const prices = getTokenPrices()

  return {
    dayKey,
    config: {
      defaultDailyAiLimit: defaultDailyAiLimit(),
      inviteRequired: Boolean(getRegisterInviteCode()),
      registerPerIpPerDay: registerPerIpPerDay(),
      historyLimit: historyLimit(),
      model: cfg.model,
      hasApiKey: cfg.hasKey,
      prices,
    },
    users: {
      total: Number(users?.total) || 0,
      active: Number(users?.active) || 0,
      disabled: Number(users?.disabled) || 0,
    },
    today: {
      registers: Number(todayRegister?.c) || 0,
      aiOk: Number(todayUsage?.ok) || 0,
      aiFail: Number(todayUsage?.fail) || 0,
      tokens: Number(todayUsage?.tokens) || 0,
      estimatedCost: formatYuanFromLi(todayUsage?.cost_micro),
      failBreakdown: failRows.map((r) => ({
        code: r.error_code || 'UNKNOWN',
        count: Number(r.c) || 0,
      })),
    },
    bannedIpCount: Number(bannedCount?.c) || 0,
  }
}

export function listUsersAdmin() {
  const dayKey = shanghaiDayKey()
  const rows = getDb().prepare(`
    SELECT id, username, ai_enabled, daily_ai_limit, status, register_ip,
           quota_reset_day, quota_reset_used, created_at
    FROM users
    ORDER BY id ASC
  `).all()

  return rows.map((u) => {
    const rawUsedToday = countTodayOkConverts(u.id, dayKey)
    const usedToday = effectiveTodayOkConverts(u, dayKey)
    const sum = getDb().prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN status = 'ok' THEN total_tokens ELSE 0 END), 0) AS tokens,
        COALESCE(SUM(CASE WHEN status = 'ok' THEN est_cost_cents ELSE 0 END), 0) AS cost_micro,
        COALESCE(SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END), 0) AS ok_count,
        COALESCE(SUM(CASE WHEN status = 'fail' THEN 1 ELSE 0 END), 0) AS fail_count,
        MAX(CASE WHEN status = 'ok' THEN created_at END) AS last_ai_at
      FROM usage_logs WHERE user_id = ?
    `).get(u.id)
    return {
      id: u.id,
      username: u.username,
      aiEnabled: Boolean(u.ai_enabled),
      dailyAiLimit: Number(u.daily_ai_limit),
      unlimited: Number(u.daily_ai_limit) === -1,
      status: u.status,
      registerIp: u.register_ip || '',
      createdAt: u.created_at,
      usedToday,
      rawUsedToday,
      quotaResetToday: String(u.quota_reset_day || '') === dayKey,
      totalTokens: Number(sum?.tokens) || 0,
      totalEstimatedCost: formatYuanFromLi(sum?.cost_micro),
      okCount: Number(sum?.ok_count) || 0,
      failCount: Number(sum?.fail_count) || 0,
      lastAiAt: sum?.last_ai_at || null,
    }
  })
}

/**
 * @param {number} userId
 * @param {{ limit?: number }} [opts]
 */
export function listUserUsageAdmin(userId, opts = {}) {
  const user = getDb().prepare('SELECT id, username FROM users WHERE id = ?').get(userId)
  if (!user) {
    const err = new Error('用户不存在')
    err.code = 'NOT_FOUND'
    throw err
  }
  return {
    user: { id: user.id, username: user.username },
    items: listUsageForUser(userId, { limit: opts.limit || 30 }),
  }
}

/**
 * @param {number} userId
 * @param {{ aiEnabled?: boolean, dailyAiLimit?: number, status?: string }} patch
 */
export function patchUserAdmin(userId, patch) {
  const db = getDb()
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
  if (!user) {
    const err = new Error('用户不存在')
    err.code = 'NOT_FOUND'
    throw err
  }

  let aiEnabled = user.ai_enabled
  let dailyAiLimit = user.daily_ai_limit
  let status = user.status

  if (typeof patch.aiEnabled === 'boolean') {
    aiEnabled = patch.aiEnabled ? 1 : 0
  }
  if (typeof patch.dailyAiLimit === 'number' || typeof patch.dailyAiLimit === 'string') {
    const n = Number(patch.dailyAiLimit)
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      const err = new Error('日额度须为整数，或 -1 表示不限')
      err.code = 'BAD_LIMIT'
      throw err
    }
    if (n < -1 || n > 10_000) {
      const err = new Error('日额度范围：-1（不限）或 0～10000')
      err.code = 'BAD_LIMIT'
      throw err
    }
    dailyAiLimit = Math.trunc(n)
  }
  if (patch.status === 'active' || patch.status === 'disabled') {
    status = patch.status
  }

  db.prepare(`
    UPDATE users SET ai_enabled = ?, daily_ai_limit = ?, status = ? WHERE id = ?
  `).run(aiEnabled, dailyAiLimit, status, userId)

  return listUsersAdmin().find((u) => u.id === userId)
}

export function listIpsAdmin() {
  const dayKey = shanghaiDayKey()
  const perIp = registerPerIpPerDay()
  const db = getDb()

  const todayRows = db.prepare(`
    SELECT ip, count FROM register_ips WHERE day_key = ? ORDER BY count DESC, ip ASC
  `).all(dayKey)

  const bans = db.prepare(`
    SELECT ip, reason, created_at FROM ip_bans ORDER BY created_at DESC
  `).all()
  const banMap = new Map(bans.map((b) => [b.ip, b]))

  const recent = db.prepare(`
    SELECT ip, day_key, count FROM register_ips
    ORDER BY day_key DESC, count DESC
    LIMIT 40
  `).all()

  return {
    dayKey,
    registerPerIpPerDay: perIp,
    today: todayRows.map((r) => ({
      ip: r.ip,
      count: Number(r.count) || 0,
      capped: perIp > 0 && Number(r.count) >= perIp,
      banned: banMap.has(r.ip) || banMap.has(normalizeIp(r.ip)),
    })),
    recent: recent.map((r) => ({
      ip: r.ip,
      dayKey: r.day_key,
      count: Number(r.count) || 0,
      banned: banMap.has(r.ip) || banMap.has(normalizeIp(r.ip)),
    })),
    bans: bans.map((b) => ({
      ip: b.ip,
      reason: b.reason || '',
      createdAt: b.created_at,
    })),
  }
}

/**
 * @param {string} ip
 * @param {string} [reason]
 */
export function banIp(ip, reason = '') {
  const key = normalizeIp(ip)
  if (!key || key === 'unknown') {
    const err = new Error('无效 IP')
    err.code = 'BAD_IP'
    throw err
  }
  getDb().prepare(`
    INSERT INTO ip_bans (ip, reason) VALUES (?, ?)
    ON CONFLICT(ip) DO UPDATE SET reason = excluded.reason
  `).run(key, String(reason || '').trim().slice(0, 200))
  return { ip: key, reason: String(reason || '').trim().slice(0, 200) }
}

/**
 * @param {string} ip
 */
export function unbanIp(ip) {
  const key = normalizeIp(ip)
  const info = getDb().prepare('DELETE FROM ip_bans WHERE ip = ?').run(key)
  if (!info.changes) {
    const err = new Error('该 IP 不在封禁列表')
    err.code = 'NOT_FOUND'
    throw err
  }
  return { ok: true, ip: key }
}

/** @param {string} ip */
function ipKeyVariants(ip) {
  const key = normalizeIp(ip)
  const raw = String(ip || '').trim()
  const set = new Set([key, raw].filter(Boolean))
  if (key && key !== 'unknown' && !key.includes(':')) {
    set.add(`::ffff:${key}`)
  }
  return [...set]
}

/**
 * 清空该 IP 今日注册计数，解除「已触顶」
 * @param {string} ip
 */
export function resetIpRegisterToday(ip) {
  const variants = ipKeyVariants(ip)
  if (!variants.length || variants.every((v) => v === 'unknown')) {
    const err = new Error('无效 IP')
    err.code = 'BAD_IP'
    throw err
  }
  const dayKey = shanghaiDayKey()
  const db = getDb()
  const stmt = db.prepare('DELETE FROM register_ips WHERE ip = ? AND day_key = ?')
  let changes = 0
  for (const v of variants) {
    changes += stmt.run(v, dayKey).changes || 0
  }
  return { ok: true, ip: normalizeIp(ip), dayKey, cleared: changes }
}

/**
 * 重置用户今日 AI 已用次数（用量记录保留，仅放行额度）
 * @param {number} userId
 */
export function resetUserAiToday(userId) {
  const db = getDb()
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
  if (!user) {
    const err = new Error('用户不存在')
    err.code = 'NOT_FOUND'
    throw err
  }
  const dayKey = shanghaiDayKey()
  const used = countTodayOkConverts(userId, dayKey)
  db.prepare(`
    UPDATE users SET quota_reset_day = ?, quota_reset_used = ? WHERE id = ?
  `).run(dayKey, used, userId)
  return listUsersAdmin().find((u) => u.id === userId)
}
