// js/admin-misc.js
// 学院 / 每日规则 / 管理员 / 设置（首页可见性）
import { supabase } from './supabase.js';
import { state } from './admin.js';
import {
    qs, showToast, setLoading, confirmDialog, openModal, closeModal,
    escapeHtml, skeletonRows, emptyState,
} from './utils.js';
import { t } from './i18n.js';

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
            title: t('common.loadFailed'),
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
        el.innerHTML = emptyState({ title: t('colleges.noData') });
        return;
    }

    el.innerHTML = state.colleges.map(c => {
        const scoreLabel = t('colleges.scoreUnit', { n: c.score ?? 0 });
        const peopleLabel = t('colleges.peopleUnit', { n: c.participant_count ?? 0 });
        return `
      <div class="admin-row" data-id="${escapeHtml(c.id)}">
        <span class="color-dot" style="background:${escapeHtml(c.color || '#555')}"></span>
        <span class="admin-name">${escapeHtml(c.name)}</span>
        <span class="admin-meta">${escapeHtml(scoreLabel)} · ${escapeHtml(peopleLabel)}</span>
        <div class="grow"></div>
        <button class="btn-mini" data-edit-college="${escapeHtml(c.id)}">${escapeHtml(t('colleges.editBtn'))}</button>
        <button class="btn-mini" data-delta="1" data-id="${escapeHtml(c.id)}">+1</button>
        <button class="btn-mini" data-delta="-1" data-id="${escapeHtml(c.id)}">-1</button>
      </div>
    `;
    }).join('');

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

    if (!name) { showToast(t('colleges.nameRequired'), 'error'); return; }

    setLoading(btn, true, t('common.saving'));

    const { data, error } = await supabase.rpc('admin_update_college', {
        p_id: editingCollegeId,
        p_name: name,
        p_color: color,
    });

    setLoading(btn, false);

    if (error || data?.error) {
        showToast(t('colleges.saveFailed', { msg: error?.message || data?.error }), 'error');
        return;
    }

    closeModal('edit-college-modal');
    showToast(t('colleges.saved'), 'success');
    refreshColleges();
}

async function adjustScore(id, delta) {
    const { data, error } = await supabase.rpc('admin_adjust_college_score', {
        p_college_id: id,
        p_delta: delta,
    });

    if (error || data?.error) {
        showToast(t('colleges.adjustFailed', { msg: error?.message || data?.error }), 'error');
        return;
    }
    refreshColleges();
}

async function resetScores() {
    const ok = await confirmDialog({
        title: t('colleges.resetTitle'),
        message: t('colleges.resetMessage'),
        confirmText: t('colleges.resetConfirm'),
        danger: true,
    });
    if (!ok) return;

    const { data, error } = await supabase.rpc('admin_reset_college_scores');

    if (error || data?.error) {
        showToast(t('colleges.resetFailed', { msg: error?.message || data?.error }), 'error');
        return;
    }
    showToast(t('colleges.resetSuccess'), 'success');
    refreshColleges();
}

function fillCollegeSelects() {
    const options = state.colleges.map(c =>
        `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`
    ).join('');
    const unsetLabel = escapeHtml(t('participants.gradeUnset'));

    ['p-college', 'edit-p-college', 'bulk-edit-house'].forEach(id => {
        const sel = qs(id);
        if (!sel) return;
        const cur = sel.value;
        sel.innerHTML = `<option value="">${unsetLabel}</option>` + options;
        sel.value = cur;
    });

    const filterSel = qs('p-filter-college');
    if (filterSel) {
        const cur = filterSel.value;
        filterSel.innerHTML = `<option value="">${escapeHtml(t('participants.filterAllColleges'))}</option>` + options;
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
            title: t('common.loadFailed'),
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
            title: t('rules.noData'),
            desc: t('rules.noDataDesc'),
        });
        return;
    }

    el.innerHTML = state.rules.slice()
        .sort((a, b) => (a.day_number || 0) - (b.day_number || 0))
        .map(r => `
      <div class="admin-row" data-day="${r.day_number}">
        <span class="badge badge-info">${escapeHtml(t('rules.dayOption', { n: r.day_number }))}</span>
        <span class="admin-name">${escapeHtml(r.title || t('rules.unnamed'))}</span>
        <span class="admin-meta">${escapeHtml(r.published ? t('rules.published') : t('rules.unpublished'))}</span>
        <div class="grow"></div>
        <button class="btn-mini" data-edit-rule="${r.day_number}">${escapeHtml(t('rules.editBtn'))}</button>
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

    if (!title) { showToast(t('rules.enterTitle'), 'error'); return; }

    setLoading(btn, true, t('rules.publishing'));

    const { data, error } = await supabase.rpc('admin_publish_daily_rule', {
        p_day: day,
        p_title: title,
        p_content: content || '',
    });

    setLoading(btn, false);

    if (error || data?.error) {
        showToast(t('rules.publishFailed', { msg: error?.message || data?.error }), 'error');
        return;
    }
    showToast(t('rules.publishSuccess', { n: day }), 'success');
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
            title: t('common.loadFailed'),
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
        el.innerHTML = emptyState({ title: t('admins.noData') });
        return;
    }

    el.innerHTML = list.map(a => `
    <div class="admin-row">
      <span class="admin-name">${escapeHtml(a.name || t('admins.unnamed'))}</span>
      <span class="admin-meta">${escapeHtml(a.email)}</span>
      <div class="grow"></div>
      <button class="btn-mini btn-warn"
              data-delete-admin="${escapeHtml(a.id)}"
              data-name="${escapeHtml(a.name || a.email)}">${escapeHtml(t('admins.removeBtn'))}</button>
    </div>
  `).join('');

    el.querySelectorAll('[data-delete-admin]').forEach(btn => {
        btn.addEventListener('click', () => removeAdmin(btn.dataset.deleteAdmin, btn.dataset.name));
    });
}

async function addAdmin(btn) {
    const email = qs('admin-email').value.trim();
    const name = qs('admin-name').value.trim();

    if (!email) { showToast(t('admins.enterEmail'), 'error'); return; }

    setLoading(btn, true, t('admins.adding'));

    const { data, error } = await supabase.rpc('admin_add_admin', {
        p_email: email,
        p_name: name || null,
    });

    setLoading(btn, false);

    if (error || data?.error) {
        const msg = mapAddAdminErr(data?.error) || error?.message || data?.error;
        showToast(t('admins.addFailed', { msg }), 'error');
        return;
    }

    qs('admin-email').value = '';
    qs('admin-name').value = '';
    showToast(t('admins.addSuccess'), 'success');
    refreshAdmins();
}

function mapAddAdminErr(code) {
    const m = {
        not_admin: t('admins.errNotAdmin'),
        invalid_school_email: t('admins.errInvalidEmail'),
        email_exists: t('admins.errExists'),
        email_required: t('admins.errEmailRequired'),
    };
    return m[code];
}

async function removeAdmin(id, name) {
    const ok = await confirmDialog({
        title: t('admins.removeTitle'),
        message: t('admins.removeMessage', { name: escapeHtml(name) }),
        confirmText: t('admins.removeConfirm'),
        danger: true,
    });
    if (!ok) return;

    const { data, error } = await supabase.rpc('admin_delete_admin', { p_id: id });

    if (error || data?.error) {
        const msg = mapRemoveAdminErr(data?.error) || error?.message || data?.error || t('common.deleteFailed');
        showToast(t('admins.removeFailed', { msg }), 'error');
        return;
    }
    showToast(t('admins.removeSuccess'), 'success');
    refreshAdmins();
}

function mapRemoveAdminErr(code) {
    const m = {
        not_admin: t('admins.errNotAdmin'),
        admin_not_found: t('admins.errNotFound'),
        cannot_delete_self: t('admins.errCannotDeleteSelf'),
        must_keep_one_admin: t('admins.errMustKeepOne'),
        foreign_key_violation: t('admins.errForeignKey'),
    };
    return m[code];
}

/* ============================================================
   设置：首页板块可见性（分组渲染）
   ============================================================ */
const SECTION_CHILDREN = {
    winner: ['winner_personal', 'winner_college', 'winner_most_kills', 'winner_fastest_death'],
};

// 数据库 key → i18n key 映射（让板块名称跟随 UI 语言）
const SECTION_LABEL_KEYS = {
    event: 'public.eventTitle',
    colleges: 'public.collegesTitle',
    counts: 'public.countsTitle',
    today_rule: 'public.todayRuleTitle',
    alive_wall: 'public.aliveWallTitle',
    winner: 'public.winnerTitle',
    winner_personal: 'public.winnerPersonal',
    winner_college: 'public.winnerCollege',
    winner_most_kills: 'public.winnerMostKills',
    winner_fastest_death: 'public.winnerFastestDeath',
};

let settingsBound = false;

export function initSettings() {
    if (settingsBound) return;
    settingsBound = true;
}

export async function refreshSettings() {
    await refreshSections();
}

// 供 admin.js 在语言切换时调用
export function refreshMiscI18n() {
    renderColleges();
    renderRules();
    // 设置页重新渲染
    const el = qs('settings-sections');
    if (el && el.dataset.loaded) {
        el.dataset.loaded = '';
        refreshSections();
    }
}

function sectionLabel(s) {
    const key = SECTION_LABEL_KEYS[s.key];
    return key ? t(key) : (s.label || s.key);
}

async function refreshSections() {
    const el = qs('settings-sections');
    if (el && !el.dataset.loaded) el.innerHTML = skeletonRows(3, 2);

    const { data, error } = await supabase.rpc('admin_get_home_sections');

    if (error || data?.error) {
        if (el) el.innerHTML = emptyState({
            title: t('common.loadFailed'),
            desc: error?.message || data?.error,
        });
        return;
    }
    if (el) el.dataset.loaded = '1';
    renderSections(Array.isArray(data) ? data : []);
}

function renderSections(list) {
    const el = qs('settings-sections');
    if (!el) return;

    if (!list.length) {
        el.innerHTML = emptyState({ title: t('settings.noSections') });
        return;
    }

    const map = new Map(list.map(s => [s.key, s]));
    const childKeys = new Set(Object.values(SECTION_CHILDREN).flat());
    const roots = list
        .filter(s => !childKeys.has(s.key))
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

    el.innerHTML = roots.map(root => {
        const childKeyList = SECTION_CHILDREN[root.key] || [];
        const children = childKeyList.map(k => map.get(k)).filter(Boolean);
        if (!children.length) return plainRow(root);
        return groupHtml(root, children);
    }).join('');

    bindSectionToggles(el);
}

function plainRow(s) {
    return `
    <div class="setting-row" data-key="${escapeHtml(s.key)}">
      <div>
        <div class="setting-label">${escapeHtml(sectionLabel(s))}</div>
        <div class="setting-desc">${escapeHtml(t('settings.visibleDesc'))}</div>
      </div>
      <label class="switch">
        <input type="checkbox" data-toggle-section="${escapeHtml(s.key)}" ${s.visible_to_public ? 'checked' : ''}>
        <span class="track"></span>
      </label>
    </div>
  `;
}

function groupHtml(parent, children) {
    const parentDisabled = !parent.visible_to_public;
    return `
    <div class="setting-group" data-group="${escapeHtml(parent.key)}">
      <div class="setting-row is-parent" data-key="${escapeHtml(parent.key)}">
        <div>
          <div class="setting-label">${escapeHtml(sectionLabel(parent))}</div>
          <div class="setting-desc">${escapeHtml(t('settings.groupParentDesc'))}</div>
        </div>
        <label class="switch">
          <input type="checkbox" data-toggle-section="${escapeHtml(parent.key)}" data-role="parent" ${parent.visible_to_public ? 'checked' : ''}>
          <span class="track"></span>
        </label>
      </div>

      <div class="setting-children ${parentDisabled ? 'is-disabled' : ''}" data-children="${escapeHtml(parent.key)}">
        ${children.map(c => `
          <div class="setting-row" data-key="${escapeHtml(c.key)}">
            <div>
              <div class="setting-label">${escapeHtml(sectionLabel(c))}</div>
            </div>
            <label class="switch">
              <input type="checkbox"
                     data-toggle-section="${escapeHtml(c.key)}"
                     data-role="child"
                     data-parent="${escapeHtml(parent.key)}"
                     ${c.visible_to_public ? 'checked' : ''}
                     ${parentDisabled ? 'disabled' : ''}>
              <span class="track"></span>
            </label>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function bindSectionToggles(el) {
    el.querySelectorAll('[data-toggle-section]').forEach(cb => {
        cb.addEventListener('change', async () => {
            const key = cb.dataset.toggleSection;
            const visible = cb.checked;
            const role = cb.dataset.role;
            const label = sectionLabel({ key });

            if (role === 'parent') {
                const group = el.querySelector(`[data-children="${key}"]`);
                if (group) {
                    group.classList.toggle('is-disabled', !visible);
                    group.querySelectorAll('input[type="checkbox"]').forEach(childCb => {
                        childCb.disabled = !visible;
                    });
                }
            }

            cb.disabled = true;
            const { data, error } = await supabase.rpc('admin_set_home_section_visibility', {
                p_key: key,
                p_visible: visible,
            });
            cb.disabled = false;

            if (error || data?.error) {
                showToast(t('settings.visibilityFailed', { msg: error?.message || data?.error }), 'error');
                cb.checked = !visible;
                if (role === 'parent') {
                    const group = el.querySelector(`[data-children="${key}"]`);
                    if (group) {
                        group.classList.toggle('is-disabled', visible);
                        group.querySelectorAll('input[type="checkbox"]').forEach(childCb => {
                            childCb.disabled = visible;
                        });
                    }
                }
                return;
            }

            const stateLabel = visible ? t('settings.enabled') : t('settings.disabled');
            showToast(`${stateLabel}「${label}」`, 'success', 1500);
        });
    });
}