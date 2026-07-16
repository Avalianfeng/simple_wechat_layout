const el = {
  whoami: document.getElementById('whoami'),
  quotaText: document.getElementById('quotaText'),
  usageList: document.getElementById('usageList'),
  usageEmpty: document.getElementById('usageEmpty'),
  historyList: document.getElementById('historyList'),
  historyEmpty: document.getElementById('historyEmpty'),
  historyLimit: document.getElementById('historyLimit'),
  oldPassword: document.getElementById('oldPassword'),
  newPassword: document.getElementById('newPassword'),
  pwdBtn: document.getElementById('pwdBtn'),
  pwdStatus: document.getElementById('pwdStatus'),
  logoutBtn: document.getElementById('logoutBtn'),
}

function quotaLabel(q) {
  if (!q?.aiEnabled) return 'AI 整理未开通，可用「已有 Markdown」排版。'
  if (q.unlimited) return `不限次数 · 今日已用 ${q.usedToday} 次`
  return `今日已用 ${q.usedToday} / ${q.dailyAiLimit} 次 · 剩余 ${q.remainingToday} 次`
}

async function loadHistory() {
  const res = await fetch('/api/history', { credentials: 'same-origin' })
  if (!res.ok) return
  const data = await res.json()
  if (el.historyLimit) el.historyLimit.textContent = String(data.limit || 10)
  const items = data.items || []
  el.historyList.innerHTML = ''
  if (!items.length) {
    el.historyEmpty.hidden = false
    return
  }
  el.historyEmpty.hidden = true
  for (const it of items) {
    const li = document.createElement('li')
    const meta = document.createElement('div')
    meta.textContent = [
      it.createdAt?.replace('T', ' ').slice(0, 19) || '',
      it.title,
      it.imageCount ? `${it.imageCount} 图` : '',
    ].filter(Boolean).join(' · ')

    const actions = document.createElement('div')
    actions.className = 'history-actions'
    const open = document.createElement('a')
    open.className = 'link-btn'
    open.href = `/?history=${it.id}`
    open.textContent = '打开'
    const del = document.createElement('button')
    del.type = 'button'
    del.className = 'link-btn'
    del.textContent = '删除'
    del.addEventListener('click', async () => {
      if (!confirm(`删除「${it.title}」？相关图片若不再被引用也会删掉。`)) return
      const r = await fetch(`/api/history/${it.id}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        alert(j.error || '删除失败')
        return
      }
      await loadHistory()
    })
    actions.append(open, del)
    li.append(meta, actions)
    el.historyList.appendChild(li)
  }
}

async function boot() {
  const res = await fetch('/api/me', { credentials: 'same-origin' })
  if (res.status === 401) {
    location.href = '/?login=1'
    return
  }
  const data = await res.json()
  el.whoami.textContent = data.user?.username || ''
  el.quotaText.textContent = quotaLabel(data.quota)

  await loadHistory()

  const usageRes = await fetch('/api/me/usage?limit=50', { credentials: 'same-origin' })
  const usageData = await usageRes.json()
  const items = usageData.items || []
  el.usageList.innerHTML = ''
  if (!items.length) {
    el.usageEmpty.hidden = false
  }
  else {
    el.usageEmpty.hidden = true
    for (const it of items) {
      const li = document.createElement('li')
      const ok = it.status === 'ok'
      li.className = ok ? '' : 'fail'
      li.textContent = [
        it.createdAt?.replace('T', ' ').slice(0, 19) || '',
        ok ? '成功' : `失败(${it.errorCode || ''})`,
        `${it.totalTokens} tokens`,
        it.estimatedCost,
        it.chunks > 1 ? `${it.chunks}段` : '',
        it.retries ? `重试${it.retries}` : '',
      ].filter(Boolean).join(' · ')
      el.usageList.appendChild(li)
    }
  }
}

el.pwdBtn.addEventListener('click', async () => {
  el.pwdStatus.textContent = '保存中…'
  el.pwdStatus.classList.remove('error')
  try {
    const res = await fetch('/api/auth/password', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        oldPassword: el.oldPassword.value,
        newPassword: el.newPassword.value,
      }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || '修改失败')
    el.pwdStatus.textContent = '密码已更新'
    el.oldPassword.value = ''
    el.newPassword.value = ''
  }
  catch (e) {
    el.pwdStatus.textContent = e.message || '修改失败'
    el.pwdStatus.classList.add('error')
  }
})

el.logoutBtn.addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
  location.href = '/'
})

boot().catch(() => {
  el.whoami.textContent = '加载失败'
})
