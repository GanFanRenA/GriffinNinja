// js/admin-misc.js
// 学院 / 每日规则 / 管理员 / 设置（首页可见性）

import { supabase } from './supabase.js';
import { state } from './admin.js';
import {
    qs, showToast, setLoading, confirmDialog,
    openModal, closeModal, escapeHtml,
    skeletonRows, emptyState,
} from './utils.js';

/* ============================================================
   学院
   ============================================================ */

let editingCollegeId = null;

export function initColleges() {
    qs('btn-refresh-colleges')?.addEventListener('click', () => refreshColleges());
    qs('btn-reset-scores')?.addEventListener('click', resetScores);
    qs('btn-save-edit-college')?.addEventListener('click', (e) => saveEditCollege(e.currentTarget));
    qs('btn-cancel-edit-college')?.addEventListener('click', () => closeModal('edit-college-modal'));
}

export async function refreshColleges() {
    const el = qs('colleges-list');
    if (el && !state.colleges.length) el.innerHTML = skeletonRows(3, 2);

    const { data, error } = await supabase.rpc('admin_get_colleges');
    if (error || data?.error) {
        if (el) el.innerHTML = emptyState({
            title: '加载失败',
            desc: error?.message || data?.error,
        });
        return;
    }

    state.colleges = Array.isArray(data) ? data : [];
    renderColleges();
    fillCollegeSelects();
}

function renderColleges() {
    const el = qs('colleges-list');
    if (!el) return;

    if (!state.colleges.length) {
        el.innerHTML = emptyState({ title: '暂无学院' });
        return;
    }

    el.innerHTML = state.colleges.map(c => `
    <div class="admin-row" data-id="${escapeHtml(c.id)}">
      <span class="color-dot" style="background:${escapeHtml(c.color || '#555')}"></span>
      <span class="admin-name">${escapeHtml(c.name)}</span>
      <span class="admin-meta">${c.score ?? 0} 分 · ${c.participant_count ?? 0} 人</span>
      <div class="grow"></div>
      <button class="btn-mini" data-edit-college="${escapeHtml(c.id)}">编辑</button>
      <button class="btn-mini" data-delta="1" data-id="${escapeHtml(c.id)}">+1</button>
      <button class="btn-mini" data-delta="-1" data-id="${escapeHtml(c.id)}">-1</button>
    </div>
  `).join('');

    el.querySelectorAll('[data-edit-college]').forEach(btn => {
        btn.addEventListener('click', () => openEditCollege(btn.dataset.editCollege));
    });

    el.querySelectorAll('[data-delta]').forEach(btn => {
        btn.addEventListener('click', () => adjustScore(btn.dataset.id, parseInt(btn.dataset.delta, 10)));
    });
}

function openEditCollege(id) {
    const c = state.colleges.find(x => x.id === id);
    if (!c) return;

    editingCollegeId = id;
    qs('edit-college-name').value = c.name || '';
    qs('edit-college-color').value = normalizeHex(c.color) || '#4f8cff';
    openModal('edit-college-modal');
}

function normalizeHex(color) {
    if (!color) return '';
    const s = String(color).trim();
    if (/^#[0-9a-fA-F]{6}$/.test(s)) return s;
    if (/^#[0-9a-fA-F]{3}$/.test(s)) {
        return '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
    }
    return '';
}

async function saveEditCollege(btn) {
    if (!editingCollegeId) return;

    const name = qs('edit-college-name').value.trim();
    const color = qs('edit-college-color').value.trim();

    if (!name) { showToast('名称不能为空', 'error'); return; }

    setLoading(btn, true, '保存中...');
    const { data, error } = await supabase.rpc('admin_update_college', {
        p_id: editingCollegeId,
        p_name: name,
        p_color: color,
    });
    setLoading(btn, false);

    if (error || data?.error) {
        showToast('保存失败：' + (error?.message || data?.error), 'error');
        return;
    }

    closeModal('edit-college-modal');
    showToast('已保存', 'success');
    refreshColleges();
}

async function adjustScore(id, delta) {
    const { data, error } = await supabase.rpc('admin_adjust_college_score', {
        p_college_id: id,
        p_delta: delta,
    });

    if (error || data?.error) {
        showToast('调整失败：' + (error?.message || data?.error), 'error');
        return;
    }
    refreshColleges();
}

async function resetScores() {
    const ok = await confirmDialog({
        title: '重置所有学院分数',
        message: '所有学院分数将归零，不影响参与者与击杀记录。此操作不可撤销。',
        confirmText: '重置',
        danger: true,
    });
    if (!ok) return;

    const { data, error } = await supabase.rpc('admin_reset_college_scores');
    if (error || data?.error) {
        showToast('重置失败：' + (error?.message || data?.error), 'error');
        return;
    }
    showToast('分数已重置', 'success');
    refreshColleges();
}

function fillCollegeSelects() {
    const options = state.colleges.map(c =>
        `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`
    ).join('');

    ['p-college', 'edit-p-college', 'bulk-edit-house'].forEach(id => {
        const sel = qs(id);
        if (!sel) return;
        const cur = sel.value;
        sel.innerHTML = '<option value="">（不指定）</option>' + options;
        sel.value = cur;
    });

    const filterSel = qs('p-filter-college');
    if (filterSel) {
        const cur = filterSel.value;
        filterSel.innerHTML = '<option value="">全部学院</option>' + options;
        filterSel.value = cur;
    }
}

/* ============================================================
   每日规则
   ============================================================ */

export function initRules() {
    qs('btn-publish-rule')?.addEventListener('click', (e) => publishRule(e.currentTarget));
    qs('btn-clear-rule')?.addEventListener('click', () => {
        qs('rule-title').value = '';
        qs('rule-content').value = '';
    });
}

export async function refreshRules() {
    const el = qs('rules-list');
    if (el && !state.rules.length) el.innerHTML = skeletonRows(3, 2);

    const { data, error } = await supabase.rpc('admin_get_daily_rules');
    if (error || data?.error) {
        if (el) el.innerHTML = emptyState({
            title: '加载失败',
            desc: error?.message || data?.error,
        });
        return;
    }

    state.rules = Array.isArray(data) ? data : [];
    renderRules();
}

function renderRules() {
    const el = qs('rules-list');
    if (!el) return;

    if (!state.rules.length) {
        el.innerHTML = emptyState({
            title: '尚未发布任何规则',
            desc: '在上方表单填写标题与内容后点击发布。',
        });
        return;
    }

    el.innerHTML = state.rules
        .slice()
        .sort((a, b) => (a.day_number || 0) - (b.day_number || 0))
        .map(r => `
      <div class="admin-row" data-day="${r.day_number}">
        <span class="badge badge-info">Day ${r.day_number}</span>
        <span class="admin-name">${escapeHtml(r.title || '未命名')}</span>
        <span class="admin-meta">${r.published ? '已发布' : '未发布'}</span>
        <div class="grow"></div>
        <button class="btn-mini" data-edit-rule="${r.day_number}">编辑</button>
      </div>
    `).join('');

    el.querySelectorAll('[data-edit-rule]').forEach(btn => {
        btn.addEventListener('click', () => {
            const day = parseInt(btn.dataset.editRule, 10);
            const rule = state.rules.find(x => x.day_number === day);
            if (!rule) return;
            qs('rule-day').value = String(day);
            qs('rule-title').value = rule.title || '';
            qs('rule-content').value = rule.content || '';
            qs('rule-title').focus();
        });
    });
}

async function publishRule(btn) {
    const day = parseInt(qs('rule-day').value, 10);
    const title = qs('rule-title').value.trim();
    const content = qs('rule-content').value.trim();

    if (!title) { showToast('请填写标题', 'error'); return; }

    setLoading(btn, true, '发布中...');
    const { data, error } = await supabase.rpc('admin_publish_daily_rule', {
        p_day: day,
        p_title: title,
        p_content: content || '',
    });
    setLoading(btn, false);

    if (error || data?.error) {
        showToast('发布失败：' + (error?.message || data?.error), 'error');
        return;
    }
    showToast(`Day ${day} 规则已发布`, 'success');
    refreshRules();
}

/* ============================================================
   管理员
   ============================================================ */

export function initAdmins() {
    qs('btn-add-admin')?.addEventListener('click', (e) => addAdmin(e.currentTarget));
    qs('btn-refresh-admins')?.addEventListener('click', () => refreshAdmins());
}

export async function refreshAdmins() {
    const el = qs('admins-list');
    if (el && !el.dataset.loaded) el.innerHTML = skeletonRows(2, 2);

    const { data, error } = await supabase.rpc('admin_get_admins');
    if (error || data?.error) {
        if (el) el.innerHTML = emptyState({
            title: '加载失败',
            desc: error?.message || data?.error,
        });
        return;
    }

    if (el) el.dataset.loaded = '1';
    renderAdmins(Array.isArray(data) ? data : []);
}

function renderAdmins(list) {
    const el = qs('admins-list');
    if (!el) return;

    if (!list.length) {
        el.innerHTML = emptyState({ title: '暂无管理员' });
        return;
    }

    el.innerHTML = list.map(a => `
    <div class="admin-row">
      <span class="admin-name">${escapeHtml(a.name || '未命名')}</span>
      <span class="admin-meta">${escapeHtml(a.email)}</span>
      <div class="grow"></div>
      <button class="btn-mini btn-warn"
              data-delete-admin="${escapeHtml(a.id)}"
              data-name="${escapeHtml(a.name || a.email)}">移除</button>
    </div>
  `).join('');

    el.querySelectorAll('[data-delete-admin]').forEach(btn => {
        btn.addEventListener('click', () => removeAdmin(btn.dataset.deleteAdmin, btn.dataset.name));
    });
}

async function addAdmin(btn) {
    const email = qs('admin-email').value.trim();
    const name = qs('admin-name').value.trim();

    if (!email) { showToast('请输入邮箱', 'error'); return; }

    setLoading(btn, true, '添加中...');
    const { data, error } = await supabase.rpc('admin_add_admin', {
        p_email: email,
        p_name: name || null,
    });
    setLoading(btn, false);

    if (error || data?.error) {
        const errMap = {
            not_admin: '你不是管理员',
            invalid_school_email: '邮箱必须是学校邮箱',
            email_exists: '该管理员已存在',
            email_required: '邮箱不能为空',
        };
        showToast('添加失败：' + (errMap[data?.error] || error?.message || data?.error), 'error');
        return;
    }

    qs('admin-email').value = '';
    qs('admin-name').value = '';
    showToast('已添加', 'success');
    refreshAdmins();
}

async function removeAdmin(id, name) {
    const ok = await confirmDialog({
        title: '移除管理员',
        message: `是否确认将「<strong>${escapeHtml(name)}</strong>」的管理员职责移除？此操作不可撤销。`,
        confirmText: '移除',
        danger: true,
    });
    if (!ok) return;

    const { data, error } = await supabase.rpc('admin_delete_admin', { p_id: id });
    if (error || data?.error) {
        const errMap = {
            not_admin: '你不是管理员',
            admin_not_found: '该管理员不存在，可能已被删除',
            cannot_delete_self: '不能移除自己的管理员职责',
            must_keep_one_admin: '至少需要保留一名管理员',
        };
        showToast('移除失败：' + (errMap[data?.error] || error?.message || data?.error), 'error');
        return;
    }
    showToast('已移除', 'success');
    refreshAdmins();
}

/* ============================================================
   设置：首页板块可见性
   ============================================================ */

let settingsBound = false;

export function initSettings() {
    if (settingsBound) return;
    settingsBound = true;
    // 目前设置页只有可见性开关，事件在渲染时绑定
}

export async function refreshSettings() {
    await refreshSections();
}

async function refreshSections() {
    const el = qs('settings-sections');
    if (el && !el.dataset.loaded) el.innerHTML = skeletonRows(3, 2);

    const { data, error } = await supabase.rpc('admin_get_home_sections');

    if (error || data?.error) {
        if (el) el.innerHTML = emptyState({
            title: '加载失败',
            desc: error?.message || data?.error,
        });
        return;
    }

    if (el) el.dataset.loaded = '1';
    const list = Array.isArray(data) ? data : [];
    renderSections(list);
}

function renderSections(list) {
    const el = qs('settings-sections');
    if (!el) return;

    if (!list.length) {
        el.innerHTML = emptyState({ title: '暂无板块配置' });
        return;
    }

    el.innerHTML = list
        .slice()
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .map(s => `
      <div class="setting-row" data-key="${escapeHtml(s.key)}">
        <div>
          <div class="setting-label">${escapeHtml(s.label || s.key)}</div>
          <div class="setting-desc">未登录访客是否可见</div>
        </div>
        <label class="switch">
          <input type="checkbox" data-toggle-section="${escapeHtml(s.key)}" ${s.visible_to_public ? 'checked' : ''}>
          <span class="track"></span>
        </label>
      </div>
    `).join('');

    el.querySelectorAll('[data-toggle-section]').forEach(cb => {
        cb.addEventListener('change', async () => {
            const key = cb.dataset.toggleSection;
            const visible = cb.checked;
            cb.disabled = true;

            const { data, error } = await supabase.rpc('admin_set_home_section_visibility', {
                p_key: key,
                p_visible: visible,
            });

            cb.disabled = false;

            if (error || data?.error) {
                showToast('保存失败：' + (error?.message || data?.error), 'error');
                cb.checked = !visible;
                return;
            }
            showToast(`${visible ? '已开启' : '已关闭'}「${key}」公开可见`, 'success', 1800);
        });
    });
}