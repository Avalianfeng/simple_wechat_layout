/** @typedef {{ filename: string, url: string }} UploadedImage */

const STORAGE_KEY = 'swl_draft_v1'

/** @type {'text' | 'markdown'} */
let inputMode = 'text'

/** @type {UploadedImage[]} */
let uploaded = []

/** @type {string} */
let lastHtml = ''

/** @type {string} */
let lastMarkdown = ''

/** @type {{ index: number, alt: string, url: string }[]} */
let lastImages = []

/** @type {object | null} */
let me = null

let options = {
  themes: [],
  colors: [],
  fonts: [],
  fontSizes: [],
  defaults: {},
  limits: {},
}

let selectedTheme = 'grace'
let selectedColor = '#07c160'
let selectedFont = ''
let selectedSize = '16px'
let restyleTimer = 0
let restyling = false
/** @type {'login' | 'register'} */
let authMode = 'login'

const el = {
  text: document.getElementById('text'),
  textLabel: document.getElementById('textLabel'),
  modeHint: document.getElementById('modeHint'),
  quotaHint: document.getElementById('quotaHint'),
  modeBtns: document.querySelectorAll('.mode-btn:not([data-auth])'),
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
  authSummary: document.getElementById('authSummary'),
  accountLink: document.getElementById('accountLink'),
  loginOpenBtn: document.getElementById('loginOpenBtn'),
  logoutBtn: document.getElementById('logoutBtn'),
  guestHint: document.getElementById('guestHint'),
  guestLoginBtn: document.getElementById('guestLoginBtn'),
  editorCard: document.getElementById('editorCard'),
  authDialog: document.getElementById('authDialog'),
  authForm: document.getElementById('authForm'),
  authTitle: document.getElementById('authTitle'),
  authUsername: document.getElementById('authUsername'),
  authPassword: document.getElementById('authPassword'),
  authInvite: document.getElementById('authInvite'),
  inviteField: document.getElementById('inviteField'),
  authError: document.getElementById('authError'),
  authSubmit: document.getElementById('authSubmit'),
  authCancel: document.getElementById('authCancel'),
  authTabs: document.querySelectorAll('[data-auth]'),
  confirmDialog: document.getElementById('confirmDialog'),
  confirmText: document.getElementById('confirmText'),
  confirmOk: document.getElementById('confirmOk'),
  confirmCancel: document.getElementById('confirmCancel'),
  supportContact: document.getElementById('supportContact'),
  wechatId: document.getElementById('wechatId'),
  copyWechatBtn: document.getElementById('copyWechatBtn'),
  copyWechatStatus: document.getElementById('copyWechatStatus'),
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
    /* ignore */
  }
}

function quotaLabel(q) {
  if (!q) return ''
  if (!q.aiEnabled) return 'AI 未开通 · 可用「已有 Markdown」'
  if (q.unlimited) return `今日 AI：不限 · 已用 ${q.usedToday} 次`
  return `今日 AI：剩余 ${q.remainingToday} / ${q.dailyAiLimit} 次`
}

function applyMe(data) {
  me = data
  const loggedIn = Boolean(data?.user)
  el.loginOpenBtn.hidden = loggedIn
  el.logoutBtn.hidden = !loggedIn
  el.accountLink.hidden = !loggedIn
  el.guestHint.hidden = loggedIn
  el.editorCard.hidden = !loggedIn
  if (loggedIn) {
    el.authSummary.textContent = `${data.user.username} · ${quotaLabel(data.quota)}`
    el.quotaHint.hidden = false
    el.quotaHint.textContent = quotaLabel(data.quota)
  }
  else {
    el.authSummary.textContent = ''
    el.quotaHint.hidden = true
  }
}

async function refreshMe() {
  try {
    const res = await fetch('/api/me', { credentials: 'same-origin' })
    if (res.status === 401) {
      applyMe(null)
      return null
    }
    if (!res.ok) {
      applyMe(null)
      return null
    }
    const data = await res.json()
    applyMe(data)
    return data
  }
  catch {
    applyMe(null)
    return null
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
    el.modeHint.textContent = '不调用 AI、不占今日次数。贴好后点「直接预览」，再换主题 / 字体。'
  }
  else {
    el.textLabel.textContent = '把文章写在这里'
    el.text.placeholder = '直接敲字就行，不用管格式。有标题、段落也可以一起贴进来。'
    el.convertBtn.textContent = '整理文字'
    el.modeHint.textContent = 'AI 只整理格式（占 1 次今日额度）。整理后换样式不再调 AI。'
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

  if (data.quota) {
    if (me) me.quota = data.quota
    applyMe(me)
  }
}

async function restyleNow() {
  if (!lastMarkdown.trim()) return
  if (restyling) return
  if (!me?.user) return
  restyling = true
  setStyleStatus('正在换样子…')
  try {
    const res = await fetch('/api/render', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        markdown: lastMarkdown,
        style: currentStyle(),
      }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || '换样子失败')
    applyResult(data, { fromAi: false })
    setStyleStatus('样子已更新（文字未改动，未占用 AI）')
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

function openAuth(mode = 'login') {
  authMode = mode === 'register' ? 'register' : 'login'
  el.authTabs.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.auth === authMode)
  })
  el.authTitle.textContent = authMode === 'register' ? '注册' : '登录'
  el.authSubmit.textContent = authMode === 'register' ? '注册并登录' : '登录'
  el.authError.hidden = true
  const needInvite = Boolean(options.register?.inviteRequired)
  el.inviteField.hidden = !(authMode === 'register' && needInvite)
  if (el.authInvite) el.authInvite.required = authMode === 'register' && needInvite
  el.authDialog.showModal()
}

function askConfirm(message) {
  return new Promise((resolve) => {
    el.confirmText.textContent = message
    const onOk = () => {
      cleanup()
      resolve(true)
    }
    const onCancel = () => {
      cleanup()
      resolve(false)
    }
    const cleanup = () => {
      el.confirmOk.removeEventListener('click', onOk)
      el.confirmCancel.removeEventListener('click', onCancel)
      el.confirmDialog.close()
    }
    el.confirmOk.addEventListener('click', onOk)
    el.confirmCancel.addEventListener('click', onCancel)
    el.confirmDialog.showModal()
  })
}

function estimateChunkHint(textLen) {
  const chunkChars = options.limits?.chunkChars || 5500
  return Math.max(1, Math.ceil(textLen / chunkChars))
}

el.fileInput.addEventListener('change', async () => {
  if (!me?.user) {
    openAuth('login')
    return
  }
  const files = Array.from(el.fileInput.files || [])
  el.fileInput.value = ''
  if (!files.length) return

  setStatus('正在上传图片…')
  el.convertBtn.disabled = true
  try {
    const form = new FormData()
    files.forEach((f) => form.append('images', f))
    const res = await fetch('/api/upload', { method: 'POST', credentials: 'same-origin', body: form })
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
  if (!me?.user) {
    openAuth('login')
    return
  }

  const text = el.text.value
  if (!text.trim() && uploaded.length === 0) {
    setStatus(inputMode === 'markdown' ? '请先粘贴 Markdown，或上传图片' : '请先写一点文字，或上传图片', true)
    return
  }

  el.copyHint.hidden = true

  if (inputMode === 'markdown') {
    el.convertBtn.disabled = true
    setStatus('正在排版预览（不调用 AI）…')
    try {
      const res = await fetch('/api/render', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          markdown: text,
          imageUrls: uploaded.map((u) => u.url),
          style: currentStyle(),
          save: true,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '预览失败')
      applyResult(data, { fromMarkdown: true })
      let msg = 'Markdown 已锁定并保存到历史。下面可随意换主题 / 字体，不会调用 AI。'
      if (data.history?.removed?.length) {
        const t = data.history.removed.map((r) => r.title).join('、')
        msg += `（已满 ${data.history.limit} 条，已删除最早：${t}）`
      }
      setStatus(msg)
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

  const chunks = estimateChunkHint(text.length)
  const q = me.quota
  let confirmMsg = '将使用站点 AI 整理格式（只改结构不改内容），占用今日 1 次额度。'
  if (chunks > 1) {
    confirmMsg += `\n文章较长，约分 ${chunks} 段调用（仍只计 1 次日额度，但耗时与参考花费更高）。`
  }
  if (q && !q.unlimited) {
    confirmMsg += `\n今日剩余 ${q.remainingToday} / ${q.dailyAiLimit} 次。`
  }
  const ok = await askConfirm(confirmMsg)
  if (!ok) return

  el.convertBtn.disabled = true
  const charHint = text.length > 8000
    ? `（较长，约 ${Math.min(180, 60 + Math.floor(text.length / 800))} 秒内）`
    : ''
  setStatus(`正在整理文字（仅此一步会用 AI）${charHint}…`)

  try {
    const res = await fetch('/api/convert', {
      method: 'POST',
      credentials: 'same-origin',
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
    const tokens = data.usage?.total_tokens
      ?? ((data.usage?.prompt_tokens || 0) + (data.usage?.completion_tokens || 0))
    const cost = data.estimatedCost || ''
    const retryHint = data.retries ? `，含 ${data.retries} 次自动重试` : ''
    let msg = `整理完成并已保存历史。本次约 ${tokens || '—'} tokens，参考 ${cost || '—'}（本站不扣费${retryHint}）。换主题不再调 AI。`
    if (data.history?.removed?.length) {
      const t = data.history.removed.map((r) => r.title).join('、')
      msg += ` 已满 ${data.history.limit} 条，已删除最早：${t}。`
    }
    setStatus(msg)
    el.resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  catch (e) {
    setStatus(e.message || '整理失败', true)
    await refreshMe()
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

el.loginOpenBtn.addEventListener('click', () => openAuth('login'))
el.guestLoginBtn.addEventListener('click', () => openAuth('login'))
el.authCancel.addEventListener('click', () => el.authDialog.close())

el.authTabs.forEach((btn) => {
  btn.addEventListener('click', () => openAuth(btn.dataset.auth))
})

el.authForm.addEventListener('submit', async (ev) => {
  ev.preventDefault()
  el.authError.hidden = true
  const path = authMode === 'register' ? '/api/auth/register' : '/api/auth/login'
  try {
    const res = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: el.authUsername.value.trim(),
        password: el.authPassword.value,
        inviteCode: el.authInvite?.value?.trim() || undefined,
      }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || '失败')
    applyMe(data)
    el.authDialog.close()
    el.authPassword.value = ''
    setStatus(authMode === 'register' ? '注册成功，可以开始写文章了。' : '已登录。')
  }
  catch (e) {
    el.authError.textContent = e.message || '失败'
    el.authError.hidden = false
  }
})

el.logoutBtn.addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
  applyMe(null)
  setStatus('已退出登录。')
})

async function boot() {
  try {
    const res = await fetch('/api/options')
    if (res.ok) options = await res.json()
  }
  catch {
    /* defaults */
  }

  if (options.support?.wechat) {
    el.wechatId.textContent = options.support.wechat
  }

  el.copyWechatBtn?.addEventListener('click', async () => {
    const id = el.wechatId?.textContent?.trim() || ''
    if (!id) return
    try {
      await navigator.clipboard.writeText(id)
      el.copyWechatStatus.textContent = '已复制微信号'
    }
    catch {
      el.copyWechatStatus.textContent = '复制失败，请长按微信号手动复制'
    }
  })

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

  await refreshMe()

  const historyId = Number(new URLSearchParams(location.search).get('history') || 0)
  if (historyId && me?.user) {
    try {
      const res = await fetch(`/api/history/${historyId}`, { credentials: 'same-origin' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '无法打开历史')
      const art = data.article
      setInputMode('markdown')
      el.text.value = art.markdown || ''
      lastMarkdown = art.markdown || ''
      lastImages = art.images || []
      uploaded = (art.images || []).map((img) => ({
        filename: String(img.url || '').split('/').pop() || '',
        url: img.url,
      }))
      renderThumbs()
      if (art.style) {
        selectedTheme = art.style.theme || selectedTheme
        selectedColor = art.style.primaryColor || selectedColor
        selectedFont = art.style.fontFamily || selectedFont
        selectedSize = art.style.fontSize || selectedSize
        el.indentToggle.checked = Boolean(art.style.indent)
        el.justifyToggle.checked = Boolean(art.style.justify)
      }
      renderAllChoices()
      await restyleNow()
      setStatus(`已打开历史：${art.title || ''}`)
      history.replaceState({}, '', '/')
      return
    }
    catch (e) {
      setStatus(e.message || '打开历史失败', true)
    }
  }

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
    if (me?.user) {
      await restyleNow()
      setStatus('已恢复上次整理的文字，可直接换样式。')
    }
  }
  else {
    renderAllChoices()
  }

  if (new URLSearchParams(location.search).get('login') === '1') {
    openAuth('login')
  }
}

boot()
