// js/admin.js
// 入口：会话守卫、Tab 路由、概览页、事件操作
import { supabase } from './supabase.js';
import { requireLogin, signOut, checkIsAdmin, getUser } from './auth.js';
import {
    qs, qsa, showToast, setLoading, confirmDialog,
    bindModalBackdrop, formatRelative, escapeHtml, emptyState,
} from './utils.js';
import { isPurpleHouse } from './public.js';
import {
    initParticipants, refreshParticipants, refreshParticipantsI18n,
} from './admin-participants.js';
import {
    initChain, refreshChain, refreshChainI18n,
} from './admin-chain.js';
import {
    initRecords, refreshRecords, refreshRecordsI18n,
} from './admin-records.js';
import {
    initColleges, refreshColleges,
    initRules, refreshRules,
    initAdmins, refreshAdmins,
    initSettings, refreshSettings, refreshMiscI18n,
} from './admin-misc.js';
import { t, initI18n, applyI18n, mountLanguageSwitcher } from './i18n.js';

initI18n();

/* ============================================================
   共享状态（供其它 admin-*.js 模块读取）
   ============================================================ */
export const state = {
    event: null,
    home: null,
    colleges: [],
    participants: [],
    chain: [],
    rules: [],
    history: [],
    eliminations: [],
    userEmail: '',
};

const TAB_KEYS = {
    overview: 'tab.overview',
    participants: 'tab.participants',
    colleges: 'tab.colleges',
    rules: 'tab.rules',
    chain: 'tab.chain',
    records: 'tab.records',
    admins: 'tab.admins',
    settings: 'tab.settings',
};

const MORE_TABS = ['colleges', 'rules', 'admins', 'settings'];

let currentTab = 'overview';

/* ============================================================
   Tab 路由
   ============================================================ */
export function goto(tab) {
    if (!TAB_KEYS[tab]) return;
    currentTab = tab;

    document.querySelectorAll('.modal-overlay').forEach(m => { m.style.display = 'none'; });
    document.body.style.overflow = '';

    closeMoreDrawer();

    // 侧边栏 / 底部导航高亮
    qsa('[data-nav]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.nav === tab);
    });

    // ✅ 关键：切换对应面板的 active 类（修复点）
    qsa('[data-panel]').forEach(p => {
        p.classList.toggle('active', p.dataset.panel === tab);
    });

    // 「更多」按钮：当前 Tab 属于抽屉时高亮
    const moreToggle = document.querySelector('[data-more-toggle]');
    if (moreToggle) {
        moreToggle.classList.toggle('active', MORE_TABS.includes(tab));
    }

    const titleEl = qs('topbar-title');
    if (titleEl) titleEl.textContent = t(TAB_KEYS[tab]);

    window.scrollTo({ top: 0, behavior: 'smooth' });
    refreshTab(tab);
}

export function refreshTab(tab = currentTab) {
    switch (tab) {
        case 'overview': return loadOverview();
        case 'participants': return refreshParticipants();
        case 'colleges': return refreshColleges();
        case 'rules': return refreshRules();
        case 'chain': return refreshChain();
        case 'records': return refreshRecords();
        case 'admins': return refreshAdmins();
        case 'settings': return refreshSettings();
    }
}

export function getCurrentTab() {
    return currentTab;
}

/* ============================================================
   概览页
   ============================================================ */
async function loadOverview() {
    const loadingEl = qs('overview-loading');
    const bodyEl = qs('overview-body');
    if (!loadingEl || !bodyEl) return;
    loadingEl.style.display = '';
    bodyEl.style.display = 'none';

    try {
        const [evt, cols, home, hist, rules] = await Promise.all([
            supabase.rpc('admin_get_event'),
            supabase.rpc('admin_get_colleges'),
            supabase.rpc('get_public_home'),
            supabase.rpc('admin_get_history', { p_limit: 5 }),
            supabase.rpc('admin_get_daily_rules'),
        ]);
        if (evt.error) throw evt.error;
        state.event = evt.data || null;
        state.colleges = Array.isArray(cols.data) ? cols.data : [];
        state.home = home.data || null;
        state.rules = Array.isArray(rules.data) ? rules.data : [];

        renderHero();
        renderSuggest();
        renderOverviewColleges();
        renderOverviewRule();
        renderOverviewRecent(Array.isArray(hist.data) ? hist.data : []);
        fillEventForm();

        loadingEl.style.display = 'none';
        bodyEl.style.display = '';
    } catch (err) {
        loadingEl.innerHTML = emptyState({
            title: t('common.loadFailed'),
            desc: err?.message || String(err),
        });
    }
}

function renderHero() {
    const event = state.event;
    const home = state.home || {};

    const statusKey = {
        draft: 'overview.statusDraft',
        active: 'overview.statusActive',
        paused: 'overview.statusPaused',
        ended: 'overview.statusEnded',
    };
    const badgeCls = {
        draft: 'badge-neutral',
        active: 'badge-success',
        paused: 'badge-warning',
        ended: 'badge-neutral',
    };
    const status = event?.status || 'draft';

    qs('hero-status').innerHTML = `<span class="badge ${badgeCls[status] || 'badge-neutral'}">` +
        `<span class="dot"></span>${escapeHtml(t(statusKey[status] || 'overview.statusDraft'))}</span>`;
    qs('hero-day-badge').innerHTML = event?.name
        ? `<span class="hint">${escapeHtml(event.name)}</span>` : '';
    qs('hero-alive').textContent = home.alive_count ?? '—';
    qs('hero-eliminated').textContent = home.eliminated_count ?? '—';
    qs('hero-day').textContent = status === 'active' && event?.current_day
        ? t('public.dayText', { n: event.current_day }) : '—';

    const actions = qs('hero-actions');
    if (!actions) return;
    if (!event) { actions.innerHTML = ''; return; }

    if (status === 'draft') {
        actions.innerHTML = `
      <button class="btn btn-primary" data-action="start">${escapeHtml(t('overview.startBtn'))}</button>
      <button class="btn btn-secondary" data-action="reshuffle">${escapeHtml(t('overview.reshuffleBtn'))}</button>
    `;
    } else if (status === 'active') {
        actions.innerHTML = `
      <button class="btn btn-secondary" data-action="pause">${escapeHtml(t('overview.pauseBtn'))}</button>
      <button class="btn btn-secondary" data-action="reshuffle">${escapeHtml(t('overview.reshuffleBtn'))}</button>
      <button class="btn btn-danger" data-action="end">${escapeHtml(t('overview.endBtn'))}</button>
    `;
    } else if (status === 'paused') {
        actions.innerHTML = `
      <button class="btn btn-primary" data-action="resume">${escapeHtml(t('overview.resumeBtn'))}</button>
      <button class="btn btn-secondary" data-action="reshuffle">${escapeHtml(t('overview.reshuffleBtn'))}</button>
      <button class="btn btn-danger" data-action="end">${escapeHtml(t('overview.endBtn'))}</button>
    `;
    } else {
        actions.innerHTML = `
      <button class="btn btn-primary" data-action="start">${escapeHtml(t('overview.startNewBtn'))}</button>
      <button class="btn btn-secondary" data-goto="records">${escapeHtml(t('overview.viewRecordsBtn'))}</button>
    `;
    }
}

function renderSuggest() {
    const bar = qs('suggest-bar');
    const textEl = qs('suggest-text');
    const actionEl = qs('suggest-action');
    if (!bar) return;
    const event = state.event;
    const home = state.home || {};
    if (!event) { bar.style.display = 'none'; return; }

    let msg = '';
    let actionLabel = '';
    let actionTab = '';

    if (event.status === 'draft') {
        if (!state.participants.length && !home.alive_count) {
            msg = t('overview.suggestDraftNoParticipants');
            actionLabel = t('overview.suggestGoAdd');
            actionTab = 'participants';
        } else {
            msg = t('overview.suggestDraftReady', { n: home.alive_count || state.participants.length || 0 });
            actionLabel = t('overview.suggestViewList');
            actionTab = 'participants';
        }
    } else if (event.status === 'active') {
        if (!home.today_rule) {
            msg = t('overview.suggestRuleMissing', { n: event.current_day });
            actionLabel = t('overview.suggestGoPublish');
            actionTab = 'rules';
        }
    } else if (event.status === 'paused') {
        msg = t('overview.suggestPaused');
    }

    if (!msg) { bar.style.display = 'none'; return; }
    bar.style.display = 'flex';
    textEl.textContent = msg;
    if (actionLabel && actionTab) {
        actionEl.style.display = '';
        actionEl.textContent = actionLabel;
        actionEl.dataset.goto = actionTab;
    } else {
        actionEl.style.display = 'none';
        delete actionEl.dataset.goto;
    }
}

function renderOverviewColleges() {
    const el = qs('overview-colleges');
    if (!el) return;

    const visibleColleges = state.colleges.filter(c =>
    !isPurpleHouse(c)
    );
    
    const colleges = visibleColleges;
    if (!colleges.length) {
        el.innerHTML = emptyState({
            title: t('overview.noColleges'),
            desc: t('overview.noCollegesHint'),
        });
        return;
    }
    el.innerHTML = colleges.map(c => `
    <div class="college-card" style="border-color:${escapeHtml(c.color || '#555')}">
      <div class="college-name" style="background:${escapeHtml(c.color || '#555')}">
        ${escapeHtml(c.name)}
      </div>
      <div class="college-score">${c.score ?? 0}</div>
      <div class="college-count">${escapeHtml(t('colleges.peopleUnit', { n: c.participant_count ?? 0 }))}</div>
    </div>
  `).join('');
}

function renderOverviewRule() {
    const el = qs('overview-rule');
    if (!el) return;
    const rule = state.home?.today_rule;
    if (!rule) {
        const extra = state.event?.status === 'active' ? t('overview.noRuleHint') : '';
        el.innerHTML = `<p class="hint">${escapeHtml(t('overview.noRule') + extra)}</p>`;
        return;
    }
    el.innerHTML = `
    <div style="font-weight:600;margin-bottom:6px">${escapeHtml(rule.title || t('rules.unnamed'))}</div>
    <div class="hint" style="white-space:pre-wrap;line-height:1.6">${escapeHtml(rule.content || '')}</div>
  `;
}

function renderOverviewRecent(list) {
    const el = qs('overview-recent');
    if (!el) return;
    if (!list.length) {
        el.innerHTML = `<p class="hint">${escapeHtml(t('overview.noRecent'))}</p>`;
        return;
    }
    el.innerHTML = list.slice(0, 5).map(h => {
        const time = formatRelative(h.happened_at);
        const d = h.details || {};
        let body = '';
        if (h.type === 'kill') {
            body = t('records.historyKillSentence', {
                hunter: `<strong>${escapeHtml(d.hunter_name || '?')}</strong>`,
                target: `<strong>${escapeHtml(d.target_name || '?')}</strong>`,
            });
        } else if (h.type === 'revoke') {
            body = `<span class="history-tag tag-revoke">${escapeHtml(t('records.tagRevoke'))}</span>` +
                t('records.historyRevokeSentence', {
                    hunter: `<strong>${escapeHtml(d.hunter_name || '?')}</strong>`,
                    target: `<strong>${escapeHtml(d.target_name || '?')}</strong>`,
                });
        } else if (h.type === 'reinsert') {
            body = `<span class="history-tag tag-reinsert">${escapeHtml(t('records.tagReinsert'))}</span>` +
                t('records.historyReinsertSentence', {
                    name: `<strong>${escapeHtml(d.participant_name || '?')}</strong>`,
                    hunter: `<strong>${escapeHtml(d.hunter_name || '?')}</strong>`,
                });
        } else {
            body = escapeHtml(h.type || '');
        }
        return `
      <div class="history-item">
        <div class="history-time">${escapeHtml(time)}</div>
        <div class="history-content">${body}</div>
      </div>`;
    }).join('');
}

function fillEventForm() {
    const evt = state.event;
    const nameEl = qs('event-name');
    const dayEl = qs('event-day');
    if (!evt) return;
    if (nameEl) nameEl.value = evt.name || '';
    if (dayEl) dayEl.value = evt.current_day || 1;
}

/* ============================================================
   事件操作
   ============================================================ */
async function handleStart(btn) {
    const isRestart = state.event?.status === 'ended';
    const message = isRestart
        ? t('overview.startConfirmRestart')
        : t('overview.startConfirmDraft');
    const label = isRestart ? t('overview.startNewBtn') : t('overview.startBtn');

    const ok = await confirmDialog({
        title: label,
        message,
        confirmText: label,
        danger: true,
        requireInput: {
            label: t('overview.startInputLabel', { label }),
            value: label,
            placeholder: label,
        },
    });
    if (!ok) return;

    setLoading(btn, true, t('common.loading'));

    let { data, error } = await supabase.rpc('admin_start_event', { p_strict_house: true });

    if (!error && data?.error === 'cannot_avoid_same_house') {
        setLoading(btn, false);
        const ignoreOk = await confirmDialog({
            title: t('overview.cannotAvoidHouse'),
            message: t('overview.cannotAvoidHouseMsg', {
                name: escapeHtml(data.max_house_name || '?'),
                count: data.max_count,
                total: data.total,
            }),
            confirmText: t('overview.ignoreHouseRule'),
            cancelText: t('common.cancel'),
            danger: false,
        });
        if (!ignoreOk) return;
        setLoading(btn, true, t('common.loading'));
        ({ data, error } = await supabase.rpc('admin_start_event', { p_strict_house: false }));
    }

    setLoading(btn, false);

    if (error || data?.error) {
        const msg = errKeyToText(data?.error) || error?.message || data?.error || '';
        showToast(t('overview.startFailed', { msg }), 'error');
        return;
    }
    const suffix = data?.strict_house
        ? t('overview.startSuffixStrict')
        : t('overview.startSuffixLoose');
    showToast(t('overview.startSuccess', { n: data?.count ?? '?', suffix }), 'success');
    loadOverview();
}

async function handleReshuffle(btn) {
    const ok = await confirmDialog({
        title: t('overview.reshuffleConfirmText'),
        message: t('overview.reshuffleConfirm'),
        confirmText: t('overview.reshuffleConfirmText'),
        danger: false,
    });
    if (!ok) return;
    setLoading(btn, true, t('common.loading'));
    const { data, error } = await supabase.rpc('admin_reshuffle_alive');
    setLoading(btn, false);
    if (error || data?.error) {
        showToast(t('overview.reshuffleFailed', { msg: error?.message || data?.error }), 'error');
        return;
    }
    showToast(t('overview.reshuffleSuccess', { n: data?.alive_count ?? '?' }), 'success');
    loadOverview();
}

async function handlePause(btn) {
    const ok = await confirmDialog({
        title: t('overview.pauseConfirmText'),
        message: t('overview.pauseConfirm'),
        confirmText: t('overview.pauseConfirmText'),
        danger: false,
    });
    if (!ok) return;
    setLoading(btn, true, t('common.loading'));
    const { data, error } = await supabase.rpc('admin_pause_event');
    setLoading(btn, false);
    if (error || data?.error) {
        showToast(t('overview.pauseFailed', { msg: error?.message || data?.error }), 'error');
        return;
    }
    showToast(t('overview.pauseSuccess'), 'success');
    loadOverview();
}

async function handleResume(btn) {
    setLoading(btn, true, t('common.loading'));
    const { data, error } = await supabase.rpc('admin_resume_event');
    setLoading(btn, false);
    if (error || data?.error) {
        showToast(t('overview.resumeFailed', { msg: error?.message || data?.error }), 'error');
        return;
    }
    showToast(t('overview.resumeSuccess'), 'success');
    loadOverview();
}

async function handleEnd(btn) {
    const endText = t('overview.endConfirmText');
    const ok = await confirmDialog({
        title: endText,
        message: t('overview.endConfirm'),
        confirmText: endText,
        danger: true,
        requireInput: {
            label: t('overview.endInputLabel'),
            value: endText,
            placeholder: endText,
        },
    });
    if (!ok) return;
    setLoading(btn, true, t('common.loading'));
    const { data, error } = await supabase.rpc('admin_end_event', { p_confirm: endText });
    setLoading(btn, false);
    if (error || data?.error) {
        showToast(t('overview.endFailed', { msg: error?.message || data?.error }), 'error');
        return;
    }
    showToast(t('overview.endSuccess'), 'success');
    loadOverview();
}

async function saveEventConfig(btn) {
    const name = qs('event-name')?.value.trim();
    const dayRaw = qs('event-day')?.value;
    const day = parseInt(dayRaw, 10);

    if (!name) { showToast(t('overview.enterEventName'), 'error'); return; }
    if (!day || day < 1 || day > 5) { showToast(t('overview.dayRange'), 'error'); return; }

    setLoading(btn, true, t('common.saving'));
    const { data, error } = await supabase.rpc('admin_update_event', {
        p_name: name,
        p_current_day: day,
    });
    setLoading(btn, false);

    if (error || data?.error) {
        showToast(t('overview.saveFailed', { msg: error?.message || data?.error }), 'error');
        return;
    }
    showToast(t('common.save') + ' ✓', 'success');
    const hintEl = qs('event-save-hint');
    if (hintEl) {
        hintEl.textContent = t('overview.savedHint');
        setTimeout(() => { hintEl.textContent = ''; }, 2000);
    }
    loadOverview();
}

function errKeyToText(code) {
    if (!code) return '';
    const key = 'error.' + code;
    const val = t(key);
    return val === key ? '' : val;
}

/* ============================================================
   全局事件委托
   ============================================================ */
function bindGlobalDelegation() {
    document.addEventListener('click', (e) => {
        const gotoBtn = e.target.closest('[data-goto]');
        if (gotoBtn && gotoBtn.dataset.goto) {
            e.preventDefault();
            goto(gotoBtn.dataset.goto);
            return;
        }
        const actionBtn = e.target.closest('[data-action]');
        if (actionBtn) {
            const action = actionBtn.dataset.action;
            if (action === 'start') handleStart(actionBtn);
            else if (action === 'reshuffle') handleReshuffle(actionBtn);
            else if (action === 'pause') handlePause(actionBtn);
            else if (action === 'resume') handleResume(actionBtn);
            else if (action === 'end') handleEnd(actionBtn);
        }
    });

    window.addEventListener('ninjatag:refresh-overview', () => {
        if (currentTab === 'overview') loadOverview();
    });
}

/* ============================================================
   移动端「更多」抽屉
   ============================================================ */
function closeMoreDrawer() {
    const drawer = qs('more-drawer');
    if (!drawer) return;
    drawer.classList.remove('is-open');
    drawer.setAttribute('aria-hidden', 'true');
}

function openMoreDrawer() {
    const drawer = qs('more-drawer');
    if (!drawer) return;
    drawer.classList.add('is-open');
    drawer.setAttribute('aria-hidden', 'false');
}

function initMoreDrawer() {
    const drawer = qs('more-drawer');
    if (!drawer || drawer.dataset.bound === '1') return;
    drawer.dataset.bound = '1';
    const toggle = document.querySelector('[data-more-toggle]');
    toggle?.addEventListener('click', () => {
        if (drawer.classList.contains('is-open')) closeMoreDrawer();
        else openMoreDrawer();
    });
    drawer.querySelectorAll('[data-more-close]').forEach(el => {
        el.addEventListener('click', closeMoreDrawer);
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && drawer.classList.contains('is-open')) {
            closeMoreDrawer();
        }
    });
}

/* ============================================================
   启动
   ============================================================ */
async function boot() {
    applyI18n();
    mountLanguageSwitcher('sidebar-lang-switch');
    mountLanguageSwitcher('drawer-lang-switch');

    // 语言切换：重绘静态文本 + 各模块 i18n 刷新 + 当前 Tab
    window.addEventListener('localechange', () => {
        applyI18n();
        const titleEl = qs('topbar-title');
        if (titleEl) titleEl.textContent = t(TAB_KEYS[currentTab] || 'tab.overview');
        // 各模块内部缓存的状态需要按新语言重绘
        try { refreshParticipantsI18n(); } catch (_) { /* ignore */ }
        try { refreshChainI18n(); } catch (_) { /* ignore */ }
        try { refreshRecordsI18n(); } catch (_) { /* ignore */ }
        try { refreshMiscI18n(); } catch (_) { /* ignore */ }
        // 概览页和当前 Tab 重新拉取数据（保险起见）
        if (currentTab === 'overview') loadOverview();
    });

    const session = await requireLogin();
    if (!session) return;

    const isAdmin = await checkIsAdmin();
    if (!isAdmin) {
        showToast(t('admin.notAdmin'), 'error');
        setTimeout(() => { window.location.href = 'index.html'; }, 1500);
        return;
    }

    const user = await getUser();
    state.userEmail = user?.email || '';
    const userLine = qs('sidebar-user');
    if (userLine) userLine.textContent = state.userEmail || '—';

    qsa('[data-nav]').forEach(btn => {
        btn.addEventListener('click', () => goto(btn.dataset.nav));
    });

    qs('nav-logout')?.addEventListener('click', (e) => {
        e.preventDefault();
        signOut();
    });

    ['edit-participant-modal', 'import-modal', 'kill-reason-modal', 'confirm-modal',
        'bulk-edit-modal', 'edit-college-modal'].forEach(bindModalBackdrop);

    qs('btn-save-event')?.addEventListener('click', (e) => saveEventConfig(e.currentTarget));

    bindGlobalDelegation();
    initMoreDrawer();

    initParticipants();
    initChain();
    initRecords();
    initColleges();
    initRules();
    initAdmins();
    initSettings();

    goto('overview');
}

document.addEventListener('DOMContentLoaded', boot);