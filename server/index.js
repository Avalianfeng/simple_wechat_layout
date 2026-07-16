import 'dotenv/config'
import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  convertToMarkdown,
  describeErrorChain,
  getDeepSeekConfig,
} from './convert.js'
import { renderMarkdownToHtml, extractImages, annotatePreviewHtml } from './render.js'
import { mergeImageUrls } from './markdown-utils.js'
import { getTextLimits } from './text-limits.js'
import { uploadMiddleware, uploadsDir, recordUploads } from './upload.js'
import {
  normalizeStyle,
  listThemesPublic,
  listColorsPublic,
  listFontsPublic,
  listFontSizesPublic,
  DEFAULT_STYLE,
} from './themes.js'
import { Agent } from 'undici'
import { initDb, defaultDailyAiLimit, getRegisterInviteCode, registerPerIpPerDay } from './db.js'
import {
  registerUser,
  loginUser,
  createSession,
  destroySession,
  changePassword,
  getSessionToken,
  setSessionCookie,
  clearSessionCookie,
  requireUser,
  publicUser,
} from './auth.js'
import {
  assertCanConvert,
  insertUsageLog,
  listUsageForUser,
  formatYuanFromLi,
  estimateCostLi,
  migrateUsageCostPrecision,
  estimateChunks,
  getTokenPrices,
  getQuotaState,
} from './usage.js'
import { requireAdmin, listUsersAdmin, patchUserAdmin, getAdminToken } from './admin.js'
import {
  saveArticleHistory,
  listArticles,
  getArticle,
  deleteArticle,
  historyLimit,
  countArticles,
} from './history.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const publicDir = path.join(__dirname, '..', 'public')
const PORT = Number(process.env.PORT) || 3080

initDb()
migrateUsageCostPrecision()

const app = express()
app.use(express.json({ limit: '2mb' }))
app.use(express.static(publicDir))
app.use('/uploads', express.static(uploadsDir, {
  maxAge: '7d',
  fallthrough: false,
}))

/** @type {Map<number, boolean>} */
const convertInFlight = new Map()

function publicBase(req) {
  const envBase = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '')
  if (envBase) return envBase
  const proto = req.get('x-forwarded-proto') || req.protocol
  const host = req.get('x-forwarded-host') || req.get('host')
  return `${proto}://${host}`
}

function buildResult(markdown, style) {
  const html = renderMarkdownToHtml(markdown, style)
  const images = extractImages(markdown)
  return {
    markdown,
    html: annotatePreviewHtml(html, images),
    images,
    style,
  }
}

function clientIp(req) {
  const xf = req.get('x-forwarded-for')
  if (xf) return xf.split(',')[0].trim()
  return req.ip || req.socket?.remoteAddress || 'unknown'
}

function mePayload(user) {
  return {
    user: publicUser(user),
    quota: getQuotaState(user),
    prices: getTokenPrices(),
  }
}

/** @type {Agent | null} */
let deepSeekProbeDispatcher = null

function getDeepSeekProbeDispatcher() {
  const { connectTimeoutMs } = getDeepSeekConfig()
  if (!deepSeekProbeDispatcher) {
    deepSeekProbeDispatcher = new Agent({ connectTimeout: connectTimeoutMs })
  }
  return deepSeekProbeDispatcher
}

async function probeDeepSeek(timeoutMs) {
  const { baseUrl, hasKey, connectTimeoutMs } = getDeepSeekConfig()
  const probeTimeoutMs = timeoutMs || Math.max(connectTimeoutMs + 5_000, 15_000)
  if (!hasKey) {
    return { ok: false, reason: 'NO_API_KEY' }
  }
  const url = `${baseUrl}/v1/models`
  const started = Date.now()
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` },
      signal: AbortSignal.timeout(probeTimeoutMs),
      dispatcher: getDeepSeekProbeDispatcher(),
    })
    return {
      ok: res.ok,
      status: res.status,
      ms: Date.now() - started,
      url,
    }
  }
  catch (e) {
    return {
      ok: false,
      ms: Date.now() - started,
      url,
      error: describeErrorChain(e),
    }
  }
}

app.get('/api/health', async (req, res) => {
  const cfg = getDeepSeekConfig()
  const body = {
    ok: true,
    hasDeepSeekKey: cfg.hasKey,
    hasAdminToken: Boolean(getAdminToken()),
    defaultDailyAiLimit: defaultDailyAiLimit(),
    deepSeek: {
      baseUrl: cfg.baseUrl,
      model: cfg.model,
      keyLength: cfg.keyLength,
    },
  }
  if (req.query.check === '1' || req.query.check === 'true') {
    body.deepSeekProbe = await probeDeepSeek()
    body.ok = body.deepSeekProbe.ok
  }
  res.status(body.ok ? 200 : 503).json(body)
})

app.get('/api/options', (_req, res) => {
  const limits = getTextLimits()
  res.json({
    themes: listThemesPublic(),
    colors: listColorsPublic(),
    fonts: listFontsPublic(),
    fontSizes: listFontSizesPublic(),
    defaults: DEFAULT_STYLE,
    limits: {
      maxChars: limits.maxChars,
      chunkChars: limits.chunkChars,
      baseTimeoutMs: limits.baseTimeoutMs,
      maxTimeoutMs: limits.maxTimeoutMs,
    },
    defaultDailyAiLimit: defaultDailyAiLimit(),
    historyLimit: historyLimit(),
    register: {
      inviteRequired: Boolean(getRegisterInviteCode()),
      perIpPerDay: registerPerIpPerDay(),
    },
    support: {
      wechat: process.env.SUPPORT_WECHAT || process.env.SUPPORT_CONTACT || 'cylf_19956272658',
      contact: process.env.SUPPORT_CONTACT || process.env.SUPPORT_WECHAT || '',
      payQrUrl: '/pay-qr.png',
      wechatQrUrl: '/wechat-qr.png',
    },
  })
})

/* ---------- auth ---------- */

app.post('/api/auth/register', (req, res) => {
  try {
    const user = registerUser(req.body?.username, req.body?.password, {
      inviteCode: req.body?.inviteCode,
      ip: clientIp(req),
    })
    const session = createSession(user.id)
    setSessionCookie(res, session.token, session.expiresAt)
    res.json(mePayload(user))
  }
  catch (e) {
    const status = e.code === 'USERNAME_TAKEN' ? 409
      : e.code === 'REGISTER_IP_LIMIT' ? 429
        : e.code === 'BAD_INVITE' || e.code === 'BAD_USERNAME' || e.code === 'BAD_PASSWORD' ? 400
          : 400
    res.status(status).json({ error: e.message || '注册失败', code: e.code || 'UNKNOWN' })
  }
})

app.post('/api/auth/login', (req, res) => {
  try {
    const user = loginUser(req.body?.username, req.body?.password)
    const session = createSession(user.id)
    setSessionCookie(res, session.token, session.expiresAt)
    res.json(mePayload(user))
  }
  catch (e) {
    const status = e.code === 'DISABLED' ? 403 : 401
    res.status(status).json({ error: e.message || '登录失败', code: e.code || 'UNKNOWN' })
  }
})

app.post('/api/auth/logout', (req, res) => {
  destroySession(getSessionToken(req))
  clearSessionCookie(res)
  res.json({ ok: true })
})

app.post('/api/auth/password', requireUser, (req, res) => {
  try {
    changePassword(req.user.id, req.body?.oldPassword, req.body?.newPassword)
    res.json({ ok: true })
  }
  catch (e) {
    const status = e.code === 'BAD_CREDENTIALS' ? 401 : 400
    res.status(status).json({ error: e.message || '修改失败', code: e.code || 'UNKNOWN' })
  }
})

app.get('/api/me', requireUser, (req, res) => {
  res.json(mePayload(req.user))
})

app.get('/api/me/usage', requireUser, (req, res) => {
  const limit = Number(req.query.limit) || 20
  const offset = Number(req.query.offset) || 0
  res.json({
    items: listUsageForUser(req.user.id, { limit, offset }),
    quota: getQuotaState(req.user),
  })
})

app.post('/api/upload', requireUser, (req, res) => {
  uploadMiddleware.array('images', 12)(req, res, (err) => {
    if (err) {
      res.status(400).json({ error: err.message || '上传失败' })
      return
    }
    const files = req.files || []
    if (files.length === 0) {
      res.status(400).json({ error: '请选择图片' })
      return
    }
    recordUploads(req.user.id, files.map((f) => f.filename))
    const base = publicBase(req)
    const items = files.map((f) => ({
      filename: f.filename,
      url: `${base}/uploads/${f.filename}`,
    }))
    res.json({ images: items })
  })
})

app.post('/api/convert', requireUser, async (req, res) => {
  const started = Date.now()
  const userId = req.user.id
  const text = typeof req.body?.text === 'string' ? req.body.text : ''
  const imageUrls = Array.isArray(req.body?.imageUrls)
    ? req.body.imageUrls.filter((u) => typeof u === 'string' && u.trim())
    : []
  const style = normalizeStyle(req.body?.style || req.body)

  if (convertInFlight.get(userId)) {
    res.status(429).json({ error: '正在整理中，请稍候', code: 'IN_FLIGHT' })
    return
  }

  try {
    assertCanConvert(req.user)
  }
  catch (e) {
    const status = e.code === 'QUOTA_EXCEEDED' || e.code === 'QUOTA_ZERO' || e.code === 'AI_DISABLED'
      ? 403
      : 401
    res.status(status).json({ error: e.message, code: e.code, quota: getQuotaState(req.user) })
    return
  }

  if (!text.trim() && imageUrls.length === 0) {
    res.status(400).json({ error: '请先写一点文字，或上传图片' })
    return
  }

  convertInFlight.set(userId, true)
  try {
    const converted = await convertToMarkdown({
      text,
      imageUrls,
      theme: style.theme,
    })
    const cost = insertUsageLog({
      userId,
      promptTokens: converted.usage?.prompt_tokens,
      completionTokens: converted.usage?.completion_tokens,
      promptCacheHitTokens: converted.usage?.prompt_cache_hit_tokens,
      promptCacheMissTokens: converted.usage?.prompt_cache_miss_tokens,
      textChars: text.length,
      chunks: converted.chunks,
      retries: converted.retries,
      status: 'ok',
    })
    const result = buildResult(converted.markdown, style)
    const quota = getQuotaState(req.user)
    const history = saveArticleHistory({
      userId,
      markdown: converted.markdown,
      style,
      images: result.images,
    })
    console.log('[api/convert] done', {
      ms: Date.now() - started,
      userId,
      theme: style.theme,
      markdownChars: converted.markdown.length,
      usage: converted.usage,
      chunks: converted.chunks,
    })
    res.json({
      ...result,
      usage: converted.usage,
      chunks: converted.chunks,
      retries: converted.retries,
      estimatedCost: cost.estimatedCost,
      quota,
      history,
    })
  }
  catch (e) {
    insertUsageLog({
      userId,
      promptTokens: e.usage?.prompt_tokens,
      completionTokens: e.usage?.completion_tokens,
      promptCacheHitTokens: e.usage?.prompt_cache_hit_tokens,
      promptCacheMissTokens: e.usage?.prompt_cache_miss_tokens,
      textChars: text.length,
      chunks: e.chunks || estimateChunks(text.length),
      retries: e.retries || 0,
      status: 'fail',
      errorCode: e.code || 'UNKNOWN',
    })
    const status = e.code === 'NO_API_KEY'
      ? 503
      : e.code === 'TEXT_TOO_LONG'
        ? 413
        : e.code === 'OVER_EDITED'
          ? 422
          : 502
    console.error('[api/convert] fail', {
      ms: Date.now() - started,
      userId,
      code: e.code || 'UNKNOWN',
      message: e.message,
      chain: describeErrorChain(e),
    })
    res.status(status).json({
      error: e.message || '整理失败',
      code: e.code || 'UNKNOWN',
      usage: e.usage || null,
      estimatedCost: e.usage
        ? formatYuanFromLi(estimateCostLi(e.usage))
        : null,
      quota: getQuotaState(req.user),
    })
  }
  finally {
    convertInFlight.delete(userId)
  }
})

/** 已有 Markdown，仅渲染（不调 AI）；save=true 时写入历史 */
app.post('/api/render', requireUser, (req, res) => {
  try {
    let markdown = typeof req.body?.markdown === 'string' ? req.body.markdown : ''
    const imageUrls = Array.isArray(req.body?.imageUrls)
      ? req.body.imageUrls.filter((u) => typeof u === 'string' && u.trim())
      : []
    const shouldSave = Boolean(req.body?.save)

    if (!markdown.trim() && imageUrls.length === 0) {
      res.status(400).json({ error: '请先粘贴 Markdown，或上传图片' })
      return
    }

    markdown = mergeImageUrls(markdown, imageUrls)
    const style = normalizeStyle(req.body?.style || req.body)
    const result = buildResult(markdown, style)
    let history = null
    if (shouldSave) {
      history = saveArticleHistory({
        userId: req.user.id,
        markdown,
        style,
        images: result.images,
      })
    }
    console.log('[api/render] ok', {
      userId: req.user.id,
      theme: style.theme,
      markdownChars: markdown.length,
      saved: shouldSave,
    })
    res.json({ ...result, history })
  }
  catch (e) {
    console.error('[api/render] fail', {
      message: e.message,
      chain: describeErrorChain(e),
    })
    res.status(500).json({ error: e.message || '渲染失败' })
  }
})

app.get('/api/history', requireUser, (req, res) => {
  res.json({
    items: listArticles(req.user.id),
    limit: historyLimit(),
    count: countArticles(req.user.id),
  })
})

app.get('/api/history/:id', requireUser, (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: '无效 id' })
    return
  }
  const article = getArticle(req.user.id, id)
  if (!article) {
    res.status(404).json({ error: '记录不存在', code: 'NOT_FOUND' })
    return
  }
  res.json({ article })
})

app.delete('/api/history/:id', requireUser, (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id < 1) {
      res.status(400).json({ error: '无效 id' })
      return
    }
    const result = deleteArticle(req.user.id, id)
    res.json(result)
  }
  catch (e) {
    const status = e.code === 'NOT_FOUND' ? 404 : 400
    res.status(status).json({ error: e.message || '删除失败', code: e.code || 'UNKNOWN' })
  }
})

/* ---------- admin ---------- */

app.get('/api/admin/users', requireAdmin, (_req, res) => {
  res.json({ users: listUsersAdmin() })
})

app.patch('/api/admin/users/:id', requireAdmin, (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id < 1) {
      res.status(400).json({ error: '无效用户 id' })
      return
    }
    const user = patchUserAdmin(id, {
      aiEnabled: req.body?.aiEnabled,
      dailyAiLimit: req.body?.dailyAiLimit,
      status: req.body?.status,
    })
    res.json({ user })
  }
  catch (e) {
    const status = e.code === 'NOT_FOUND' ? 404 : 400
    res.status(status).json({ error: e.message || '更新失败', code: e.code || 'UNKNOWN' })
  }
})

app.listen(PORT, async () => {
  const cfg = getDeepSeekConfig()
  console.log(`simple-wechat-layout listening on http://127.0.0.1:${PORT}`)
  console.log('[startup] deepseek', {
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    hasKey: cfg.hasKey,
    keyLength: cfg.keyLength,
  })
  console.log('[startup] auth', {
    defaultDailyAiLimit: defaultDailyAiLimit(),
    hasAdminToken: Boolean(getAdminToken()),
  })
  if (!cfg.hasKey) {
    console.warn('警告: 未设置 DEEPSEEK_API_KEY，/api/convert 将不可用')
  }
  else {
    const probe = await probeDeepSeek()
    if (probe.ok) {
      console.log('[startup] deepseek probe ok', { ms: probe.ms, status: probe.status })
    }
    else {
      console.warn('[startup] deepseek probe failed', probe)
    }
  }
  if (!getAdminToken()) {
    console.warn('警告: 未设置 ADMIN_TOKEN，管理后台将不可用')
  }
})
