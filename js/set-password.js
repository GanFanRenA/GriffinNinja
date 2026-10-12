// js/set-password.js
import { supabase } from './supabase.js';
import { showMessage, setLoading } from './utils.js';
import { routeAfterLogin } from './auth.js';
import { t, initI18n, applyI18n, mountLanguageSwitcher } from './i18n.js';

initI18n();

async function init() {
    applyI18n();
    mountLanguageSwitcher('lang-switch');
    window.addEventListener('localechange', () => applyI18n());

    const loadingEl = document.getElementById('loading');
    const stepEl = document.getElementById('step-password');

    // 等待 Supabase 从 URL hash 中解析 token 并写入 session
    await new Promise(r => setTimeout(r, 400));

    const { data: { session }, error } = await supabase.auth.getSession();

    if (error || !session) {
        loadingEl.innerHTML = t('setpwd.invalidLink') +
            ' <a href="register.html" data-i18n="login.registerLink">' + t('login.registerLink') + '</a>';
        return;
    }

    loadingEl.style.display = 'none';
    stepEl.style.display = 'block';

    const emailEl = document.getElementById('user-email');
    if (emailEl) emailEl.textContent = session.user.email || '';

    const btn = document.getElementById('btn-set');
    btn.addEventListener('click', () => handleSetPassword(btn));
    document.getElementById('password2')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            btn.click();
        }
    });
}

async function handleSetPassword(btn) {
    const pwd = document.getElementById('password').value;
    const pwd2 = document.getElementById('password2').value;

    if (!pwd || pwd.length < 6) {
        showMessage(t('setpwd.tooShort'), 'error');
        return;
    }
    if (pwd !== pwd2) {
        showMessage(t('setpwd.mismatch'), 'error');
        return;
    }

    setLoading(btn, true, t('setpwd.setting'));

    const { error } = await supabase.auth.updateUser({ password: pwd });

    if (error) {
        showMessage(t('setpwd.setFailed', { msg: error.message }), 'error');
        setLoading(btn, false);
        return;
    }

    showMessage(t('setpwd.success'), 'success');
    setTimeout(() => routeAfterLogin(), 700);
}

document.addEventListener('DOMContentLoaded', init);