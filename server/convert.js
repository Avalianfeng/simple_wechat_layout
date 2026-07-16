import { SYSTEM_PROMPT, buildUserPrompt } from './prompts.js'
import { mergeImageUrls } from './markdown-utils.js'
import { THEMES } from './themes.js'
import { Agent } from 'undici'
import {
  assertTextLength,
  computeTimeoutMs,
  getTextLimits,
  looksOverEdited,
  splitTextIntoChunks,
} from './text-limits.js'

const DEFAULT_BASE = 'https://api.deepseek.com'
const DEFAULT_MODEL = 'deepseek-v4-flash'
const DEFAULT_CONNECT_TIMEOUT_MS = 30_000
const DEFAULT_RETRY_TIMES = 1

/** @type {Agent | null} */
let deepSeekDispatcher = null

function getDeepSeekDispatcher(connectTimeoutMs) {
  if (!deepSeekDispatcher) {
    deepSeekDispatcher = new Agent({
      connectTimeout: connectTimeoutMs,
    })
  }
  return deepSeekDispatcher
}

function isDeepSeekNetworkError(e) {
  return Boolean(
    e?.message === 'fetch failed'
    || e?.code === 'UND_ERR_CONNECT_TIMEOUT'
    || e?.code === 'UND_ERR_SOCKET'
    || e?.code === 'ECONNRESET'
    || e?.code === 'ETIMEDOUT',
  )
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * @param {string} content
 */
export function extractMarkdown(content) {
  const text = (content || '').trim()
  const fenced = text.match(/```(?:markdown|md)?\s*([\s\S]*?)```/i)
  if (fenced) return fenced[1].trim()
  return text
}

/** @param {unknown} err */
export function describeErrorChain(err) {
  const parts = []
  let cur = err
  let depth = 0
  while (cur && depth < 5) {
    if (cur instanceof Error) {
      const bits = [cur.name, cur.message].filter(Boolean)
      if ('code' in cur && cur.code) bits.push(`code=${cur.code}`)
      if ('errno' in cur && cur.errno != null) bits.push(`errno=${cur.errno}`)
      if ('syscall' in cur && cur.syscall) bits.push(`syscall=${cur.syscall}`)
      if ('hostname' in cur && cur.hostname) bits.push(`host=${cur.hostname}`)
      if ('address' in cur && cur.address) bits.push(`addr=${cur.address}`)
      if ('port' in cur && cur.port != null) bits.push(`port=${cur.port}`)
      parts.push(bits.join(' '))
      cur = cur.cause
    }
    else {
      parts.push(String(cur))
      break
    }
    depth += 1
  }
  return parts.join(' ← ')
}

export function getDeepSeekConfig() {
  const limits = getTextLimits()
  return {
    baseUrl: (process.env.DEEPSEEK_BASE_URL || DEFAULT_BASE).replace(/\/$/, ''),
    model: process.env.DEEPSEEK_MODEL || DEFAULT_MODEL,
    hasKey: Boolean(process.env.DEEPSEEK_API_KEY),
    keyLength: process.env.DEEPSEEK_API_KEY?.length || 0,
    connectTimeoutMs: Number(process.env.DEEPSEEK_CONNECT_TIMEOUT_MS) || DEFAULT_CONNECT_TIMEOUT_MS,
    retryTimes: Number(process.env.DEEPSEEK_RETRY_TIMES) || DEFAULT_RETRY_TIMES,
    ...limits,
  }
}

/**
 * @param {{ messages: object[], timeoutMs: number, model: string, baseUrl: string, apiKey: string }} opts
 */
async function callDeepSeekOnce({ messages, timeoutMs, model, baseUrl, apiKey }) {
  const url = `${baseUrl}/v1/chat/completions`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        messages,
      }),
      signal: controller.signal,
      dispatcher: getDeepSeekDispatcher(getDeepSeekConfig().connectTimeoutMs),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      const err = new Error(`DeepSeek 请求失败 (${res.status}): ${detail.slice(0, 300)}`)
      err.code = 'DEEPSEEK_HTTP'
      err.status = res.status
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

    return { markdown, model: data?.model || model, usage: data?.usage || null }
  }
  finally {
    clearTimeout(timer)
  }
}

async function callDeepSeekWithRetry({ messages, timeoutMs, model, baseUrl, apiKey }) {
  const { retryTimes } = getDeepSeekConfig()
  const attempts = Math.max(1, 1 + retryTimes)
  let lastErr

  for (let i = 0; i < attempts; i++) {
    try {
      return await callDeepSeekOnce({ messages, timeoutMs, model, baseUrl, apiKey })
    }
    catch (e) {
      lastErr = e
      if (e?.name === 'AbortError') throw e
      if (!isDeepSeekNetworkError(e)) throw e
      if (i === attempts - 1) throw e
      await sleep(300 + i * 500)
    }
  }

  throw lastErr
}

/**
 * @param {{ text: string, imageUrls?: string[], theme?: string, isRetry?: boolean, chunkIndex?: number, chunkTotal?: number }} input
 */
async function convertChunk(input) {
  const apiKey = process.env.DEEPSEEK_API_KEY
  const { baseUrl, model } = getDeepSeekConfig()
  const timeoutMs = computeTimeoutMs((input.text || '').length)

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: buildUserPrompt(input.text, input.imageUrls, {
        themeLabel: THEMES[input.theme]?.label,
        chunkIndex: input.chunkIndex,
        chunkTotal: input.chunkTotal,
        isRetry: input.isRetry,
      }),
    },
  ]

  return callDeepSeekWithRetry({ messages, timeoutMs, model, baseUrl, apiKey })
}

/**
 * @param {{
 *   prompt_tokens?: number,
 *   completion_tokens?: number,
 *   total_tokens?: number,
 *   prompt_cache_hit_tokens?: number,
 *   prompt_cache_miss_tokens?: number,
 * } | null} a
 * @param {{
 *   prompt_tokens?: number,
 *   completion_tokens?: number,
 *   total_tokens?: number,
 *   prompt_cache_hit_tokens?: number,
 *   prompt_cache_miss_tokens?: number,
 * } | null} b
 */
function addUsage(a, b) {
  return {
    prompt_tokens: (Number(a?.prompt_tokens) || 0) + (Number(b?.prompt_tokens) || 0),
    completion_tokens: (Number(a?.completion_tokens) || 0) + (Number(b?.completion_tokens) || 0),
    total_tokens: (Number(a?.total_tokens) || 0) + (Number(b?.total_tokens) || 0),
    prompt_cache_hit_tokens:
      (Number(a?.prompt_cache_hit_tokens) || 0) + (Number(b?.prompt_cache_hit_tokens) || 0),
    prompt_cache_miss_tokens:
      (Number(a?.prompt_cache_miss_tokens) || 0) + (Number(b?.prompt_cache_miss_tokens) || 0),
  }
}

/**
 * 一律经 DeepSeek 规范化为 Markdown（长文自动分段 + 动态超时）
 * @param {{ text: string, imageUrls?: string[], theme?: string }} input
 * @returns {Promise<{ markdown: string, usage: object, chunks: number, retries: number }>}
 */
export async function convertToMarkdown({ text, imageUrls = [], theme } = {}) {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) {
    const err = new Error('未配置 DEEPSEEK_API_KEY，请在 .env 中设置')
    err.code = 'NO_API_KEY'
    throw err
  }

  const raw = text || ''
  assertTextLength(raw.length)

  const { baseUrl, model, chunkChars } = getDeepSeekConfig()
  const started = Date.now()
  const timeoutMs = computeTimeoutMs(raw.length)
  const chunks = raw.length > chunkChars ? splitTextIntoChunks(raw, chunkChars) : [raw]

  console.log('[convert] request', {
    url: `${baseUrl}/v1/chat/completions`,
    model,
    theme: theme || null,
    textChars: raw.length,
    imageCount: imageUrls.length,
    timeoutMs,
    chunks: chunks.length,
  })

  /** @type {{
   *   prompt_tokens: number,
   *   completion_tokens: number,
   *   total_tokens: number,
   *   prompt_cache_hit_tokens: number,
   *   prompt_cache_miss_tokens: number,
   * }} */
  let usage = {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    prompt_cache_hit_tokens: 0,
    prompt_cache_miss_tokens: 0,
  }
  let retries = 0

  try {
    const parts = []
    const imagesForAi = chunks.length === 1 ? imageUrls : []

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      let result = await convertChunk({
        text: chunk,
        imageUrls: i === 0 ? imagesForAi : [],
        theme,
        chunkIndex: i + 1,
        chunkTotal: chunks.length,
      })
      usage = addUsage(usage, result.usage)

      if (looksOverEdited(chunk, result.markdown)) {
        console.warn('[convert] over-edited, retry chunk', { chunk: i + 1 })
        retries += 1
        result = await convertChunk({
          text: chunk,
          imageUrls: i === 0 ? imagesForAi : [],
          theme,
          chunkIndex: i + 1,
          chunkTotal: chunks.length,
          isRetry: true,
        })
        usage = addUsage(usage, result.usage)
        if (looksOverEdited(chunk, result.markdown)) {
          const err = new Error('AI 疑似改动了原文内容，请改用「已有 Markdown」模式，或缩短后重试')
          err.code = 'OVER_EDITED'
          err.usage = usage
          err.chunks = chunks.length
          err.retries = retries
          throw err
        }
      }

      parts.push(result.markdown)
    }

    let markdown = parts.join('\n\n').trim()

    // 分段时图片只在第一段 prompt；其余 URL 由服务端补入
    if (chunks.length > 1 && imageUrls.length) {
      markdown = mergeImageUrls(markdown, imageUrls)
    }

    console.log('[convert] ok', {
      ms: Date.now() - started,
      model,
      markdownChars: markdown.length,
      chunks: chunks.length,
      retries,
      usage,
    })

    return { markdown, usage, chunks: chunks.length, retries }
  }
  catch (e) {
    const ms = Date.now() - started
    if (e?.usage) {
      /* already attached */
    }
    else {
      e.usage = usage
      e.chunks = chunks.length
      e.retries = retries
    }

    if (e?.name === 'AbortError') {
      const err = new Error(`整理超时（约 ${Math.round(timeoutMs / 1000)} 秒）。文章较长可改用「已有 Markdown」模式，或分段后再整理。`)
      err.code = 'TIMEOUT'
      err.usage = usage
      err.chunks = chunks.length
      err.retries = retries
      console.error('[convert] timeout', { ms, timeoutMs })
      throw err
    }

    if (e?.message === 'fetch failed' || e?.code === 'UND_ERR_CONNECT_TIMEOUT') {
      const chain = describeErrorChain(e)
      const err = new Error(`无法连接 DeepSeek (${baseUrl}): ${chain}`)
      err.code = 'DEEPSEEK_NETWORK'
      err.cause = e
      err.usage = usage
      err.chunks = chunks.length
      err.retries = retries
      console.error('[convert] network', { ms, chain })
      throw err
    }

    console.error('[convert] error', {
      ms,
      code: e?.code || 'UNKNOWN',
      chain: describeErrorChain(e),
    })
    throw e
  }
}
