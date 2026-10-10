// js/public.js
import { supabase } from './supabase.js';
import { getSession, signOut } from './auth.js';
import { escapeHtml } from './utils.js';

let pollTimer = null;

async function loadPublicHome() {
  const { data, error } = await supabase.rpc('get_public_home');

  if (error) {
    console.error('加载公共主页失败:', error);
    document.getElementById('status-text').textContent = '加载失败';
    return;
  }

  if (!data || !data.event) {
    document.getElementById('status-text').textContent = '活动尚未创建';
    return;
  }

  renderEvent(data);
  renderColleges(data.colleges || []);
  renderCounts(data);
  renderTodayRule(data.today_rule);
  renderAliveWall(data.alive_wall || []);
  renderWinner(data);
}

function renderEvent(data) {
  const statusMap = {
    draft: '未开始',
    active: '进行中',
    paused: '已暂停',
    ended: '已结束',
  };
  document.getElementById('status-text').textContent =
    statusMap[data.event.status] || data.event.status;
  document.getElementById('day-text').textContent =
    data.event.status === 'active' ? `第 ${data.event.current_day} 天` : '';
}

function renderColleges(colleges) {
  const el = document.getElementById('colleges-list');
  el.innerHTML = colleges.map(c => `
    <div class="college-card" style="border-color:${escapeHtml(c.color)}">
      <div class="college-name" style="background:${escapeHtml(c.color)}">
        ${escapeHtml(c.name)}
      </div>
      <div class="college-score">${c.score}</div>
    </div>
  `).join('');
}

function renderCounts(data) {
  document.getElementById('alive-count').textContent = data.alive_count ?? 0;
  document.getElementById('eliminated-count').textContent = data.eliminated_count ?? 0;
}

function renderTodayRule(rule) {
  if (!rule) {
    document.getElementById('rule-title').textContent = '今日无特殊规则';
    document.getElementById('rule-content').textContent = '';
    return;
  }
  document.getElementById('rule-title').textContent = rule.title || '';
  document.getElementById('rule-content').textContent = rule.content || '';
}
let lastAliveWallKey = '';

function renderAliveWall(list) {
  const el = document.getElementById('alive-wall-list');

  // 生成数据指纹，用于判断是否变化
  const key = list.map(p => `${p.id}|${p.photo_url || ''}|${p.name}`).join(',');

  if (key === lastAliveWallKey) {
    return; // 数据没变，不重渲染
  }
  lastAliveWallKey = key;

  if (!list.length) {
    el.innerHTML = '<p>暂无存活者</p>';
    return;
  }

  el.innerHTML = list.map(p => `
    <div class="wall-item">
      <img src="${escapeHtml(p.photo_url || 'assets/placeholder.png')}"
           alt=""
           loading="lazy"
           onerror="this.onerror=null;this.src='assets/placeholder.png'">
      <div class="wall-name">${escapeHtml(p.name)}</div>
      <div class="wall-college" style="color:${escapeHtml(p.color)}">
        ${escapeHtml(p.college_name)}
      </div>
    </div>
  `).join('');
}

function renderWinner(data) {
  if (data.event.status !== 'ended') return;

  const el = document.getElementById('winner');
  el.style.display = 'block';

  const winner = data.winner;
  const college = data.winning_college;

  let html = '';
  if (winner) {
    html += `
      <div class="winner-card">
        <img src="${escapeHtml(winner.photo_url || 'assets/placeholder.png')}"
             alt="${escapeHtml(winner.name)}">
        <div>
          <div class="winner-label">个人赢家</div>
          <div class="winner-name">${escapeHtml(winner.name)}</div>
          <div class="winner-college">${escapeHtml(winner.college_name)}</div>
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
  document.getElementById('winner-content').innerHTML = html;
}

async function updateNav() {
  const session = await getSession();
  const navLogin = document.getElementById('nav-login');
  const navMe = document.getElementById('nav-me');
  const navAdmin = document.getElementById('nav-admin');
  const navLogout = document.getElementById('nav-logout');

  if (session) {
    navLogin.style.display = 'none';
    navMe.style.display = '';
    navLogout.style.display = '';
    // 简单判断管理员
    const { data } = await supabase.rpc('is_admin');
    if (data === true) navAdmin.style.display = '';
  } else {
    navLogin.style.display = '';
    navMe.style.display = 'none';
    navAdmin.style.display = 'none';
    navLogout.style.display = 'none';
  }
}

function bindEvents() {
  document.getElementById('nav-logout')?.addEventListener('click', (e) => {
    e.preventDefault();
    signOut();
  });
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(loadPublicHome, 5000);
}

document.addEventListener('DOMContentLoaded', async () => {
  bindEvents();
  await updateNav();
  await loadPublicHome();
  startPolling();
});