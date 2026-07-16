/** @typedef {{ filename: string, url: string }} UploadedImage */

const STORAGE_KEY = 'swl_draft_v1'

/** @type {'text' | 'markdown'} */
let inputMode = 'text'

/** @type {UploadedImage[]} */
let uploaded = []

/** @type {string} */
let lastHtml = ''

/** 锁定的 Markdown：样式切换绝不改写、不重跑 AI */
/** @type {string} */
let lastMarkdown = ''

/** @type {{ index: number, alt: string, url: string }[]} */
let lastImages = []

let options = {
  themes: [],
  colors: [],
  fonts: [],
  fontSizes: [],
  defaults: {},
}

let selectedTheme = 'grace'
let selectedColor = '#07c160'
let selectedFont = ''
let selectedSize = '16px'
let restyleTimer = 0
let restyling = false

const el = {
  text: document.getElementById('text'),
  textLabel: document.getElementById('textLabel'),
  modeHint: document.getElementById('modeHint'),
  modeBtns: document.querySelectorAll('.mode-btn'),
  fileInput: document.getElementById('fileInput'),
  thumbList: document.getElementById('thumbList'),
  themeGroup: document.getElementById('themeGroup'),
  colorGroup: document.getElementById('colorGroup'),
  fontGroup: document.getElementById('fontGroup'),
  sizeGroup: document.getElementById('sizeGroup'),
  indentToggle: document.getElementById('indentToggle'),
  justifyToggle: document.getElementById('justifyToggle'),
  convertBtn: document.getElementById('convertBtn'),
  status: document.getElementById('status'),
  styleStatus: document.getElementById('styleStatus'),
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

function setStyleStatus(msg) {
  if (!msg) {
    el.styleStatus.hidden = true
    el.styleStatus.textContent = ''
    return
  }
  el.styleStatus.hidden = false
  el.styleStatus.textContent = msg
}

function currentStyle() {
  return {
    theme: selectedTheme,
    primaryColor: selectedColor,
    fontFamily: selectedFont,
    fontSize: selectedSize,
    indent: el.indentToggle.checked,
    justify: el.justifyToggle.checked,
  }
}

function persistDraft() {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
      markdown: lastMarkdown,
      images: lastImages,
      style: currentStyle(),
      text: el.text.value,
      inputMode,
    }))
  }
  catch {
    /* ignore quota */
  }
}

function setInputMode(mode) {
  inputMode = mode === 'markdown' ? 'markdown' : 'text'
  el.modeBtns.forEach((btn) => {
    const active = btn.dataset.mode === inputMode
    btn.classList.toggle('active', active)
    btn.setAttribute('aria-selected', active ? 'true' : 'false')
  })

  if (inputMode === 'markdown') {
    el.textLabel.textContent = '把 Markdown 贴在这里'
    el.text.placeholder = '# 标题\n\n段落文字……\n\n> 引用\n\n![配图说明](图片地址可选)'
    el.convertBtn.textContent = '直接预览'
    el.modeHint.textContent = '不调用 AI。贴好后点「直接预览」，再换主题 / 字体。'
  }
  else {
    el.textLabel.textContent = '把文章写在这里'
    el.text.placeholder = '直接敲字就行，不用管格式。有标题、段落也可以一起贴进来。'
    el.convertBtn.textContent = '整理文字'
    el.modeHint.textContent = '由 AI 整理一次（只改格式不改内容）。整理后可随意换样式，不会再调 AI。'
  }
  persistDraft()
}

function loadDraft() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  }
  catch {
    return null
  }
}

function paintChoiceRow(container, items, isActive, onPick, renderInner) {
  container.innerHTML = ''
  items.forEach((item) => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = `choice${isActive(item) ? ' active' : ''}`
    btn.innerHTML = renderInner(item)
    btn.addEventListener('click', () => onPick(item))
    container.append(btn)
  })
}

function renderAllChoices() {
  paintChoiceRow(
    el.themeGroup,
    options.themes,
    (t) => t.id === selectedTheme,
    (t) => {
      selectedTheme = t.id
      renderAllChoices()
      scheduleRestyle()
    },
    (t) => `<span class="title">${t.label}</span><span class="hint">${t.hint || ''}</span>`,
  )

  paintChoiceRow(
    el.colorGroup,
    options.colors,
    (c) => c.value === selectedColor,
    (c) => {
      selectedColor = c.value
      renderAllChoices()
      scheduleRestyle()
    },
    (c) => `<span class="swatch" style="background:${c.value}"></span>${c.label}`,
  )

  paintChoiceRow(
    el.fontGroup,
    options.fonts,
    (f) => f.value === selectedFont,
    (f) => {
      selectedFont = f.value
      renderAllChoices()
      scheduleRestyle()
    },
    (f) => `<span class="title" style="font-family:${f.value}">${f.label}</span><span class="hint">${f.hint || ''}</span>`,
  )

  paintChoiceRow(
    el.sizeGroup,
    options.fontSizes,
    (s) => s.value === selectedSize,
    (s) => {
      selectedSize = s.value
      renderAllChoices()
      scheduleRestyle()
    },
    (s) => `<span class="title">${s.label}</span>`,
  )
}

function applyResult(data, { fromAi = false, fromMarkdown = false } = {}) {
  if (fromAi || fromMarkdown || !lastMarkdown) {
    lastMarkdown = data.markdown || lastMarkdown
  }
  lastHtml = data.html || ''
  lastImages = data.images || lastImages

  if (data.style) {
    selectedTheme = data.style.theme || selectedTheme
    selectedColor = data.style.primaryColor || selectedColor
    selectedFont = data.style.fontFamily || selectedFont
    selectedSize = data.style.fontSize || selectedSize
    el.indentToggle.checked = Boolean(data.style.indent)
    el.justifyToggle.checked = Boolean(data.style.justify)
  }

  el.preview.innerHTML = lastHtml
  el.markdownOut.textContent = lastMarkdown
  renderInsertGuide(lastImages)
  el.resultSection.hidden = false
  renderAllChoices()
  persistDraft()
}

/** 仅本地重渲染，绝不调用 /api/convert */
async function restyleNow() {
  if (!lastMarkdown.trim()) return
  if (restyling) return
  restyling = true
  setStyleStatus('正在换样子…')
  try {
    const res = await fetch('/api/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        markdown: lastMarkdown,
        style: currentStyle(),
      }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || '换样子失败')
    applyResult(data, { fromAi: false })
    setStyleStatus('样子已更新（文字未改动）')
  }
  catch (e) {
    setStyleStatus(e.message || '换样子失败')
  }
  finally {
    restyling = false
  }
}

function scheduleRestyle() {
  if (!lastMarkdown.trim()) return
  window.clearTimeout(restyleTimer)
  restyleTimer = window.setTimeout(() => {
    restyleNow()
  }, 180)
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
  images.forEach((img) => {
    const li = document.createElement('li')
    const num = document.createElement('span')
    num.className = 'num'
    num.textContent = String(img.index || '')
    const thumb = document.createElement('img')
    thumb.src = img.url
    thumb.alt = img.alt || `图 ${img.index}`
    const meta = document.createElement('div')
    meta.className = 'meta'
    meta.textContent = img.alt ? `【图${img.index}】${img.alt}` : `【图${img.index}】`
    li.append(num, thumb, meta)
    el.insertList.append(li)
  })
}

function prepareWechatHtml(html) {
  const root = document.createElement('div')
  root.innerHTML = html

  root.querySelectorAll('li > ul, li > ol').forEach((nested) => {
    nested.parentElement?.insertAdjacentElement('afterend', nested)
  })

  root.querySelectorAll('figure, img').forEach((node) => {
    if (node.tagName === 'FIGURE') {
      const n = node.getAttribute('data-img-index') || ''
      const marker = document.createElement('p')
      marker.textContent = n ? `【图${n}】` : '【图】'
      marker.style.cssText = 'color:#07c160;font-weight:bold;text-align:center;margin:1em 0;'
      node.replaceWith(marker)
      return
    }
    if (node.closest('figure')) return
    const marker = document.createElement('p')
    marker.textContent = '【图】'
    marker.style.cssText = 'color:#07c160;font-weight:bold;text-align:center;margin:1em 0;'
    node.replaceWith(marker)
  })

  const empty = () => {
    const p = document.createElement('p')
    p.style.cssText = 'font-size:0;line-height:0;margin:0;'
    p.innerHTML = '&nbsp;'
    return p
  }
  root.insertBefore(empty(), root.firstChild)
  root.appendChild(empty())
  return root.innerHTML
}

async function copyHtml(html) {
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([html], { type: 'text/plain' }),
      }),
    ])
    return
  }

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
    setStatus(inputMode === 'markdown' ? '请先粘贴 Markdown，或上传图片' : '请先写一点文字，或上传图片', true)
    return
  }

  el.convertBtn.disabled = true
  el.copyHint.hidden = true

  if (inputMode === 'markdown') {
    setStatus('正在排版预览（不调用 AI）…')
    try {
      const res = await fetch('/api/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          markdown: text,
          imageUrls: uploaded.map((u) => u.url),
          style: currentStyle(),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '预览失败')
      applyResult(data, { fromMarkdown: true })
      setStatus('Markdown 已锁定。下面可随意换主题 / 字体，不会调用 AI。')
      el.resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    catch (e) {
      setStatus(e.message || '预览失败', true)
    }
    finally {
      el.convertBtn.disabled = false
    }
    return
  }

  const charHint = text.length > 8000 ? `（较长，约 ${Math.min(180, 60 + Math.floor(text.length / 800))} 秒内）` : ''
  setStatus(`正在整理文字（仅此一步会用 AI）${charHint}…`)

  try {
    const res = await fetch('/api/convert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        imageUrls: uploaded.map((u) => u.url),
        style: currentStyle(),
      }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || '整理失败')

    applyResult(data, { fromAi: true })
    setStatus('文字已整理并锁定。下面可随意换主题 / 字体，不会再调用 AI。')
    el.resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  catch (e) {
    setStatus(e.message || '整理失败', true)
  }
  finally {
    el.convertBtn.disabled = false
  }
})

el.modeBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.dataset.mode === inputMode) return
    setInputMode(btn.dataset.mode)
  })
})

el.indentToggle.addEventListener('change', scheduleRestyle)
el.justifyToggle.addEventListener('change', scheduleRestyle)

el.copyBtn.addEventListener('click', async () => {
  if (!lastHtml) {
    setStatus('请先整理文字', true)
    return
  }
  try {
    await copyHtml(prepareWechatHtml(lastHtml))
    el.copyHint.hidden = false
    el.copyHint.className = 'hint success'
    el.copyHint.textContent = lastImages.length > 0
      ? '文字已复制（图已换成【图N】）。打开公众号后台粘贴，再按下方顺序插图。'
      : '已复制。打开公众号后台，粘贴即可。'
  }
  catch (e) {
    el.copyHint.hidden = false
    el.copyHint.className = 'hint'
    el.copyHint.textContent = e.message || '复制失败'
  }
})

async function boot() {
  try {
    const res = await fetch('/api/options')
    if (res.ok) options = await res.json()
  }
  catch {
    /* defaults below */
  }

  if (!options.themes?.length) {
    options.themes = [
      { id: 'grace', label: '优雅', hint: '柔和随笔' },
      { id: 'classic', label: '经典', hint: '色块标题' },
      { id: 'simple', label: '简洁', hint: '轻量现代' },
    ]
  }
  if (!options.colors?.length) {
    options.colors = [{ id: 'green', label: '微信绿', value: '#07c160' }]
  }
  if (!options.fonts?.length) {
    options.fonts = [{
      id: 'sans',
      label: '无衬线',
      hint: '清晰好读',
      value: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
    }]
  }
  if (!options.fontSizes?.length) {
    options.fontSizes = [
      { id: '15', label: '15', value: '15px' },
      { id: '16', label: '16', value: '16px' },
      { id: '17', label: '17', value: '17px' },
    ]
  }

  const d = options.defaults || {}
  selectedTheme = d.theme || selectedTheme
  selectedColor = d.primaryColor || selectedColor
  selectedFont = d.fontFamily || options.fonts[0].value
  selectedSize = d.fontSize || '16px'
  el.indentToggle.checked = d.indent !== undefined ? Boolean(d.indent) : true
  el.justifyToggle.checked = Boolean(d.justify)

  const draft = loadDraft()
  if (draft?.inputMode) setInputMode(draft.inputMode)
  else setInputMode('text')

  if (draft?.markdown) {
    lastMarkdown = draft.markdown
    lastImages = draft.images || []
    if (draft.text) el.text.value = draft.text
    if (draft.style) {
      selectedTheme = draft.style.theme || selectedTheme
      selectedColor = draft.style.primaryColor || selectedColor
      selectedFont = draft.style.fontFamily || selectedFont
      selectedSize = draft.style.fontSize || selectedSize
      el.indentToggle.checked = Boolean(draft.style.indent)
      el.justifyToggle.checked = Boolean(draft.style.justify)
    }
    renderAllChoices()
    await restyleNow()
    setStatus('已恢复上次整理的文字，可直接换样式。')
  }
  else {
    renderAllChoices()
  }
}

boot()
