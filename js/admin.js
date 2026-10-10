// js/admin.js
import { supabase } from './supabase.js';
import { requireLogin, signOut, checkIsAdmin } from './auth.js';
import { showMessage, setLoading, escapeHtml, formatTime } from './utils.js';

let cachedColleges = [];
let cachedParticipants = [];
let cachedRules = [];

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
        reports: loadReports,
        logs: loadLogs,
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
    document.getElementById('event-info').innerHTML = `
    <p>名称：${escapeHtml(data.name)}</p>
    <p>状态：${statusMap[data.status] || data.status}</p>
    <p>当前天数：Day ${data.current_day}</p>
  `;
    document.getElementById('event-name').value = data.name || '';
    document.getElementById('event-day').value = data.current_day || 1;
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

async function pauseEvent() {
    const { data, error } = await supabase.rpc('admin_pause_event');
    if (error || data?.error) {
        showMessage('暂停失败：' + (error?.message || data?.error), 'error');
        return;
    }
    showMessage('活动已暂停', 'success');
    loadEvent();
}

async function resumeEvent() {
    const { data, error } = await supabase.rpc('admin_resume_event');
    if (error || data?.error) {
        showMessage('继续失败：' + (error?.message || data?.error), 'error');
        return;
    }
    showMessage('活动已继续', 'success');
    loadEvent();
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
    sel.innerHTML = data.map(c =>
        `<option value="${c.id}">${escapeHtml(c.name)}</option>`
    ).join('');
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
      <span class="admin-meta">${escapeHtml(p.email)} · ${escapeHtml(p.college_name)} · ${escapeHtml(p.status)}</span>
      <button class="btn-mini" data-delete-p="${p.id}">删除</button>
    </div>
  `).join('');

    el.querySelectorAll('[data-delete-p]').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!confirm('确定删除该参与者？')) return;
            const { data, error } = await supabase.rpc('admin_delete_participant', {
                p_id: btn.dataset.deleteP,
            });
            if (error || data?.error) { showMessage('删除失败', 'error'); return; }
            showMessage('已删除', 'success');
            loadParticipantsTab();
        });
    });
}

function filterParticipants() {
    const kw = document.getElementById('p-search').value.trim().toLowerCase();
    if (!kw) { renderParticipants(cachedParticipants); return; }
    renderParticipants(cachedParticipants.filter(p =>
        p.name.toLowerCase().includes(kw) || p.email.toLowerCase().includes(kw)
    ));
}

async function addParticipant() {
    const email = document.getElementById('p-email').value.trim();
    const name = document.getElementById('p-name').value.trim();
    const collegeId = document.getElementById('p-college').value;
    const photo = document.getElementById('p-photo').value.trim();

    if (!email || !name || !collegeId) {
        showMessage('请填写邮箱、姓名、学院', 'error');
        return;
    }

    const { data, error } = await supabase.rpc('admin_add_participant', {
        p_email: email, p_name: name,
        p_college_id: collegeId,
        p_photo_url: photo || null,
    });
    if (error || data?.error) {
        showMessage('添加失败：' + (error?.message || data?.error), 'error');
        return;
    }
    document.getElementById('p-email').value = '';
    document.getElementById('p-name').value = '';
    document.getElementById('p-photo').value = '';
    showMessage('已添加', 'success');
    loadParticipantsTab();
}

async function importCSV() {
    const raw = document.getElementById('csv-input').value.trim();
    if (!raw) { showMessage('请输入 CSV', 'error'); return; }

    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) { showMessage('CSV 为空', 'error'); return; }

    // 跳过表头
    if (lines[0].toLowerCase().startsWith('email')) lines.shift();

    const collegeMap = {};
    cachedColleges.forEach(c => { collegeMap[c.name.toLowerCase()] = c.id; });

    const rows = [];
    for (const line of lines) {
        const parts = line.split(',').map(s => s.trim());
        const [email, name, collegeName, photoUrl] = parts;
        if (!email || !name || !collegeName) continue;
        const collegeId = collegeMap[collegeName.toLowerCase()];
        if (!collegeId) {
            showMessage(`未找到学院：${collegeName}`, 'error');
            return;
        }
        rows.push({ email, name, college_id: collegeId, photo_url: photoUrl || null });
    }

    if (!rows.length) { showMessage('没有有效行', 'error'); return; }

    const { data, error } = await supabase.rpc('admin_import_participants', { p_rows: rows });
    if (error || data?.error) {
        showMessage('导入失败：' + (error?.message || data?.error), 'error');
        return;
    }
    showMessage(`已导入 ${data.count} 人`, 'success');
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
    if (error || data?.error) {
        document.getElementById('chain-list').textContent = '加载失败';
        return;
    }
    const el = document.getElementById('chain-list');
    if (!data.length) {
        el.innerHTML = '<p class="hint">暂无数据</p>';
        return;
    }
    el.innerHTML = data.map(p => `
    <div class="admin-row">
      <span class="admin-name">${escapeHtml(p.name)}</span>
      <span class="admin-meta">${escapeHtml(p.code || '-')} → ${escapeHtml(p.target_name || '无')} (${escapeHtml(p.target_code || '-')})</span>
      <span class="admin-meta">${escapeHtml(p.status)}</span>
      ${p.status === 'alive' && p.target_name ? `
        <button class="btn-mini btn-warn" data-admin-kill="${p.id}" data-award="1">击杀+加分</button>
        <button class="btn-mini" data-admin-kill="${p.id}" data-award="0">击杀不加分</button>
      ` : ''}
    </div>
  `).join('');

    el.querySelectorAll('[data-admin-kill]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const hunterId = btn.dataset.adminKill;
            const award = btn.dataset.award === '1';
            const msg = award
                ? '确认执行击杀，并给击杀者学院加 1 分？'
                : '确认执行击杀（不加分）？';
            if (!confirm(msg)) return;

            const { data: res, error: err } = await supabase.rpc('admin_kill_target', {
                p_hunter_id: hunterId,
                p_award_points: award,
            });
            if (err || res?.error) {
                showMessage('失败：' + (err?.message || res?.error), 'error');
                return;
            }
            if (res?.winner) {
                showMessage(`击杀成功！${res.winner_name || ''} 获胜，活动已结束。`, 'success');
            } else {
                showMessage('击杀成功', 'success');
            }
            loadChain();
        });
    });
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
    document.getElementById('btn-pause')?.addEventListener('click', pauseEvent);
    document.getElementById('btn-resume')?.addEventListener('click', resumeEvent);
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
    document.getElementById('btn-refresh-elims')
        ?.addEventListener('click', loadEliminations);
    document.getElementById('btn-refresh-reports')
        ?.addEventListener('click', loadReports);
    document.getElementById('btn-refresh-logs')
        ?.addEventListener('click', loadLogs);
    document.getElementById('btn-clear-logs')
        ?.addEventListener('click', clearLogs);
}

// ============ 审计日志 ============
async function loadLogs() {
    const { data, error } = await supabase.rpc('admin_get_audit_logs');
    if (error || data?.error) {
        document.getElementById('logs-list').textContent = '加载失败';
        return;
    }
    const el = document.getElementById('logs-list');
    if (!data || !data.length) {
        el.innerHTML = '<p class="hint">暂无日志</p>';
        return;
    }

    const actionMap = {
        start_event: '开始活动',
        admin_kill: '管理员击杀',
    };

    el.innerHTML = data.map(log => `
        <div class="admin-row">
            <span class="admin-name">${escapeHtml(actionMap[log.action] || log.action)}</span>
            <span class="admin-meta">${escapeHtml(log.admin_email || '系统')} · ${formatTime(log.created_at)}</span>
            <span class="admin-meta">${escapeHtml(JSON.stringify(log.details || {}))}</span>
            <button class="btn-mini btn-warn" data-delete-log="${log.id}">删除</button>
        </div>
    `).join('');

    el.querySelectorAll('[data-delete-log]').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!confirm('确定删除这条日志？')) return;
            const { data: res, error: err } = await supabase.rpc('admin_delete_audit_log', {
                p_log_id: btn.dataset.deleteLog,
            });
            if (err || res?.error) {
                showMessage('删除失败：' + (err?.message || res?.error), 'error');
                return;
            }
            showMessage('已删除', 'success');
            loadLogs();
        });
    });
}

async function clearLogs() {
    if (!confirm('确定清空所有审计日志？此操作不可恢复。')) return;
    const { data, error } = await supabase.rpc('admin_clear_audit_logs');
    if (error || data?.error) {
        showMessage('清空失败：' + (error?.message || data?.error), 'error');
        return;
    }
    showMessage('已清空所有日志', 'success');
    loadLogs();
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
    await loadEvent();
});