// js/admin.js
import { supabase } from './supabase.js';
import { requireLogin, signOut, checkIsAdmin } from './auth.js';
import { showMessage, setLoading, escapeHtml, formatTime } from './utils.js';

const KILL_REASONS = {
    normal: { label: '正常击杀', award: true },
    rule_violation: { label: '违反规则', award: true },
    task_incomplete: { label: '未完成任务', award: true },
    absent: { label: '缺勤', award: true },
    no_points: { label: '不计分击杀', award: false },
};

let cachedColleges = [];
let cachedParticipants = [];
let cachedRules = [];
let currentEventStatus = null;
let cachedChain = [];

// ============ Tab 切换 ============
function initTabs() {
    document.querySelectorAll('.tab').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById('panel-' + btn.dataset.tab).classList.add('active');
            loadTab(btn.dataset.tab);
        });
    });
}

function loadTab(name) {
    const map = {
        event: loadEvent,
        colleges: loadColleges,
        participants: loadParticipantsTab,
        rules: loadRules,
        chain: loadChain,
        eliminations: loadEliminations,
        history: loadHistory,   // 新增
        reports: loadReports,
        admins: loadAdmins,
    };
    map[name]?.();
}

// ============ 事件 ============
async function loadEvent() {
    const { data, error } = await supabase.rpc('admin_get_event');
    if (error || data?.error) {
        document.getElementById('event-info').textContent = '加载失败';
        return;
    }
    const statusMap = {
        draft: '未开始',
        active: '进行中',
        paused: '已暂停',
        ended: '已结束',
    };
    currentEventStatus = data.status;

    document.getElementById('event-info').innerHTML = `
    <p>名称：${escapeHtml(data.name)}</p>
    <p>状态：${statusMap[data.status] || data.status}</p>
    <p>当前天数：Day ${data.current_day}</p>
  `;
    document.getElementById('event-name').value = data.name || '';
    document.getElementById('event-day').value = data.current_day || 1;

    // 更新暂停/继续按钮
    const btn = document.getElementById('btn-toggle-pause');
    if (btn) {
        if (data.status === 'active') {
            btn.textContent = '暂停';
            btn.disabled = false;
        } else if (data.status === 'paused') {
            btn.textContent = '继续';
            btn.disabled = false;
        } else {
            btn.textContent = '暂停';
            btn.disabled = true; // draft / ended 时禁用
        }
    }
}

async function resetScores() {
    if (!confirm('确定重置所有学院分数为 0？')) return;
    const { data, error } = await supabase.rpc('admin_reset_college_scores');
    if (error || data?.error) {
        showMessage('重置失败：' + (error?.message || data?.error), 'error');
        return;
    }
    showMessage('学院分已重置', 'success');
}

async function saveEvent() {
    const name = document.getElementById('event-name').value.trim();
    const day = parseInt(document.getElementById('event-day').value, 10);
    if (!name || !day) { showMessage('请填写完整', 'error'); return; }
    const { data, error } = await supabase.rpc('admin_update_event', {
        p_name: name, p_current_day: day,
    });
    if (error || data?.error) {
        showMessage('保存失败：' + (error?.message || data?.error), 'error');
        return;
    }
    showMessage('已保存', 'success');
    loadEvent();
}

async function startEvent() {
    if (!confirm('开始活动会重置所有人状态、生成新代码和环，确定继续？')) return;
    const { data, error } = await supabase.rpc('admin_start_event');
    console.log(data, error);
    if (error || data?.error) {
        showMessage('开始失败：' + (error?.message || data?.error), 'error');
        return;
    }
    showMessage(`活动已开始，共 ${data.count} 人`, 'success');
    loadEvent();
}

async function reshuffleAlive() {
    if (!confirm('将只对存活者重新生成环，确定继续？')) return;
    const { data, error } = await supabase.rpc('admin_reshuffle_alive');
    if (error || data?.error) {
        showMessage('打乱失败：' + (error?.message || data?.error), 'error');
        return;
    }
    showMessage(`已打乱 ${data.alive_count} 名存活者`, 'success');
}

async function togglePause() {
    const btn = document.getElementById('btn-toggle-pause');
    if (!btn || btn.disabled) return;

    if (currentEventStatus === 'active') {
        btn.disabled = true;
        const { data, error } = await supabase.rpc('admin_pause_event');
        btn.disabled = false;
        if (error || data?.error) {
            showMessage('暂停失败：' + (error?.message || data?.error), 'error');
            return;
        }
        showMessage('活动已暂停', 'success');
        loadEvent();
    } else if (currentEventStatus === 'paused') {
        btn.disabled = true;
        const { data, error } = await supabase.rpc('admin_resume_event');
        btn.disabled = false;
        if (error || data?.error) {
            showMessage('继续失败：' + (error?.message || data?.error), 'error');
            return;
        }
        showMessage('活动已继续', 'success');
        loadEvent();
    } else {
        showMessage('当前状态无法暂停/继续', 'error');
    }
}

async function endEvent() {
    const text = prompt('输入「结束活动」四个字以确认：');
    if (text === null) return;
    if (text.trim() !== '结束活动') {
        showMessage('输入不正确，未结束', 'error');
        return;
    }
    const { data, error } = await supabase.rpc('admin_end_event', {
        p_confirm: text.trim(),
    });
    if (error || data?.error) {
        showMessage('结束失败：' + (error?.message || data?.error), 'error');
        return;
    }
    showMessage('活动已结束', 'success');
    loadEvent();
}

// ============ 学院 ============
async function loadColleges() {
    const { data, error } = await supabase.rpc('admin_get_colleges');
    if (error || data?.error) {
        document.getElementById('colleges-list').textContent = '加载失败';
        return;
    }
    cachedColleges = data;
    const el = document.getElementById('colleges-list');
    el.innerHTML = data.map(c => `
    <div class="admin-row">
      <span class="color-dot" style="background:${escapeHtml(c.color)}"></span>
      <span class="admin-name">${escapeHtml(c.name)}</span>
      <span class="admin-meta">${c.score} 分 · ${c.participant_count} 人</span>
      <button class="btn-mini" data-edit-college="${c.id}">编辑</button>
      <button class="btn-mini" data-score-college="${c.id}" data-delta="1">+1</button>
      <button class="btn-mini" data-score-college="${c.id}" data-delta="-1">-1</button>
    </div>
  `).join('');

    el.querySelectorAll('[data-score-college]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const delta = parseInt(btn.dataset.delta, 10);
            const { data: res, error: err } = await supabase.rpc('admin_adjust_college_score', {
                p_college_id: btn.dataset.scoreCollege, p_delta: delta,
            });
            if (err || res?.error) { showMessage('失败', 'error'); return; }
            loadColleges();
        });
    });

    el.querySelectorAll('[data-edit-college]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const c = cachedColleges.find(x => x.id === btn.dataset.editCollege);
            if (!c) return;
            const name = prompt('学院名', c.name);
            if (name === null) return;
            const color = prompt('颜色 hex', c.color);
            if (color === null) return;
            const { data: res, error: err } = await supabase.rpc('admin_update_college', {
                p_id: c.id, p_name: name, p_color: color,
            });
            if (err || res?.error) { showMessage('失败', 'error'); return; }
            loadColleges();
        });
    });

    // 填充参与者下拉
    const sel = document.getElementById('p-college');
    sel.innerHTML = '<option value="">（不指定）</option>' +
        data.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
}

// ============ 参与者 ============
async function loadParticipantsTab() {
    await loadColleges();
    const { data, error } = await supabase.rpc('admin_get_participants');
    if (error || data?.error) {
        document.getElementById('participants-list').textContent = '加载失败';
        return;
    }
    cachedParticipants = data;
    renderParticipants(data);
}

function renderParticipants(list) {
    const el = document.getElementById('participants-list');
    if (!list.length) {
        el.innerHTML = '<p class="hint">暂无参与者</p>';
        return;
    }
    el.innerHTML = list.map(p => `
    <div class="admin-row">
        <span class="admin-name">${escapeHtml(p.name)}</span>
        <span class="admin-meta">
            ${p.grade ? escapeHtml(p.grade) + ' · ' : ''}
            ${escapeHtml(p.college_name || '未分 House')}
            · ${escapeHtml(p.status)}
            ${p.email ? ' · ' + escapeHtml(p.email) : ''}
        </span>
        <button class="btn-mini" data-edit-p="${p.id}">编辑</button>
        <button class="btn-mini btn-warn" data-delete-p="${p.id}">删除</button>
    </div>
`).join('');

    el.querySelectorAll('[data-delete-p]').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!confirm('确定删除该参与者？删除后会同步清理其击杀记录、举报和相关引用。')) return;
            const { data, error } = await supabase.rpc('admin_delete_participant', {
                p_id: btn.dataset.deleteP,
            });
            if (error || data?.error) { showMessage('删除失败', 'error'); return; }
            showMessage('已删除', 'success');
            loadParticipantsTab();
        });
    });

    el.querySelectorAll('[data-edit-p]').forEach(btn => {
        btn.addEventListener('click', () => {
            const p = cachedParticipants.find(x => x.id === btn.dataset.editP);
            if (p) openEditParticipant(p);
        });
    });
}

// ============ 编辑参与者 ============
let editingParticipantId = null;

function openEditParticipant(p) {
    editingParticipantId = p.id;

    // 填充 House 下拉
    const collegeSel = document.getElementById('edit-p-college');
    collegeSel.innerHTML = '<option value="">（不指定）</option>' +
        cachedColleges.map(c =>
            `<option value="${c.id}">${escapeHtml(c.name)}</option>`
        ).join('');

    document.getElementById('edit-p-name').value = p.name || '';
    document.getElementById('edit-p-grade').value = p.grade || '';
    document.getElementById('edit-p-college').value = p.college_id || '';
    document.getElementById('edit-p-photo').value = p.photo_url || '';
    document.getElementById('edit-p-email').value = p.email || '';

    const msg = document.getElementById('edit-participant-message');
    msg.style.display = 'none';

    document.getElementById('edit-participant-modal').style.display = 'flex';
}

function closeEditParticipant() {
    editingParticipantId = null;
    document.getElementById('edit-participant-modal').style.display = 'none';
}

async function saveEditParticipant() {
    if (!editingParticipantId) return;

    const name = document.getElementById('edit-p-name').value.trim();
    const grade = document.getElementById('edit-p-grade').value || null;
    const collegeId = document.getElementById('edit-p-college').value || null;
    const photo = document.getElementById('edit-p-photo').value.trim();
    const email = document.getElementById('edit-p-email').value.trim();

    const msg = document.getElementById('edit-participant-message');
    msg.style.display = 'none';

    if (!name) {
        msg.textContent = '姓名不能为空';
        msg.className = 'message message-error';
        msg.style.display = 'block';
        return;
    }

    const btn = document.getElementById('btn-save-edit-participant');
    btn.disabled = true;

    const { data, error } = await supabase.rpc('admin_update_participant', {
        p_id: editingParticipantId,
        p_name: name,
        p_grade: grade,
        p_college_id: collegeId,
        p_photo_url: photo || null,
        p_email: email || null,
    });

    btn.disabled = false;

    if (error || data?.error) {
        const errMap = {
            not_admin: '你不是管理员',
            id_required: '缺少参与者 ID',
            name_required: '姓名不能为空',
            participant_not_found: '参与者不存在',
            email_exists: '该邮箱已被其他参与者使用',
            invalid_school_email: '邮箱必须是学校邮箱',
        };
        msg.textContent = errMap[data?.error] || error?.message || data?.error || '保存失败';
        msg.className = 'message message-error';
        msg.style.display = 'block';
        return;
    }

    closeEditParticipant();
    showMessage('已保存', 'success');
    loadParticipantsTab();
}

function filterParticipants() {
    const kw = document.getElementById('p-search').value.trim().toLowerCase();
    if (!kw) { renderParticipants(cachedParticipants); return; }
    renderParticipants(cachedParticipants.filter(p =>
        (p.name || '').toLowerCase().includes(kw) ||
        (p.email || '').toLowerCase().includes(kw) ||
        (p.grade || '').toLowerCase().includes(kw)
    ));
}

async function addParticipant() {
    const name = document.getElementById('p-name').value.trim();
    const grade = document.getElementById('p-grade').value.trim();
    const collegeId = document.getElementById('p-college').value || null;
    const photo = document.getElementById('p-photo').value.trim();
    const email = document.getElementById('p-email').value.trim();

    if (!name) {
        showMessage('请填写姓名', 'error');
        return;
    }

    const { data, error } = await supabase.rpc('admin_add_participant', {
        p_name: name,
        p_grade: grade || null,
        p_college_id: collegeId,
        p_photo_url: photo || null,
        p_email: email || null,
    });

    if (error || data?.error) {
        const errMap = {
            not_admin: '你不是管理员',
            name_required: '姓名不能为空',
            email_exists: '该邮箱已存在',
            invalid_school_email: '邮箱必须是学校邮箱',
            no_event: '没有事件',
        };
        showMessage('添加失败：' + (errMap[data?.error] || error?.message || data?.error), 'error');
        return;
    }

    // 清空表单（保留 house 选择）
    document.getElementById('p-name').value = '';
    document.getElementById('p-grade').value = '';
    document.getElementById('p-photo').value = '';
    document.getElementById('p-email').value = '';
    showMessage('已添加', 'success');
    loadParticipantsTab();
}

async function importCSV() {
    const raw = document.getElementById('csv-input').value.trim();
    if (!raw) { showMessage('请输入 CSV', 'error'); return; }

    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) { showMessage('CSV 为空', 'error'); return; }

    // 跳过表头（如果第一行以 name 开头）
    if (lines[0].toLowerCase().startsWith('name')) lines.shift();
    const VALID_GRADES = ['G9', 'G10', 'G11', 'G12', 'Teacher'];
    const rows = [];
    for (const line of lines) {
        const parts = line.split(',').map(s => s.trim());
        const [name, grade, collegeName, photoUrl, email] = parts;

        if (!name) continue; // 姓名为空的行直接跳过

        let gradeVal = grade || null;
        if (gradeVal && !VALID_GRADES.includes(gradeVal)) {
            gradeVal = null; // 或改成 throw 提示，二选一
        }

        rows.push({
            name: name,
            grade: gradeVal,
            college_name: collegeName || null,
            photo_url: photoUrl || null,
            email: email || null,
        });
    }

    if (!rows.length) { showMessage('没有有效行', 'error'); return; }

    const { data, error } = await supabase.rpc('admin_import_participants', { p_rows: rows });
    if (error || data?.error) {
        showMessage('导入失败：' + (error?.message || data?.error), 'error');
        return;
    }

    const skipped = data.skipped ? `（跳过 ${data.skipped} 行）` : '';
    showMessage(`已导入 ${data.count} 人${skipped}`, 'success');
    document.getElementById('csv-input').value = '';
    loadParticipantsTab();
}

// ============ 每日规则 ============
async function loadRules() {
    const { data, error } = await supabase.rpc('admin_get_daily_rules');
    if (error || data?.error) {
        document.getElementById('rules-list').textContent = '加载失败';
        return;
    }
    cachedRules = data;
    const el = document.getElementById('rules-list');
    if (!data.length) {
        el.innerHTML = '<p class="hint">暂无规则</p>';
        return;
    }
    el.innerHTML = data.map(r => `
    <div class="admin-row">
      <span class="admin-name">Day ${r.day_number}</span>
      <span class="admin-meta">${escapeHtml(r.title)} · ${r.published ? '已发布' : '未发布'}</span>
      <button class="btn-mini" data-edit-rule="${r.day_number}">编辑</button>
    </div>
  `).join('');

    el.querySelectorAll('[data-edit-rule]').forEach(btn => {
        btn.addEventListener('click', () => {
            const day = parseInt(btn.dataset.editRule, 10);
            const rule = cachedRules.find(r => r.day_number === day);
            if (!rule) return;
            document.getElementById('rule-day').value = String(day);
            document.getElementById('rule-title').value = rule.title;
            document.getElementById('rule-content').value = rule.content;
        });
    });
}

async function publishRule() {
    const day = parseInt(document.getElementById('rule-day').value, 10);
    const title = document.getElementById('rule-title').value.trim();
    const content = document.getElementById('rule-content').value.trim();
    if (!title) { showMessage('请填写标题', 'error'); return; }
    const { data, error } = await supabase.rpc('admin_publish_daily_rule', {
        p_day: day, p_title: title, p_content: content || '',
    });
    if (error || data?.error) {
        showMessage('发布失败：' + (error?.message || data?.error), 'error');
        return;
    }
    showMessage('已发布', 'success');
    loadRules();
}

// ============ 全局链 ============
async function loadChain() {
    const { data, error } = await supabase.rpc('admin_get_global_chain');
    if (error) {
        document.getElementById('chain-list').textContent = '加载失败：' + error.message;
        return;
    }
    if (data?.error) {
        document.getElementById('chain-list').textContent = '加载失败：' + data.error;
        return;
    }

    cachedChain = Array.isArray(data) ? data : [];
    renderChain(cachedChain);
}

let reinsertSelected = null;
let reinsertSearchTimer = null;

async function searchEliminated(query) {
    const { data, error } = await supabase.rpc('admin_search_eliminated_participants', {
        p_query: query || '',
    });
    if (error) {
        document.getElementById('reinsert-search-results').textContent =
            '搜索失败：' + error.message;
        return;
    }
    renderReinsertResults(Array.isArray(data) ? data : []);
}

function renderReinsertResults(list) {
    const el = document.getElementById('reinsert-search-results');
    if (!list.length) {
        el.innerHTML = '<p class="hint">没有匹配的已淘汰者</p>';
        return;
    }
    el.innerHTML = list.map(p => `
        <div class="admin-row">
            <span class="admin-name">${escapeHtml(p.name)}</span>
            <span class="admin-meta">${escapeHtml(p.email || '')} · ${escapeHtml(p.college_name || '')}</span>
            <button class="btn-mini"
                    data-pick-reinsert="${p.id}"
                    data-name="${escapeHtml(p.name)}">选择</button>
        </div>
    `).join('');

    el.querySelectorAll('[data-pick-reinsert]').forEach(btn => {
        btn.addEventListener('click', () => {
            selectEliminatedForReinsert(btn.dataset.pickReinsert, btn.dataset.name);
        });
    });
}

async function selectEliminatedForReinsert(id, name) {
    reinsertSelected = { id, name };
    document.getElementById('reinsert-selected-name').textContent = name;
    document.getElementById('reinsert-selected').style.display = 'block';
    await fillReinsertHunterSelect();
}

async function fillReinsertHunterSelect() {
    const { data, error } = await supabase.rpc('admin_get_global_chain');
    const sel = document.getElementById('reinsert-hunter-select');

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
        `<option value="${p.id}">${escapeHtml(p.name)} → ${escapeHtml(p.target_name)}</option>`
    ).join('');
}

async function confirmReinsert() {
    if (!reinsertSelected) return;

    const sel = document.getElementById('reinsert-hunter-select');
    const hunterId = sel.value;
    if (!hunterId) {
        showMessage('请选择插入位置', 'error');
        return;
    }

    const hunterLabel = sel.selectedOptions[0]?.textContent || '';
    if (!confirm(`确认将「${reinsertSelected.name}」插入到「${hunterLabel}」之间？`)) return;

    const btn = document.getElementById('btn-confirm-reinsert');
    btn.disabled = true;
    const { data, error } = await supabase.rpc('admin_reinsert_participant', {
        p_participant_id: reinsertSelected.id,
        p_hunter_id: hunterId,
    });
    btn.disabled = false;

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
        showMessage(
            '失败：' + (errMap[data?.error] || error?.message || data?.error),
            'error'
        );
        return;
    }

    showMessage(
        `已将「${data.participant_name}」加入环中，新代码：${data.code}`,
        'success'
    );
    resetReinsertUI();
    loadChain();
}

function resetReinsertUI() {
    reinsertSelected = null;
    const selEl = document.getElementById('reinsert-selected');
    if (selEl) selEl.style.display = 'none';
    const searchEl = document.getElementById('reinsert-search');
    if (searchEl) searchEl.value = '';
    const resEl = document.getElementById('reinsert-search-results');
    if (resEl) resEl.innerHTML = '';
}

function bindReinsertEvents() {
    const input = document.getElementById('reinsert-search');
    if (input && !input.dataset.bound) {
        input.dataset.bound = '1';
        input.addEventListener('input', () => {
            clearTimeout(reinsertSearchTimer);
            reinsertSearchTimer = setTimeout(() => {
                searchEliminated(input.value.trim());
            }, 300);
        });
        // 首次打开时，先展示所有已淘汰者
        searchEliminated('');
    }

    const btnConfirm = document.getElementById('btn-confirm-reinsert');
    if (btnConfirm && !btnConfirm.dataset.bound) {
        btnConfirm.dataset.bound = '1';
        btnConfirm.addEventListener('click', confirmReinsert);
    }

    const btnCancel = document.getElementById('btn-cancel-reinsert');
    if (btnCancel && !btnCancel.dataset.bound) {
        btnCancel.dataset.bound = '1';
        btnCancel.addEventListener('click', resetReinsertUI);
    }
}

async function renderChain(list) {
    const el = document.getElementById('chain-list');
    if (!list.length) {
        el.innerHTML = '<p class="hint">暂无数据</p>';
        return;
    }

    const { data: eventData } = await supabase.rpc('admin_get_event');
    const eventActive = eventData?.status === 'active';

    el.innerHTML = list.map(p => {
        const status = p.status ?? '';
        const targetName = p.target_name ?? '';
        const collegeName = p.college_name ?? '';
        const canKill = String(status).toLowerCase() === 'alive' && targetName;

        return `
    <div class="admin-row">
        <span class="admin-name">${escapeHtml(p.name)}</span>
        <span class="admin-meta">${escapeHtml(p.code || '-')} → ${escapeHtml(targetName || '无')} (${escapeHtml(p.target_code || '-')})</span>
        <span class="admin-meta">${escapeHtml(status)}</span>
        ${canKill ? `
            <button class="btn-mini btn-warn"
                    data-kill-btn="${p.id}"
                    data-target-name="${escapeHtml(targetName)}"
                    data-college-name="${escapeHtml(collegeName)}"
                    ${eventActive ? '' : 'disabled'}>完成击杀</button>
        ` : ''}
    </div>`;
    }).join('');

    el.querySelectorAll('[data-kill-btn]').forEach(btn => {
        btn.addEventListener('click', () => {
            openKillReasonModal({
                hunterId: btn.dataset.killBtn,
                targetName: btn.dataset.targetName,
                collegeName: btn.dataset.collegeName,
            });
        });
    });
}

// ============ 击杀原因 Modal ============
let pendingKill = null;

function openKillReasonModal(ctx) {
    pendingKill = ctx;
    document.getElementById('kill-target-name').textContent = ctx.targetName || '-';

    // 默认选中 normal
    const radios = document.querySelectorAll('input[name="kill-reason"]');
    radios.forEach(r => { r.checked = (r.value === 'normal'); });

    document.getElementById('kill-reason-modal').style.display = 'flex';
}

function closeKillReasonModal() {
    pendingKill = null;
    document.getElementById('kill-reason-modal').style.display = 'none';
}

async function submitKillWithReason() {
    if (!pendingKill) return;

    const selected = document.querySelector('input[name="kill-reason"]:checked');
    const reason = selected ? selected.value : 'normal';
    const info = KILL_REASONS[reason] || KILL_REASONS.normal;

    const { hunterId, targetName, collegeName } = pendingKill;

    // 二次确认
    const awardText = info.award ? '将' : '将不';
    const msg = `确定“${targetName}”因为“${info.label}”而被击杀，“${collegeName || '该学院'}”${awardText}得分。`;
    if (!confirm(msg)) return;

    closeKillReasonModal();

    const { data: res, error: err } = await supabase.rpc('admin_kill_target', {
        p_hunter_id: hunterId,
        p_reason: reason,
    });

    if (err || res?.error) {
        const errMap = {
            not_admin: '你不是管理员',
            event_not_active: '活动未进行中',
            hunter_not_alive: '猎人不是存活状态',
            hunter_no_target: '猎人没有目标',
            target_already_eliminated: '目标已被淘汰',
        };
        showMessage('失败：' + (errMap[res?.error] || err?.message || res?.error), 'error');
        return;
    }

    if (res?.winner) {
        showMessage(`击杀成功！${res.winner_name || ''} 获胜，活动已结束。`, 'success');
    } else {
        showMessage('击杀成功', 'success');
    }
    loadChain();
}

function filterChain() {
    const kw = document.getElementById('chain-search').value.trim().toLowerCase();
    if (!kw) {
        renderChain(cachedChain);
        return;
    }
    const filtered = cachedChain.filter(p =>
        (p.name || '').toLowerCase().includes(kw) ||
        (p.code || '').toLowerCase().includes(kw) ||
        (p.target_name || '').toLowerCase().includes(kw) ||
        (p.target_code || '').toLowerCase().includes(kw)
    );
    renderChain(filtered);
}

// ============ 管理员 ============
async function loadAdmins() {
    const { data, error } = await supabase.rpc('admin_get_admins');
    if (error || data?.error) {
        document.getElementById('admins-list').textContent = '加载失败';
        return;
    }

    const el = document.getElementById('admins-list');
    if (!data.length) {
        el.innerHTML = '<p class="hint">暂无管理员</p>';
        return;
    }

    el.innerHTML = data.map(a => `
        <div class="admin-row">
            <span class="admin-name">${escapeHtml(a.name || '未命名')}</span>
            <span class="admin-meta">${escapeHtml(a.email)}</span>
            <button class="btn-mini btn-warn"
        data-delete-admin="${a.id}"
        data-name="${escapeHtml(a.name || a.email)}">移除</button>
        </div>
    `).join('');

    el.querySelectorAll('[data-delete-admin]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const name = btn.dataset.name || '该管理员';

            if (!confirm(`是否确认将'${name}'的管理员职责移除？`)) return;

            const { data: res, error: err } = await supabase.rpc('admin_delete_admin', {
                p_id: btn.dataset.deleteAdmin,
            });

            if (err || res?.error) {
                const errMap = {
                    not_admin: '你不是管理员',
                    admin_not_found: '该管理员不存在，可能已被删除',
                    cannot_delete_self: '不能移除自己的管理员职责',
                    must_keep_one_admin: '至少需要保留一名管理员',
                };
                showMessage('删除失败：' + (errMap[res?.error] || err?.message || res?.error), 'error');
                return;
            }

            showMessage('已移除管理员职责', 'success');
            loadAdmins();
        });
    });
}

async function addAdmin() {
    const email = document.getElementById('admin-email').value.trim();
    const name = document.getElementById('admin-name').value.trim();

    if (!email) {
        showMessage('请输入邮箱', 'error');
        return;
    }

    const { data, error } = await supabase.rpc('admin_add_admin', {
        p_email: email,
        p_name: name || null,
    });

    if (error || data?.error) {
        showMessage('添加失败：' + (error?.message || data?.error), 'error');
        return;
    }

    document.getElementById('admin-email').value = '';
    document.getElementById('admin-name').value = '';
    showMessage('已添加', 'success');
    loadAdmins();
}

// ============ 击杀记录 ============
async function loadEliminations() {
    const { data, error } = await supabase.rpc('admin_get_eliminations');
    if (error || data?.error) {
        document.getElementById('eliminations-list').textContent = '加载失败';
        return;
    }
    const el = document.getElementById('eliminations-list');
    if (!data.length) {
        el.innerHTML = '<p class="hint">暂无击杀记录</p>';
        return;
    }
    el.innerHTML = data.map(e => `
    <div class="admin-row">
      <span class="admin-name">${escapeHtml(e.hunter_name)} → ${escapeHtml(e.target_name)}</span>
      <span class="admin-meta">${escapeHtml(e.hunter_college)} → ${escapeHtml(e.target_college)} · ${formatTime(e.created_at)}</span>
      <span class="admin-meta">${e.status}</span>
      ${e.status === 'valid'
            ? `<button class="btn-mini btn-warn" data-revoke="${e.id}">撤销</button>`
            : `<span class="admin-meta">${escapeHtml(e.revoke_reason || '')}</span>`}
    </div>
  `).join('');

    el.querySelectorAll('[data-revoke]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const reason = prompt('撤销原因');
            if (reason === null) return;
            const { data: res, error: err } = await supabase.rpc('admin_revoke_kill', {
                p_elimination_id: btn.dataset.revoke,
                p_reason: reason || '',
            });
            if (err || res?.error) {
                showMessage('撤销失败：' + (err?.message || res?.error), 'error');
                return;
            }
            showMessage('已撤销', 'success');
            loadEliminations();
        });
    });
}

// ============ 举报 ============
async function loadReports() {
    const { data, error } = await supabase.rpc('admin_get_reports');
    if (error || data?.error) {
        document.getElementById('reports-list').textContent = '加载失败';
        return;
    }
    const el = document.getElementById('reports-list');
    if (!data.length) {
        el.innerHTML = '<p class="hint">暂无举报</p>';
        return;
    }
    el.innerHTML = data.map(r => `
    <div class="report-item">
      <div class="admin-row">
        <span class="admin-name">${escapeHtml(r.reporter_name)} 举报 ${escapeHtml(r.target_name)}</span>
        <span class="admin-meta">${formatTime(r.created_at)} · ${r.status}</span>
      </div>
      <p class="hint">原因：${escapeHtml(r.reason)}</p>
      <p>${escapeHtml(r.description || '')}</p>
      ${r.evidence_url ? `<a href="${escapeHtml(r.evidence_url)}" target="_blank">查看证据</a>` : ''}
      ${r.status === 'pending' ? `
        <div class="btn-row">
          <button class="btn-mini" data-handle="${r.id}" data-status="resolved">已处理</button>
          <button class="btn-mini btn-warn" data-handle="${r.id}" data-status="rejected">驳回</button>
        </div>
      ` : `<p class="hint">处理备注：${escapeHtml(r.admin_note || '')}</p>`}
    </div>
  `).join('');

    el.querySelectorAll('[data-handle]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const note = prompt('处理备注（可选）') || '';
            const { data: res, error: err } = await supabase.rpc('admin_handle_report', {
                p_report_id: btn.dataset.handle,
                p_status: btn.dataset.status,
                p_note: note,
            });
            if (err || res?.error) {
                showMessage('处理失败：' + (err?.message || res?.error), 'error');
                return;
            }
            showMessage('已处理', 'success');
            loadReports();
        });
    });
}

// ============ 历史记录 ============
let cachedHistory = [];

async function loadHistory() {
    const { data, error } = await supabase.rpc('admin_get_history', { p_limit: 500 });
    if (error || data?.error) {
        document.getElementById('history-list').textContent = '加载失败';
        return;
    }
    cachedHistory = Array.isArray(data) ? data : [];
    renderHistory(cachedHistory);
}

function renderHistory(list) {
    const el = document.getElementById('history-list');
    if (!list.length) {
        el.innerHTML = '<p class="hint">暂无历史记录</p>';
        return;
    }

    el.innerHTML = list.map(h => {
        const t = formatTime(h.happened_at);
        const d = h.details || {};

        if (h.type === 'kill') {
            const reasonInfo = KILL_REASONS[d.reason] || null;
            const reasonLabel = reasonInfo ? reasonInfo.label : (d.reason || '');
            const pts = d.points_awarded
                ? `，<strong>${escapeHtml(d.hunter_college || '?')} +${d.points_awarded}</strong>`
                : '，不加分';
            return `
        <div class="history-item">
            <div class="history-time">${t}</div>
            <div class="history-content">
                <strong>${escapeHtml(d.hunter_name || '?')}</strong>
                击杀了
                <strong>${escapeHtml(d.target_name || '?')}</strong>${pts}
                ${reasonLabel ? `<div class="history-note">原因：${escapeHtml(reasonLabel)}</div>` : ''}
            </div>
        </div>`;
        }

        if (h.type === 'revoke') {
            const pts = d.points_awarded
                ? `，<strong>${escapeHtml(d.hunter_college || '?')} -${d.points_awarded}</strong>`
                : '';
            return `
                <div class="history-item">
                    <div class="history-time">${t}</div>
                    <div class="history-content">
                        <span class="history-tag tag-revoke">撤销</span>
                        撤销了 <strong>${escapeHtml(d.hunter_name || '?')}</strong>
                        击杀 <strong>${escapeHtml(d.target_name || '?')}</strong>${pts}
                        ${(() => { const r = KILL_REASONS[d.reason]; return r ? `<div class="history-note">原击杀原因：${escapeHtml(r.label)}</div>` : ''; })()}
                        ${d.revoke_reason ? `<div class="history-note">原因：${escapeHtml(d.revoke_reason)}</div>` : ''}
                        ${d.revoked_by_email ? `<div class="history-note">操作者：${escapeHtml(d.revoked_by_email)}</div>` : ''}
                    </div>
                </div>`;
        }

        if (h.type === 'reinsert') {
            return `
                <div class="history-item">
                    <div class="history-time">${t}</div>
                    <div class="history-content">
                        <span class="history-tag tag-reinsert">复活</span>
                        将 <strong>${escapeHtml(d.participant_name || '?')}</strong>
                        重新加入环中（插入到 <strong>${escapeHtml(d.hunter_name || '?')}</strong> 之后）
                        ${d.admin_email ? `<div class="history-note">操作者：${escapeHtml(d.admin_email)}</div>` : ''}
                    </div>
                </div>`;
        }

        return '';
    }).join('');
}

function filterHistory() {
    const kw = document.getElementById('history-search').value.trim().toLowerCase();
    if (!kw) {
        renderHistory(cachedHistory);
        return;
    }
    const filtered = cachedHistory.filter(h => {
        const s = [
            h.type,
            h.details?.hunter_name,
            h.details?.target_name,
            h.details?.participant_name,
            h.details?.hunter_college,
            h.details?.target_college,
            h.details?.revoke_reason,
            h.details?.revoked_by_email,
            h.details?.admin_email,
        ].filter(Boolean).join(' ').toLowerCase();
        return s.includes(kw);
    });
    renderHistory(filtered);
}

// ============ 绑定事件 ============
function bindEvents() {
    document.getElementById('nav-logout')?.addEventListener('click', (e) => {
        e.preventDefault();
        signOut();
    });
    document.getElementById('btn-save-event')
        ?.addEventListener('click', saveEvent);
    document.getElementById('btn-start')?.addEventListener('click', startEvent);
    document.getElementById('btn-reshuffle')?.addEventListener('click', reshuffleAlive);
    document.getElementById('btn-toggle-pause')?.addEventListener('click', togglePause);
    document.getElementById('btn-end')?.addEventListener('click', endEvent);
    document.getElementById('btn-add-participant')
        ?.addEventListener('click', addParticipant);
    document.getElementById('btn-import-csv')
        ?.addEventListener('click', importCSV);
    document.getElementById('p-search')
        ?.addEventListener('input', filterParticipants);

    document.getElementById('btn-publish-rule')
        ?.addEventListener('click', publishRule);

    document.getElementById('btn-refresh-chain')
        ?.addEventListener('click', loadChain);
    document.getElementById('chain-search')
        ?.addEventListener('input', filterChain);
    document.getElementById('btn-refresh-elims')
        ?.addEventListener('click', loadEliminations);
    document.getElementById('btn-refresh-reports')
        ?.addEventListener('click', loadReports);

    document.getElementById('btn-add-admin')
        ?.addEventListener('click', addAdmin);
    document.getElementById('btn-refresh-admins')
        ?.addEventListener('click', loadAdmins);
    document.getElementById('btn-save-edit-participant')
        ?.addEventListener('click', saveEditParticipant);
    document.getElementById('btn-cancel-edit-participant')
        ?.addEventListener('click', closeEditParticipant);
    document.getElementById('edit-participant-modal')
        ?.addEventListener('click', (e) => {
            if (e.target.id === 'edit-participant-modal') closeEditParticipant();
        });
    document.getElementById('btn-refresh-history')
        ?.addEventListener('click', loadHistory);
    document.getElementById('history-search')
        ?.addEventListener('input', filterHistory);
    document.getElementById('btn-kill-reason-next')
        ?.addEventListener('click', submitKillWithReason);

    document.getElementById('kill-reason-modal')
        ?.addEventListener('click', (e) => {
            if (e.target.id === 'kill-reason-modal') closeKillReasonModal();
        });
}

document.addEventListener('DOMContentLoaded', async () => {
    const session = await requireLogin();
    if (!session) return;

    const isAdmin = await checkIsAdmin();
    if (!isAdmin) {
        showMessage('你不是管理员，无权访问。', 'error');
        setTimeout(() => window.location.href = 'index.html', 1500);
        return;
    }

    initTabs();
    bindEvents();
    bindReinsertEvents();
    await loadEvent();
});