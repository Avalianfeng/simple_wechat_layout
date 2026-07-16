import 'dotenv/config'
import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { convertToMarkdown } from './convert.js'
import { renderMarkdownToHtml, extractImages } from './render.js'
import { uploadMiddleware, uploadsDir } from './upload.js'

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

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    hasDeepSeekKey: Boolean(process.env.DEEPSEEK_API_KEY),
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
  try {
    const text = typeof req.body?.text === 'string' ? req.body.text : ''
    const imageUrls = Array.isArray(req.body?.imageUrls)
      ? req.body.imageUrls.filter((u) => typeof u === 'string' && u.trim())
      : []

    if (!text.trim() && imageUrls.length === 0) {
      res.status(400).json({ error: '请先写一点文字，或上传图片' })
      return
    }

    const markdown = await convertToMarkdown({ text, imageUrls })
    const html = renderMarkdownToHtml(markdown)
    const images = extractImages(markdown)

    res.json({ markdown, html, images })
  }
  catch (e) {
    const status = e.code === 'NO_API_KEY' ? 503 : 502
    console.error('[convert]', e.message)
    res.status(status).json({
      error: e.message || '整理失败',
      code: e.code || 'UNKNOWN',
    })
  }
})

app.listen(PORT, () => {
  console.log(`simple-wechat-layout listening on http://127.0.0.1:${PORT}`)
  if (!process.env.DEEPSEEK_API_KEY) {
    console.warn('警告: 未设置 DEEPSEEK_API_KEY，/api/convert 将不可用')
  }
})
