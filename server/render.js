import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { marked } from 'marked'
import juice from 'juice'
import { THEMES, normalizeStyle } from './themes.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const themesDir = path.join(__dirname, '..', 'themes')

const baseCss = fs.readFileSync(path.join(themesDir, 'base.css'), 'utf8')
const themeFileCache = new Map()

function loadThemeCss(themeId) {
  const meta = THEMES[themeId] || THEMES.grace
  if (themeFileCache.has(meta.file)) return themeFileCache.get(meta.file)
  const css = fs.readFileSync(path.join(themesDir, meta.file), 'utf8')
  themeFileCache.set(meta.file, css)
  return css
}

marked.setOptions({
  gfm: true,
  breaks: true,
})

const renderer = new marked.Renderer()
renderer.image = ({ href, title, text }) => {
  const alt = text || '配图'
  const titleAttr = title ? ` title="${escapeAttr(title)}"` : ''
  const caption = alt && alt !== '配图'
    ? `<figcaption>${escapeHtml(alt)}</figcaption>`
    : ''
  return `<figure><img src="${escapeAttr(href || '')}" alt="${escapeAttr(alt)}"${titleAttr} />${caption}</figure>`
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;')
}

function buildExtraCss({ indent, justify }) {
  const rules = []
  if (indent) rules.push('text-indent: 2em;')
  if (justify) rules.push('text-align: justify;')
  if (!rules.length) return ''
  return `.article p {\n  ${rules.join('\n  ')}\n}`
}

/**
 * Markdown → 内联样式 HTML（纯本地，不调 AI）
 * @param {string} markdown
 * @param {object} [styleInput]
 */
export function renderMarkdownToHtml(markdown, styleInput = {}) {
  const style = normalizeStyle(styleInput)
  let css = `${baseCss}\n\n${loadThemeCss(style.theme)}\n\n${buildExtraCss(style)}`
  css = css
    .replaceAll('{{PRIMARY}}', style.primaryColor)
    .replaceAll('{{FONT_FAMILY}}', style.fontFamily)
    .replaceAll('{{FONT_SIZE}}', style.fontSize)

  const body = marked.parse(markdown || '', { renderer })
  const wrapped = `<section class="article">${body}</section>`
  return juice.inlineContent(wrapped, css, {
    applyStyleTags: true,
    removeStyleTags: true,
    preserveMediaQueries: false,
    preserveFontFaces: false,
    inlinePseudoElements: false,
  })
}

/**
 * @param {string} markdown
 * @returns {{ index: number, alt: string, url: string }[]}
 */
export function extractImages(markdown) {
  const images = []
  const re = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
  let m
  let index = 0
  while ((m = re.exec(markdown || '')) !== null) {
    index += 1
    images.push({ index, alt: m[1] || '配图', url: m[2] })
  }
  return images
}

/**
 * @param {string} html
 * @param {{ index: number }[]} images
 */
export function annotatePreviewHtml(html, images) {
  if (!images?.length) return html
  let i = 0
  return html.replace(/<figure\b/gi, () => {
    i += 1
    const n = images[i - 1]?.index || i
    return `<figure data-img-index="${n}"`
  })
}
