// js/login.js
import { supabase } from './supabase.js';
import { showMessage, setLoading } from './utils.js';
import { routeAfterLogin } from './auth.js';

const SCHOOL_DOMAIN = '@bjsmicschool.com';

async function checkExistingSession() {
  const { data } = await supabase.auth.getSession();
  if (data.session) {
    await routeAfterLogin();
    return true;
  }
  return false;
}

function isValidSchoolEmail(email) {
  return email.endsWith(SCHOOL_DOMAIN);
}

async function sendMagicLink(email) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: window.location.origin + '/login.html',
    },
  });
  if (error) throw error;
}

document.addEventListener('DOMContentLoaded', async () => {
  // 若已登录，直接跳转
  const alreadyLoggedIn = await checkExistingSession();
  if (alreadyLoggedIn) return;

  const btnSend = document.getElementById('btn-send');
  const inputEmail = document.getElementById('email');
  const btnTestLogin = document.getElementById('btn-test-login');

  // 测试用密码登录
  btnTestLogin?.addEventListener('click', async () => {
    const email = document.getElementById('test-email').value.trim().toLowerCase();
    const password = document.getElementById('test-password').value;

    if (!email || !password) {
      showMessage('请输入测试邮箱和密码', 'error');
      return;
    }

    setLoading(btnTestLogin, true, '登录中...');
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await routeAfterLogin();
    } catch (err) {
      showMessage(err.message || '登录失败', 'error');
      setLoading(btnTestLogin, false);
    }
  });

  btnSend.addEventListener('click', async () => {
    const email = inputEmail.value.trim().toLowerCase();

    if (!email) {
      showMessage('请输入邮箱', 'error');
      return;
    }
    if (!isValidSchoolEmail(email)) {
      showMessage('请使用学校邮箱登录', 'error');
      return;
    }

    setLoading(btnSend, true, '发送中...');
    try {
      await sendMagicLink(email);
      document.getElementById('step-email').style.display = 'none';
      document.getElementById('step-sent').style.display = 'block';
    } catch (err) {
      showMessage(err.message || '发送失败', 'error');
    } finally {
      setLoading(btnSend, false);
    }
  });
});