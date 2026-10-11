// js/public.js
// 公共主页：活动状态、阵营分、人数、今日规则、存活墙、赢家

import { supabase } from './supabase.js';
import { getSession, signOut } from './auth.js';
import { qs, escapeHtml, emptyState } from './utils.js';

const POLL_INTERVAL = 5000;

let pollTimer = null;
let isAdminUser = false;
let sectionVisibility = {};
let lastAliveWallKey = '';
let lastStatusKey = '';

/* ============================================================
   可见性
   ============================================================ */

async function initVisibility() {
  const session = await getSession();
  if (session) {
    const { data } = await supabase.rpc('is_admin');
    isAdminUser = data === true;
  }

  const { data: vis } = await supabase.rpc('get_home_section_visibility');
  sectionVisibility = (vis && typeof vis === 'object') ? vis : {};

  applySectionVisibility();
}

function applySectionVisibility() {
  document.querySelectorAll('[data-section]').forEach(el => {
    const key = el.dataset.section;
    if (key === 'winner') return; // winner 由 renderWinner 处理

    const visible = sectionVisibility[key] !== false;
    el.style.display = (isAdminUser || visible) ? '' : 'none';
  });
}

/* ============================================================
   加载数据
   ============================================================ */

async function loadPublicHome() {
  const { data, error } = await supabase.rpc('get_public_home');

  if (error) {
    console.error('加载公共主页失败:', error);
    const statusEl = qs('status-text');
    if (statusEl) statusEl.textContent = '加载失败';
    return;
  }

  if (!data || !data.event) {
    const statusEl = qs('status-text');
    if (statusEl) statusEl.textContent = '活动尚未创建';
    return;
  }

  renderEvent(data);
  renderColleges(data.colleges || []);
  renderCounts(data);
  renderTodayRule(data.today_rule);
  renderAliveWall(data.alive_wall || []);
  renderWinner(data);
}

/* ============================================================
   渲染
   ============================================================ */

function renderEvent(data) {
  const statusMap = {
    draft: '未开始',
    active: '进行中',
    paused: '已暂停',
    ended: '已结束',
  };
  const badgeCls = {
    draft: 'badge-neutral',
    active: 'badge-success',
    paused: 'badge-warning',
    ended: 'badge-neutral',
  };
  const status = data.event.status;

  const statusEl = qs('status-text');
  if (statusEl) {
    statusEl.innerHTML =
      `<span class="badge ${badgeCls[status] || 'badge-neutral'}">` +
      `<span class="dot"></span>${escapeHtml(statusMap[status] || status)}</span>`;
  }

  const dayEl = qs('day-text');
  if (dayEl) {
    dayEl.textContent = status === 'active' && data.event.current_day
      ? `第 ${data.event.current_day} 天`
      : '';
  }
}

function renderColleges(colleges) {
  const el = qs('colleges-list');
  if (!el) return;

  if (!colleges.length) {
    el.innerHTML = emptyState({ title: '暂无阵营数据' });
    return;
  }

  el.innerHTML = colleges.map(c => `
    <div class="college-card" style="border-color:${escapeHtml(c.color || '#555')}">
      <div class="college-name" style="background:${escapeHtml(c.color || '#555')}">
        ${escapeHtml(c.name)}
      </div>
      <div class="college-score">${c.score ?? 0}</div>
    </div>
  `).join('');
}

function renderCounts(data) {
  const alive = qs('alive-count');
  const elim = qs('eliminated-count');
  if (alive) alive.textContent = data.alive_count ?? 0;
  if (elim) elim.textContent = data.eliminated_count ?? 0;
}

function renderTodayRule(rule) {
  const titleEl = qs('rule-title');
  const contentEl = qs('rule-content');
  if (!titleEl || !contentEl) return;

  if (!rule) {
    titleEl.textContent = '今日无特殊规则';
    contentEl.textContent = '';
    return;
  }
  titleEl.textContent = rule.title || '';
  contentEl.textContent = rule.content || '';
}

function renderAliveWall(list) {
  const el = qs('alive-wall-list');
  if (!el) return;

  // 数据指纹：避免无变化重绘
  const key = list.map(p => `${p.id}|${p.photo_url || ''}|${p.name}|${p.college_name || ''}`).join(',');
  if (key === lastAliveWallKey) return;
  lastAliveWallKey = key;

  if (!list.length) {
    el.innerHTML = emptyState({
      icon: 'user',
      title: '暂无存活者',
    });
    return;
  }

  el.innerHTML = list.map(p => `
    <div class="wall-item">
      <img src="${escapeHtml(p.photo_url || 'assets/placeholder.png')}"
           alt="${escapeHtml(p.name)}"
           loading="lazy"
           onerror="this.onerror=null;this.src='assets/placeholder.png'">
      <div class="wall-name">${escapeHtml(p.name)}</div>
      <div class="wall-college" style="color:${escapeHtml(p.color || '')}">
        ${escapeHtml(p.college_name || '')}
      </div>
    </div>
  `).join('');
}

function renderWinner(data) {
  const el = qs('winner');
  if (!el) return;

  if (data.event.status !== 'ended') {
    el.style.display = 'none';
    return;
  }

  // 可见性由后端配置决定；管理员始终可见
  if (!isAdminUser && sectionVisibility['winner'] === false) {
    el.style.display = 'none';
    return;
  }

  el.style.display = '';

  const winner = data.winner;
  const college = data.winning_college;

  let html = '';
  if (winner) {
    html += `
      <div class="winner-card">
        <img src="${escapeHtml(winner.photo_url || 'assets/placeholder.png')}"
             alt="${escapeHtml(winner.name)}"
             onerror="this.onerror=null;this.src='assets/placeholder.png'">
        <div>
          <div class="winner-label">个人赢家</div>
          <div class="winner-name">${escapeHtml(winner.name)}</div>
          <div class="winner-college">${escapeHtml(winner.college_name || '')}</div>
        </div>
      </div>
    `;
  }
  if (college) {
    html += `
      <div class="winner-card">
        <div>
          <div class="winner-label">阵营赢家</div>
          <div class="winner-name">${escapeHtml(college.name)}</div>
          <div class="winner-college">${college.score} 分</div>
        </div>
      </div>
    `;
  }

  const content = qs('winner-content');
  if (content) {
    content.innerHTML = html || '<p class="hint">暂无赢家数据。</p>';
  }
}

/* ============================================================
   导航
   ============================================================ */

async function updateNav() {
  const session = await getSession();
  const navLogin = qs('nav-login');
  const navAdmin = qs('nav-admin');
  const navLogout = qs('nav-logout');
  if (!navLogin || !navAdmin || !navLogout) return;

  if (session) {
    const { data } = await supabase.rpc('is_admin');
    if (data === true) {
      navLogin.style.display = 'none';
      navAdmin.style.display = '';
      navLogout.style.display = '';
    } else {
      // 非管理员登录状态：静默退出
      await supabase.auth.signOut();
      navLogin.style.display = '';
      navAdmin.style.display = 'none';
      navLogout.style.display = 'none';
    }
  } else {
    navLogin.style.display = '';
    navAdmin.style.display = 'none';
    navLogout.style.display = 'none';
  }
}

/* ============================================================
   轮询 / 启动
   ============================================================ */

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(loadPublicHome, POLL_INTERVAL);
}

// 页面不可见时暂停轮询
function bindVisibilityChange() {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    } else {
      loadPublicHome();
      startPolling();
    }
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  qs('nav-logout')?.addEventListener('click', (e) => {
    e.preventDefault();
    signOut();
  });

  await initVisibility();
  await updateNav();
  await loadPublicHome();
  startPolling();
  bindVisibilityChange();
});