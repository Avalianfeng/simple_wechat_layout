/** @typedef {{ filename: string, url: string }} UploadedImage */

/** @type {UploadedImage[]} */
let uploaded = []

/** @type {string} */
let lastHtml = ''

/** @type {{ alt: string, url: string }[]} */
let lastImages = []

const el = {
  text: document.getElementById('text'),
  fileInput: document.getElementById('fileInput'),
  thumbList: document.getElementById('thumbList'),
  convertBtn: document.getElementById('convertBtn'),
  status: document.getElementById('status'),
  resultSection: document.getElementById('resultSection'),
  preview: document.getElementById('preview'),
  copyBtn: document.getElementById('copyBtn'),
  copyHint: document.getElementById('copyHint'),
  insertGuide: document.getElementById('insertGuide'),
  insertList: document.getElementById('insertList'),
  markdownOut: document.getElementById('markdownOut'),
}

function setStatus(msg, isError = false) {
  el.status.textContent = msg || ''
  el.status.classList.toggle('error', Boolean(isError))
}

function renderThumbs() {
  el.thumbList.innerHTML = ''
  if (uploaded.length === 0) {
    el.thumbList.hidden = true
    return
  }
  el.thumbList.hidden = false
  uploaded.forEach((item, index) => {
    const li = document.createElement('li')
    const img = document.createElement('img')
    img.src = item.url
    img.alt = `图片 ${index + 1}`
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'remove'
    remove.setAttribute('aria-label', '删除')
    remove.textContent = '×'
    remove.addEventListener('click', () => {
      uploaded.splice(index, 1)
      renderThumbs()
    })
    li.append(img, remove)
    el.thumbList.append(li)
  })
}

function renderInsertGuide(images) {
  el.insertList.innerHTML = ''
  if (!images.length) {
    el.insertGuide.hidden = true
    return
  }
  el.insertGuide.hidden = false
  images.forEach((img, i) => {
    const li = document.createElement('li')
    const num = document.createElement('span')
    num.className = 'num'
    num.textContent = String(i + 1)
    const thumb = document.createElement('img')
    thumb.src = img.url
    thumb.alt = img.alt || `图 ${i + 1}`
    const meta = document.createElement('div')
    meta.className = 'meta'
    meta.textContent = img.alt ? `说明：${img.alt}` : `第 ${i + 1} 张`
    li.append(num, thumb, meta)
    el.insertList.append(li)
  })
}

el.fileInput.addEventListener('change', async () => {
  const files = Array.from(el.fileInput.files || [])
  el.fileInput.value = ''
  if (!files.length) return

  setStatus('正在上传图片…')
  el.convertBtn.disabled = true
  try {
    const form = new FormData()
    files.forEach((f) => form.append('images', f))
    const res = await fetch('/api/upload', { method: 'POST', body: form })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || '上传失败')
    uploaded = uploaded.concat(data.images || [])
    renderThumbs()
    setStatus(`已添加 ${data.images.length} 张图片`)
  }
  catch (e) {
    setStatus(e.message || '上传失败', true)
  }
  finally {
    el.convertBtn.disabled = false
  }
})

el.convertBtn.addEventListener('click', async () => {
  const text = el.text.value
  if (!text.trim() && uploaded.length === 0) {
    setStatus('请先写一点文字，或上传图片', true)
    return
  }

  setStatus('正在整理，请稍等…')
  el.convertBtn.disabled = true
  el.copyHint.hidden = true

  try {
    const res = await fetch('/api/convert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        imageUrls: uploaded.map((u) => u.url),
      }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || '整理失败')

    lastHtml = data.html || ''
    lastImages = data.images || []
    el.preview.innerHTML = lastHtml
    el.markdownOut.textContent = data.markdown || ''
    renderInsertGuide(lastImages)
    el.resultSection.hidden = false
    setStatus('整理完成，可以预览并复制')
    el.resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  catch (e) {
    setStatus(e.message || '整理失败', true)
  }
  finally {
    el.convertBtn.disabled = false
  }
})

async function copyHtml(html) {
  // 优先用 ClipboardItem 写入 HTML，便于粘贴到公众号编辑器
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    const blobHtml = new Blob([html], { type: 'text/html' })
    const blobText = new Blob([html], { type: 'text/plain' })
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': blobHtml,
        'text/plain': blobText,
      }),
    ])
    return
  }

  // 回退：选中隐藏容器复制
  const box = document.createElement('div')
  box.contentEditable = 'true'
  box.innerHTML = html
  box.style.cssText = 'position:fixed;left:-9999px;top:0;'
  document.body.appendChild(box)
  const range = document.createRange()
  range.selectNodeContents(box)
  const sel = window.getSelection()
  sel.removeAllRanges()
  sel.addRange(range)
  const ok = document.execCommand('copy')
  sel.removeAllRanges()
  box.remove()
  if (!ok) throw new Error('复制失败，请长按预览区手动复制')
}

/** 复制给微信时去掉外链图，避免空白占位；本站预览仍保留图片 */
function htmlForWechatCopy(html) {
  return html
    .replace(/<img\b[^>]*>/gi, '')
    .replace(/<p>\s*<\/p>/gi, '')
}

el.copyBtn.addEventListener('click', async () => {
  if (!lastHtml) {
    setStatus('请先整理并预览', true)
    return
  }
  try {
    await copyHtml(htmlForWechatCopy(lastHtml))
    el.copyHint.hidden = false
    el.copyHint.className = 'hint success'
    if (lastImages.length > 0) {
      el.copyHint.textContent =
        '文字已复制。请打开公众号后台粘贴，再按下方顺序插入图片。'
    }
    else {
      el.copyHint.textContent = '已复制。打开公众号后台，粘贴即可。'
    }
  }
  catch (e) {
    el.copyHint.hidden = false
    el.copyHint.className = 'hint'
    el.copyHint.textContent = e.message || '复制失败'
  }
})
