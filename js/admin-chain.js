// js/admin-chain.js
// 全局链：列表 / 搜索 / 状态筛选 / 击杀 / 重新加入已淘汰者 / 折叠
import { supabase } from './supabase.js';
import { state } from './admin.js';
import {
    qs, showToast, setLoading, confirmDialog, openModal, closeModal,
    escapeHtml, debounce, skeletonTable, emptyState,
} from './utils.js';
import { t } from './i18n.js';

const KILL_REASON_KEYS = {
    normal: { labelKey: 'chain.killReasonNormal', award: true },
    rule_violation: { labelKey: 'chain.killReasonRuleViolation', award: true },
    task_incomplete: { labelKey: 'chain.killReasonTaskIncomplete', award: true },
    absent: { labelKey: 'chain.killReasonAbsent', award: true },
    no_points: { labelKey: 'chain.killReasonNoPoints', award: false },
};

const COLLAPSE_PREFIX = 'ninjatag.collapse.';

let chainFilter = { keyword: '', status: '' };
let chainSignature = '';
let pendingKill = null;
let reinsertSelected = null;
let reinsertSearchTimer = null;
let reinsertBound = false;

/* ============================================================
   折叠
   ============================================================ */
function initCollapsible() {
    document.querySelectorAll('[data-collapse-key]').forEach(card => {
        if (card.dataset.collapseBound === '1') return;
        card.dataset.collapseBound = '1';
        const key = card.dataset.collapseKey;
        const trigger = card.querySelector('[data-collapse-trigger]');
        if (!key || !trigger) return;

        try {
            if (localStorage.getItem(COLLAPSE_PREFIX + key) === '1') {
                card.classList.add('is-collapsed');
            }
        } catch (_) { /* ignore */ }

        trigger.addEventListener('click', (e) => {
            if (e.target.closest('[data-no-collapse]')) return;
            if (e.target.closest('input, select, textarea, a')) return;
            const collapsed = card.classList.toggle('is-collapsed');
            try {
                localStorage.setItem(COLLAPSE_PREFIX + key, collapsed ? '1' : '0');
            } catch (_) { /* ignore */ }
        });
    });
}

/* ============================================================
   初始化
   ============================================================ */
export function initChain() {
    initCollapsible();

    const searchEl = qs('chain-search');
    if (searchEl) searchEl.addEventListener('input', debounce(() => {
        chainFilter.keyword = searchEl.value.trim().toLowerCase();
        renderChainList();
    }, 200));

    qs('chain-filter-status')?.addEventListener('change', (e) => {
        chainFilter.status = e.target.value;
        renderChainList();
    });

    qs('btn-refresh-chain')?.addEventListener('click', () => refreshChain());

    qs('btn-cancel-kill-modal')?.addEventListener('click', closeKillModal);
    qs('btn-kill-reason-next')?.addEventListener('click', (e) => submitKill(e.currentTarget));
    document.querySelectorAll('input[name="kill-reason"]').forEach(r => {
        r.addEventListener('change', updateKillPreview);
    });

    bindReinsertEvents();
}

// 供 admin.js 在语言切换时调用
export function refreshChainI18n() {
    chainSignature = '';
    renderChainList();
    // 重新加入区块重新渲染
    if (qs('reinsert-search-results')) searchEliminated(qs('reinsert-search')?.value.trim() || '');
}

/* ============================================================
   加载 & 渲染
   ============================================================ */
export async function refreshChain() {
    const el = qs('chain-list');
    if (el && !state.chain.length) el.innerHTML = skeletonTable(4);

    const [chainRes, evtRes] = await Promise.all([
        supabase.rpc('admin_get_global_chain'),
        state.event ? Promise.resolve({ data: state.event }) : supabase.rpc('admin_get_event'),
    ]);

    if (chainRes.error) {
        if (el) el.innerHTML = emptyState({
            title: t('common.loadFailed'),
            desc: chainRes.error.message,
        });
        return;
    }
    if (chainRes.data?.error) {
        if (el) el.innerHTML = emptyState({
            title: t('common.loadFailed'),
            desc: chainRes.data.error,
        });
        return;
    }

    state.chain = Array.isArray(chainRes.data) ? chainRes.data : [];
    if (evtRes?.data) state.event = evtRes.data;
    chainSignature = '';
    renderChainList();
}

function getFilteredChain() {
    const kw = chainFilter.keyword;
    return state.chain.filter(p => {
        if (chainFilter.status && String(p.status || '').toLowerCase() !== chainFilter.status) {
            return false;
        }
        if (kw) {
            const hay = [p.name, p.code, p.target_name, p.target_code, p.college_name]
                .filter(Boolean).join(' ').toLowerCase();
            if (!hay.includes(kw)) return false;
        }
        return true;
    });
}

function renderChainList() {
    const el = qs('chain-list');
    if (!el) return;

    const list = getFilteredChain();

    if (!list.length) {
        el.innerHTML = state.chain.length
            ? emptyState({ icon: 'search', title: t('chain.noMatch'), desc: t('chain.noMatchDesc') })
            : emptyState({ icon: 'chain', title: t('chain.noData'), desc: t('chain.noDataDesc') });
        chainSignature = '';
        return;
    }

    const eventActive = state.event?.status === 'active';
    const sig = list.map(p =>
        `${p.id}:${p.name}:${p.code}:${p.target_name}:${p.target_code}:${p.status}:${eventActive ? 1 : 0}`
    ).join('|');
    if (sig === chainSignature) return;
    chainSignature = sig;

    el.innerHTML = `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>${escapeHtml(t('chain.colHunter'))}</th>
            <th>${escapeHtml(t('chain.colCode'))}</th>
            <th>${escapeHtml(t('chain.colTarget'))}</th>
            <th>${escapeHtml(t('chain.colTargetCode'))}</th>
            <th>${escapeHtml(t('chain.colStatus'))}</th>
            <th class="text-right">${escapeHtml(t('chain.colActions'))}</th>
          </tr>
        </thead>
        <tbody>
          ${list.map(p => rowHtml(p, eventActive)).join('')}
        </tbody>
      </table>
    </div>
  `;
    bindChainRowEvents();
}

function rowHtml(p, eventActive) {
    const status = String(p.status || '').toLowerCase();
    const statusMap = {
        alive: ['badge-success', t('chain.statusAlive')],
        eliminated: ['badge-danger', t('chain.statusEliminated')],
        winner: ['badge-gold', t('chain.statusWinner')],
    };
    const [cls, label] = statusMap[status] || ['badge-neutral', p.status || '—'];
    const canKill = status === 'alive' && p.target_name && eventActive;

    const colHunter = escapeHtml(t('chain.colHunter'));
    const colCode = escapeHtml(t('chain.colCode'));
    const colTarget = escapeHtml(t('chain.colTarget'));
    const colTargetCode = escapeHtml(t('chain.colTargetCode'));
    const colStatus = escapeHtml(t('chain.colStatus'));
    const colActions = escapeHtml(t('chain.colActions'));

    return `
    <tr data-id="${escapeHtml(p.id)}">
      <td data-label="${colHunter}">
        <div class="cell-main">${escapeHtml(p.name)}</div>
        ${p.college_name ? `<div class="cell-sub">${escapeHtml(p.college_name)}</div>` : ''}
      </td>
      <td data-label="${colCode}"><span class="my-code" style="font-size:14px;padding:4px 8px;letter-spacing:2px;border:none;background:var(--bg)">${escapeHtml(p.code || '-')}</span></td>
      <td data-label="${colTarget}">${p.target_name
            ? escapeHtml(p.target_name)
            : `<span class="muted">${escapeHtml(t('chain.noTarget'))}</span>`}</td>
      <td data-label="${colTargetCode}">${p.target_code
            ? `<span class="hint">${escapeHtml(p.target_code)}</span>`
            : '<span class="muted">—</span>'}</td>
      <td data-label="${colStatus}"><span class="badge ${cls}">${escapeHtml(label)}</span></td>
      <td class="cell-actions" data-label="${colActions}">
        ${canKill
            ? `<button class="btn-mini btn-warn"
                data-kill="${escapeHtml(p.id)}"
                data-target-name="${escapeHtml(p.target_name)}"
                data-college-name="${escapeHtml(p.college_name || '')}"
                data-college-id="${escapeHtml(p.college_id || '')}">${escapeHtml(t('chain.killBtn'))}</button>`
            : `<span class="hint">${!eventActive && status === 'alive' ? escapeHtml(t('chain.eventNotActive')) : '—'}</span>`}
      </td>
    </tr>
  `;
}

function bindChainRowEvents() {
    const el = qs('chain-list');
    if (!el) return;
    el.querySelectorAll('[data-kill]').forEach(btn => {
        btn.addEventListener('click', () => {
            openKillModal({
                hunterId: btn.dataset.kill,
                targetName: btn.dataset.targetName,
                collegeName: btn.dataset.collegeName,
                collegeId: btn.dataset.collegeId,
            });
        });
    });
}

/* ============================================================
   击杀 Modal
   ============================================================ */
function openKillModal(ctx) {
    pendingKill = ctx;
    qs('kill-target-name').textContent = ctx.targetName || '-';
    document.querySelectorAll('input[name="kill-reason"]').forEach(r => {
        r.checked = (r.value === 'normal');
    });
    updateKillPreview();
    openModal('kill-reason-modal');
}

function closeKillModal() {
    pendingKill = null;
    closeModal('kill-reason-modal');
}

function updateKillPreview() {
    if (!pendingKill) return;
    const selected = document.querySelector('input[name="kill-reason"]:checked');
    const reason = selected ? selected.value : 'normal';
    const info = KILL_REASON_KEYS[reason] || KILL_REASON_KEYS.normal;
    const previewEl = qs('kill-preview');
    if (!previewEl) return;

    const college = pendingKill.collegeName || '—';
    if (info.award) {
        previewEl.innerHTML = t('chain.killPreviewAward', { college: escapeHtml(college) });
    } else {
        previewEl.innerHTML = t('chain.killPreviewNoAward', { college: escapeHtml(college) });
    }
}

async function submitKill(btn) {
    if (!pendingKill) return;

    const selected = document.querySelector('input[name="kill-reason"]:checked');
    const reason = selected ? selected.value : 'normal';
    const info = KILL_REASON_KEYS[reason] || KILL_REASON_KEYS.normal;
    const { hunterId, targetName, collegeName } = pendingKill;

    setLoading(btn, true, t('chain.killing'));

    const { data, error } = await supabase.rpc('admin_kill_target', {
        p_hunter_id: hunterId,
        p_reason: reason,
    });

    setLoading(btn, false);

    if (error || data?.error) {
        const msg = mapKillErr(data?.error) || error?.message || data?.error;
        showToast(t('chain.killFailed', { msg }), 'error');
        return;
    }

    closeKillModal();

    if (data?.winner) {
        showToast(t('chain.killWin', { name: data.winner_name || '' }), 'success', 5000);
    } else {
        const pts = info.award
            ? t('chain.killPointsAward', { college: collegeName || '—' })
            : t('chain.killPointsNone');
        showToast(t('chain.killSuccess', { name: targetName, pts }), 'success');
    }

    await refreshChain();
    if (data?.winner) {
        window.dispatchEvent(new CustomEvent('ninjatag:refresh-overview'));
    }
}

function mapKillErr(code) {
    const m = {
        not_admin: t('chain.errNotAdmin'),
        event_not_active: t('chain.errEventNotActive'),
        hunter_not_alive: t('chain.errHunterNotAlive'),
        hunter_no_target: t('chain.errHunterNoTarget'),
        target_already_eliminated: t('chain.errTargetEliminated'),
    };
    return m[code];
}

/* ============================================================
   重新加入已淘汰者
   ============================================================ */
function bindReinsertEvents() {
    if (reinsertBound) return;
    reinsertBound = true;

    const input = qs('reinsert-search');
    if (input) {
        input.addEventListener('input', () => {
            clearTimeout(reinsertSearchTimer);
            reinsertSearchTimer = setTimeout(() => {
                searchEliminated(input.value.trim());
            }, 250);
        });
        searchEliminated('');
    }

    qs('btn-confirm-reinsert')?.addEventListener('click', confirmReinsert);
    qs('btn-cancel-reinsert')?.addEventListener('click', resetReinsertUI);
}

async function searchEliminated(query) {
    const el = qs('reinsert-search-results');
    if (!el) return;

    const { data, error } = await supabase.rpc('admin_search_eliminated_participants', {
        p_query: query || '',
    });

    if (error) {
        el.innerHTML = `<p class="hint">${escapeHtml(t('chain.reinsertSearchFailed', { msg: error.message }))}</p>`;
        return;
    }

    const list = Array.isArray(data) ? data : [];

    if (!list.length) {
        el.innerHTML = `<p class="hint" style="margin-top:8px">${escapeHtml(t('chain.reinsertNoMatch'))}</p>`;
        return;
    }

    const colName = escapeHtml(t('participants.colName'));
    const colCollege = escapeHtml(t('participants.colCollege'));
    const colEmail = escapeHtml(t('participants.colEmail'));
    const colActions = escapeHtml(t('participants.colActions'));

    el.innerHTML = `
    <div class="table-wrap" style="margin-top:8px">
      <table class="data-table">
        <thead>
          <tr>
            <th>${colName}</th>
            <th>${colCollege}</th>
            <th>${colEmail}</th>
            <th class="text-right">${colActions}</th>
          </tr>
        </thead>
        <tbody>
          ${list.map(p => `
            <tr>
              <td data-label="${colName}"><span class="cell-main">${escapeHtml(p.name)}</span></td>
              <td data-label="${colCollege}">${p.college_name
            ? `<span class="row"><span class="color-dot" style="background:${escapeHtml(p.color || '#555')}"></span>${escapeHtml(p.college_name)}</span>`
            : '<span class="muted">—</span>'}</td>
              <td data-label="${colEmail}">${p.email ? `<span class="hint">${escapeHtml(p.email)}</span>` : '—'}</td>
              <td class="cell-actions" data-label="${colActions}">
                <button class="btn-mini"
                        data-pick="${escapeHtml(p.id)}"
                        data-name="${escapeHtml(p.name)}">${escapeHtml(t('common.add'))}</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

    el.querySelectorAll('[data-pick]').forEach(btn => {
        btn.addEventListener('click', () => {
            selectEliminated(btn.dataset.pick, btn.dataset.name);
        });
    });
}

async function selectEliminated(id, name) {
    reinsertSelected = { id, name };
    qs('reinsert-selected-name').textContent = name;
    qs('reinsert-selected').style.display = 'block';
    await fillHunterSelect();
}

async function fillHunterSelect() {
    const sel = qs('reinsert-hunter-select');
    if (!sel) return;

    const { data, error } = await supabase.rpc('admin_get_global_chain');

    if (error || data?.error) {
        sel.innerHTML = `<option value="">${escapeHtml(t('chain.reinsertLoadFailed'))}</option>`;
        return;
    }

    const aliveWithTarget = (data || []).filter(p =>
        String(p.status).toLowerCase() === 'alive' && p.target_name
    );

    if (!aliveWithTarget.length) {
        sel.innerHTML = `<option value="">${escapeHtml(t('chain.reinsertNoPosition'))}</option>`;
        return;
    }

    sel.innerHTML = aliveWithTarget.map(p =>
        `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)} → ${escapeHtml(p.target_name)}</option>`
    ).join('');
}

async function confirmReinsert() {
    if (!reinsertSelected) return;

    const sel = qs('reinsert-hunter-select');
    const hunterId = sel?.value;
    if (!hunterId) { showToast(t('chain.reinsertSelectFirst'), 'error'); return; }

    const hunterLabel = sel.selectedOptions[0]?.textContent || '';

    const ok = await confirmDialog({
        title: t('chain.reinsertConfirmTitle'),
        message: t('chain.reinsertConfirmMsg', {
            name: escapeHtml(reinsertSelected.name),
            position: escapeHtml(hunterLabel),
        }),
        confirmText: t('chain.reinsertConfirmText'),
        danger: false,
    });
    if (!ok) return;

    const btn = qs('btn-confirm-reinsert');
    setLoading(btn, true, t('chain.reinsertJoining'));

    const { data, error } = await supabase.rpc('admin_reinsert_participant', {
        p_participant_id: reinsertSelected.id,
        p_hunter_id: hunterId,
    });

    setLoading(btn, false);

    if (error || data?.error) {
        const msg = mapReinsertErr(data?.error) || error?.message || data?.error;
        showToast(t('chain.reinsertFailed', { msg }), 'error');
        return;
    }

    showToast(t('chain.reinsertSuccess', { code: data?.code || '-' }), 'success', 4500);
    resetReinsertUI();
    await refreshChain();
    await searchEliminated('');
}

function mapReinsertErr(code) {
    const m = {
        not_admin: t('chain.errNotAdmin'),
        event_not_active: t('chain.errEventNotActive'),
        participant_not_found: t('chain.errParticipantNotFound'),
        participant_not_eliminated: t('chain.errParticipantNotEliminated'),
        hunter_not_found: t('chain.errHunterNotFound'),
        hunter_not_alive: t('chain.errHunterNotAlive'),
        hunter_no_target: t('chain.errHunterNoTarget2'),
        wrong_event: t('chain.errWrongEvent'),
    };
    return m[code];
}

function resetReinsertUI() {
    reinsertSelected = null;
    const selEl = qs('reinsert-selected');
    if (selEl) selEl.style.display = 'none';
    const searchEl = qs('reinsert-search');
    if (searchEl) searchEl.value = '';
    const resEl = qs('reinsert-search-results');
    if (resEl) resEl.innerHTML = '';
    searchEliminated('');
}