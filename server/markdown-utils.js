import { extractImages } from './render.js'

/**
 * 将上传的图片 URL 补进 Markdown（仅补缺失的）
 * @param {string} markdown
 * @param {string[]} imageUrls
 */
export function mergeImageUrls(markdown, imageUrls = []) {
  if (!imageUrls.length) return (markdown || '').trim()

  const existing = new Set(extractImages(markdown).map((i) => i.url))
  const missing = imageUrls.filter((u) => u && !existing.has(u))
  if (!missing.length) return (markdown || '').trim()

  const appendix = missing.map((url) => `![配图](${url})`).join('\n\n')
  return `${(markdown || '').trim()}\n\n${appendix}`
}
