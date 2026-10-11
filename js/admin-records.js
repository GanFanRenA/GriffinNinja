// js/admin-records.js
// 记录：击杀记录（可撤销）+ 历史记录（击杀/撤销/复活，可搜索）

import { supabase } from './supabase.js';
import { state } from './admin.js';
import {
    qs, showToast, confirmDialog, escapeHtml, debounce,
    formatTime, formatRelative,
    skeletonRows, emptyState,
} from './utils.js';

const KILL_REASONS = {
    normal: { label: '正常击杀', award: true },
    rule_violation: { label: '违反规则', award: true },
    task_incomplete: { label: '未完成任务', award: true },
    absent: { label: '缺勤', award: true },
    no_points: { label: '不计分击杀', award: false },
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
            title: '加载失败',
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
            title: '加载失败',
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
            title: '暂无击杀记录',
            desc: '活动开始后，击杀会显示在这里。',
        });
        eliminationsSig = '';
        return;
    }

    const sig = list.map(e =>
        `${e.id}:${e.status}:${e.created_at}:${e.revoke_reason || ''}`
    ).join('|');
    if (sig === eliminationsSig) return;
    eliminationsSig = sig;

    el.innerHTML = `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>击杀</th>
            <th>学院</th>
            <th>时间</th>
            <th>状态</th>
            <th class="text-right">操作</th>
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
    const reason = KILL_REASONS[e.reason] || null;
    const statusMap = {
        valid: ['badge-success', '有效'],
        revoked: ['badge-neutral', '已撤销'],
    };
    const [cls, label] = statusMap[e.status] || ['badge-neutral', e.status || '—'];

    return `
    <tr data-id="${escapeHtml(e.id)}">
      <td data-label="击杀">
        <div class="cell-main">${escapeHtml(e.hunter_name || '?')} → ${escapeHtml(e.target_name || '?')}</div>
        ${reason ? `<div class="cell-sub">原因：${escapeHtml(reason.label)}${e.points_awarded ? ` · +${e.points_awarded}` : ' · 不加分'}</div>` : ''}
      </td>
      <td data-label="学院">
        <div class="cell-sub">${escapeHtml(e.hunter_college || '—')} → ${escapeHtml(e.target_college || '—')}</div>
      </td>
      <td data-label="时间">
        <div>${escapeHtml(formatTime(e.created_at))}</div>
        <div class="cell-sub">${escapeHtml(formatRelative(e.created_at))}</div>
      </td>
      <td data-label="状态"><span class="badge ${cls}">${escapeHtml(label)}</span></td>
      <td class="cell-actions" data-label="操作">
        ${e.status === 'valid'
            ? `<button class="btn-mini btn-warn" data-revoke="${escapeHtml(e.id)}">撤销</button>`
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

    const reasonInfo = KILL_REASONS[elim.reason];
    const lines = [];
    lines.push(`撤销 <strong>${escapeHtml(elim.hunter_name || '?')}</strong> 击杀 <strong>${escapeHtml(elim.target_name || '?')}</strong>。`);
    if (reasonInfo) lines.push(`原击杀原因：${escapeHtml(reasonInfo.label)}。`);
    lines.push(`被淘汰者将恢复为存活状态，猎人目标将恢复到击杀前的目标。`);
    if (elim.points_awarded) {
        lines.push(`<strong>${escapeHtml(elim.hunter_college || '相关学院')}</strong> 将扣回 <strong style="color:#fca5a5">${elim.points_awarded}</strong> 分。`);
    }

    const ok = await confirmDialog({
        title: '撤销击杀',
        message: lines.join('<br>'),
        confirmText: '确认撤销',
        danger: true,
        requireInput: {
            label: '请填写撤销原因（可选，直接回车确认）',
            // 不要求匹配文本，直接回车即可
        },
    });
    // confirmDialog 的 requireInput.value 若未设置，则接受任意输入
    if (!ok) return;

    // 取输入值作为 revoke_reason
    const reasonInput = qs('confirm-input');
    const revokeReason = reasonInput?.value.trim() || '';

    const { data, error } = await supabase.rpc('admin_revoke_kill', {
        p_elimination_id: elimId,
        p_reason: revokeReason,
    });

    if (error || data?.error) {
        const errMap = {
            not_admin: '你不是管理员',
            elimination_not_found: '击杀记录不存在',
            already_revoked: '该击杀已被撤销',
            event_not_active: '活动未进行中',
        };
        showToast('撤销失败：' + (errMap[data?.error] || error?.message || data?.error), 'error');
        return;
    }

    showToast('已撤销', 'success');
    await Promise.all([refreshEliminations(), refreshHistory()]);
}

/* ============================================================
   历史记录
   ============================================================ */

function getFilteredHistory() {
    const kw = historyKeyword;
    if (!kw) return state.history;

    return state.history.filter(h => {
        const d = h.details || {};
        const hay = [
            h.type,
            d.hunter_name, d.target_name, d.participant_name,
            d.hunter_college, d.target_college,
            d.revoke_reason, d.revoked_by_email, d.admin_email,
            d.reason,
        ].filter(Boolean).join(' ').toLowerCase();
        return hay.includes(kw);
    });
}

function renderHistory() {
    const el = qs('history-list');
    if (!el) return;

    const list = getFilteredHistory();

    if (!list.length) {
        el.innerHTML = state.history.length
            ? emptyState({ icon: 'search', title: '没有匹配的记录', desc: '试试其他关键词。' })
            : emptyState({
                icon: 'clock',
                title: '暂无历史记录',
                desc: '击杀、撤销、复活会按时间倒序显示。',
            });
        historySig = '';
        return;
    }

    const sig = list.map(h => `${h.type}:${h.happened_at}:${h.details?.hunter_name || ''}:${h.details?.target_name || ''}:${h.details?.participant_name || ''}`).join('|');
    if (sig === historySig) return;
    historySig = sig;

    el.innerHTML = list.map(historyItemHtml).join('');
}

function historyItemHtml(h) {
    const t = formatTime(h.happened_at);
    const rel = formatRelative(h.happened_at);
    const d = h.details || {};

    if (h.type === 'kill') {
        const reasonInfo = KILL_REASONS[d.reason];
        const reasonLabel = reasonInfo ? reasonInfo.label : (d.reason || '');
        const pts = d.points_awarded
            ? `<strong>${escapeHtml(d.hunter_college || '?')} +${d.points_awarded}</strong>`
            : '不加分';
        return `
      <div class="history-item">
        <div class="history-time">${escapeHtml(t)}<div class="cell-sub">${escapeHtml(rel)}</div></div>
        <div class="history-content">
          <span class="history-tag tag-kill">击杀</span>
          <strong>${escapeHtml(d.hunter_name || '?')}</strong>
          击杀了
          <strong>${escapeHtml(d.target_name || '?')}</strong>
          <span class="hint">（${pts}）</span>
          ${reasonLabel ? `<div class="history-note">原因：${escapeHtml(reasonLabel)}</div>` : ''}
          ${d.is_admin_kill ? `<div class="history-note">管理员操作</div>` : ''}
        </div>
      </div>`;
    }

    if (h.type === 'revoke') {
        const reasonInfo = KILL_REASONS[d.reason];
        const pts = d.points_awarded
            ? `<strong>${escapeHtml(d.hunter_college || '?')} -${d.points_awarded}</strong>`
            : '';
        return `
      <div class="history-item">
        <div class="history-time">${escapeHtml(t)}<div class="cell-sub">${escapeHtml(rel)}</div></div>
        <div class="history-content">
          <span class="history-tag tag-revoke">撤销</span>
          撤销了 <strong>${escapeHtml(d.hunter_name || '?')}</strong>
          击杀 <strong>${escapeHtml(d.target_name || '?')}</strong>
          ${pts ? `<span class="hint">（${pts}）</span>` : ''}
          ${reasonInfo ? `<div class="history-note">原击杀原因：${escapeHtml(reasonInfo.label)}</div>` : ''}
          ${d.revoke_reason ? `<div class="history-note">撤销原因：${escapeHtml(d.revoke_reason)}</div>` : ''}
          ${d.revoked_by_email ? `<div class="history-note">操作者：${escapeHtml(d.revoked_by_email)}</div>` : ''}
        </div>
      </div>`;
    }

    if (h.type === 'reinsert') {
        return `
      <div class="history-item">
        <div class="history-time">${escapeHtml(t)}<div class="cell-sub">${escapeHtml(rel)}</div></div>
        <div class="history-content">
          <span class="history-tag tag-reinsert">复活</span>
          将 <strong>${escapeHtml(d.participant_name || '?')}</strong>
          重新加入环中（插入到 <strong>${escapeHtml(d.hunter_name || '?')}</strong> 之后）
          ${d.admin_email ? `<div class="history-note">操作者：${escapeHtml(d.admin_email)}</div>` : ''}
        </div>
      </div>`;
    }

    // 其它类型
    return `
    <div class="history-item">
      <div class="history-time">${escapeHtml(t)}</div>
      <div class="history-content">
        <span class="history-tag tag-admin">${escapeHtml(h.type || '操作')}</span>
        ${escapeHtml(JSON.stringify(d).slice(0, 120))}
      </div>
    </div>`;
}