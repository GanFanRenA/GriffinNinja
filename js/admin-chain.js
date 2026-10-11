// js/admin-chain.js
// 全局链：列表 / 搜索 / 状态筛选 / 击杀 / 重新加入已淘汰者

import { supabase } from './supabase.js';
import { state } from './admin.js';
import {
    qs, showToast, setLoading, confirmDialog,
    openModal, closeModal, escapeHtml, debounce,
    skeletonTable, emptyState,
} from './utils.js';

const KILL_REASONS = {
    normal: { label: '正常击杀', award: true },
    rule_violation: { label: '违反规则', award: true },
    task_incomplete: { label: '未完成任务', award: true },
    absent: { label: '缺勤', award: true },
    no_points: { label: '不计分击杀', award: false },
};

let chainFilter = { keyword: '', status: '' };
let chainSignature = '';

let pendingKill = null;       // { hunterId, hunterName, targetName, collegeName, collegeId }
let reinsertSelected = null;  // { id, name }
let reinsertSearchTimer = null;
let reinsertBound = false;

/* ============================================================
   初始化
   ============================================================ */

export function initChain() {
    // 链筛选
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

    // 击杀 Modal
    qs('btn-cancel-kill-modal')?.addEventListener('click', closeKillModal);
    qs('btn-kill-reason-next')?.addEventListener('click', (e) => submitKill(e.currentTarget));

    // 击杀原因 radio 变化时更新预览
    document.querySelectorAll('input[name="kill-reason"]').forEach(r => {
        r.addEventListener('change', updateKillPreview);
    });

    // 复活
    bindReinsertEvents();
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
            title: '加载失败',
            desc: chainRes.error.message,
        });
        return;
    }
    if (chainRes.data?.error) {
        if (el) el.innerHTML = emptyState({ title: '加载失败', desc: chainRes.data.error });
        return;
    }

    state.chain = Array.isArray(chainRes.data) ? chainRes.data : [];
    if (evtRes?.data) state.event = evtRes.data;

    chainSignature = ''; // 强制重绘
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
            ? emptyState({ icon: 'search', title: '没有匹配的参与者', desc: '试试调整筛选条件。' })
            : emptyState({ icon: 'chain', title: '暂无全局链', desc: '开始活动后即可查看。' });
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
            <th>Hunter</th>
            <th>代码</th>
            <th>目标</th>
            <th>目标代码</th>
            <th>状态</th>
            <th class="text-right">操作</th>
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
        alive: ['badge-success', '存活'],
        eliminated: ['badge-danger', '已淘汰'],
        winner: ['badge-gold', '赢家'],
    };
    const [cls, label] = statusMap[status] || ['badge-neutral', p.status || '—'];

    const canKill = status === 'alive' && p.target_name && eventActive;

    return `
    <tr data-id="${escapeHtml(p.id)}">
      <td data-label="Hunter">
        <div class="cell-main">${escapeHtml(p.name)}</div>
        ${p.college_name
            ? `<div class="cell-sub">${escapeHtml(p.college_name)}</div>`
            : ''}
      </td>
      <td data-label="代码"><span class="my-code" style="font-size:14px;padding:4px 8px;letter-spacing:2px;border:none;background:var(--bg)">${escapeHtml(p.code || '-')}</span></td>
      <td data-label="目标">${p.target_name
            ? escapeHtml(p.target_name)
            : '<span class="muted">无</span>'}</td>
      <td data-label="目标代码">${p.target_code
            ? `<span class="hint">${escapeHtml(p.target_code)}</span>`
            : '<span class="muted">—</span>'}</td>
      <td data-label="状态"><span class="badge ${cls}">${escapeHtml(label)}</span></td>
      <td class="cell-actions" data-label="操作">
        ${canKill
            ? `<button class="btn-mini btn-warn"
                data-kill="${escapeHtml(p.id)}"
                data-target-name="${escapeHtml(p.target_name)}"
                data-college-name="${escapeHtml(p.college_name || '')}"
                data-college-id="${escapeHtml(p.college_id || '')}">完成击杀</button>`
            : `<span class="hint">${!eventActive && status === 'alive' ? '活动未进行' : '—'}</span>`}
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

    // 默认选中 normal
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
    const info = KILL_REASONS[reason] || KILL_REASONS.normal;

    const previewEl = qs('kill-preview');
    if (!previewEl) return;

    const college = pendingKill.collegeName || '该学院';
    if (info.award) {
        previewEl.innerHTML =
            `确认后，<strong>${escapeHtml(college)}</strong> 将 <strong style="color:#86efac">+1 分</strong>。`;
    } else {
        previewEl.innerHTML =
            `确认后，<strong>${escapeHtml(college)}</strong> <strong style="color:#fca5a5">不得分</strong>。`;
    }
}

async function submitKill(btn) {
    if (!pendingKill) return;

    const selected = document.querySelector('input[name="kill-reason"]:checked');
    const reason = selected ? selected.value : 'normal';
    const info = KILL_REASONS[reason] || KILL_REASONS.normal;
    const { hunterId, targetName, collegeName } = pendingKill;

    setLoading(btn, true, '击杀中...');
    const { data, error } = await supabase.rpc('admin_kill_target', {
        p_hunter_id: hunterId,
        p_reason: reason,
    });
    setLoading(btn, false);

    if (error || data?.error) {
        const errMap = {
            not_admin: '你不是管理员',
            event_not_active: '活动未进行中',
            hunter_not_alive: '猎人不是存活状态',
            hunter_no_target: '猎人没有目标',
            target_already_eliminated: '目标已被淘汰',
        };
        showToast('失败：' + (errMap[data?.error] || error?.message || data?.error), 'error');
        return;
    }

    closeKillModal();

    if (data?.winner) {
        showToast(`击杀成功！${data.winner_name || ''} 获胜，活动已结束。`, 'success', 5000);
    } else {
        const pts = info.award ? `（${collegeName || '该学院'} +1）` : '（不计分）';
        showToast(`已击杀「${targetName}」${pts}`, 'success');
    }

    // 刷新链 + 概览数据
    await refreshChain();
    // 若已出赢家，概览状态也会变，触发一次刷新
    if (data?.winner) {
        // 通知 admin.js 刷新概览
        window.dispatchEvent(new CustomEvent('ninjatag:refresh-overview'));
    }
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
        // 首次加载时先展示所有已淘汰者
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
        el.innerHTML = `<p class="hint">搜索失败：${escapeHtml(error.message)}</p>`;
        return;
    }

    const list = Array.isArray(data) ? data : [];
    if (!list.length) {
        el.innerHTML = `<p class="hint" style="margin-top:8px">没有匹配的已淘汰者。</p>`;
        return;
    }

    el.innerHTML = `
    <div class="table-wrap" style="margin-top:8px">
      <table class="data-table">
        <thead>
          <tr><th>姓名</th><th>学院</th><th>邮箱</th><th class="text-right">操作</th></tr>
        </thead>
        <tbody>
          ${list.map(p => `
            <tr>
              <td data-label="姓名"><span class="cell-main">${escapeHtml(p.name)}</span></td>
              <td data-label="学院">${p.college_name
            ? `<span class="row"><span class="color-dot" style="background:${escapeHtml(p.color || '#555')}"></span>${escapeHtml(p.college_name)}</span>`
            : '<span class="muted">—</span>'}</td>
              <td data-label="邮箱">${p.email ? `<span class="hint">${escapeHtml(p.email)}</span>` : '—'}</td>
              <td class="cell-actions" data-label="操作">
                <button class="btn-mini"
                        data-pick="${escapeHtml(p.id)}"
                        data-name="${escapeHtml(p.name)}">选择</button>
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
        sel.innerHTML = '<option value="">（加载失败）</option>';
        return;
    }

    const aliveWithTarget = (data || []).filter(p =>
        String(p.status).toLowerCase() === 'alive' && p.target_name
    );

    if (!aliveWithTarget.length) {
        sel.innerHTML = '<option value="">（没有可插入的位置）</option>';
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
    if (!hunterId) { showToast('请选择插入位置', 'error'); return; }

    const hunterLabel = sel.selectedOptions[0]?.textContent || '';

    const ok = await confirmDialog({
        title: '重新加入已淘汰者',
        message: `将把「<strong>${escapeHtml(reinsertSelected.name)}</strong>」插入到「<strong>${escapeHtml(hunterLabel)}</strong>」之间，并为其生成新的代码。`,
        confirmText: '确认加入',
        danger: false,
    });
    if (!ok) return;

    const btn = qs('btn-confirm-reinsert');
    setLoading(btn, true, '加入中...');
    const { data, error } = await supabase.rpc('admin_reinsert_participant', {
        p_participant_id: reinsertSelected.id,
        p_hunter_id: hunterId,
    });
    setLoading(btn, false);

    if (error || data?.error) {
        const errMap = {
            not_admin: '你不是管理员',
            event_not_active: '活动未进行中',
            participant_not_found: '找不到该参与者',
            participant_not_eliminated: '该参与者不是已淘汰状态',
            hunter_not_found: '找不到该 Hunter',
            hunter_not_alive: 'Hunter 不是存活状态',
            hunter_no_target: 'Hunter 没有目标',
            wrong_event: '参与者不属于当前事件',
        };
        showToast('失败：' + (errMap[data?.error] || error?.message || data?.error), 'error');
        return;
    }

    showToast(`已加入环中，新代码：${data?.code || '-'}`, 'success', 4500);
    resetReinsertUI();
    await refreshChain();
    await searchEliminated('');
}

function resetReinsertUI() {
    reinsertSelected = null;
    const selEl = qs('reinsert-selected'); if (selEl) selEl.style.display = 'none';
    const searchEl = qs('reinsert-search'); if (searchEl) searchEl.value = '';
    const resEl = qs('reinsert-search-results'); if (resEl) resEl.innerHTML = '';
    searchEliminated('');
}