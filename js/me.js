// js/me.js
window.location.href = 'index.html';

import { supabase } from './supabase.js';
import { requireLogin, signOut } from './auth.js';
import { showMessage, setLoading, escapeHtml, formatTime } from './utils.js';

let currentTargetId = null;

// 隐私提醒
function initPrivacyModal() {
  const modal = document.getElementById('privacy-modal');
  const btn = document.getElementById('btn-privacy-ok');
  btn.addEventListener('click', () => {
    modal.style.display = 'none';
    loadProfile();
  });
}

// 水印
function applyWatermark(email) {
  const el = document.getElementById('watermark');
  const now = new Date().toLocaleString('zh-CN', { hour12: false });
  const text = `${email} · ${now}`;
  let html = '';
  for (let i = 0; i < 30; i++) {
    html += `<span>${escapeHtml(text)}</span>`;
  }
  el.innerHTML = html;
}

// 加载个人数据
async function loadProfile() {
  const { data, error } = await supabase.rpc('get_my_profile');

  if (error) {
    document.getElementById('loading').textContent = '加载失败：' + error.message;
    return;
  }
  if (!data || data.error) {
    document.getElementById('loading').textContent =
      '未找到你的参与者记录，请联系管理员。';
    return;
  }

  document.getElementById('loading').style.display = 'none';
  document.getElementById('content').style.display = 'block';

  const me = data.me;
  applyWatermark(me.email || '');

  renderStatus(me, data.event_status, data.eliminated_by);
  renderCode(me, data.event_status);
  renderTarget(data.current_target, me);
  renderMyKills(data.my_kills || []);
}

// 状态
function renderStatus(me, eventStatus, eliminatedBy) {
  const el = document.getElementById('my-status');
  const infoEl = document.getElementById('event-status-info');

  const statusMap = {
    alive: '存活',
    eliminated: '已淘汰',
    winner: '赢家',
  };
  el.textContent = statusMap[me.status] || me.status;
  el.className = `status-badge status-${me.status}`;

  if (me.status === 'eliminated' && eliminatedBy) {
    const info = document.getElementById('eliminated-info');
    info.style.display = 'block';
    info.innerHTML = `
      <p>你被 <strong>${escapeHtml(eliminatedBy.name)}</strong> 淘汰。</p>
      <p class="hint">淘汰时间：${formatTime(eliminatedBy.eliminated_at)}</p>
    `;
  }

  if (eventStatus !== 'active') {
    const map = { draft: '活动尚未开始', paused: '活动已暂停', ended: '活动已结束' };
    infoEl.textContent = map[eventStatus] || '';
  }
}

// 我的代码
function renderCode(me, eventStatus) {
  const codeEl = document.getElementById('my-code');
  if (eventStatus === 'active' && me.code) {
    codeEl.textContent = me.code;
  } else {
    codeEl.textContent = '活动开始后显示';
    codeEl.classList.add('muted');
  }
}

// 当前目标
function renderTarget(target, me) {
  const targetCard = document.getElementById('target-card');
  const targetEmpty = document.getElementById('target-empty');
  const reportSection = document.getElementById('report-section');

  if (me.status !== 'alive' || !target) {
    targetCard.style.display = 'none';
    targetEmpty.style.display = 'block';
    reportSection.style.display = 'none';
    return;
  }

  targetEmpty.style.display = 'none';
  targetCard.style.display = 'block';
  reportSection.style.display = 'block';

  currentTargetId = target.id;
  document.getElementById('target-name').textContent = target.name;
  document.getElementById('target-college').textContent = target.college_name;
  document.getElementById('target-college').style.color = target.color;
  document.getElementById('target-photo').src =
    target.photo_url || 'assets/placeholder.png';
}

// 我已淘汰的人
function renderMyKills(list) {
  const el = document.getElementById('my-kills-list');
  if (!list.length) {
    el.innerHTML = '<p class="hint">暂无</p>';
    return;
  }
  el.innerHTML = list.map(p => `
    <div class="wall-item">
      <img src="${escapeHtml(p.photo_url || 'assets/placeholder.png')}"
           alt="${escapeHtml(p.name)}" loading="lazy"
           onerror="this.src='assets/placeholder.png'">
      <div class="wall-name">${escapeHtml(p.name)}</div>
      <div class="wall-college">${formatTime(p.eliminated_at)}</div>
    </div>
  `).join('');
}

// 击杀
async function submitKill() {
  const code = document.getElementById('kill-code').value.trim().toUpperCase();
  const btn = document.getElementById('btn-submit-kill');

  if (!code) { showMessage('请输入代码', 'error'); return; }
  if (!currentTargetId) { showMessage('无当前目标', 'error'); return; }

  setLoading(btn, true, '提交中...');
  const { data, error } = await supabase.rpc('kill_target', {
    p_target_id: currentTargetId,
    p_input_code: code,
  });
  setLoading(btn, false);

  if (error) { showMessage('提交失败：' + error.message, 'error'); return; }
  if (data?.error) {
    const errMap = {
      wrong_code: '代码错误',
      event_not_active: '活动未进行',
      hunter_not_alive: '你已被淘汰',
      target_already_eliminated: '目标已被淘汰，请刷新',
      not_your_target: '目标已变化，请刷新',
      not_your_target_anymore: '目标已变化，请刷新',
    };
    showMessage(errMap[data.error] || ('失败：' + data.error), 'error');
    if (data.error === 'target_already_eliminated' ||
      data.error === 'not_your_target') {
      setTimeout(loadProfile, 1500);
    }
    return;
  }

  if (data?.winner) {
    showMessage('你赢了！活动结束。', 'success');
  } else {
    showMessage('击杀成功！', 'success');
  }
  document.getElementById('kill-form').style.display = 'none';
  setTimeout(loadProfile, 800);
}

// 举报
async function submitReport() {
  const reason = document.getElementById('report-reason').value.trim();
  const desc = document.getElementById('report-desc').value.trim();
  const btn = document.getElementById('btn-submit-report');

  if (!reason) { showMessage('请填写举报原因', 'error'); return; }
  if (!currentTargetId) { showMessage('无当前目标', 'error'); return; }

  setLoading(btn, true, '提交中...');
  const { data, error } = await supabase.rpc('submit_report', {
    p_target_id: currentTargetId,
    p_reason: reason,
    p_description: desc,
    p_evidence_url: null,
  });
  setLoading(btn, false);

  if (error || data?.error) {
    showMessage('提交失败：' + (error?.message || data?.error), 'error');
    return;
  }

  showMessage('举报已提交，管理员会处理。', 'success');
  document.getElementById('report-form').style.display = 'none';
  document.getElementById('report-reason').value = '';
  document.getElementById('report-desc').value = '';
}

document.addEventListener('DOMContentLoaded', async () => {
  const session = await requireLogin();
  if (!session) return;

  initPrivacyModal();

  document.getElementById('nav-logout')?.addEventListener('click', (e) => {
    e.preventDefault();
    signOut();
  });

  document.getElementById('btn-open-kill').addEventListener('click', () => {
    document.getElementById('kill-form').style.display = 'block';
    document.getElementById('kill-code').focus();
  });

  document.getElementById('btn-cancel-kill').addEventListener('click', () => {
    document.getElementById('kill-form').style.display = 'none';
    document.getElementById('kill-code').value = '';
  });

  document.getElementById('btn-submit-kill').addEventListener('click', submitKill);

  document.getElementById('btn-open-report').addEventListener('click', () => {
    document.getElementById('report-form').style.display = 'block';
    document.getElementById('btn-open-report').style.display = 'none';
  });

  document.getElementById('btn-submit-report').addEventListener('click', submitReport);
});