import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { marked } from 'marked'
import juice from 'juice'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const themesDir = path.join(__dirname, '..', 'themes')

const baseCss = fs.readFileSync(path.join(themesDir, 'base.css'), 'utf8')
const simpleCss = fs.readFileSync(path.join(themesDir, 'simple.css'), 'utf8')
const themeCss = `${baseCss}\n\n${simpleCss}`

marked.setOptions({
  gfm: true,
  breaks: true,
})

/**
 * Markdown → 微信可用的内联样式 HTML
 * @param {string} markdown
 * @returns {string}
 */
export function renderMarkdownToHtml(markdown) {
  const body = marked.parse(markdown || '')
  const wrapped = `<section class="article">${body}</section>`
  return juice.inlineContent(wrapped, themeCss, {
    applyStyleTags: true,
    removeStyleTags: true,
    preserveMediaQueries: false,
    preserveFontFaces: false,
    inlinePseudoElements: false,
  })
}

/**
 * 从 markdown 中提取图片 URL（按出现顺序）
 * @param {string} markdown
 * @returns {{ alt: string, url: string }[]}
 */
export function extractImages(markdown) {
  const images = []
  const re = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
  let m
  while ((m = re.exec(markdown || '')) !== null) {
    images.push({ alt: m[1] || '配图', url: m[2] })
  }
  return images
}
