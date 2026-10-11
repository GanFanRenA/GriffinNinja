// js/public.js
// 公共主页：活动状态、阵营分、人数、今日规则、存活墙、最终赢家

import { supabase } from './supabase.js';
import { getSession, signOut } from './auth.js';
import { qs, escapeHtml, formatTime, emptyState } from './utils.js';

const POLL_INTERVAL = 5000;

let pollTimer = null;
let isAdminUser = false;
let sectionVisibility = {};
let lastAliveWallKey = '';

// 赢家统计缓存（避免每次轮询都请求）
let winnerStatsCache = null;
let winnerStatsEventKey = null;

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

// 判断某个子开关是否可见
function isSubVisible(key) {
  if (isAdminUser) return true;
  return sectionVisibility[key] !== false;
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
  await renderWinner(data);
}

/* ============================================================
   渲染：状态 / 阵营 / 人数 / 规则 / 存活墙
   ============================================================ */

function renderEvent(data) {
  const statusMap = { draft: '未开始', active: '进行中', paused: '已暂停', ended: '已结束' };
  const badgeCls = { draft: 'badge-neutral', active: 'badge-success', paused: 'badge-warning', ended: 'badge-neutral' };
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

  const key = list.map(p => `${p.id}|${p.photo_url || ''}|${p.name}|${p.college_name || ''}`).join(',');
  if (key === lastAliveWallKey) return;
  lastAliveWallKey = key;

  if (!list.length) {
    el.innerHTML = emptyState({ icon: 'user', title: '暂无存活者' });
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

/* ============================================================
   最终赢家：4 个独立奖项
   ============================================================ */

async function loadWinnerStats(eventKey) {
  if (winnerStatsCache && winnerStatsEventKey === eventKey) {
    return winnerStatsCache;
  }

  const { data, error } = await supabase.rpc('get_winner_stats');
  if (error || data?.error) {
    console.error('get_winner_stats 失败:', error || data?.error);
    return null;
  }

  winnerStatsCache = data;
  winnerStatsEventKey = eventKey;
  return data;
}

async function renderWinner(data) {
  const el = qs('winner');
  if (!el) return;

  // 只在活动结束时显示
  if (data.event.status !== 'ended') {
    el.style.display = 'none';
    winnerStatsCache = null;
    winnerStatsEventKey = null;
    return;
  }

  // 总开关
  if (!isAdminUser && sectionVisibility['winner'] === false) {
    el.style.display = 'none';
    return;
  }

  el.style.display = '';

  const eventKey = data.event.id || 'default';
  const stats = await loadWinnerStats(eventKey);
  const contentEl = qs('winner-content');
  if (!contentEl) return;

  if (!stats) {
    contentEl.innerHTML = '<p class="hint">暂无赢家数据。</p>';
    return;
  }

  const parts = [];

  // 1. 个人赢家
  if (isSubVisible('winner_personal') && stats.personal) {
    parts.push(winnerCard({
      label: '个人赢家',
      icon: '🏆',
      name: stats.personal.name,
      photo: stats.personal.photo_url,
      sub: stats.personal.college_name || '',
      color: stats.personal.color || '',
    }));
  }

  // 2. 阵营赢家
  if (isSubVisible('winner_college') && stats.college) {
    parts.push(winnerCard({
      label: '阵营赢家',
      icon: '🛡️',
      name: stats.college.name,
      photo: null,
      sub: `${stats.college.score ?? 0} 分`,
      color: stats.college.color || '',
    }));
  }

  // 3. 最多淘汰
  if (isSubVisible('winner_most_kills') && stats.most_kills) {
    parts.push(winnerCard({
      label: '最多淘汰',
      icon: '⚔️',
      name: stats.most_kills.name,
      photo: stats.most_kills.photo_url,
      sub: `${stats.most_kills.college_name || ''} · ${stats.most_kills.kill_count} 次击杀`,
      color: stats.most_kills.color || '',
    }));
  }

  // 4. 最快阵亡
  if (isSubVisible('winner_fastest_death') && stats.fastest_death) {
    parts.push(winnerCard({
      label: '最快阵亡',
      icon: '💀',
      name: stats.fastest_death.name,
      photo: stats.fastest_death.photo_url,
      sub: `${stats.fastest_death.college_name || ''} · ${formatTime(stats.fastest_death.eliminated_at)}`,
      color: stats.fastest_death.color || '',
    }));
  }

  contentEl.innerHTML = parts.length
    ? parts.join('')
    : '<p class="hint">未开启任何奖项显示。</p>';
}

function winnerCard({ label, icon, name, photo, sub, color }) {
  const imgHtml = photo
    ? `<img src="${escapeHtml(photo)}" alt="${escapeHtml(name)}"
            onerror="this.onerror=null;this.src='assets/placeholder.png'">`
    : `<div class="winner-emoji">${icon}</div>`;

  return `
    <div class="winner-card">
      ${imgHtml}
      <div>
        <div class="winner-label">${icon} ${escapeHtml(label)}</div>
        <div class="winner-name">${escapeHtml(name || '—')}</div>
        ${sub ? `<div class="winner-college" style="color:${escapeHtml(color || '')}">${escapeHtml(sub)}</div>` : ''}
      </div>
    </div>
  `;
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