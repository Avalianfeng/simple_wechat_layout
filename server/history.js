import fs from 'node:fs'
import path from 'node:path'
import { getDb } from './db.js'
import { uploadsDir } from './upload.js'

/**
 * @param {number} userId
 * @param {string[]} filenames
 */
function ownedFilenames(userId, filenames) {
  if (!filenames.length) return new Set()
  const db = getDb()
  const owned = new Set()
  const stmt = db.prepare(
    'SELECT 1 AS ok FROM uploads WHERE filename = ? AND user_id = ?',
  )
  for (const name of filenames) {
    if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) continue
    if (stmt.get(name, userId)) owned.add(name)
  }
  return owned
}

export function historyLimit() {
  const n = Number(process.env.HISTORY_LIMIT)
  return Number.isFinite(n) && n >= 1 ? Math.trunc(n) : 10
}

/**
 * @param {string} markdown
 */
export function titleFromMarkdown(markdown) {
  const text = String(markdown || '').trim()
  const heading = text.match(/^#\s+(.+)$/m)
  if (heading) return heading[1].trim().slice(0, 40)
  const plain = text.replace(/[#*_>`\[\]()!|-]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!plain) return '未命名文章'
  return plain.slice(0, 40) + (plain.length > 40 ? '…' : '')
}

/**
 * @param {string} markdown
 * @param {{ url?: string }[]} [images]
 */
export function extractUploadFilenames(markdown, images = []) {
  const names = new Set()
  for (const img of images) {
    const m = String(img.url || '').match(/\/uploads\/([^/?#]+)/i)
    if (m) names.add(m[1])
  }
  const re = /\/uploads\/([^)\s/?#]+)/gi
  let m
  while ((m = re.exec(markdown || '')) !== null) {
    names.add(m[1])
  }
  return [...names]
}

/**
 * 全局引用：任意用户历史仍引用则不可删。
 * @param {string[]} filenames
 */
function filenamesStillUsed(filenames) {
  if (!filenames.length) return new Set()
  const rows = getDb().prepare(`
    SELECT markdown, images_json FROM articles
  `).all()
  const used = new Set()
  for (const row of rows) {
    let images = []
    try {
      images = JSON.parse(row.images_json || '[]')
    }
    catch {
      images = []
    }
    for (const name of extractUploadFilenames(row.markdown, images)) {
      used.add(name)
    }
  }
  return used
}

/**
 * @param {number} userId
 * @param {string[]} filenames
 */
function deleteUploadFiles(userId, filenames) {
  const db = getDb()
  const delMeta = db.prepare(
    'DELETE FROM uploads WHERE filename = ? AND user_id = ?',
  )
  for (const name of filenames) {
    if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) continue
    const full = path.join(uploadsDir, name)
    try {
      if (fs.existsSync(full)) fs.unlinkSync(full)
    }
    catch {
      /* ignore */
    }
    try {
      delMeta.run(name, userId)
    }
    catch {
      /* ignore */
    }
  }
}

/**
 * @param {number} userId
 * @param {number} articleId
 */
function deleteArticleRow(userId, articleId) {
  const db = getDb()
  const row = db.prepare(
    'SELECT id, markdown, images_json FROM articles WHERE id = ? AND user_id = ?',
  ).get(articleId, userId)
  if (!row) return null

  let images = []
  try {
    images = JSON.parse(row.images_json || '[]')
  }
  catch {
    images = []
  }
  const files = extractUploadFilenames(row.markdown, images)
  db.prepare('DELETE FROM articles WHERE id = ? AND user_id = ?').run(articleId, userId)

  const owned = ownedFilenames(userId, files)
  const candidates = files.filter((f) => owned.has(f))
  const still = filenamesStillUsed(candidates)
  deleteUploadFiles(userId, candidates.filter((f) => !still.has(f)))
  return row
}

/**
 * @param {{
 *   userId: number,
 *   markdown: string,
 *   style?: object,
 *   images?: object[],
 * }} input
 */
export function saveArticleHistory(input) {
  const db = getDb()
  const limit = historyLimit()
  const markdown = String(input.markdown || '')
  const title = titleFromMarkdown(markdown)
  const styleJson = JSON.stringify(input.style || {})
  const imagesJson = JSON.stringify(Array.isArray(input.images) ? input.images : [])

  const oldestBefore = db.prepare(`
    SELECT id, title FROM articles
    WHERE user_id = ?
    ORDER BY id ASC
  `).all(input.userId)

  const info = db.prepare(`
    INSERT INTO articles (user_id, title, markdown, style_json, images_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(input.userId, title, markdown, styleJson, imagesJson)

  /** @type {{ id: number, title: string }[]} */
  const removed = []
  const afterCount = oldestBefore.length + 1
  if (afterCount > limit) {
    const drop = afterCount - limit
    for (let i = 0; i < drop; i++) {
      const old = oldestBefore[i]
      if (!old) break
      deleteArticleRow(input.userId, old.id)
      removed.push({ id: old.id, title: old.title })
    }
  }

  const article = getArticle(input.userId, Number(info.lastInsertRowid))
  return {
    article,
    removed,
    limit,
    count: countArticles(input.userId),
  }
}

/**
 * @param {number} userId
 */
export function countArticles(userId) {
  const row = getDb().prepare(
    'SELECT COUNT(*) AS c FROM articles WHERE user_id = ?',
  ).get(userId)
  return Number(row?.c) || 0
}

/**
 * @param {number} userId
 */
export function listArticles(userId) {
  const rows = getDb().prepare(`
    SELECT id, title, images_json, created_at,
           length(markdown) AS markdown_chars
    FROM articles
    WHERE user_id = ?
    ORDER BY id DESC
  `).all(userId)

  return rows.map((r) => {
    let imageCount = 0
    try {
      imageCount = JSON.parse(r.images_json || '[]').length
    }
    catch {
      imageCount = 0
    }
    return {
      id: r.id,
      title: r.title,
      imageCount,
      markdownChars: r.markdown_chars,
      createdAt: r.created_at,
    }
  })
}

/**
 * @param {number} userId
 * @param {number} id
 */
export function getArticle(userId, id) {
  const row = getDb().prepare(`
    SELECT id, title, markdown, style_json, images_json, created_at
    FROM articles WHERE id = ? AND user_id = ?
  `).get(id, userId)
  if (!row) return null
  let style = {}
  let images = []
  try {
    style = JSON.parse(row.style_json || '{}')
  }
  catch {
    style = {}
  }
  try {
    images = JSON.parse(row.images_json || '[]')
  }
  catch {
    images = []
  }
  return {
    id: row.id,
    title: row.title,
    markdown: row.markdown,
    style,
    images,
    createdAt: row.created_at,
  }
}

/**
 * @param {number} userId
 * @param {number} id
 */
export function deleteArticle(userId, id) {
  const row = deleteArticleRow(userId, id)
  if (!row) {
    const err = new Error('记录不存在')
    err.code = 'NOT_FOUND'
    throw err
  }
  return { ok: true, count: countArticles(userId) }
}
