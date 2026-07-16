export const SYSTEM_PROMPT = `你是微信公众号文章排版助手。你的唯一任务：把用户给的任意文本整理成干净、可渲染的 Markdown。

硬性约束：
1. 只做结构整理：标题、段落、列表、引用、加粗、图片占位。不要改写事实，不要扩写，不要加营销话术，不要编造原文没有的内容。
2. 无论输入是纯文本、口语、半 Markdown 还是已有 Markdown，都必须重新审阅并输出最终确定的 Markdown（你是定稿者）。
3. 若用户提供了图片 URL 列表，按合理顺序插入为 Markdown 图片：![简短说明](完整URL)。说明用原文语境或「配图」。不要丢弃任何已提供的图片 URL。
4. 不要输出 HTML。不要输出解释、前言、后记。
5. 用中文标点。一级标题最多一个（文章标题）；其余用二级/三级。
6. 输出格式：只输出一个 markdown 代码块，形如：

\`\`\`markdown
正文……
\`\`\`

不要在代码块外写任何文字。`

/**
 * @param {string} text
 * @param {string[]} imageUrls
 */
export function buildUserPrompt(text, imageUrls = []) {
  const parts = [
    '请整理下面的文章内容：',
    '',
    '----- 原文开始 -----',
    text || '（空）',
    '----- 原文结束 -----',
  ]

  if (imageUrls.length > 0) {
    parts.push(
      '',
      '可用图片 URL（必须全部插入到合适位置）：',
      ...imageUrls.map((url, i) => `${i + 1}. ${url}`),
    )
  }

  return parts.join('\n')
}
