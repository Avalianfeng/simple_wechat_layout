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
import { uploadMiddleware, uploadsDir } from './upload.js'
import {
  normalizeStyle,
  listThemesPublic,
  listColorsPublic,
  listFontsPublic,
  listFontSizesPublic,
  DEFAULT_STYLE,
} from './themes.js'
import { Agent } from 'undici'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const publicDir = path.join(__dirname, '..', 'public')
const PORT = Number(process.env.PORT) || 3080

const app = express()
app.use(express.json({ limit: '2mb' }))
app.use(express.static(publicDir))
app.use('/uploads', express.static(uploadsDir, {
  maxAge: '7d',
  fallthrough: false,
}))

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

/** @type {Agent | null} */
let deepSeekProbeDispatcher = null

function getDeepSeekProbeDispatcher() {
  const { connectTimeoutMs } = getDeepSeekConfig()
  if (!deepSeekProbeDispatcher) {
    deepSeekProbeDispatcher = new Agent({ connectTimeout: connectTimeoutMs })
  }
  return deepSeekProbeDispatcher
}

/** 探测 DeepSeek 可达性（不消耗 chat token） */
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
      baseTimeoutMs: limits.baseTimeoutMs,
      maxTimeoutMs: limits.maxTimeoutMs,
    },
  })
})

app.post('/api/upload', (req, res) => {
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
    const base = publicBase(req)
    const items = files.map((f) => ({
      filename: f.filename,
      url: `${base}/uploads/${f.filename}`,
    }))
    res.json({ images: items })
  })
})

app.post('/api/convert', async (req, res) => {
  const started = Date.now()
  try {
    const text = typeof req.body?.text === 'string' ? req.body.text : ''
    const imageUrls = Array.isArray(req.body?.imageUrls)
      ? req.body.imageUrls.filter((u) => typeof u === 'string' && u.trim())
      : []
    const style = normalizeStyle(req.body?.style || req.body)

    if (!text.trim() && imageUrls.length === 0) {
      res.status(400).json({ error: '请先写一点文字，或上传图片' })
      return
    }

    const markdown = await convertToMarkdown({
      text,
      imageUrls,
      theme: style.theme,
    })
    const result = buildResult(markdown, style)
    console.log('[api/convert] done', {
      ms: Date.now() - started,
      theme: style.theme,
      markdownChars: markdown.length,
      imageCount: result.images.length,
    })
    res.json(result)
  }
  catch (e) {
    const status = e.code === 'NO_API_KEY'
      ? 503
      : e.code === 'TEXT_TOO_LONG'
        ? 413
        : e.code === 'OVER_EDITED'
          ? 422
          : 502
    console.error('[api/convert] fail', {
      ms: Date.now() - started,
      code: e.code || 'UNKNOWN',
      message: e.message,
      chain: describeErrorChain(e),
    })
    res.status(status).json({
      error: e.message || '整理失败',
      code: e.code || 'UNKNOWN',
    })
  }
})

/** 已有 Markdown，仅渲染（不调 AI）；可附带 imageUrls 自动补图 */
app.post('/api/render', (req, res) => {
  try {
    let markdown = typeof req.body?.markdown === 'string' ? req.body.markdown : ''
    const imageUrls = Array.isArray(req.body?.imageUrls)
      ? req.body.imageUrls.filter((u) => typeof u === 'string' && u.trim())
      : []

    if (!markdown.trim() && imageUrls.length === 0) {
      res.status(400).json({ error: '请先粘贴 Markdown，或上传图片' })
      return
    }

    markdown = mergeImageUrls(markdown, imageUrls)
    const style = normalizeStyle(req.body?.style || req.body)
    const result = buildResult(markdown, style)
    console.log('[api/render] ok', {
      theme: style.theme,
      markdownChars: markdown.length,
    })
    res.json(result)
  }
  catch (e) {
    console.error('[api/render] fail', {
      message: e.message,
      chain: describeErrorChain(e),
    })
    res.status(500).json({ error: e.message || '渲染失败' })
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
  if (!cfg.hasKey) {
    console.warn('警告: 未设置 DEEPSEEK_API_KEY，/api/convert 将不可用')
    return
  }
  const probe = await probeDeepSeek()
  if (probe.ok) {
    console.log('[startup] deepseek probe ok', { ms: probe.ms, status: probe.status })
  } else {
    console.warn('[startup] deepseek probe failed', probe)
  }
})
