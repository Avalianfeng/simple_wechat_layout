import crypto from 'node:crypto'
import { getDb, defaultDailyAiLimit, getRegisterInviteCode, registerPerIpPerDay } from './db.js'

const SESSION_DAYS = 30
const COOKIE_NAME = 'swl_session'
const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/

export { COOKIE_NAME }

export function shanghaiDayKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

/**
 * @param {string} password
 */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16)
  const hash = crypto.scryptSync(password, salt, 64)
  return `${salt.toString('base64')}:${hash.toString('base64')}`
}

/**
 * @param {string} password
 * @param {string} stored
 */
export function verifyPassword(password, stored) {
  const [saltB64, hashB64] = String(stored || '').split(':')
  if (!saltB64 || !hashB64) return false
  const salt = Buffer.from(saltB64, 'base64')
  const expected = Buffer.from(hashB64, 'base64')
  const actual = crypto.scryptSync(password, salt, expected.length)
  return crypto.timingSafeEqual(expected, actual)
}

/**
 * @param {string} username
 * @param {string} password
 * @param {{ inviteCode?: string, ip?: string }} [opts]
 */
export function registerUser(username, password, opts = {}) {
  const name = String(username || '').trim()
  if (!USERNAME_RE.test(name)) {
    const err = new Error('用户名需为 3～32 位字母、数字或下划线')
    err.code = 'BAD_USERNAME'
    throw err
  }
  if (typeof password !== 'string' || password.length < 8) {
    const err = new Error('密码至少 8 位')
    err.code = 'BAD_PASSWORD'
    throw err
  }

  const requiredInvite = getRegisterInviteCode()
  if (requiredInvite) {
    const got = String(opts.inviteCode || '').trim()
    if (got !== requiredInvite) {
      const err = new Error('邀请码不正确')
      err.code = 'BAD_INVITE'
      throw err
    }
  }

  const ip = String(opts.ip || '').trim() || 'unknown'
  const dayKey = shanghaiDayKey()
  const perIp = registerPerIpPerDay()
  const db = getDb()

  if (perIp > 0) {
    const row = db.prepare(
      'SELECT count FROM register_ips WHERE ip = ? AND day_key = ?',
    ).get(ip, dayKey)
    if (row && Number(row.count) >= perIp) {
      const err = new Error(`同一网络今日注册已达上限（${perIp} 个），请明天再试或联系管理员`)
      err.code = 'REGISTER_IP_LIMIT'
      throw err
    }
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(name)
  if (existing) {
    const err = new Error('用户名已被占用')
    err.code = 'USERNAME_TAKEN'
    throw err
  }

  const limit = defaultDailyAiLimit()
  const info = db.prepare(`
    INSERT INTO users (username, password_hash, ai_enabled, daily_ai_limit, status)
    VALUES (?, ?, 1, ?, 'active')
  `).run(name, hashPassword(password), limit)

  if (perIp > 0) {
    db.prepare(`
      INSERT INTO register_ips (ip, day_key, count) VALUES (?, ?, 1)
      ON CONFLICT(ip, day_key) DO UPDATE SET count = count + 1
    `).run(ip, dayKey)
  }

  return getUserById(Number(info.lastInsertRowid))
}

/**
 * @param {string} username
 * @param {string} password
 */
export function loginUser(username, password) {
  const name = String(username || '').trim()
  const db = getDb()
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(name)
  if (!row || !verifyPassword(password, row.password_hash)) {
    const err = new Error('用户名或密码错误')
    err.code = 'BAD_CREDENTIALS'
    throw err
  }
  if (row.status !== 'active') {
    const err = new Error('账号已禁用，请联系管理员')
    err.code = 'DISABLED'
    throw err
  }
  return row
}

/**
 * @param {number} userId
 */
export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex')
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000)
  const expiresAt = expires.toISOString()
  getDb().prepare(`
    INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)
  `).run(token, userId, expiresAt)
  return { token, expiresAt }
}

/**
 * @param {string} token
 */
export function destroySession(token) {
  if (!token) return
  getDb().prepare('DELETE FROM sessions WHERE token = ?').run(token)
}

/**
 * @param {number} userId
 * @param {string} oldPassword
 * @param {string} newPassword
 */
export function changePassword(userId, oldPassword, newPassword) {
  const user = getUserById(userId)
  if (!user || !verifyPassword(oldPassword, user.password_hash)) {
    const err = new Error('当前密码不正确')
    err.code = 'BAD_CREDENTIALS'
    throw err
  }
  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    const err = new Error('新密码至少 8 位')
    err.code = 'BAD_PASSWORD'
    throw err
  }
  getDb().prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .run(hashPassword(newPassword), userId)
}

/**
 * @param {number} id
 */
export function getUserById(id) {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) || null
}

/**
 * @param {string} token
 */
export function getUserBySessionToken(token) {
  if (!token) return null
  const db = getDb()
  const row = db.prepare(`
    SELECT u.*, s.expires_at AS session_expires_at
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ?
  `).get(token)
  if (!row) return null
  if (new Date(row.session_expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
    return null
  }
  if (row.status !== 'active') return null
  return row
}

/**
 * @param {import('express').Request} req
 */
export function parseCookies(req) {
  const header = req.headers.cookie || ''
  /** @type {Record<string, string>} */
  const out = {}
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx < 0) continue
    const k = part.slice(0, idx).trim()
    const v = part.slice(idx + 1).trim()
    if (k) out[k] = decodeURIComponent(v)
  }
  return out
}

/**
 * @param {import('express').Request} req
 */
export function getSessionToken(req) {
  return parseCookies(req)[COOKIE_NAME] || ''
}

/**
 * @param {import('express').Response} res
 * @param {string} token
 * @param {string} expiresAt
 */
export function setSessionCookie(res, token, expiresAt) {
  const secure = process.env.COOKIE_SECURE === '1'
    || process.env.NODE_ENV === 'production'
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${new Date(expiresAt).toUTCString()}`,
  ]
  if (secure) parts.push('Secure')
  res.append('Set-Cookie', parts.join('; '))
}

/**
 * @param {import('express').Response} res
 */
export function clearSessionCookie(res) {
  const secure = process.env.COOKIE_SECURE === '1'
    || process.env.NODE_ENV === 'production'
  const parts = [
    `${COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ]
  if (secure) parts.push('Secure')
  res.append('Set-Cookie', parts.join('; '))
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function requireUser(req, res, next) {
  const user = getUserBySessionToken(getSessionToken(req))
  if (!user) {
    res.status(401).json({ error: '请先登录', code: 'UNAUTHORIZED' })
    return
  }
  req.user = user
  next()
}

/**
 * @param {object} user
 */
export function publicUser(user) {
  if (!user) return null
  return {
    id: user.id,
    username: user.username,
    aiEnabled: Boolean(user.ai_enabled),
    dailyAiLimit: Number(user.daily_ai_limit),
    unlimited: Number(user.daily_ai_limit) === -1,
    status: user.status,
    createdAt: user.created_at,
  }
}
