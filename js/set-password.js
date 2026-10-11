// js/set-password.js
import { supabase } from './supabase.js';
import { showMessage, setLoading } from './utils.js';
import { routeAfterLogin } from './auth.js';

async function init() {
    const loadingEl = document.getElementById('loading');
    const stepEl = document.getElementById('step-password');

    // 等待 Supabase 从 URL hash 中解析 token 并写入 session
    await new Promise(r => setTimeout(r, 400));

    const { data: { session }, error } = await supabase.auth.getSession();

    if (error || !session) {
        loadingEl.innerHTML =
            '链接无效或已过期。请重新 <a href="register.html">注册</a>。';
        return;
    }

    loadingEl.style.display = 'none';
    stepEl.style.display = 'block';

    const emailEl = document.getElementById('user-email');
    if (emailEl) emailEl.textContent = session.user.email || '';

    const btn = document.getElementById('btn-set');
    btn.addEventListener('click', () => handleSetPassword(btn));

    document.getElementById('password2')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); btn.click(); }
    });
}

async function handleSetPassword(btn) {
    const pwd = document.getElementById('password').value;
    const pwd2 = document.getElementById('password2').value;

    if (!pwd || pwd.length < 6) {
        showMessage('密码至少 6 位', 'error');
        return;
    }
    if (pwd !== pwd2) {
        showMessage('两次输入的密码不一致', 'error');
        return;
    }

    setLoading(btn, true, '设置中...');

    const { error } = await supabase.auth.updateUser({ password: pwd });

    if (error) {
        showMessage('设置失败：' + error.message, 'error');
        setLoading(btn, false);
        return;
    }

    showMessage('密码已设置，正在进入后台...', 'success');
    setTimeout(() => routeAfterLogin(), 700);
}

document.addEventListener('DOMContentLoaded', init);