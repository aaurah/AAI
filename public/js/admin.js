/* AAI Admin Panel — Client JS */
(function () {
  'use strict';

  // ── Theme ──────────────────────────────────────────────────────────────────
  const THEME_KEY = 'aai_theme';
  const htmlRoot = document.getElementById('htmlRoot') || document.documentElement;
  const themeToggle = document.getElementById('themeToggle');
  const themeIcon = document.getElementById('themeIcon');

  function applyTheme(theme) {
    htmlRoot.setAttribute('data-theme', theme);
    if (themeIcon) {
      themeIcon.className = theme === 'light' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
    }
    // Bootstrap dark mode
    htmlRoot.setAttribute('data-bs-theme', theme === 'light' ? 'light' : 'dark');
    localStorage.setItem(THEME_KEY, theme);
  }

  // Load saved theme
  const savedTheme = localStorage.getItem(THEME_KEY) || 'dark';
  applyTheme(savedTheme);

  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const current = htmlRoot.getAttribute('data-theme') || 'dark';
      applyTheme(current === 'dark' ? 'light' : 'dark');
    });
  }

  // ── Sidebar toggle ────────────────────────────────────────────────────────
  const toggle = document.getElementById('sidebarToggle');
  const sidebar = document.getElementById('sidebar');

  // Mobile overlay
  const overlay = document.createElement('div');
  overlay.id = 'sidebarOverlay';
  document.body.appendChild(overlay);

  function openSidebar() {
    sidebar && sidebar.classList.add('open');
    overlay.classList.add('show');
  }
  function closeSidebar() {
    sidebar && sidebar.classList.remove('open');
    overlay.classList.remove('show');
  }

  if (toggle && sidebar) {
    toggle.addEventListener('click', () => {
      if (window.innerWidth <= 768) {
        sidebar.classList.contains('open') ? closeSidebar() : openSidebar();
      } else {
        // Collapse sidebar on desktop
        document.getElementById('main-content')?.classList.toggle('sidebar-collapsed');
      }
    });
  }
  overlay.addEventListener('click', closeSidebar);

  // ── Auto-dismiss flash alerts ─────────────────────────────────────────────
  document.querySelectorAll('.alert[role="alert"]').forEach((el) => {
    setTimeout(() => {
      try { bootstrap.Alert.getOrCreateInstance(el).close(); } catch {}
    }, 6000);
  });

  // ── SSE live feed ─────────────────────────────────────────────────────────
  const liveIndicator = document.getElementById('liveIndicator');
  const liveDot = liveIndicator?.querySelector('.live-dot');
  const auditFeed = document.getElementById('auditFeed');
  const ghFeed = document.getElementById('ghFeed');

  if (typeof EventSource !== 'undefined') {
    const evtSource = new EventSource('/events/stream');

    evtSource.onopen = () => { liveDot && liveDot.classList.add('connected'); };
    evtSource.onerror = () => { liveDot && liveDot.classList.remove('connected'); };

    evtSource.addEventListener('audit', (e) => {
      if (!auditFeed) return;
      const d = JSON.parse(e.data);
      const row = document.createElement('tr');
      row.style.animation = 'fadeInRow .4s ease';
      row.innerHTML = `
        <td><code class="text-info small">${d.action}</code></td>
        <td><span class="small">${d.username || '—'}</span></td>
        <td><span class="badge bg-${d.status === 'success' ? 'success' : d.status === 'failure' ? 'danger' : 'warning'}">${d.status}</span></td>
        <td><span class="badge sev-${d.severity}">${d.severity}</span></td>
        <td class="text-muted small">just now</td>`;
      auditFeed.prepend(row);
      // Keep max 15 rows
      while (auditFeed.children.length > 15) auditFeed.lastChild.remove();
    });

    evtSource.addEventListener('github', (e) => {
      if (!ghFeed) return;
      const d = JSON.parse(e.data);
      const item = document.createElement('li');
      item.className = 'list-group-item';
      item.style.animation = 'fadeInRow .4s ease';
      item.innerHTML = `
        <div class="d-flex align-items-start gap-2">
          ${d.senderAvatar ? `<img src="${d.senderAvatar}" class="avatar-xs mt-1" />` : '<i class="fa-brands fa-github mt-1"></i>'}
          <div>
            <div class="small fw-semibold text-truncate" style="max-width:220px">${d.title}</div>
            <div class="text-muted" style="font-size:.7rem"><span class="badge bg-dark text-muted me-1">${d.eventType}</span>just now</div>
          </div>
        </div>`;
      ghFeed.prepend(item);
      while (ghFeed.children.length > 5) ghFeed.lastChild.remove();
    });

    evtSource.addEventListener('notification', (e) => {
      const d = JSON.parse(e.data);
      updateNotifBadge(1, true);
      showToast(d.title, d.message, d.type || 'info');
    });
  }

  // ── Notification dropdown ─────────────────────────────────────────────────
  const notifBadge = document.getElementById('notifBadge');
  const notifList = document.getElementById('notifList');
  const markAllReadBtn = document.getElementById('markAllRead');

  function updateNotifBadge(count, increment) {
    if (!notifBadge) return;
    if (increment) {
      const cur = parseInt(notifBadge.textContent) || 0;
      count = cur + count;
    }
    notifBadge.textContent = count;
    notifBadge.style.display = count > 0 ? 'flex' : 'none';
  }

  async function loadNotifications() {
    if (!notifList) return;
    try {
      const countRes = await fetch('/notifications/count');
      const { count } = await countRes.json();
      updateNotifBadge(count);
      notifList.innerHTML = count === 0
        ? '<div class="text-center text-muted py-3 small">No unread notifications</div>'
        : `<div class="text-center text-muted py-3 small">${count} unread — <a href="/notifications">View all</a></div>`;
    } catch {}
  }

  // Load count on page load
  loadNotifications();

  if (markAllReadBtn) {
    markAllReadBtn.addEventListener('click', async () => {
      await fetch('/notifications/read-all', { method: 'POST' });
      updateNotifBadge(0);
      if (notifList) notifList.innerHTML = '<div class="text-center text-muted py-3 small">No unread notifications</div>';
    });
  }

  // ── Toast notifications ───────────────────────────────────────────────────
  function showToast(title, message, type) {
    let container = document.getElementById('toastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toastContainer';
      container.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:8px';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast show align-items-center text-bg-${type === 'danger' ? 'danger' : type === 'success' ? 'success' : type === 'warning' ? 'warning' : 'primary'} border-0`;
    toast.style.animation = 'slideInToast .3s ease';
    toast.innerHTML = `<div class="d-flex"><div class="toast-body"><strong>${title}</strong>${message ? '<br><small>' + message + '</small>' : ''}</div><button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>`;
    container.appendChild(toast);
    setTimeout(() => { toast.style.animation = 'fadeOut .3s ease forwards'; setTimeout(() => toast.remove(), 300); }, 5000);
  }

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
    if (e.key === 'g' && !e.ctrlKey && !e.metaKey) {
      // g+d = dashboard, g+u = users, g+a = audit
      window._gKey = true;
      setTimeout(() => { window._gKey = false; }, 1000);
    }
    if (window._gKey) {
      const map = { d: '/dashboard', u: '/users', r: '/roles', k: '/apikeys', l: '/audit', s: '/settings', h: '/system' };
      if (map[e.key]) { window.location.href = map[e.key]; window._gKey = false; }
    }
    if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
      const search = document.querySelector('input[name="q"]');
      if (search) { e.preventDefault(); search.focus(); }
    }
  });

  // ── Confirm before POST forms with data-confirm ───────────────────────────
  document.querySelectorAll('form[data-confirm]').forEach((form) => {
    form.addEventListener('submit', (e) => {
      if (!confirm(form.dataset.confirm)) e.preventDefault();
    });
  });
})();

/* ── CSS animations ──────────────────────────────────────────────────────── */
const _style = document.createElement('style');
_style.textContent = `
  @keyframes fadeInRow { from { opacity:0; background:rgba(59,125,221,.15); } to { opacity:1; background:transparent; } }
  @keyframes slideInToast { from { opacity:0; transform:translateX(20px); } to { opacity:1; transform:translateX(0); } }
  @keyframes fadeOut { to { opacity:0; transform:translateX(20px); } }
`;
document.head.appendChild(_style);
