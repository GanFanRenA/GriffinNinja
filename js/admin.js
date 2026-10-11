// js/admin.js
// 入口：会话守卫、Tab 路由、概览页、事件操作

import { supabase } from './supabase.js';
import { requireLogin, signOut, checkIsAdmin, getUser } from './auth.js';
import {
    qs, qsa, showToast, setLoading, confirmDialog,
    bindModalBackdrop, formatRelative, escapeHtml,
    emptyState,
} from './utils.js';

import { initParticipants, refreshParticipants } from './admin-participants.js';
import { initChain, refreshChain } from './admin-chain.js';
import { initRecords, refreshRecords } from './admin-records.js';
import {
    initColleges, refreshColleges,
    initRules, refreshRules,
    initAdmins, refreshAdmins,
    initSettings, refreshSettings,
} from './admin-misc.js';

/* ============================================================
   共享状态（供其它 admin-*.js 模块读取）
   ============================================================ */

export const state = {
    event: null,           // { id, name, status, current_day }
    home: null,            // get_public_home 返回值
    colleges: [],          // admin_get_colleges
    participants: [],      // admin_get_participants
    chain: [],             // admin_get_global_chain
    rules: [],             // admin_get_daily_rules
    history: [],           // admin_get_history
    eliminations: [],      // admin_get_eliminations
    userEmail: '',
};

const TAB_TITLES = {
    overview: '概览',
    participants: '参与者',
    colleges: '学院',
    rules: '每日规则',
    chain: '全局链',
    records: '记录',
    admins: '管理员',
    settings: '设置',
};

let currentTab = 'overview';

/* ============================================================
   Tab 路由
   ============================================================ */

export function goto(tab) {
    if (!TAB_TITLES[tab]) return;
    currentTab = tab;

    qsa('[data-nav]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.nav === tab);
    });

    qsa('[data-panel]').forEach(p => {
        p.classList.toggle('active', p.dataset.panel === tab);
    });

    const titleEl = qs('topbar-title');
    if (titleEl) titleEl.textContent = TAB_TITLES[tab];

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

// 供外部模块读取当前 Tab
export function getCurrentTab() { return currentTab; }

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
            title: '加载失败',
            desc: err?.message || String(err),
        });
    }
}

function renderHero() {
    const event = state.event;
    const home = state.home || {};

    const statusMap = {
        draft: '未开始',
        active: '进行中',
        paused: '已暂停',
        ended: '已结束',
    };
    const badgeCls = {
        draft: 'badge-neutral',
        active: 'badge-success',
        paused: 'badge-warning',
        ended: 'badge-neutral',
    };

    const status = event?.status || 'draft';

    qs('hero-status').innerHTML =
        `<span class="badge ${badgeCls[status] || 'badge-neutral'}">` +
        `<span class="dot"></span>${escapeHtml(statusMap[status] || status)}</span>`;

    qs('hero-day-badge').innerHTML = event?.name
        ? `<span class="hint">${escapeHtml(event.name)}</span>`
        : '';

    qs('hero-alive').textContent = home.alive_count ?? '—';
    qs('hero-eliminated').textContent = home.eliminated_count ?? '—';
    qs('hero-day').textContent =
        status === 'active' && event?.current_day ? `Day ${event.current_day}` : '—';

    const actions = qs('hero-actions');
    if (!actions) return;

    if (!event) {
        actions.innerHTML = '';
        return;
    }

    if (status === 'draft') {
        actions.innerHTML = `
      <button class="btn btn-primary" data-action="start">开始活动</button>
      <button class="btn btn-secondary" data-action="reshuffle">重新打乱</button>
    `;
    } else if (status === 'active') {
        actions.innerHTML = `
      <button class="btn btn-secondary" data-action="pause">暂停活动</button>
      <button class="btn btn-secondary" data-action="reshuffle">重新打乱</button>
      <button class="btn btn-danger" data-action="end">结束活动</button>
    `;
    } else if (status === 'paused') {
        actions.innerHTML = `
      <button class="btn btn-primary" data-action="resume">继续活动</button>
      <button class="btn btn-secondary" data-action="reshuffle">重新打乱</button>
      <button class="btn btn-danger" data-action="end">结束活动</button>
    `;
    } else {
        actions.innerHTML = `
      <button class="btn btn-secondary" data-goto="records">查看记录</button>
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
            msg = '还没有参与者，先导入名单再开始活动。';
            actionLabel = '去添加';
            actionTab = 'participants';
        } else {
            msg = `已准备 ${home.alive_count || state.participants.length || 0} 名参与者，可以开始活动。`;
            actionLabel = '查看名单';
            actionTab = 'participants';
        }
    } else if (event.status === 'active') {
        if (!home.today_rule) {
            msg = `Day ${event.current_day} 的规则尚未发布。`;
            actionLabel = '去发布';
            actionTab = 'rules';
        }
    } else if (event.status === 'paused') {
        msg = '活动已暂停，所有击杀已冻结。';
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

    const colleges = state.colleges;
    if (!colleges.length) {
        el.innerHTML = emptyState({ title: '暂无学院', desc: '请先在「学院」标签添加学院。' });
        return;
    }

    el.innerHTML = colleges.map(c => `
    <div class="college-card" style="border-color:${escapeHtml(c.color || '#555')}">
      <div class="college-name" style="background:${escapeHtml(c.color || '#555')}">
        ${escapeHtml(c.name)}
      </div>
      <div class="college-score">${c.score ?? 0}</div>
      <div class="college-count">${c.participant_count ?? 0} 人</div>
    </div>
  `).join('');
}

function renderOverviewRule() {
    const el = qs('overview-rule');
    if (!el) return;

    const rule = state.home?.today_rule;
    if (!rule) {
        el.innerHTML = `<p class="hint">今日暂无规则。${state.event?.status === 'active' ? ' 可前往「每日规则」发布。' : ''
            }</p>`;
        return;
    }

    el.innerHTML = `
    <div style="font-weight:600;margin-bottom:6px">${escapeHtml(rule.title || '未命名')}</div>
    <div class="hint" style="white-space:pre-wrap;line-height:1.6">${escapeHtml(rule.content || '')}</div>
  `;
}

function renderOverviewRecent(list) {
    const el = qs('overview-recent');
    if (!el) return;

    if (!list.length) {
        el.innerHTML = `<p class="hint">暂无动态。</p>`;
        return;
    }

    el.innerHTML = list.slice(0, 5).map(h => {
        const t = formatRelative(h.happened_at);
        const d = h.details || {};
        let body = '';

        if (h.type === 'kill') {
            body = `<strong>${escapeHtml(d.hunter_name || '?')}</strong> 击杀了 ` +
                `<strong>${escapeHtml(d.target_name || '?')}</strong>`;
        } else if (h.type === 'revoke') {
            body = `<span class="history-tag tag-revoke">撤销</span>` +
                `撤销了 <strong>${escapeHtml(d.hunter_name || '?')}</strong> 击杀 ` +
                `<strong>${escapeHtml(d.target_name || '?')}</strong>`;
        } else if (h.type === 'reinsert') {
            body = `<span class="history-tag tag-reinsert">复活</span>` +
                `<strong>${escapeHtml(d.participant_name || '?')}</strong> 重新加入`;
        } else {
            body = escapeHtml(h.type || '');
        }

        return `
      <div class="history-item">
        <div class="history-time">${t}</div>
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
    const ok = await confirmDialog({
        title: '开始活动',
        message: '将重置所有参与者状态、生成新代码、随机生成击杀环，并把所有学院分归零。已有的击杀记录将被清空。',
        confirmText: '开始活动',
        danger: true,
    });
    if (!ok) return;

    setLoading(btn, true, '开始中...');
    const { data, error } = await supabase.rpc('admin_start_event');
    setLoading(btn, false);

    if (error || data?.error) {
        showToast('开始失败：' + (error?.message || data?.error), 'error');
        return;
    }
    showToast(`活动已开始，共 ${data?.count ?? '?'} 人`, 'success');
    loadOverview();
}

async function handleReshuffle(btn) {
    const ok = await confirmDialog({
        title: '重新打乱存活者',
        message: '将只对当前存活者重新生成击杀环，不影响已淘汰者，学院分保持不变。',
        confirmText: '确认打乱',
        danger: false,
    });
    if (!ok) return;

    setLoading(btn, true, '打乱中...');
    const { data, error } = await supabase.rpc('admin_reshuffle_alive');
    setLoading(btn, false);

    if (error || data?.error) {
        showToast('打乱失败：' + (error?.message || data?.error), 'error');
        return;
    }
    showToast(`已打乱 ${data?.alive_count ?? '?'} 名存活者`, 'success');
    loadOverview();
}

async function handlePause(btn) {
    const ok = await confirmDialog({
        title: '暂停活动',
        message: '暂停期间所有击杀将被冻结，参与者仍可查看自己的目标。',
        confirmText: '暂停',
        danger: false,
    });
    if (!ok) return;

    setLoading(btn, true, '暂停中...');
    const { data, error } = await supabase.rpc('admin_pause_event');
    setLoading(btn, false);

    if (error || data?.error) {
        showToast('暂停失败：' + (error?.message || data?.error), 'error');
        return;
    }
    showToast('活动已暂停', 'success');
    loadOverview();
}

async function handleResume(btn) {
    setLoading(btn, true, '继续中...');
    const { data, error } = await supabase.rpc('admin_resume_event');
    setLoading(btn, false);

    if (error || data?.error) {
        showToast('继续失败：' + (error?.message || data?.error), 'error');
        return;
    }
    showToast('活动已继续', 'success');
    loadOverview();
}

async function handleEnd(btn) {
    const ok = await confirmDialog({
        title: '结束活动',
        message: '将停止所有击杀、结算赢家。此操作不可撤销。',
        confirmText: '结束活动',
        danger: true,
        requireInput: {
            label: '请输入「结束活动」以确认',
            value: '结束活动',
            placeholder: '结束活动',
        },
    });
    if (!ok) return;

    setLoading(btn, true, '结束中...');
    const { data, error } = await supabase.rpc('admin_end_event', { p_confirm: '结束活动' });
    setLoading(btn, false);

    if (error || data?.error) {
        showToast('结束失败：' + (error?.message || data?.error), 'error');
        return;
    }
    showToast('活动已结束', 'success');
    loadOverview();
}

async function saveEventConfig(btn) {
    const name = qs('event-name')?.value.trim();
    const dayRaw = qs('event-day')?.value;
    const day = parseInt(dayRaw, 10);

    if (!name) { showToast('请填写事件名称', 'error'); return; }
    if (!day || day < 1 || day > 5) { showToast('天数需在 1-5 之间', 'error'); return; }

    setLoading(btn, true, '保存中...');
    const { data, error } = await supabase.rpc('admin_update_event', {
        p_name: name,
        p_current_day: day,
    });
    setLoading(btn, false);

    if (error || data?.error) {
        showToast('保存失败：' + (error?.message || data?.error), 'error');
        return;
    }

    showToast('已保存', 'success');
    const hintEl = qs('event-save-hint');
    if (hintEl) {
        hintEl.textContent = '已保存 ✓';
        setTimeout(() => { hintEl.textContent = ''; }, 2000);
    }
    loadOverview();
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

    // 接收子模块派发的刷新事件
    window.addEventListener('ninjatag:refresh-overview', () => {
        if (currentTab === 'overview') loadOverview();
    });
}

/* ============================================================
   启动
   ============================================================ */

async function boot() {
    const session = await requireLogin();
    if (!session) return;

    const isAdmin = await checkIsAdmin();
    if (!isAdmin) {
        showToast('你不是管理员，无权访问。', 'error');
        setTimeout(() => { window.location.href = 'index.html'; }, 1500);
        return;
    }

    const user = await getUser();
    state.userEmail = user?.email || '';
    const userLine = qs('sidebar-user');
    if (userLine) userLine.textContent = state.userEmail || '已登录';

    // 导航
    qsa('[data-nav]').forEach(btn => {
        btn.addEventListener('click', () => goto(btn.dataset.nav));
    });

    // 退出
    qs('nav-logout')?.addEventListener('click', (e) => {
        e.preventDefault();
        signOut();
    });

    // Modal 遮罩
    [
        'edit-participant-modal',
        'import-modal',
        'kill-reason-modal',
        'confirm-modal',
        'bulk-edit-modal',
        'edit-college-modal',
    ].forEach(bindModalBackdrop);

    // 保存事件配置
    qs('btn-save-event')?.addEventListener('click', (e) => saveEventConfig(e.currentTarget));

    // 全局委托
    bindGlobalDelegation();

    // 初始化各 Tab 模块（只绑定一次事件）
    initParticipants();
    initChain();
    initRecords();
    initColleges();
    initRules();
    initAdmins();
    initSettings();

    // 首次渲染
    goto('overview');
}

document.addEventListener('DOMContentLoaded', boot);