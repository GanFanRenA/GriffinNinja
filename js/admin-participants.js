// js/admin-participants.js
// 参与者：列表 / 筛选 / 排序 / 批量 / CSV 导入预览 / 增删改 / 照片上传
import { supabase } from './supabase.js';
import { state, refreshTab } from './admin.js';
import {
    qs, qsa, showToast, setLoading, confirmDialog, openModal, closeModal,
    escapeHtml, debounce, skeletonTable, emptyState,
} from './utils.js';
import { t } from './i18n.js';

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
    if (!file) throw new Error(t('participants.photoNoFile'));
    if (!file.type.startsWith('image/')) throw new Error(t('participants.photoNotImage'));
    const MAX = 2 * 1024 * 1024;
    if (file.size > MAX) throw new Error(t('participants.photoTooLarge'));

    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const uuid = (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2));
    const path = `${uuid}.${ext}`;

    const { error } = await supabase.storage.from('photos').upload(path, file, {
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
    const preview = root.querySelector('.photo-preview img');
    const chooseBtn = root.querySelector('[data-photo-choose]');
    const removeBtn = root.querySelector('[data-photo-remove]');
    const fileInput = root.querySelector('[data-photo-file]');
    const valueInput = root.querySelector('[data-photo-value]');
    const hint = root.querySelector('.photo-hint');
    const defaultHintKey = hint?.getAttribute('data-i18n') || 'participants.photoHint';

    function setPreview(url) {
        preview.onerror = () => {
            preview.onerror = null;
            preview.src = 'assets/placeholder.png';
        };
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
        if (hint) hint.textContent = on ? t('participants.photoUploading') : t(defaultHintKey);
    }

    chooseBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
        const f = fileInput.files && fileInput.files[0];
        if (!f) return;
        setUploading(true);
        try {
            const url = await uploadImage(f);
            setValue(url);
            showToast(t('participants.photoUploaded'), 'success');
        } catch (err) {
            showToast(t('participants.photoUploadFailed', { msg: err.message || err }), 'error');
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
        refreshHint: () => {
            if (hint && !chooseBtn.disabled) hint.textContent = t(defaultHintKey);
        },
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

function refreshUploaderHints() {
    uploaders.forEach(u => u.refreshHint && u.refreshHint());
}

/* ============================================================
   初始化
   ============================================================ */
export function initParticipants() {
    initAllUploaders();

    qs('btn-add-participant')?.addEventListener('click', (e) => addParticipant(e.currentTarget));

    const searchEl = qs('p-search');
    if (searchEl) searchEl.addEventListener('input', debounce(() => {
        filter.keyword = searchEl.value.trim().toLowerCase();
        render();
    }, 200));

    qs('p-filter-college')?.addEventListener('change', (e) => { filter.collegeId = e.target.value; render(); });
    qs('p-filter-status')?.addEventListener('change', (e) => { filter.status = e.target.value; render(); });
    qs('p-filter-grade')?.addEventListener('change', (e) => { filter.grade = e.target.value; render(); });

    const sortEl = qs('p-sort');
    if (sortEl) {
        sortEl.value = filter.sort;
        sortEl.addEventListener('change', (e) => {
            filter.sort = e.target.value || 'created_desc';
            render();
        });
    }

    qs('p-bulk-clear')?.addEventListener('click', () => {
        selectedIds.clear();
        render();
    });
    qs('p-bulk-house')?.addEventListener('click', openBulkHouseModal);
    qs('p-bulk-grade')?.addEventListener('click', openBulkGradeModal);
    qs('p-bulk-delete')?.addEventListener('click', bulkDelete);

    qs('btn-save-edit-participant')?.addEventListener('click', (e) => saveEditParticipant(e.currentTarget));
    qs('btn-cancel-edit-participant')?.addEventListener('click', closeEditModal);

    qs('btn-open-import')?.addEventListener('click', openImportModal);
    qs('btn-cancel-import')?.addEventListener('click', closeImportModal);
    qs('btn-preview-import')?.addEventListener('click', previewImport);
    qs('btn-import-csv')?.addEventListener('click', (e) => doImport(e.currentTarget));

    qs('btn-bulk-edit-cancel')?.addEventListener('click', () => closeModal('bulk-edit-modal'));
    qs('btn-bulk-edit-ok')?.addEventListener('click', applyBulkEdit);
}

// 供 admin.js 在语言切换时调用
export function refreshParticipantsI18n() {
    refreshUploaderHints();
    fillFilterOptions();
    fillAddCollegeSelect();
    lastRenderedSignature = '';
    render();
    updateBulkBar();
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
            title: t('common.loadFailed'),
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
    sel.innerHTML = `<option value="">${escapeHtml(t('participants.filterAllColleges'))}</option>` +
        state.colleges.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('');
    sel.value = current;
}

function fillAddCollegeSelect() {
    const sel = qs('p-college');
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = `<option value="">${escapeHtml(t('participants.gradeUnset'))}</option>` +
        state.colleges.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('');
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
        case 'created_asc': return arr.sort(cmpCreated('asc'));
        case 'created_desc': return arr.sort(cmpCreated('desc'));
        case 'name_asc': return arr.sort(cmpName('asc'));
        case 'name_desc': return arr.sort(cmpName('desc'));
        case 'surname_asc': return arr.sort(cmpSurname('asc'));
        case 'surname_desc': return arr.sort(cmpSurname('desc'));
        default: return arr;
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
            ? t('participants.countTotal', { n: total })
            : t('participants.countFiltered', { n: list.length, total });
    }

    const visibleIds = new Set(list.map(p => p.id));
    let selectionChanged = false;
    selectedIds.forEach(id => {
        if (!visibleIds.has(id)) {
            selectedIds.delete(id);
            selectionChanged = true;
        }
    });
    if (selectionChanged) updateBulkBar();

    if (!list.length) {
        el.innerHTML = state.participants.length
            ? emptyState({
                icon: 'search',
                title: t('participants.noMatch'),
                desc: t('participants.noMatchDesc'),
            })
            : emptyState({
                icon: 'user',
                title: t('participants.noData'),
                desc: t('participants.noDataDesc'),
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
            <th>${escapeHtml(t('participants.colName'))}</th>
            <th>${escapeHtml(t('participants.colCollege'))}</th>
            <th>${escapeHtml(t('participants.colGrade'))}</th>
            <th>${escapeHtml(t('participants.colStatus'))}</th>
            <th>${escapeHtml(t('participants.colEmail'))}</th>
            <th class="text-right">${escapeHtml(t('participants.colActions'))}</th>
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
    const statusKey = {
        alive: ['badge-success', 'participants.statusAlive'],
        eliminated: ['badge-danger', 'participants.statusEliminated'],
        winner: ['badge-gold', 'participants.statusWinner'],
    };
    const [cls, key] = statusKey[p.status] || ['badge-neutral', null];
    const label = key ? t(key) : (p.status || '—');

    const colName = escapeHtml(t('participants.colName'));
    const colCollege = escapeHtml(t('participants.colCollege'));
    const colGrade = escapeHtml(t('participants.colGrade'));
    const colStatus = escapeHtml(t('participants.colStatus'));
    const colEmail = escapeHtml(t('participants.colEmail'));
    const colActions = escapeHtml(t('participants.colActions'));

    return `
    <tr data-id="${escapeHtml(p.id)}">
      <td data-label="">
        <input type="checkbox" class="p-row-check" data-id="${escapeHtml(p.id)}" ${checked}>
      </td>
      <td data-label="${colName}">
        <div class="cell-main">${escapeHtml(p.name)}</div>
        ${p.code ? `<div class="cell-sub">${escapeHtml(t('participants.colCode', { code: p.code }))}</div>` : ''}
      </td>
      <td data-label="${colCollege}">${p.college_name
            ? `<span class="row"><span class="color-dot" style="background:${escapeHtml(p.color || '#555')}"></span>${escapeHtml(p.college_name)}</span>`
            : `<span class="muted">${escapeHtml(t('participants.colUnassigned'))}</span>`}</td>
      <td data-label="${colGrade}">${p.grade ? escapeHtml(p.grade) : '<span class="muted">—</span>'}</td>
      <td data-label="${colStatus}"><span class="badge ${cls}">${escapeHtml(label)}</span></td>
      <td data-label="${colEmail}">${p.email
            ? `<span class="hint">${escapeHtml(p.email)}</span>`
            : '<span class="muted">—</span>'}</td>
      <td class="cell-actions" data-label="${colActions}">
        <button class="btn-mini" data-edit="${escapeHtml(p.id)}">${escapeHtml(t('common.edit'))}</button>
        <button class="btn-mini btn-warn" data-delete="${escapeHtml(p.id)}">${escapeHtml(t('common.delete'))}</button>
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
        selectAll.checked = rowChecks.length > 0 && Array.from(rowChecks).every(cb => cb.checked);
        selectAll.indeterminate = !selectAll.checked && Array.from(rowChecks).some(cb => cb.checked);

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
            if (cb.checked) selectedIds.add(id);
            else selectedIds.delete(id);
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

    if (!name) { showToast(t('participants.enterName'), 'error'); return; }
    if (grade && !VALID_GRADES.includes(grade)) { showToast(t('participants.invalidGrade'), 'error'); return; }

    setLoading(btn, true, t('common.adding'));

    const { data, error } = await supabase.rpc('admin_add_participant', {
        p_name: name,
        p_grade: grade,
        p_college_id: collegeId,
        p_photo_url: photo,
        p_email: email,
    });

    setLoading(btn, false);

    if (error || data?.error) {
        showToast(t('participants.addFailed', { msg: mapAddErr(data?.error) || error?.message || data?.error }), 'error');
        return;
    }

    ['p-name', 'p-email'].forEach(id => {
        const e = qs(id);
        if (e) e.value = '';
    });
    const gradeEl = qs('p-grade');
    if (gradeEl) gradeEl.value = '';
    uploaders.get('p-photo')?.reset();

    showToast(t('participants.addSuccess'), 'success');
    refreshParticipants();
}

function mapAddErr(code) {
    const m = {
        not_admin: t('participants.errNotAdmin'),
        name_required: t('participants.errNameRequired'),
        email_exists: t('participants.errEmailExists'),
        invalid_school_email: t('participants.errInvalidEmail'),
        no_event: t('participants.errNoEvent'),
    };
    return m[code];
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
        collegeSel.innerHTML = `<option value="">${escapeHtml(t('participants.gradeUnset'))}</option>` +
            state.colleges.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('');
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

    if (!name) { showToast(t('participants.editNameRequired'), 'error'); return; }
    if (grade && !VALID_GRADES.includes(grade)) { showToast(t('participants.invalidGrade'), 'error'); return; }

    setLoading(btn, true, t('common.saving'));

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
        showToast(mapEditErr(data?.error) || error?.message || data?.error || t('participants.editSaveFailed'), 'error');
        return;
    }

    closeEditModal();
    showToast(t('participants.editSaved'), 'success');
    refreshParticipants();
}

function mapEditErr(code) {
    const m = {
        not_admin: t('participants.errNotAdmin'),
        id_required: t('participants.errIdRequired'),
        name_required: t('participants.errNameRequired'),
        participant_not_found: t('participants.errNotFound'),
        email_exists: t('participants.errEmailUsed'),
        invalid_school_email: t('participants.errInvalidEmail'),
    };
    return m[code];
}

/* ============================================================
   删除
   ============================================================ */
async function deleteParticipant(id) {
    const p = state.participants.find(x => x.id === id);
    const name = p?.name || '—';

    const ok = await confirmDialog({
        title: t('participants.deleteTitle'),
        message: t('participants.deleteMessage', { name: escapeHtml(name) }),
        confirmText: t('participants.deleteConfirm'),
        danger: true,
    });
    if (!ok) return;

    const { data, error } = await supabase.rpc('admin_delete_participant', { p_id: id });

    if (error || data?.error) {
        showToast(t('participants.deleteFailed', { msg: error?.message || data?.error }), 'error');
        return;
    }

    selectedIds.delete(id);
    showToast(t('participants.deleteSuccess'), 'success');
    refreshParticipants();
}

/* ============================================================
   批量操作
   ============================================================ */
function openBulkHouseModal() {
    const sel = qs('bulk-edit-house');
    if (sel) {
        sel.innerHTML = `<option value="">${escapeHtml(t('participants.gradeUnset'))}</option>` +
            state.colleges.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('');
    }
    qs('bulk-edit-title').textContent = t('participants.bulkHouseTitle');
    qs('bulk-edit-desc').textContent = t('participants.bulkHouseDesc', { n: selectedIds.size });
    qs('bulk-edit-field-house').style.display = '';
    qs('bulk-edit-field-grade').style.display = 'none';
    qs('bulk-edit-modal').dataset.mode = 'house';
    openModal('bulk-edit-modal');
}

function openBulkGradeModal() {
    qs('bulk-edit-title').textContent = t('participants.bulkGradeTitle');
    qs('bulk-edit-desc').textContent = t('participants.bulkGradeDesc', { n: selectedIds.size });
    qs('bulk-edit-field-house').style.display = 'none';
    qs('bulk-edit-field-grade').style.display = '';
    qs('bulk-edit-modal').dataset.mode = 'grade';
    const g = qs('bulk-edit-grade');
    if (g) g.value = '';
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

    if (failed) {
        showToast(t('participants.bulkPartialFail', { failed, total: ids.length }), 'warning');
    } else {
        showToast(t('participants.bulkUpdated'), 'success');
    }
    refreshParticipants();
}

async function bulkDelete() {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;

    const ok = await confirmDialog({
        title: t('participants.bulkDeleteTitle'),
        message: t('participants.bulkDeleteMessage', { n: ids.length }),
        confirmText: t('participants.bulkDeleteConfirm', { n: ids.length }),
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

    if (failed) {
        showToast(t('participants.bulkPartialDeleteFail', { failed, total: ids.length }), 'warning');
    } else {
        showToast(t('participants.deleteSuccess'), 'success');
    }
    refreshParticipants();
}

/* ============================================================
   CSV 导入
   ============================================================ */
function openImportModal() {
    parsedRows = [];
    const ta = qs('csv-input');
    if (ta) ta.value = '';
    const preview = qs('import-preview');
    if (preview) {
        preview.style.display = 'none';
        preview.innerHTML = '';
    }
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
    if (!raw.trim()) { showToast(t('participants.importEnterCsv'), 'error'); return; }

    parsedRows = parseCSV(raw);
    const el = qs('import-preview');
    if (!el) return;

    if (!parsedRows.length) {
        el.style.display = 'block';
        el.innerHTML = `<p class="hint">${escapeHtml(t('participants.importNoValidRows'))}</p>`;
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
          ${gradeInvalid ? `<div class="cell-sub" style="color:#fca5a5">${escapeHtml(t('participants.importInvalidGrade', { v: r._raw.grade }))}</div>` : ''}
        </td>
        <td>${r.college_name ? escapeHtml(r.college_name) : '<span class="muted">—</span>'}</td>
        <td>${r.email ? escapeHtml(r.email) : '<span class="muted">—</span>'}
          ${dupEmail ? `<div class="cell-sub" style="color:#fca5a5">${escapeHtml(t('participants.importDuplicateEmail'))}</div>` : ''}
        </td>
      </tr>`;
    }).join('');

    el.style.display = 'block';
    el.innerHTML = `
    <p class="hint" style="margin-bottom:8px">
      ${escapeHtml(t('participants.importParsed', { n: parsedRows.length }))}
    </p>
    <div class="table-wrap" style="max-height:280px;overflow:auto">
      <table class="data-table">
        <thead>
          <tr>
            <th>${escapeHtml(t('participants.importRowNum'))}</th>
            <th>${escapeHtml(t('participants.colName'))}</th>
            <th>${escapeHtml(t('participants.colGrade'))}</th>
            <th>${escapeHtml(t('participants.colCollege'))}</th>
            <th>${escapeHtml(t('participants.colEmail'))}</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
  `;
}

async function doImport(btn) {
    const raw = qs('csv-input')?.value || '';
    if (!raw.trim()) { showToast(t('participants.importEnterCsv'), 'error'); return; }
    if (!parsedRows.length) parsedRows = parseCSV(raw);
    if (!parsedRows.length) { showToast(t('participants.importNoRows'), 'error'); return; }

    setLoading(btn, true, t('participants.importing'));

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
        showToast(t('participants.importFailed', { msg: error?.message || data?.error }), 'error');
        return;
    }

    const skipped = data?.skipped ? t('participants.importSkipped', { n: data.skipped }) : '';
    showToast(t('participants.importSuccess', { n: data?.count ?? 0, skipped }), 'success');
    parsedRows = [];
    closeImportModal();
    refreshParticipants();
}