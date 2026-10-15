// js/public.js
// 公共主页：活动状态、阵营分、人数、今日规则、存活墙、最终赢家
import { supabase } from './supabase.js';
import { getSession, signOut } from './auth.js';
import { qs, escapeHtml, formatTime, emptyState } from './utils.js';
import { t, initI18n, applyI18n, mountLanguageSwitcher } from './i18n.js';

initI18n();

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


function isPurpleHouse(c) {
  return c?.is_hidden === true ||
    String(c?.name || c?.college_name || '').trim().toLowerCase() === 'purplehouse';
}


function applySectionVisibility() {
  document.querySelectorAll('[data-section]').forEach(el => {
    const key = el.dataset.section;
    if (key === 'winner') return;
    const visible = sectionVisibility[key] !== false;
    el.style.display = (isAdminUser || visible) ? '' : 'none';
  });
}

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
    if (statusEl) statusEl.textContent = t('public.loadFailed');
    return;
  }
  if (!data || !data.event) {
    const statusEl = qs('status-text');
    if (statusEl) statusEl.textContent = t('public.noEvent');
    return;
  }
  renderEvent(data);
  renderColleges((data.colleges || []).filter(c=>!isPurpleHouse(c)));
  renderCounts(data);
  renderTodayRule(data.today_rule);
  renderAliveWall(data.alive_wall || []);
  await renderWinner(data);
}

/* ============================================================
   渲染：状态 / 阵营 / 人数 / 规则 / 存活墙
   ============================================================ */
function renderEvent(data) {
  const status = data.event.status;
  const statusKey = {
    draft: 'public.statusDraft',
    active: 'public.statusActive',
    paused: 'public.statusPaused',
    ended: 'public.statusEnded',
  };
  const badgeCls = {
    draft: 'badge-neutral',
    active: 'badge-success',
    paused: 'badge-warning',
    ended: 'badge-neutral',
  };
  const statusEl = qs('status-text');
  if (statusEl) {
    const label = t(statusKey[status] || 'public.statusDraft');
    statusEl.innerHTML = `<span class="badge ${badgeCls[status] || 'badge-neutral'}">` +
      `<span class="dot"></span>${escapeHtml(label)}</span>`;
  }
  const dayEl = qs('day-text');
  if (dayEl) {
    dayEl.textContent = status === 'active' && data.event.current_day
      ? t('public.dayText', { n: data.event.current_day })
      : '';
  }
}

function renderColleges(colleges) {
  const el = qs('colleges-list');
  if (!el) return;
  if (!colleges.length) {
    el.innerHTML = emptyState({ title: t('public.noColleges') });
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
    titleEl.textContent = t('public.noRule');
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
    el.innerHTML = emptyState({ icon: 'user', title: t('public.noAlive') });
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
  if (data.event.status !== 'ended') {
    el.style.display = 'none';
    winnerStatsCache = null;
    winnerStatsEventKey = null;
    return;
  }
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
    contentEl.innerHTML = `<p class="hint">${escapeHtml(t('public.noWinnerData'))}</p>`;
    return;
  }
  const parts = [];

  if (isSubVisible('winner_personal') && stats.personal) {
    parts.push(winnerCard({
      label: t('public.winnerPersonal'),
      icon: '🏆',
      name: stats.personal.name,
      photo: stats.personal.photo_url,
      sub: stats.personal.college_name || '',
      color: stats.personal.color || '',
    }));
  }
  if (isSubVisible('winner_college') && stats.college) {
    parts.push(winnerCard({
      label: t('public.winnerCollege'),
      icon: '🛡️',
      name: stats.college.name,
      photo: null,
      sub: t('public.collegeScore', { n: stats.college.score ?? 0 }),
      color: stats.college.color || '',
    }));
  }
  if (isSubVisible('winner_most_kills') && stats.most_kills) {
    parts.push(winnerCard({
      label: t('public.winnerMostKills'),
      icon: '⚔️',
      name: stats.most_kills.name,
      photo: stats.most_kills.photo_url,
      sub: `${stats.most_kills.college_name || ''} · ${t('public.killCount', { n: stats.most_kills.kill_count })}`,
      color: stats.most_kills.color || '',
    }));
  }
  if (isSubVisible('winner_fastest_death') && stats.fastest_death) {
    parts.push(winnerCard({
      label: t('public.winnerFastestDeath'),
      icon: '💀',
      name: stats.fastest_death.name,
      photo: stats.fastest_death.photo_url,
      sub: `${stats.fastest_death.college_name || ''} · ${formatTime(stats.fastest_death.eliminated_at)}`,
      color: stats.fastest_death.color || '',
    }));
  }

  contentEl.innerHTML = parts.length
    ? parts.join('')
    : `<p class="hint">${escapeHtml(t('public.noWinnerEnabled'))}</p>`;
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
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    } else {
      loadPublicHome();
      startPolling();
    }
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  applyI18n();
  mountLanguageSwitcher('lang-switch');

  window.addEventListener('localechange', () => {
    applyI18n();
    lastAliveWallKey = ''; // 强制重绘存活墙
    winnerStatsCache = null;
    winnerStatsEventKey = null;
    loadPublicHome();
  });

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