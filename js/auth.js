// js/auth.js
import { supabase } from './supabase.js';

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function getUser() {
  const { data } = await supabase.auth.getUser();
  return data.user;
}

export async function signOut() {
  await supabase.auth.signOut();
  window.location.href = 'index.html';
}

// 页面守卫：需要登录的页面调用
export async function requireLogin(redirectTo = 'login.html') {
  const session = await getSession();
  if (!session) {
    window.location.href = redirectTo;
    return null;
  }
  return session;
}

// 判断是否为管理员
export async function checkIsAdmin() {
  const { data, error } = await supabase.rpc('is_admin');
  if (error) return false;
  return data === true;
}

// 判断是否完成身份确认
export async function checkConfirmed() {
  const { data, error } = await supabase.rpc('get_my_profile');
  if (error || !data || data.error) return false;
  return data.me?.is_confirmed === true;
}

// 登录后跳转逻辑
export async function routeAfterLogin() {
  const isAdmin = await checkIsAdmin();
  if (isAdmin) {
    window.location.href = 'admin.html';
    return;
  }
  const confirmed = await checkConfirmed();
  if (!confirmed) {
    window.location.href = 'confirm.html';
    return;
  }
  window.location.href = 'me.html';
}