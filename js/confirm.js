// js/confirm.js
window.location.href = 'index.html';

import { supabase } from './supabase.js';
import { requireLogin, signOut } from './auth.js';
import { showMessage, setLoading } from './utils.js';
import { t, initI18n, applyI18n, mountLanguageSwitcher } from './i18n.js';

initI18n();

async function loadProfile() {
  const { data, error } = await supabase.rpc('get_my_profile');
  if (error) {
    console.error(error);
    document.getElementById('loading').textContent = t('identity.loadFailed', { msg: error.message });
    return;
  }
  if (!data || data.error) {
    document.getElementById('loading').textContent = t('identity.notFound');
    return;
  }
  const me = data.me;
  if (me.is_confirmed) {
    window.location.href = 'me.html';
    return;
  }
  document.getElementById('loading').style.display = 'none';
  document.getElementById('profile').style.display = 'block';
  document.getElementById('name').textContent = me.name || '-';
  document.getElementById('college').textContent = me.college_name || '-';
  document.getElementById('email').textContent = me.email || '';
  if (me.photo_url) {
    document.getElementById('photo').src = me.photo_url;
  }
}

async function confirmIdentity(btn) {
  setLoading(btn, true, t('identity.confirming'));
  const { data, error } = await supabase.rpc('confirm_identity');
  setLoading(btn, false);
  if (error) {
    showMessage(t('identity.confirmFailed', { msg: error.message }), 'error');
    return;
  }
  if (data?.error) {
    showMessage(t('identity.confirmFailed', { msg: data.error }), 'error');
    return;
  }
  showMessage(t('identity.confirmed'), 'success');
  setTimeout(() => window.location.href = 'me.html', 800);
}

async function submitReject(note) {
  if (!note.trim()) {
    showMessage(t('identity.enterNote'), 'error');
    return;
  }
  const { data, error } = await supabase.rpc('report_identity_issue', { p_note: note.trim() });
  if (error || data?.error) {
    showMessage(t('identity.submitFailed', { msg: error?.message || data?.error }), 'error');
    return;
  }
  showMessage(t('identity.notified'), 'success');
  setTimeout(async () => { await signOut(); }, 1500);
}

document.addEventListener('DOMContentLoaded', async () => {
  applyI18n();
  mountLanguageSwitcher('lang-switch');
  window.addEventListener('localechange', () => applyI18n());

  const session = await requireLogin();
  if (!session) return;
  await loadProfile();
  document.getElementById('nav-logout')?.addEventListener('click', (e) => {
    e.preventDefault();
    signOut();
  });
  document.getElementById('btn-confirm').addEventListener('click', (e) => {
    confirmIdentity(e.target);
  });
  document.getElementById('btn-reject').addEventListener('click', () => {
    document.getElementById('reject-form').style.display = 'block';
    document.getElementById('btn-reject').style.display = 'none';
  });
  document.getElementById('btn-submit-reject').addEventListener('click', () => {
    const note = document.getElementById('reject-note').value;
    submitReject(note);
  });
});