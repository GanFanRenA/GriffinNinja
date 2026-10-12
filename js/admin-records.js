// js/admin-records.js
// 记录：击杀记录（可撤销）+ 历史记录（击杀/撤销/复活，可搜索）
import { supabase } from './supabase.js';
import { state } from './admin.js';
import {
    qs, showToast, confirmDialog, escapeHtml, debounce,
    formatTime, formatRelative, skeletonRows, emptyState,
} from './utils.js';
import { t } from './i18n.js';

const KILL_REASON_KEYS = {
    normal: { labelKey: 'chain.killReasonNormal', award: true },
    rule_violation: { labelKey: 'chain.killReasonRuleViolation', award: true },
    task_incomplete: { labelKey: 'chain.killReasonTaskIncomplete', award: true },
    absent: { labelKey: 'chain.killReasonAbsent', award: true },
    no_points: { labelKey: 'chain.killReasonNoPoints', award: false },
};

let historyKeyword = '';
let eliminationsSig = '';
let historySig = '';

/* ============================================================
   初始化
   ============================================================ */
export function initRecords() {
    qs('btn-refresh-elims')?.addEventListener('click', () => refreshEliminations());
    qs('btn-refresh-history')?.addEventListener('click', () => refreshHistory());

    const searchEl = qs('history-search');
    if (searchEl) searchEl.addEventListener('input', debounce(() => {
        historyKeyword = searchEl.value.trim().toLowerCase();
        renderHistory();
    }, 200));
}

// 供 admin.js 在语言切换时调用
export function refreshRecordsI18n() {
    eliminationsSig = '';
    historySig = '';
    renderEliminations();
    renderHistory();
}

/* ============================================================
   加载
   ============================================================ */
export async function refreshRecords() {
    await Promise.all([refreshEliminations(), refreshHistory()]);
}

async function refreshEliminations() {
    const el = qs('eliminations-list');
    if (el && !state.eliminations.length) el.innerHTML = skeletonRows(3, 3);

    const { data, error } = await supabase.rpc('admin_get_eliminations');

    if (error || data?.error) {
        if (el) el.innerHTML = emptyState({
            title: t('common.loadFailed'),
            desc: error?.message || data?.error,
        });
        return;
    }

    state.eliminations = Array.isArray(data) ? data : [];
    eliminationsSig = '';
    renderEliminations();
}

async function refreshHistory() {
    const el = qs('history-list');
    if (el && !state.history.length) el.innerHTML = skeletonRows(3, 2);

    const { data, error } = await supabase.rpc('admin_get_history', { p_limit: 500 });

    if (error || data?.error) {
        if (el) el.innerHTML = emptyState({
            title: t('common.loadFailed'),
            desc: error?.message || data?.error,
        });
        return;
    }

    state.history = Array.isArray(data) ? data : [];
    historySig = '';
    renderHistory();
}

/* ============================================================
   击杀记录
   ============================================================ */
function renderEliminations() {
    const el = qs('eliminations-list');
    if (!el) return;
    const list = state.eliminations;

    if (!list.length) {
        el.innerHTML = emptyState({
            icon: 'clock',
            title: t('records.noEliminations'),
            desc: t('records.noEliminationsDesc'),
        });
        eliminationsSig = '';
        return;
    }

    const sig = list.map(e => `${e.id}:${e.status}:${e.created_at}:${e.revoke_reason || ''}`).join('|');
    if (sig === eliminationsSig) return;
    eliminationsSig = sig;

    el.innerHTML = `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>${escapeHtml(t('records.colKill'))}</th>
            <th>${escapeHtml(t('records.colCollege'))}</th>
            <th>${escapeHtml(t('records.colTime'))}</th>
            <th>${escapeHtml(t('records.colStatus'))}</th>
            <th class="text-right">${escapeHtml(t('records.colActions'))}</th>
          </tr>
        </thead>
        <tbody>
          ${list.map(elimRow).join('')}
        </tbody>
      </table>
    </div>
  `;
    bindElimEvents();
}

function elimRow(e) {
    const info = KILL_REASON_KEYS[e.reason] || null;
    const reasonLabel = info ? t(info.labelKey) : '';

    const statusMap = {
        valid: ['badge-success', t('records.statusValid')],
        revoked: ['badge-neutral', t('records.statusRevoked')],
    };
    const [cls, label] = statusMap[e.status] || ['badge-neutral', e.status || '—'];

    const colKill = escapeHtml(t('records.colKill'));
    const colCollege = escapeHtml(t('records.colCollege'));
    const colTime = escapeHtml(t('records.colTime'));
    const colStatus = escapeHtml(t('records.colStatus'));
    const colActions = escapeHtml(t('records.colActions'));

    const reasonLine = reasonLabel
        ? escapeHtml(t('records.reasonLabel', { reason: reasonLabel })) +
        ' · ' +
        (e.points_awarded ? escapeHtml(t('records.pointsAwarded', { n: e.points_awarded })) : escapeHtml(t('records.pointsNone')))
        : '';

    return `
    <tr data-id="${escapeHtml(e.id)}">
      <td data-label="${colKill}">
        <div class="cell-main">${escapeHtml(e.hunter_name || '?')} → ${escapeHtml(e.target_name || '?')}</div>
        ${reasonLine ? `<div class="cell-sub">${reasonLine}</div>` : ''}
      </td>
      <td data-label="${colCollege}">
        <div class="cell-sub">${escapeHtml(e.hunter_college || '—')} → ${escapeHtml(e.target_college || '—')}</div>
      </td>
      <td data-label="${colTime}">
        <div>${escapeHtml(formatTime(e.created_at))}</div>
        <div class="cell-sub">${escapeHtml(formatRelative(e.created_at))}</div>
      </td>
      <td data-label="${colStatus}"><span class="badge ${cls}">${escapeHtml(label)}</span></td>
      <td class="cell-actions" data-label="${colActions}">
        ${e.status === 'valid'
            ? `<button class="btn-mini btn-warn" data-revoke="${escapeHtml(e.id)}">${escapeHtml(t('records.revokeBtn'))}</button>`
            : `<span class="hint">${escapeHtml(e.revoke_reason || '')}</span>`}
      </td>
    </tr>
  `;
}

function bindElimEvents() {
    const el = qs('eliminations-list');
    if (!el) return;
    el.querySelectorAll('[data-revoke]').forEach(btn => {
        btn.addEventListener('click', () => revokeKill(btn.dataset.revoke));
    });
}

async function revokeKill(elimId) {
    const elim = state.eliminations.find(x => x.id === elimId);
    if (!elim) return;

    const info = KILL_REASON_KEYS[elim.reason];
    const lines = [];
    lines.push(t('records.revokeLine1', {
        hunter: `<strong>${escapeHtml(elim.hunter_name || '?')}</strong>`,
        target: `<strong>${escapeHtml(elim.target_name || '?')}</strong>`,
    }));
    if (info) {
        lines.push(t('records.revokeLine2', { reason: escapeHtml(t(info.labelKey)) }));
    }
    lines.push(t('records.revokeLine3'));
    if (elim.points_awarded) {
        lines.push(t('records.revokeLine4', {
            college: `<strong>${escapeHtml(elim.hunter_college || '—')}</strong>`,
            points: `<strong style="color:#fca5a5">${elim.points_awarded}</strong>`,
        }));
    }

    const ok = await confirmDialog({
        title: t('records.revokeTitle'),
        message: lines.join('<br>'),
        confirmText: t('records.revokeConfirm'),
        danger: true,
        requireInput: {
            label: t('records.revokeInputLabel'),
        },
    });
    if (!ok) return;

    const reasonInput = qs('confirm-input');
    const revokeReason = reasonInput?.value.trim() || '';

    const { data, error } = await supabase.rpc('admin_revoke_kill', {
        p_elimination_id: elimId,
        p_reason: revokeReason,
    });

    if (error || data?.error) {
        const msg = mapRevokeErr(data?.error) || error?.message || data?.error;
        showToast(t('records.revokeFailed', { msg }), 'error');
        return;
    }

    showToast(t('records.revoked'), 'success');
    await Promise.all([refreshEliminations(), refreshHistory()]);
}

function mapRevokeErr(code) {
    const m = {
        not_admin: t('records.errNotAdmin'),
        elimination_not_found: t('records.errNotFound'),
        already_revoked: t('records.errAlreadyRevoked'),
        event_not_active: t('records.errEventNotActive'),
    };
    return m[code];
}

/* ============================================================
   历史记录
   ============================================================ */
function getFilteredHistory() {
    const kw = historyKeyword;
    if (!kw) return state.history;
    return state.history.filter(h => {
        const d = h.details || {};
        const parts = [
            h.type,
            d.hunter_name, d.target_name, d.participant_name,
            d.hunter_college, d.target_college,
            d.revoke_reason, d.revoked_by_email, d.admin_email,
            d.reason,
        ];
        // 把原因的本地化标签也加进搜索索引
        if (d.reason && KILL_REASON_KEYS[d.reason]) {
            parts.push(t(KILL_REASON_KEYS[d.reason].labelKey));
        }
        const hay = parts.filter(Boolean).join(' ').toLowerCase();
        return hay.includes(kw);
    });
}

function renderHistory() {
    const el = qs('history-list');
    if (!el) return;
    const list = getFilteredHistory();

    if (!list.length) {
        el.innerHTML = state.history.length
            ? emptyState({ icon: 'search', title: t('records.noHistoryMatch'), desc: t('records.noHistoryMatchDesc') })
            : emptyState({ icon: 'clock', title: t('records.noHistory'), desc: t('records.noHistoryDesc') });
        historySig = '';
        return;
    }

    const sig = list.map(h =>
        `${h.type}:${h.happened_at}:${h.details?.hunter_name || ''}:${h.details?.target_name || ''}:${h.details?.participant_name || ''}`
    ).join('|');
    if (sig === historySig) return;
    historySig = sig;

    el.innerHTML = list.map(historyItemHtml).join('');
}

function historyItemHtml(h) {
    const time = formatTime(h.happened_at);
    const rel = formatRelative(h.happened_at);
    const d = h.details || {};

    if (h.type === 'kill') {
        const info = KILL_REASON_KEYS[d.reason];
        const reasonLabel = info ? t(info.labelKey) : (d.reason || '');
        const pts = d.points_awarded
            ? `<strong>${escapeHtml(d.hunter_college || '?')} +${d.points_awarded}</strong>`
            : escapeHtml(t('records.pointsNone'));

        const sentence = t('records.historyKillSentence', {
            hunter: `<strong>${escapeHtml(d.hunter_name || '?')}</strong>`,
            target: `<strong>${escapeHtml(d.target_name || '?')}</strong>`,
        });

        return `
      <div class="history-item">
        <div class="history-time">${escapeHtml(time)}<div class="cell-sub">${escapeHtml(rel)}</div></div>
        <div class="history-content">
          <span class="history-tag tag-kill">${escapeHtml(t('records.tagKill'))}</span>
          ${sentence}
          <span class="hint">（${pts}）</span>
          ${reasonLabel ? `<div class="history-note">${escapeHtml(t('records.historyKillReason', { reason: reasonLabel }))}</div>` : ''}
          ${d.is_admin_kill ? `<div class="history-note">${escapeHtml(t('records.historyAdminOp'))}</div>` : ''}
        </div>
      </div>`;
    }

    if (h.type === 'revoke') {
        const info = KILL_REASON_KEYS[d.reason];
        const pts = d.points_awarded
            ? `<strong>${escapeHtml(d.hunter_college || '?')} -${d.points_awarded}</strong>`
            : '';

        const sentence = t('records.historyRevokeSentence', {
            hunter: `<strong>${escapeHtml(d.hunter_name || '?')}</strong>`,
            target: `<strong>${escapeHtml(d.target_name || '?')}</strong>`,
        });

        return `
      <div class="history-item">
        <div class="history-time">${escapeHtml(time)}<div class="cell-sub">${escapeHtml(rel)}</div></div>
        <div class="history-content">
          <span class="history-tag tag-revoke">${escapeHtml(t('records.tagRevoke'))}</span>
          ${sentence}
          ${pts ? `<span class="hint">（${pts}）</span>` : ''}
          ${info ? `<div class="history-note">${escapeHtml(t('records.historyOriginalReason', { reason: t(info.labelKey) }))}</div>` : ''}
          ${d.revoke_reason ? `<div class="history-note">${escapeHtml(t('records.historyRevokeReason', { reason: d.revoke_reason }))}</div>` : ''}
          ${d.revoked_by_email ? `<div class="history-note">${escapeHtml(t('records.historyOperator', { email: d.revoked_by_email }))}</div>` : ''}
        </div>
      </div>`;
    }

    if (h.type === 'reinsert') {
        const sentence = t('records.historyReinsertSentence', {
            name: `<strong>${escapeHtml(d.participant_name || '?')}</strong>`,
            hunter: `<strong>${escapeHtml(d.hunter_name || '?')}</strong>`,
        });
        return `
      <div class="history-item">
        <div class="history-time">${escapeHtml(time)}<div class="cell-sub">${escapeHtml(rel)}</div></div>
        <div class="history-content">
          <span class="history-tag tag-reinsert">${escapeHtml(t('records.tagReinsert'))}</span>
          ${sentence}
          ${d.admin_email ? `<div class="history-note">${escapeHtml(t('records.historyOperator', { email: d.admin_email }))}</div>` : ''}
        </div>
      </div>`;
    }

    return `
    <div class="history-item">
      <div class="history-time">${escapeHtml(time)}</div>
      <div class="history-content">
        <span class="history-tag tag-admin">${escapeHtml(h.type || '—')}</span>
        ${escapeHtml(JSON.stringify(d).slice(0, 120))}
      </div>
    </div>`;
}