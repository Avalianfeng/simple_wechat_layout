import { SYSTEM_PROMPT, buildUserPrompt } from './prompts.js'

const DEFAULT_BASE = 'https://api.deepseek.com'
const DEFAULT_MODEL = 'deepseek-chat'
const TIMEOUT_MS = 60_000

/**
 * 从模型回复中抽出 markdown 正文
 * @param {string} content
 */
export function extractMarkdown(content) {
  const text = (content || '').trim()
  const fenced = text.match(/```(?:markdown|md)?\s*([\s\S]*?)```/i)
  if (fenced) return fenced[1].trim()
  return text
}

/**
 * 一律经 DeepSeek 规范化为 Markdown
 * @param {{ text: string, imageUrls?: string[] }} input
 * @returns {Promise<string>}
 */
export async function convertToMarkdown({ text, imageUrls = [] }) {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) {
    const err = new Error('未配置 DEEPSEEK_API_KEY，请在 .env 中设置')
    err.code = 'NO_API_KEY'
    throw err
  }

  const baseUrl = (process.env.DEEPSEEK_BASE_URL || DEFAULT_BASE).replace(/\/$/, '')
  const model = process.env.DEEPSEEK_MODEL || DEFAULT_MODEL

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(text, imageUrls) },
        ],
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      const err = new Error(`DeepSeek 请求失败 (${res.status}): ${detail.slice(0, 300)}`)
      err.code = 'DEEPSEEK_HTTP'
      throw err
    }

    const data = await res.json()
    const content = data?.choices?.[0]?.message?.content
    if (!content) {
      const err = new Error('DeepSeek 返回空内容')
      err.code = 'DEEPSEEK_EMPTY'
      throw err
    }

    const markdown = extractMarkdown(content)
    if (!markdown) {
      const err = new Error('未能从回复中解析出 Markdown')
      err.code = 'DEEPSEEK_PARSE'
      throw err
    }

    return markdown
  }
  catch (e) {
    if (e?.name === 'AbortError') {
      const err = new Error('整理超时，请稍后重试')
      err.code = 'TIMEOUT'
      throw err
    }
    throw e
  }
  finally {
    clearTimeout(timer)
  }
}
