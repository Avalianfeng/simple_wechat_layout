import { getDb } from './db.js'
import { countTodayOkConverts, formatYuanFromLi } from './usage.js'
import { shanghaiDayKey } from './auth.js'

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

export function listUsersAdmin() {
  const dayKey = shanghaiDayKey()
  const rows = getDb().prepare(`
    SELECT id, username, ai_enabled, daily_ai_limit, status, created_at
    FROM users
    ORDER BY id ASC
  `).all()

  return rows.map((u) => {
    const usedToday = countTodayOkConverts(u.id, dayKey)
    const sum = getDb().prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN status = 'ok' THEN total_tokens ELSE 0 END), 0) AS tokens,
        COALESCE(SUM(CASE WHEN status = 'ok' THEN est_cost_cents ELSE 0 END), 0) AS cost_micro
      FROM usage_logs WHERE user_id = ?
    `).get(u.id)
    return {
      id: u.id,
      username: u.username,
      aiEnabled: Boolean(u.ai_enabled),
      dailyAiLimit: Number(u.daily_ai_limit),
      unlimited: Number(u.daily_ai_limit) === -1,
      status: u.status,
      createdAt: u.created_at,
      usedToday,
      totalTokens: Number(sum?.tokens) || 0,
      totalEstimatedCost: formatYuanFromLi(sum?.cost_micro),
    }
  })
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
