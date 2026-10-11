// js/login.js
import { supabase } from './supabase.js';
import { showMessage, setLoading } from './utils.js';
import { routeAfterLogin } from './auth.js';

/* ============================================================
   会话检查
   ============================================================ */

async function checkExistingSession() {
  const { data } = await supabase.auth.getSession();
  if (data.session) {
    await routeAfterLogin();
    return true;
  }
  return false;
}

/* ============================================================
   输入解析：邮箱 / 姓名
   ============================================================ */

function looksLikeEmail(s) {
  return s.includes('@');
}

async function resolveEmail(input) {
  if (looksLikeEmail(input)) return input;

  // 通过 admins.name 反查 email，需后端 RPC resolve_login_email
  const { data, error } = await supabase.rpc('resolve_login_email', {
    p_name: input,
  });

  if (error) throw new Error('无法解析名称：' + error.message);
  if (!data) throw new Error('未找到该名称对应的账号');
  return data;
}

/* ============================================================
   登录
   ============================================================ */

async function handleLogin(btn) {
  const input = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  if (!input) { showMessage('请输入邮箱或姓名', 'error'); return; }
  if (!password) { showMessage('请输入密码', 'error'); return; }

  setLoading(btn, true, '登录中...');

  try {
    const email = await resolveEmail(input.toLowerCase());
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;

    await routeAfterLogin();
  } catch (err) {
    showMessage(err.message || '登录失败', 'error');
    setLoading(btn, false);
  }
}

/* ============================================================
   启动
   ============================================================ */

document.addEventListener('DOMContentLoaded', async () => {
  const alreadyLoggedIn = await checkExistingSession();
  if (alreadyLoggedIn) return;

  const btn = document.getElementById('btn-login');
  btn?.addEventListener('click', () => handleLogin(btn));

  document.getElementById('password')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); btn?.click(); }
  });
});