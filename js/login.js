// js/login.js
import { supabase } from './supabase.js';
import { showMessage, setLoading } from './utils.js';
import { routeAfterLogin } from './auth.js';
import { t, initI18n, applyI18n, mountLanguageSwitcher } from './i18n.js';

initI18n();

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
  const { data, error } = await supabase.rpc('resolve_login_email', { p_name: input });
  if (error) throw new Error(t('login.resolveNameFailed', { msg: error.message }));
  if (!data) throw new Error(t('login.nameNotFound'));
  return data;
}

/* ============================================================
   登录
   ============================================================ */
async function handleLogin(btn) {
  const input = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  if (!input) {
    showMessage(t('login.enterEmail'), 'error');
    return;
  }
  if (!password) {
    showMessage(t('login.enterPassword'), 'error');
    return;
  }

  setLoading(btn, true, t('login.submitting'));

  try {
    const email = await resolveEmail(input.toLowerCase());
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    await routeAfterLogin();
  } catch (err) {
    showMessage(err.message || t('login.failed'), 'error');
    setLoading(btn, false);
  }
}

/* ============================================================
   启动
   ============================================================ */
document.addEventListener('DOMContentLoaded', async () => {
  applyI18n();
  mountLanguageSwitcher('lang-switch');
  window.addEventListener('localechange', () => applyI18n());

  const alreadyLoggedIn = await checkExistingSession();
  if (alreadyLoggedIn) return;

  const btn = document.getElementById('btn-login');
  btn?.addEventListener('click', () => handleLogin(btn));
  document.getElementById('password')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      btn?.click();
    }
  });
});