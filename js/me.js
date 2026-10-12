// js/me.js
window.location.href = 'index.html';

import { supabase } from './supabase.js';
import { requireLogin, signOut } from './auth.js';
import { showMessage, setLoading, escapeHtml, formatTime } from './utils.js';
import { t, initI18n, applyI18n, mountLanguageSwitcher } from './i18n.js';

initI18n();

let currentTargetId = null;

function initPrivacyModal() {
  const modal = document.getElementById('privacy-modal');
  const btn = document.getElementById('btn-privacy-ok');
  btn.addEventListener('click', () => {
    modal.style.display = 'none';
    loadProfile();
  });
}

function applyWatermark(email) {
  const el = document.getElementById('watermark');
  const now = new Date().toLocaleString(
    document.documentElement.lang && document.documentElement.lang.startsWith('en') ? 'en-US' : 'zh-CN',
    { hour12: false }
  );
  const text = `${email} · ${now}`;
  let html = '';
  for (let i = 0; i < 30; i++) {
    html += `<span>${escapeHtml(text)}</span>`;
  }
  el.innerHTML = html;
}

async function loadProfile() {
  const { data, error } = await supabase.rpc('get_my_profile');
  if (error) {
    document.getElementById('loading').textContent = t('me.loadFailed', { msg: error.message });
    return;
  }
  if (!data || data.error) {
    document.getElementById('loading').textContent = t('me.notFound');
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

function renderStatus(me, eventStatus, eliminatedBy) {
  const el = document.getElementById('my-status');
  const infoEl = document.getElementById('event-status-info');
  const statusMap = {
    alive: t('me.statusAlive'),
    eliminated: t('me.statusEliminated'),
    winner: t('me.statusWinner'),
  };
  el.textContent = statusMap[me.status] || me.status;
  el.className = `status-badge status-${me.status}`;

  if (me.status === 'eliminated' && eliminatedBy) {
    const info = document.getElementById('eliminated-info');
    info.style.display = 'block';
    info.innerHTML = `
      <p>${t('me.eliminatedBy', { name: escapeHtml(eliminatedBy.name) })}</p>
      <p class="hint">${t('me.eliminatedTime', { time: formatTime(eliminatedBy.eliminated_at) })}</p>
    `;
  }

  if (eventStatus !== 'active') {
    const map = {
      draft: t('me.eventDraft'),
      paused: t('me.eventPaused'),
      ended: t('me.eventEnded'),
    };
    infoEl.textContent = map[eventStatus] || '';
  }
}

function renderCode(me, eventStatus) {
  const codeEl = document.getElementById('my-code');
  if (eventStatus === 'active' && me.code) {
    codeEl.textContent = me.code;
  } else {
    codeEl.textContent = t('me.codeHidden');
    codeEl.classList.add('muted');
  }
}

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
  document.getElementById('target-photo').src = target.photo_url || 'assets/placeholder.png';
}

function renderMyKills(list) {
  const el = document.getElementById('my-kills-list');
  if (!list.length) {
    el.innerHTML = `<p class="hint">${t('me.noKills')}</p>`;
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

async function submitKill() {
  const code = document.getElementById('kill-code').value.trim().toUpperCase();
  const btn = document.getElementById('btn-submit-kill');

  if (!code) {
    showMessage(t('me.enterCode'), 'error');
    return;
  }
  if (!currentTargetId) {
    showMessage(t('me.noTarget'), 'error');
    return;
  }

  setLoading(btn, true, t('me.submitting'));

  const { data, error } = await supabase.rpc('kill_target', {
    p_target_id: currentTargetId,
    p_input_code: code,
  });

  setLoading(btn, false);

  if (error) {
    showMessage(t('me.submitFailed', { msg: error.message }), 'error');
    return;
  }
  if (data?.error) {
    const errMap = {
      wrong_code: t('me.wrongCode'),
      event_not_active: t('me.eventNotActive'),
      hunter_not_alive: t('me.youEliminated'),
      target_already_eliminated: t('me.targetEliminated'),
      not_your_target: t('me.targetChanged'),
      not_your_target_anymore: t('me.targetChanged'),
    };
    showMessage(errMap[data.error] || t('me.failed', { msg: data.error }), 'error');
    if (data.error === 'target_already_eliminated' || data.error === 'not_your_target') {
      setTimeout(loadProfile, 1500);
    }
    return;
  }

  if (data?.winner) {
    showMessage(t('me.youWon'), 'success');
  } else {
    showMessage(t('me.killSuccess'), 'success');
  }

  document.getElementById('kill-form').style.display = 'none';
  setTimeout(loadProfile, 800);
}

async function submitReport() {
  const reason = document.getElementById('report-reason').value.trim();
  const desc = document.getElementById('report-desc').value.trim();
  const btn = document.getElementById('btn-submit-report');

  if (!reason) {
    showMessage(t('me.reportPleaseReason'), 'error');
    return;
  }
  if (!currentTargetId) {
    showMessage(t('me.noTarget'), 'error');
    return;
  }

  setLoading(btn, true, t('me.submitting'));

  const { data, error } = await supabase.rpc('submit_report', {
    p_target_id: currentTargetId,
    p_reason: reason,
    p_description: desc,
    p_evidence_url: null,
  });

  setLoading(btn, false);

  if (error || data?.error) {
    showMessage(t('me.submitFailed', { msg: error?.message || data?.error }), 'error');
    return;
  }

  showMessage(t('me.reportSuccess'), 'success');
  document.getElementById('report-form').style.display = 'none';
  document.getElementById('report-reason').value = '';
  document.getElementById('report-desc').value = '';
}

document.addEventListener('DOMContentLoaded', async () => {
  applyI18n();
  mountLanguageSwitcher('lang-switch');
  window.addEventListener('localechange', () => applyI18n());

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