// js/register.js
import { supabase } from './supabase.js';
import { showMessage, setLoading } from './utils.js';
import { t, initI18n, applyI18n, mountLanguageSwitcher } from './i18n.js';

initI18n();

const SCHOOL_DOMAIN = '@bjsmicschool.com';

function isValidSchoolEmail(email) {
    return email.endsWith(SCHOOL_DOMAIN);
}

async function sendRegisterLink(email) {
    const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
            shouldCreateUser: true,
            emailRedirectTo: window.location.origin + '/set-password.html',
        },
    });
    if (error) throw error;
}

document.addEventListener('DOMContentLoaded', () => {
    applyI18n();
    mountLanguageSwitcher('lang-switch');
    window.addEventListener('localechange', () => applyI18n());

    const btn = document.getElementById('btn-send');
    const input = document.getElementById('email');

    btn?.addEventListener('click', async () => {
        const email = input.value.trim().toLowerCase();
        if (!email) {
            showMessage(t('register.enterEmail'), 'error');
            return;
        }
        if (!isValidSchoolEmail(email)) {
            showMessage(t('register.schoolEmailOnly'), 'error');
            return;
        }
        setLoading(btn, true, t('register.sending'));
        try {
            await sendRegisterLink(email);
            document.getElementById('step-email').style.display = 'none';
            document.getElementById('step-sent').style.display = 'block';
        } catch (err) {
            showMessage(err.message || t('register.sendFailed'), 'error');
        } finally {
            setLoading(btn, false);
        }
    });

    input?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            btn?.click();
        }
    });
});