const TOKEN_KEY = 'swl_admin_token'

const el = {
  loginCard: document.getElementById('loginCard'),
  usersCard: document.getElementById('usersCard'),
  adminToken: document.getElementById('adminToken'),
  adminLoginBtn: document.getElementById('adminLoginBtn'),
  adminLoginStatus: document.getElementById('adminLoginStatus'),
  refreshBtn: document.getElementById('refreshBtn'),
  adminLogoutBtn: document.getElementById('adminLogoutBtn'),
  usersTable: document.getElementById('usersTable'),
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

function renderUsers(users) {
  const tbody = el.usersTable.querySelector('tbody')
  tbody.innerHTML = ''
  for (const u of users) {
    const tr = document.createElement('tr')
    const limitVal = u.unlimited ? '' : String(u.dailyAiLimit)
    tr.innerHTML = `
      <td>${u.id}</td>
      <td>${escapeHtml(u.username)}</td>
      <td><input type="checkbox" data-ai ${u.aiEnabled ? 'checked' : ''} /></td>
      <td class="limit-cell">
        <label class="check tiny"><input type="checkbox" data-unlimited ${u.unlimited ? 'checked' : ''} /> 不限</label>
        <input type="number" class="text-input tiny-input" data-limit min="0" max="10000" value="${escapeAttr(limitVal)}" ${u.unlimited ? 'disabled' : ''} />
      </td>
      <td>${u.usedToday}</td>
      <td>${escapeHtml(u.totalEstimatedCost)}</td>
      <td>${u.status === 'active' ? '正常' : '禁用'}</td>
      <td class="ops">
        <button type="button" class="btn btn-secondary btn-sm" data-save>保存</button>
        <button type="button" class="btn btn-secondary btn-sm" data-toggle-status>
          ${u.status === 'active' ? '禁用' : '启用'}
        </button>
      </td>
    `
    const unlimitedBox = tr.querySelector('[data-unlimited]')
    const limitInput = tr.querySelector('[data-limit]')
    unlimitedBox.addEventListener('change', () => {
      limitInput.disabled = unlimitedBox.checked
      if (unlimitedBox.checked) limitInput.value = ''
    })
    tr.querySelector('[data-save]').addEventListener('click', async () => {
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
        await loadUsers()
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
        await loadUsers()
      }
      catch (e) {
        el.adminStatus.textContent = e.message || '操作失败'
        el.adminStatus.classList.add('error')
      }
    })
    tbody.appendChild(tr)
  }
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

async function loadUsers() {
  el.adminStatus.classList.remove('error')
  const data = await api('/api/admin/users')
  renderUsers(data.users || [])
}

function showApp() {
  el.loginCard.hidden = true
  el.usersCard.hidden = false
}

function showLogin() {
  el.loginCard.hidden = false
  el.usersCard.hidden = true
}

el.adminLoginBtn.addEventListener('click', async () => {
  setToken(el.adminToken.value.trim())
  el.adminLoginStatus.textContent = '校验中…'
  el.adminLoginStatus.classList.remove('error')
  try {
    await loadUsers()
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
  loadUsers().catch((e) => {
    el.adminStatus.textContent = e.message
    el.adminStatus.classList.add('error')
  })
})

el.adminLogoutBtn.addEventListener('click', () => {
  setToken('')
  showLogin()
})

if (getToken()) {
  loadUsers().then(showApp).catch(() => {
    setToken('')
    showLogin()
  })
}
