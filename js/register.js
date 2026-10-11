// js/register.js
import { supabase } from './supabase.js';
import { showMessage, setLoading } from './utils.js';

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
    const btn = document.getElementById('btn-send');
    const input = document.getElementById('email');

    btn?.addEventListener('click', async () => {
        const email = input.value.trim().toLowerCase();

        if (!email) { showMessage('请输入邮箱', 'error'); return; }
        if (!isValidSchoolEmail(email)) {
            showMessage('请使用学校邮箱注册', 'error');
            return;
        }

        setLoading(btn, true, '发送中...');
        try {
            await sendRegisterLink(email);
            document.getElementById('step-email').style.display = 'none';
            document.getElementById('step-sent').style.display = 'block';
        } catch (err) {
            showMessage(err.message || '发送失败', 'error');
        } finally {
            setLoading(btn, false);
        }
    });

    input?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); btn?.click(); }
    });
});