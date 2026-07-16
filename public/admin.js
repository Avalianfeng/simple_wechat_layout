const TOKEN_KEY = 'swl_admin_token'

const el = {
  loginCard: document.getElementById('loginCard'),
  adminApp: document.getElementById('adminApp'),
  adminToken: document.getElementById('adminToken'),
  adminLoginBtn: document.getElementById('adminLoginBtn'),
  adminLoginStatus: document.getElementById('adminLoginStatus'),
  refreshBtn: document.getElementById('refreshBtn'),
  adminLogoutBtn: document.getElementById('adminLogoutBtn'),
  overviewBody: document.getElementById('overviewBody'),
  usersTable: document.getElementById('usersTable'),
  userUsagePanel: document.getElementById('userUsagePanel'),
  userUsageTitle: document.getElementById('userUsageTitle'),
  userUsageList: document.getElementById('userUsageList'),
  userUsageEmpty: document.getElementById('userUsageEmpty'),
  ipsHint: document.getElementById('ipsHint'),
  todayIpsTable: document.getElementById('todayIpsTable'),
  bansTable: document.getElementById('bansTable'),
  bansEmpty: document.getElementById('bansEmpty'),
  banIpInput: document.getElementById('banIpInput'),
  banReasonInput: document.getElementById('banReasonInput'),
  banIpBtn: document.getElementById('banIpBtn'),
  adminStatus: document.getElementById('adminStatus'),
}

function getToken() {
  return sessionStorage.getItem(TOKEN_KEY) || ''
}

function setToken(t) {
  if (t) sessionStorage.setItem(TOKEN_KEY, t)
  else sessionStorage.removeItem(TOKEN_KEY)
}

async function api(path, opts = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Admin-Token': getToken(),
    ...(opts.headers || {}),
  }
  const res = await fetch(path, { ...opts, headers })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error || '请求失败')
    err.code = data.code
    err.status = res.status
    throw err
  }
  return data
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;')
}

function fmtTime(s) {
  if (!s) return '—'
  return String(s).replace('T', ' ').slice(0, 19)
}

function renderOverview(data) {
  const c = data.config || {}
  const u = data.users || {}
  const t = data.today || {}
  const fail = (t.failBreakdown || [])
    .map((f) => `${f.code}×${f.count}`)
    .join(' · ') || '无'

  const limitLabel = c.defaultDailyAiLimit === -1
    ? '不限'
    : `${c.defaultDailyAiLimit} 次/日`

  el.overviewBody.innerHTML = `
    <dl class="overview-grid">
      <div><dt>默认日额度</dt><dd>${escapeHtml(limitLabel)}</dd></div>
      <div><dt>邀请码</dt><dd>${c.inviteRequired ? '已开启' : '未开启'}</dd></div>
      <div><dt>同 IP 日注册上限</dt><dd>${c.registerPerIpPerDay === 0 ? '不限' : c.registerPerIpPerDay}</dd></div>
      <div><dt>历史篇数上限</dt><dd>${c.historyLimit ?? '—'}</dd></div>
      <div><dt>模型</dt><dd>${escapeHtml(c.model || '—')}</dd></div>
      <div><dt>API Key</dt><dd>${c.hasApiKey ? '已配置' : '未配置'}</dd></div>
      <div><dt>用户</dt><dd>${u.total || 0}（正常 ${u.active || 0} / 禁用 ${u.disabled || 0}）</dd></div>
      <div><dt>封禁 IP</dt><dd>${data.bannedIpCount || 0}</dd></div>
      <div><dt>今日注册</dt><dd>${t.registers || 0}</dd></div>
      <div><dt>今日 AI</dt><dd>成功 ${t.aiOk || 0} · 失败 ${t.aiFail || 0}</dd></div>
      <div><dt>今日 tokens</dt><dd>${t.tokens || 0}</dd></div>
      <div><dt>今日参考花费</dt><dd>${escapeHtml(t.estimatedCost || '¥0')}</dd></div>
      <div class="span-2"><dt>今日失败码</dt><dd>${escapeHtml(fail)}</dd></div>
      <div class="span-2"><dt>计价（元/百万）</dt><dd>命中 ${c.prices?.inputCacheHitPerMillion ?? '—'} · 未命中 ${c.prices?.inputCacheMissPerMillion ?? '—'} · 输出 ${c.prices?.outputPerMillion ?? '—'}</dd></div>
    </dl>
    <p class="hint tiny">统计日：${escapeHtml(data.dayKey || '')}（上海时区）</p>
  `
}

function renderUsers(users) {
  const tbody = el.usersTable.querySelector('tbody')
  tbody.innerHTML = ''
  for (const u of users) {
    const tr = document.createElement('tr')
    const limitVal = u.unlimited ? '' : String(u.dailyAiLimit)
    tr.innerHTML = `
      <td>${u.id}</td>
      <td>${escapeHtml(u.username)}</td>
      <td class="mono">${escapeHtml(u.registerIp || '—')}</td>
      <td><input type="checkbox" data-ai ${u.aiEnabled ? 'checked' : ''} /></td>
      <td class="limit-cell">
        <label class="check tiny"><input type="checkbox" data-unlimited ${u.unlimited ? 'checked' : ''} /> 不限</label>
        <input type="number" class="text-input tiny-input" data-limit min="0" max="10000" value="${escapeAttr(limitVal)}" ${u.unlimited ? 'disabled' : ''} />
      </td>
      <td>${u.usedToday}${u.quotaResetToday && u.rawUsedToday !== u.usedToday ? `<br><span class="tiny">实记 ${u.rawUsedToday}</span>` : ''}</td>
      <td>${escapeHtml(u.totalEstimatedCost)}<br><span class="tiny">${u.totalTokens} tok · 成${u.okCount}/败${u.failCount}</span></td>
      <td class="tiny">${escapeHtml(fmtTime(u.lastAiAt))}</td>
      <td>${u.status === 'active' ? '正常' : '禁用'}</td>
      <td class="ops">
        <button type="button" class="btn btn-secondary btn-sm" data-save>保存</button>
        <button type="button" class="btn btn-secondary btn-sm" data-toggle-status>
          ${u.status === 'active' ? '禁用' : '启用'}
        </button>
        <button type="button" class="btn btn-secondary btn-sm" data-reset-today title="清空今日已用次数，用量记录保留">重置今日</button>
        <button type="button" class="btn btn-secondary btn-sm" data-usage>明细</button>
      </td>
    `
    const unlimitedBox = tr.querySelector('[data-unlimited]')
    const limitInput = tr.querySelector('[data-limit]')
    unlimitedBox.addEventListener('change', () => {
      limitInput.disabled = unlimitedBox.checked
      if (unlimitedBox.checked) limitInput.value = ''
    })
    tr.querySelector('[data-save]').addEventListener('click', async () => {
      el.adminStatus.classList.remove('error')
      el.adminStatus.textContent = '保存中…'
      try {
        const dailyAiLimit = unlimitedBox.checked
          ? -1
          : Number(limitInput.value)
        await api(`/api/admin/users/${u.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            aiEnabled: tr.querySelector('[data-ai]').checked,
            dailyAiLimit,
          }),
        })
        el.adminStatus.textContent = `已保存 ${u.username}`
        await loadAll()
      }
      catch (e) {
        el.adminStatus.textContent = e.message || '保存失败'
        el.adminStatus.classList.add('error')
      }
    })
    tr.querySelector('[data-toggle-status]').addEventListener('click', async () => {
      try {
        await api(`/api/admin/users/${u.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            status: u.status === 'active' ? 'disabled' : 'active',
          }),
        })
        await loadAll()
      }
      catch (e) {
        el.adminStatus.textContent = e.message || '操作失败'
        el.adminStatus.classList.add('error')
      }
    })
    tr.querySelector('[data-reset-today]').addEventListener('click', async () => {
      if (!confirm(`重置「${u.username}」今日 AI 已用次数？用量记录会保留，仅重新放行额度。`)) return
      el.adminStatus.classList.remove('error')
      try {
        await api(`/api/admin/users/${u.id}/reset-today`, { method: 'POST', body: '{}' })
        el.adminStatus.textContent = `已重置 ${u.username} 今日额度`
        await loadAll()
      }
      catch (e) {
        el.adminStatus.textContent = e.message || '重置失败'
        el.adminStatus.classList.add('error')
      }
    })
    tr.querySelector('[data-usage]').addEventListener('click', () => {
      loadUserUsage(u.id, u.username)
    })
    tbody.appendChild(tr)
  }
}

async function loadUserUsage(userId, username) {
  el.userUsagePanel.hidden = false
  el.userUsageTitle.textContent = `用量明细 · ${username}`
  el.userUsageList.innerHTML = ''
  el.userUsageEmpty.hidden = true
  try {
    const data = await api(`/api/admin/users/${userId}/usage?limit=30`)
    const items = data.items || []
    if (!items.length) {
      el.userUsageEmpty.hidden = false
      return
    }
    for (const it of items) {
      const li = document.createElement('li')
      const ok = it.status === 'ok'
      li.className = ok ? '' : 'fail'
      li.textContent = [
        fmtTime(it.createdAt),
        ok ? '成功' : `失败(${it.errorCode || ''})`,
        `${it.totalTokens} tokens`,
        it.estimatedCost,
        it.chunks > 1 ? `${it.chunks}段` : '',
      ].filter(Boolean).join(' · ')
      el.userUsageList.appendChild(li)
    }
  }
  catch (e) {
    el.userUsageEmpty.hidden = false
    el.userUsageEmpty.textContent = e.message || '加载失败'
  }
}

function renderIps(data) {
  const per = data.registerPerIpPerDay
  el.ipsHint.textContent = `今日 ${data.dayKey} · 同 IP 日注册上限 ${per === 0 ? '不限' : per} · 封禁后禁止注册 / 登录 / AI 整理 · 「重置今日」可清空该 IP 今日注册计数`

  const todayBody = el.todayIpsTable.querySelector('tbody')
  todayBody.innerHTML = ''
  for (const row of data.today || []) {
    const tr = document.createElement('tr')
    const flags = [
      row.capped ? '已触顶' : '',
      row.banned ? '已封禁' : '',
    ].filter(Boolean).join(' · ') || '正常'
    tr.innerHTML = `
      <td class="mono">${escapeHtml(row.ip)}</td>
      <td>${row.count}</td>
      <td>${escapeHtml(flags)}</td>
      <td class="ops"></td>
    `
    const ops = tr.querySelector('.ops')
    const resetBtn = document.createElement('button')
    resetBtn.type = 'button'
    resetBtn.className = 'btn btn-secondary btn-sm'
    resetBtn.textContent = '重置今日'
    resetBtn.title = '清空该 IP 今日注册计数'
    resetBtn.addEventListener('click', () => doResetIpToday(row.ip))
    ops.append(resetBtn)

    if (row.banned) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'btn btn-secondary btn-sm'
      btn.textContent = '解封'
      btn.addEventListener('click', () => doUnban(row.ip))
      ops.append(btn)
    }
    else {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'btn btn-secondary btn-sm'
      btn.textContent = '封禁'
      btn.addEventListener('click', () => doBan(row.ip))
      ops.append(btn)
    }
    todayBody.appendChild(tr)
  }
  if (!(data.today || []).length) {
    const tr = document.createElement('tr')
    tr.innerHTML = '<td colspan="4" class="hint">今日尚无注册记录</td>'
    todayBody.appendChild(tr)
  }

  const bansBody = el.bansTable.querySelector('tbody')
  bansBody.innerHTML = ''
  const bans = data.bans || []
  el.bansEmpty.hidden = bans.length > 0
  for (const b of bans) {
    const tr = document.createElement('tr')
    tr.innerHTML = `
      <td class="mono">${escapeHtml(b.ip)}</td>
      <td>${escapeHtml(b.reason || '—')}</td>
      <td class="tiny">${escapeHtml(fmtTime(b.createdAt))}</td>
      <td class="ops"></td>
    `
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'btn btn-secondary btn-sm'
    btn.textContent = '解封'
    btn.addEventListener('click', () => doUnban(b.ip))
    tr.querySelector('.ops').append(btn)
    bansBody.appendChild(tr)
  }
}

async function doBan(ip, reason = '') {
  el.adminStatus.classList.remove('error')
  try {
    const data = await api('/api/admin/ips/ban', {
      method: 'POST',
      body: JSON.stringify({ ip, reason }),
    })
    renderIps(data.ips)
    el.adminStatus.textContent = `已封禁 ${ip}`
  }
  catch (e) {
    el.adminStatus.textContent = e.message || '封禁失败'
    el.adminStatus.classList.add('error')
  }
}

async function doUnban(ip) {
  el.adminStatus.classList.remove('error')
  try {
    const data = await api('/api/admin/ips/ban', {
      method: 'DELETE',
      body: JSON.stringify({ ip }),
    })
    renderIps(data.ips)
    el.adminStatus.textContent = `已解封 ${ip}`
  }
  catch (e) {
    el.adminStatus.textContent = e.message || '解封失败'
    el.adminStatus.classList.add('error')
  }
}

async function doResetIpToday(ip) {
  if (!confirm(`清空 IP ${ip} 的今日注册计数？清空后可再次注册。`)) return
  el.adminStatus.classList.remove('error')
  try {
    const data = await api('/api/admin/ips/reset-today', {
      method: 'POST',
      body: JSON.stringify({ ip }),
    })
    renderIps(data.ips)
    el.adminStatus.textContent = `已重置 ${ip} 今日注册计数`
  }
  catch (e) {
    el.adminStatus.textContent = e.message || '重置失败'
    el.adminStatus.classList.add('error')
  }
}

async function loadAll() {
  el.adminStatus.classList.remove('error')
  const [overview, usersData, ips] = await Promise.all([
    api('/api/admin/overview'),
    api('/api/admin/users'),
    api('/api/admin/ips'),
  ])
  renderOverview(overview)
  renderUsers(usersData.users || [])
  renderIps(ips)
}

function showApp() {
  el.loginCard.hidden = true
  el.adminApp.hidden = false
}

function showLogin() {
  el.loginCard.hidden = false
  el.adminApp.hidden = true
  el.userUsagePanel.hidden = true
}

el.adminLoginBtn.addEventListener('click', async () => {
  setToken(el.adminToken.value.trim())
  el.adminLoginStatus.textContent = '校验中…'
  el.adminLoginStatus.classList.remove('error')
  try {
    await loadAll()
    showApp()
    el.adminLoginStatus.textContent = ''
  }
  catch (e) {
    setToken('')
    el.adminLoginStatus.textContent = e.message || '令牌无效'
    el.adminLoginStatus.classList.add('error')
  }
})

el.refreshBtn.addEventListener('click', () => {
  loadAll().catch((e) => {
    el.adminStatus.textContent = e.message
    el.adminStatus.classList.add('error')
  })
})

el.adminLogoutBtn.addEventListener('click', () => {
  setToken('')
  showLogin()
})

el.banIpBtn.addEventListener('click', () => {
  const ip = el.banIpInput.value.trim()
  if (!ip) {
    el.adminStatus.textContent = '请填写 IP'
    el.adminStatus.classList.add('error')
    return
  }
  doBan(ip, el.banReasonInput.value.trim()).then(() => {
    el.banIpInput.value = ''
    el.banReasonInput.value = ''
  })
})

if (getToken()) {
  loadAll().then(showApp).catch(() => {
    setToken('')
    showLogin()
  })
}
