// js/admin-participants.js
// 参与者：列表 / 筛选 / 排序 / 批量 / CSV 导入预览 / 增删改 / 照片上传

import { supabase } from './supabase.js';
import { state, refreshTab } from './admin.js';
import {
  qs, qsa, showToast, setLoading, confirmDialog,
  openModal, closeModal, escapeHtml, debounce,
  skeletonTable, emptyState,
} from './utils.js';

const VALID_GRADES = ['G9', 'G10', 'G11', 'G12', 'Teacher'];

let filter = {
  keyword: '',
  collegeId: '',
  status: '',
  grade: '',
  sort: 'created_desc',
};

let selectedIds = new Set();
let editingId = null;
let parsedRows = [];
let lastRenderedSignature = '';

/* ============================================================
   照片上传器
   ============================================================ */

const uploaders = new Map();

async function uploadImage(file) {
  if (!file) throw new Error('未选择文件');
  if (!file.type.startsWith('image/')) throw new Error('请选择图片文件');

  const MAX = 2 * 1024 * 1024;
  if (file.size > MAX) throw new Error('文件不能超过 2MB');

  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const uuid = (crypto.randomUUID
    ? crypto.randomUUID()
    : Date.now() + '-' + Math.random().toString(36).slice(2));
  const path = `${uuid}.${ext}`;

  const { error } = await supabase.storage
    .from('photos')
    .upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type,
    });

  if (error) throw error;

  const { data } = supabase.storage.from('photos').getPublicUrl(path);
  return data.publicUrl;
}

function initUploader(root) {
  const key = root.dataset.photoUploader;
  const preview  = root.querySelector('.photo-preview img');
  const chooseBtn = root.querySelector('[data-photo-choose]');
  const removeBtn = root.querySelector('[data-photo-remove]');
  const fileInput = root.querySelector('[data-photo-file]');
  const valueInput = root.querySelector('[data-photo-value]');
  const hint = root.querySelector('.photo-hint');
  const defaultHint = hint?.textContent || '';

  function setPreview(url) {
    preview.onerror = () => { preview.onerror = null; preview.src = 'assets/placeholder.png'; };
    preview.src = url || 'assets/placeholder.png';
  }

  function setValue(url) {
    valueInput.value = url || '';
    setPreview(url);
    if (removeBtn) removeBtn.style.display = url ? '' : 'none';
  }

  function setUploading(on) {
    chooseBtn.disabled = on;
    fileInput.disabled = on;
    if (removeBtn) removeBtn.disabled = on;
    if (hint) hint.textContent = on ? '上传中...' : defaultHint;
  }

  chooseBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    setUploading(true);
    try {
      const url = await uploadImage(f);
      setValue(url);
      showToast('照片已上传', 'success');
    } catch (err) {
      showToast('上传失败：' + (err.message || err), 'error');
    } finally {
      setUploading(false);
      fileInput.value = '';
    }
  });

  removeBtn?.addEventListener('click', () => setValue(''));

  const api = {
    getValue: () => (valueInput.value || '').trim() || null,
    setValue,
    reset: () => setValue(''),
  };
  uploaders.set(key, api);
  return api;
}

function initAllUploaders() {
  document.querySelectorAll('[data-photo-uploader]').forEach(root => {
    if (root.dataset.uploaderBound === '1') return;
    root.dataset.uploaderBound = '1';
    initUploader(root);
  });
}

/* ============================================================
   初始化
   ============================================================ */

export function initParticipants() {
  initAllUploaders();

  qs('btn-add-participant')?.addEventListener('click', (e) => addParticipant(e.currentTarget));

  // 筛选
  const searchEl = qs('p-search');
  if (searchEl) searchEl.addEventListener('input', debounce(() => {
    filter.keyword = searchEl.value.trim().toLowerCase();
    render();
  }, 200));

  qs('p-filter-college')?.addEventListener('change', (e) => {
    filter.collegeId = e.target.value;
    render();
  });
  qs('p-filter-status')?.addEventListener('change', (e) => {
    filter.status = e.target.value;
    render();
  });
  qs('p-filter-grade')?.addEventListener('change', (e) => {
    filter.grade = e.target.value;
    render();
  });

  // 排序
  const sortEl = qs('p-sort');
  if (sortEl) {
    sortEl.value = filter.sort;
    sortEl.addEventListener('change', (e) => {
      filter.sort = e.target.value || 'created_desc';
      render();
    });
  }

  // 批量操作
  qs('p-bulk-clear')?.addEventListener('click', () => {
    selectedIds.clear();
    render();
  });
  qs('p-bulk-house')?.addEventListener('click', openBulkHouseModal);
  qs('p-bulk-grade')?.addEventListener('click', openBulkGradeModal);
  qs('p-bulk-delete')?.addEventListener('click', bulkDelete);

  // 编辑 Modal
  qs('btn-save-edit-participant')?.addEventListener('click', (e) => saveEditParticipant(e.currentTarget));
  qs('btn-cancel-edit-participant')?.addEventListener('click', closeEditModal);

  // CSV 导入
  qs('btn-open-import')?.addEventListener('click', openImportModal);
  qs('btn-cancel-import')?.addEventListener('click', closeImportModal);
  qs('btn-preview-import')?.addEventListener('click', previewImport);
  qs('btn-import-csv')?.addEventListener('click', (e) => doImport(e.currentTarget));

  // 批量修改 Modal
  qs('btn-bulk-edit-cancel')?.addEventListener('click', () => closeModal('bulk-edit-modal'));
  qs('btn-bulk-edit-ok')?.addEventListener('click', applyBulkEdit);
}

/* ============================================================
   加载 & 渲染
   ============================================================ */

export async function refreshParticipants() {
  const el = qs('participants-list');
  if (el && !state.participants.length) {
    el.innerHTML = skeletonTable(4);
  }

  const [pRes, cRes] = await Promise.all([
    supabase.rpc('admin_get_participants'),
    supabase.rpc('admin_get_colleges'),
  ]);

  if (pRes.error || pRes.data?.error) {
    if (el) el.innerHTML = emptyState({
      title: '加载失败',
      desc: pRes.error?.message || pRes.data?.error,
    });
    return;
  }

  state.participants = Array.isArray(pRes.data) ? pRes.data : [];
  if (Array.isArray(cRes.data)) state.colleges = cRes.data;

  fillFilterOptions();
  fillAddCollegeSelect();
  render();
}

function fillFilterOptions() {
  const sel = qs('p-filter-college');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">全部学院</option>' +
    state.colleges.map(c =>
      `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`
    ).join('');
  sel.value = current;
}

function fillAddCollegeSelect() {
  const sel = qs('p-college');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">（不指定）</option>' +
    state.colleges.map(c =>
      `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`
    ).join('');
  sel.value = current;
}

function getFiltered() {
  const kw = filter.keyword;
  return state.participants.filter(p => {
    if (filter.collegeId && p.college_id !== filter.collegeId) return false;
    if (filter.status && p.status !== filter.status) return false;
    if (filter.grade && (p.grade || '') !== filter.grade) return false;
    if (kw) {
      const hay = [p.name, p.email, p.code, p.grade].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(kw)) return false;
    }
    return true;
  });
}

/* ============================================================
   排序
   - created_asc / created_desc ：按 created_at
   - name_asc / name_desc      ：按完整 name
   - surname_asc / surname_desc：取第一个空格后的字符串作为「姓」
                                 无空格的（比如纯中文名）视为无姓，始终排最前
   ============================================================ */
function cmpCreated(dir) {
  return (a, b) => {
    const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
    const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
    return dir === 'asc' ? ta - tb : tb - ta;
  };
}

function cmpName(dir) {
  return (a, b) => {
    const c = String(a.name || '').localeCompare(String(b.name || ''), 'en', { sensitivity: 'base' });
    return dir === 'asc' ? c : -c;
  };
}

// 姓氏排序 key：把「名 姓」格式的姓名重组成「姓 名」再比较。
// 例：John Smith  →  "Smith John"
//     Alice Brown →  "Brown Alice"
//     张三（无空格）→  null，排最前
function getSurnameKey(name) {
  if (!name) return null;
  const s = String(name).trim();
  const idx = s.indexOf(' ');
  if (idx < 0) return null;

  const firstName = s.slice(0, idx).trim();
  const surname = s.slice(idx + 1).trim();
  if (!surname) return null;

  return firstName ? `${surname} ${firstName}` : surname;
}

function cmpSurname(dir) {
  return (a, b) => {
    const ka = getSurnameKey(a.name);
    const kb = getSurnameKey(b.name);

    // 无姓者（纯中文名 / 无空格）始终排最前
    if (!ka && !kb) return 0;
    if (!ka) return -1;
    if (!kb) return 1;

    const c = ka.localeCompare(kb, 'en', { sensitivity: 'base' });
    return dir === 'asc' ? c : -c;
  };
}

function getSorted(list) {
  const arr = list.slice();
  switch (filter.sort) {
    case 'created_asc':  return arr.sort(cmpCreated('asc'));
    case 'created_desc': return arr.sort(cmpCreated('desc'));
    case 'name_asc':     return arr.sort(cmpName('asc'));
    case 'name_desc':    return arr.sort(cmpName('desc'));
    case 'surname_asc':  return arr.sort(cmpSurname('asc'));
    case 'surname_desc': return arr.sort(cmpSurname('desc'));
    default:             return arr;
  }
}

/* ============================================================
   渲染
   ============================================================ */

function render() {
  const el = qs('participants-list');
  if (!el) return;

  const list = getSorted(getFiltered());

  const countHint = qs('p-count-hint');
  if (countHint) {
    const total = state.participants.length;
    countHint.textContent = list.length === total
      ? `共 ${total} 人`
      : `筛选出 ${list.length} / ${total} 人`;
  }

  const visibleIds = new Set(list.map(p => p.id));
  let selectionChanged = false;
  selectedIds.forEach(id => {
    if (!visibleIds.has(id)) { selectedIds.delete(id); selectionChanged = true; }
  });
  if (selectionChanged) updateBulkBar();

  if (!list.length) {
    el.innerHTML = state.participants.length
      ? emptyState({ icon: 'search', title: '没有匹配的参与者', desc: '试试调整筛选条件。' })
      : emptyState({
          icon: 'user',
          title: '还没有参与者',
          desc: '导入 CSV 或在上方手动添加。',
        });
    lastRenderedSignature = '';
    return;
  }

  const sig = list.map(p =>
    `${p.id}:${p.name}:${p.grade || ''}:${p.college_name || ''}:${p.status}:${p.email || ''}:${selectedIds.has(p.id) ? 1 : 0}`
  ).join('|');
  if (sig === lastRenderedSignature) return;
  lastRenderedSignature = sig;

  el.innerHTML = `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th style="width:36px">
              <input type="checkbox" id="p-select-all">
            </th>
            <th>姓名</th>
            <th>学院</th>
            <th>年级</th>
            <th>状态</th>
            <th>邮箱</th>
            <th class="text-right">操作</th>
          </tr>
        </thead>
        <tbody>
          ${list.map(rowHtml).join('')}
        </tbody>
      </table>
    </div>
  `;

  bindTableEvents();
}

function rowHtml(p) {
  const checked = selectedIds.has(p.id) ? 'checked' : '';
  const statusMap = {
    alive: ['badge-success', '存活'],
    eliminated: ['badge-danger', '已淘汰'],
    winner: ['badge-gold', '赢家'],
  };
  const [cls, label] = statusMap[p.status] || ['badge-neutral', p.status || '—'];

  return `
    <tr data-id="${escapeHtml(p.id)}">
      <td data-label="">
        <input type="checkbox" class="p-row-check" data-id="${escapeHtml(p.id)}" ${checked}>
      </td>
      <td data-label="姓名">
        <div class="cell-main">${escapeHtml(p.name)}</div>
        ${p.code ? `<div class="cell-sub">代码 ${escapeHtml(p.code)}</div>` : ''}
      </td>
      <td data-label="学院">${p.college_name
        ? `<span class="row"><span class="color-dot" style="background:${escapeHtml(p.color || '#555')}"></span>${escapeHtml(p.college_name)}</span>`
        : '<span class="muted">未分</span>'}</td>
      <td data-label="年级">${p.grade ? escapeHtml(p.grade) : '<span class="muted">—</span>'}</td>
      <td data-label="状态"><span class="badge ${cls}">${escapeHtml(label)}</span></td>
      <td data-label="邮箱">${p.email
        ? `<span class="hint">${escapeHtml(p.email)}</span>`
        : '<span class="muted">—</span>'}</td>
      <td class="cell-actions" data-label="操作">
        <button class="btn-mini" data-edit="${escapeHtml(p.id)}">编辑</button>
        <button class="btn-mini btn-warn" data-delete="${escapeHtml(p.id)}">删除</button>
      </td>
    </tr>
  `;
}

function bindTableEvents() {
  const el = qs('participants-list');
  if (!el) return;

  const selectAll = el.querySelector('#p-select-all');
  const rowChecks = el.querySelectorAll('.p-row-check');

  if (selectAll) {
    selectAll.checked = rowChecks.length > 0 &&
      Array.from(rowChecks).every(cb => cb.checked);
    selectAll.indeterminate = !selectAll.checked &&
      Array.from(rowChecks).some(cb => cb.checked);

    selectAll.addEventListener('change', () => {
      const list = getSorted(getFiltered());
      if (selectAll.checked) list.forEach(p => selectedIds.add(p.id));
      else list.forEach(p => selectedIds.delete(p.id));
      render();
      updateBulkBar();
    });
  }

  rowChecks.forEach(cb => {
    cb.addEventListener('change', () => {
      const id = cb.dataset.id;
      if (cb.checked) selectedIds.add(id); else selectedIds.delete(id);
      updateBulkBar();
      if (selectAll) {
        const all = Array.from(rowChecks);
        selectAll.checked = all.every(c => c.checked);
        selectAll.indeterminate = !selectAll.checked && all.some(c => c.checked);
      }
    });
  });

  el.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => openEditModal(btn.dataset.edit));
  });

  el.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', () => deleteParticipant(btn.dataset.delete));
  });
}

function updateBulkBar() {
  const bar = qs('p-bulk-bar');
  const countEl = qs('p-bulk-count');
  if (!bar) return;
  if (selectedIds.size === 0) {
    bar.style.display = 'none';
  } else {
    bar.style.display = 'flex';
    if (countEl) countEl.textContent = String(selectedIds.size);
  }
}

/* ============================================================
   添加
   ============================================================ */

async function addParticipant(btn) {
  const name = qs('p-name')?.value.trim();
  const grade = qs('p-grade')?.value || null;
  const collegeId = qs('p-college')?.value || null;
  const photo = uploaders.get('p-photo')?.getValue() || null;
  const email = qs('p-email')?.value.trim() || null;

  if (!name) { showToast('请填写姓名', 'error'); return; }
  if (grade && !VALID_GRADES.includes(grade)) {
    showToast('年级不合法', 'error');
    return;
  }

  setLoading(btn, true, '添加中...');
  const { data, error } = await supabase.rpc('admin_add_participant', {
    p_name: name,
    p_grade: grade,
    p_college_id: collegeId,
    p_photo_url: photo,
    p_email: email,
  });
  setLoading(btn, false);

  if (error || data?.error) {
    const errMap = {
      not_admin: '你不是管理员',
      name_required: '姓名不能为空',
      email_exists: '该邮箱已存在',
      invalid_school_email: '邮箱必须是学校邮箱',
      no_event: '没有事件',
    };
    showToast('添加失败：' + (errMap[data?.error] || error?.message || data?.error), 'error');
    return;
  }

  ['p-name', 'p-email'].forEach(id => {
    const e = qs(id); if (e) e.value = '';
  });
  const gradeEl = qs('p-grade'); if (gradeEl) gradeEl.value = '';
  uploaders.get('p-photo')?.reset();

  showToast('已添加', 'success');
  refreshParticipants();
}

/* ============================================================
   编辑
   ============================================================ */

function openEditModal(id) {
  const p = state.participants.find(x => x.id === id);
  if (!p) return;

  editingId = id;

  const collegeSel = qs('edit-p-college');
  if (collegeSel) {
    collegeSel.innerHTML = '<option value="">（不指定）</option>' +
      state.colleges.map(c =>
        `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`
      ).join('');
  }

  qs('edit-p-name').value = p.name || '';
  qs('edit-p-grade').value = p.grade || '';
  if (collegeSel) collegeSel.value = p.college_id || '';
  qs('edit-p-email').value = p.email || '';
  uploaders.get('edit-p-photo')?.setValue(p.photo_url || '');

  openModal('edit-participant-modal');
}

function closeEditModal() {
  editingId = null;
  closeModal('edit-participant-modal');
}

async function saveEditParticipant(btn) {
  if (!editingId) return;

  const name = qs('edit-p-name').value.trim();
  const grade = qs('edit-p-grade').value || null;
  const collegeId = qs('edit-p-college').value || null;
  const photo = uploaders.get('edit-p-photo')?.getValue() || null;
  const email = qs('edit-p-email').value.trim() || null;

  if (!name) { showToast('姓名不能为空', 'error'); return; }
  if (grade && !VALID_GRADES.includes(grade)) {
    showToast('年级不合法', 'error');
    return;
  }

  setLoading(btn, true, '保存中...');
  const { data, error } = await supabase.rpc('admin_update_participant', {
    p_id: editingId,
    p_name: name,
    p_grade: grade,
    p_college_id: collegeId,
    p_photo_url: photo,
    p_email: email,
  });
  setLoading(btn, false);

  if (error || data?.error) {
    const errMap = {
      not_admin: '你不是管理员',
      id_required: '缺少参与者 ID',
      name_required: '姓名不能为空',
      participant_not_found: '参与者不存在',
      email_exists: '该邮箱已被其他参与者使用',
      invalid_school_email: '邮箱必须是学校邮箱',
    };
    showToast(errMap[data?.error] || error?.message || data?.error || '保存失败', 'error');
    return;
  }

  closeEditModal();
  showToast('已保存', 'success');
  refreshParticipants();
}

/* ============================================================
   删除
   ============================================================ */

async function deleteParticipant(id) {
  const p = state.participants.find(x => x.id === id);
  const name = p?.name || '该参与者';

  const ok = await confirmDialog({
    title: '删除参与者',
    message: `将删除「<strong>${escapeHtml(name)}</strong>」，并同步清理其击杀记录、举报和相关引用。此操作不可撤销。`,
    confirmText: '确认删除',
    danger: true,
  });
  if (!ok) return;

  const { data, error } = await supabase.rpc('admin_delete_participant', { p_id: id });
  if (error || data?.error) {
    showToast('删除失败：' + (error?.message || data?.error), 'error');
    return;
  }

  selectedIds.delete(id);
  showToast('已删除', 'success');
  refreshParticipants();
}

/* ============================================================
   批量操作
   ============================================================ */

function openBulkHouseModal() {
  const sel = qs('bulk-edit-house');
  if (sel) {
    sel.innerHTML = '<option value="">（不指定）</option>' +
      state.colleges.map(c =>
        `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`
      ).join('');
  }
  qs('bulk-edit-title').textContent = '批量分 House';
  qs('bulk-edit-desc').textContent = `将为已选的 ${selectedIds.size} 人设置 House。`;
  qs('bulk-edit-field-house').style.display = '';
  qs('bulk-edit-field-grade').style.display = 'none';
  qs('bulk-edit-modal').dataset.mode = 'house';
  openModal('bulk-edit-modal');
}

function openBulkGradeModal() {
  qs('bulk-edit-title').textContent = '批量改年级';
  qs('bulk-edit-desc').textContent = `将为已选的 ${selectedIds.size} 人设置年级。`;
  qs('bulk-edit-field-house').style.display = 'none';
  qs('bulk-edit-field-grade').style.display = '';
  qs('bulk-edit-modal').dataset.mode = 'grade';
  const g = qs('bulk-edit-grade'); if (g) g.value = '';
  openModal('bulk-edit-modal');
}

async function applyBulkEdit() {
  const mode = qs('bulk-edit-modal').dataset.mode;
  const ids = Array.from(selectedIds);
  if (!ids.length) { closeModal('bulk-edit-modal'); return; }

  const byId = new Map(state.participants.map(p => [p.id, p]));

  let failed = 0;

  if (mode === 'house') {
    const collegeId = qs('bulk-edit-house').value || null;
    for (const id of ids) {
      const p = byId.get(id);
      if (!p) continue;
      const { error } = await supabase.rpc('admin_update_participant', {
        p_id: id,
        p_name: p.name,
        p_grade: p.grade || null,
        p_college_id: collegeId,
        p_photo_url: p.photo_url || null,
        p_email: p.email || null,
      });
      if (error) failed++;
    }
  } else if (mode === 'grade') {
    const grade = qs('bulk-edit-grade').value || null;
    for (const id of ids) {
      const p = byId.get(id);
      if (!p) continue;
      const { error } = await supabase.rpc('admin_update_participant', {
        p_id: id,
        p_name: p.name,
        p_grade: grade,
        p_college_id: p.college_id || null,
        p_photo_url: p.photo_url || null,
        p_email: p.email || null,
      });
      if (error) failed++;
    }
  }

  closeModal('bulk-edit-modal');
  selectedIds.clear();
  updateBulkBar();

  if (failed) showToast(`部分失败：${failed} / ${ids.length} 条未更新`, 'warning');
  else showToast('已更新', 'success');

  refreshParticipants();
}

async function bulkDelete() {
  const ids = Array.from(selectedIds);
  if (!ids.length) return;

  const ok = await confirmDialog({
    title: '批量删除参与者',
    message: `将删除已选的 <strong>${ids.length}</strong> 名参与者，并同步清理其击杀记录、举报和相关引用。此操作不可撤销。`,
    confirmText: `删除 ${ids.length} 人`,
    danger: true,
  });
  if (!ok) return;

  let failed = 0;
  for (const id of ids) {
    const { error } = await supabase.rpc('admin_delete_participant', { p_id: id });
    if (error) failed++;
  }

  selectedIds.clear();
  updateBulkBar();

  if (failed) showToast(`部分失败：${failed} / ${ids.length} 条未删除`, 'warning');
  else showToast('已删除', 'success');

  refreshParticipants();
}

/* ============================================================
   CSV 导入
   ============================================================ */

function openImportModal() {
  parsedRows = [];
  const ta = qs('csv-input'); if (ta) ta.value = '';
  const preview = qs('import-preview');
  if (preview) { preview.style.display = 'none'; preview.innerHTML = ''; }
  openModal('import-modal');
}

function closeImportModal() {
  closeModal('import-modal');
}

function parseCSVLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out.map(s => s.trim());
}

function parseCSV(raw) {
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return [];

  if (lines[0].toLowerCase().startsWith('name')) lines.shift();

  const rows = [];
  for (const line of lines) {
    const parts = parseCSVLine(line);
    const [name, grade, house, photoUrl, email] = parts;

    if (!name) continue;

    let gradeVal = grade || null;
    if (gradeVal && !VALID_GRADES.includes(gradeVal)) gradeVal = null;

    rows.push({
      name,
      grade: gradeVal,
      college_name: house || null,
      photo_url: photoUrl || null,
      email: email || null,
      _raw: { grade: grade || '', house: house || '' },
    });
  }
  return rows;
}

function previewImport() {
  const raw = qs('csv-input')?.value || '';
  if (!raw.trim()) { showToast('请输入 CSV', 'error'); return; }

  parsedRows = parseCSV(raw);
  const el = qs('import-preview');
  if (!el) return;

  if (!parsedRows.length) {
    el.style.display = 'block';
    el.innerHTML = `<p class="hint">没有可导入的有效行。</p>`;
    return;
  }

  const emailCount = new Map();
  parsedRows.forEach(r => {
    if (r.email) emailCount.set(r.email, (emailCount.get(r.email) || 0) + 1);
  });

  const rowsHtml = parsedRows.map((r, i) => {
    const dupEmail = r.email && emailCount.get(r.email) > 1;
    const gradeInvalid = r._raw.grade && !r.grade;
    const cls = (dupEmail || gradeInvalid) ? 'style="background:rgba(239,68,68,0.08)"' : '';
    return `
      <tr ${cls}>
        <td>${i + 1}</td>
        <td>${escapeHtml(r.name)}</td>
        <td>${r.grade ? escapeHtml(r.grade) : '<span class="muted">—</span>'}
          ${gradeInvalid ? `<div class="cell-sub" style="color:#fca5a5">原值「${escapeHtml(r._raw.grade)}」非法</div>` : ''}
        </td>
        <td>${r.college_name ? escapeHtml(r.college_name) : '<span class="muted">—</span>'}</td>
        <td>${r.email ? escapeHtml(r.email) : '<span class="muted">—</span>'}
          ${dupEmail ? `<div class="cell-sub" style="color:#fca5a5">重复邮箱</div>` : ''}
        </td>
      </tr>`;
  }).join('');

  el.style.display = 'block';
  el.innerHTML = `
    <p class="hint" style="margin-bottom:8px">
      共解析出 <strong>${parsedRows.length}</strong> 行。请确认无误后点击「导入」。
    </p>
    <div class="table-wrap" style="max-height:280px;overflow:auto">
      <table class="data-table">
        <thead>
          <tr><th>#</th><th>姓名</th><th>年级</th><th>学院</th><th>邮箱</th></tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
  `;
}

async function doImport(btn) {
  const raw = qs('csv-input')?.value || '';
  if (!raw.trim()) { showToast('请输入 CSV', 'error'); return; }

  if (!parsedRows.length) {
    parsedRows = parseCSV(raw);
  }
  if (!parsedRows.length) { showToast('没有有效行', 'error'); return; }

  setLoading(btn, true, '导入中...');
  const { data, error } = await supabase.rpc('admin_import_participants', {
    p_rows: parsedRows.map(r => ({
      name: r.name,
      grade: r.grade,
      college_name: r.college_name,
      photo_url: r.photo_url,
      email: r.email,
    })),
  });
  setLoading(btn, false);

  if (error || data?.error) {
    showToast('导入失败：' + (error?.message || data?.error), 'error');
    return;
  }

  const skipped = data?.skipped ? `（跳过 ${data.skipped} 行）` : '';
  showToast(`已导入 ${data?.count ?? 0} 人${skipped}`, 'success');
  parsedRows = [];
  closeImportModal();
  refreshParticipants();
}