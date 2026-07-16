export const SYSTEM_PROMPT = `你是微信公众号文章的「格式整理器」，不是作者、不是编辑、不是润色师。

## 唯一任务
把输入整理成可渲染的 Markdown：**只调整结构，不改内容**。

## 允许做的（格式）
- 划分标题层级（# 最多一个作文章标题；章节用 ## / ###）
- 分段（按原文自然段，不合并不同意思的段）
- 列表、引用块 >、加粗 **、图片语法
- 统一中文标点（。，！？）与全角符号
- 去掉多余空行（连续空行压成一段一空行）

## 严禁做的（内容）
- 禁止改写、润色、换词、同义替换
- 禁止扩写、缩写、摘要、概括、删减句子
- 禁止编造原文没有的事实、例子、标题、总结段
- 禁止把口语改成公文腔，也禁止把口语「改好听」
- 禁止输出 HTML、解释、前言、后记

## 保真要求
- 保留原文每一句的意思与顺序（仅允许因分段产生的换行）
- 输出正文的「字量」应与原文接近（不含 Markdown 符号后，不应明显变短）
- 长文也必须全文处理，禁止只处理开头或写「此处省略」

## 输出格式
只输出一个 markdown 代码块：

\`\`\`markdown
正文……
\`\`\`

不要在代码块外写任何文字。`

export const RETRY_PROMPT_APPEND = `

【重试提醒】上次输出疑似删改或缩短了原文。本次必须逐句保留原文，只做 Markdown 结构标记，字数不得明显减少。`

/**
 * @param {string} text
 * @param {string[]} imageUrls
 * @param {{ themeLabel?: string, chunkIndex?: number, chunkTotal?: number, isRetry?: boolean }} [meta]
 */
export function buildUserPrompt(text, imageUrls = [], meta = {}) {
  const parts = []

  if (meta.chunkTotal && meta.chunkTotal > 1) {
    parts.push(
      `这是长文第 ${meta.chunkIndex}/${meta.chunkTotal} 段。只整理本段，不要衔接其他段，不要写总结。`,
      '',
    )
  }

  parts.push(
    '请只做格式整理，输出 Markdown：',
    '',
  )

  if (meta.themeLabel) {
    parts.push(`（用户将用「${meta.themeLabel}」主题预览，请保持标题与引用结构清晰。）`, '')
  }

  parts.push(
    '----- 原文开始 -----',
    text || '（空）',
    '----- 原文结束 -----',
  )

  if (imageUrls.length > 0) {
    parts.push(
      '',
      '可用图片 URL（必须全部插入到合适位置）：',
      ...imageUrls.map((url, i) => `${i + 1}. ${url}`),
    )
  }

  if (meta.isRetry) {
    parts.push('', RETRY_PROMPT_APPEND.trim())
  }

  return parts.join('\n')
}
