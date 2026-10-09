// js/confirm.js
import { supabase } from './supabase.js';
import { requireLogin, signOut } from './auth.js';
import { showMessage, setLoading, escapeHtml } from './utils.js';

async function loadProfile() {
  const { data, error } = await supabase.rpc('get_my_profile');

  if (error) {
    console.error(error);
    document.getElementById('loading').textContent = '加载失败：' + error.message;
    return;
  }

  if (!data || data.error) {
    document.getElementById('loading').textContent =
      '未找到你的参与者记录，请联系管理员。';
    return;
  }

  const me = data.me;

  if (me.is_confirmed) {
    // 已确认，直接进个人页
    window.location.href = 'me.html';
    return;
  }

  // 渲染信息
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
  setLoading(btn, true, '确认中...');
  const { data, error } = await supabase.rpc('confirm_identity');
  setLoading(btn, false);

  if (error) {
    showMessage('确认失败：' + error.message, 'error');
    return;
  }
  if (data?.error) {
    showMessage('确认失败：' + data.error, 'error');
    return;
  }

  showMessage('身份已确认，正在进入个人页...', 'success');
  setTimeout(() => window.location.href = 'me.html', 800);
}

async function submitReject(note) {
  if (!note.trim()) {
    showMessage('请填写说明', 'error');
    return;
  }
  const { data, error } = await supabase.rpc('report_identity_issue', {
    p_note: note.trim(),
  });

  if (error || data?.error) {
    showMessage('提交失败：' + (error?.message || data?.error), 'error');
    return;
  }

  showMessage('已通知管理员，请等待处理。', 'success');
  setTimeout(async () => {
    await signOut();
  }, 1500);
}

document.addEventListener('DOMContentLoaded', async () => {
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