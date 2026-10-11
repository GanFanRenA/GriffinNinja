// js/utils.js
// 通用工具：转义、时间、Toast、Modal、确认对话框、骨架屏、空状态

/* ============================================================
   转义 / 格式化
   ============================================================ */

export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatRelative(ts) {
  if (!ts) return '';
  const diff = Date.now() - new Date(ts).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return '刚刚';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} 天前`;
  return formatTime(ts);
}

export function debounce(fn, wait = 250) {
  let t = null;
  return function debounced(...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
}

/* ============================================================
   Toast
   ============================================================ */

const TOAST_ICONS = {
  success: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
  error: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 17h.01"/></svg>',
  warning: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.7l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3.3l-8-14a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
  info: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4f8cff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
};

function getToastContainer() {
  let el = document.getElementById('toast-container');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast-container';
    el.className = 'toast-container';
    document.body.appendChild(el);
  }
  return el;
}

export function showToast(msg, type = 'info', duration = 3000) {
  if (!msg) return;
  const container = getToastContainer();

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${TOAST_ICONS[type] || TOAST_ICONS.info}</span>
    <span class="toast-body">${escapeHtml(msg)}</span>
  `;

  container.appendChild(toast);

  const remove = () => {
    toast.classList.add('leaving');
    setTimeout(() => toast.remove(), 200);
  };

  const timer = setTimeout(remove, duration);
  toast.addEventListener('click', () => {
    clearTimeout(timer);
    remove();
  });
}

export function showMessage(msg, type = 'info') {
  const map = { error: 'error', success: 'success', warning: 'warning', info: 'info' };
  showToast(msg, map[type] || 'info');
}

export function hideMessage() { /* no-op */ }

/* ============================================================
   按钮 loading
   ============================================================ */

export function setLoading(btn, loading, text = '处理中...') {
  if (!btn) return;

  if (loading) {
    if (!btn.dataset.originalHtml) btn.dataset.originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span style="display:inline-block;width:14px;height:14px;border:2px solid currentColor;border-top-color:transparent;border-radius:50%;animation:spin 0.7s linear infinite;vertical-align:-2px;margin-right:6px"></span>${escapeHtml(text)}`;
    if (!document.getElementById('spin-keyframe')) {
      const style = document.createElement('style');
      style.id = 'spin-keyframe';
      style.textContent = '@keyframes spin{to{transform:rotate(360deg)}}';
      document.head.appendChild(style);
    }
  } else {
    btn.disabled = false;
    if (btn.dataset.originalHtml) {
      btn.innerHTML = btn.dataset.originalHtml;
      delete btn.dataset.originalHtml;
    }
  }
}

/* ============================================================
   Modal
   ============================================================ */

export function openModal(id) {
  const el = typeof id === 'string' ? document.getElementById(id) : id;
  if (!el) return;
  el.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

export function closeModal(id) {
  const el = typeof id === 'string' ? document.getElementById(id) : id;
  if (!el) return;
  el.style.display = 'none';
  const anyOpen = Array.from(document.querySelectorAll('.modal-overlay'))
    .some(m => m.style.display === 'flex');
  if (!anyOpen) document.body.style.overflow = '';
}

export function bindModalBackdrop(id) {
  const el = typeof id === 'string' ? document.getElementById(id) : id;
  if (!el || el.dataset.backdropBound) return;
  el.dataset.backdropBound = '1';
  el.addEventListener('click', (e) => {
    if (e.target === el) closeModal(el);
  });
}

/* ============================================================
   通用确认对话框
   ============================================================ */

export function confirmDialog(opts = {}) {
  const {
    title = '确认操作',
    message = '',
    confirmText = '确认',
    cancelText = '取消',
    danger = true,
    requireInput = null,
  } = opts;

  return new Promise((resolve) => {
    const overlay = document.getElementById('confirm-modal');
    const titleEl = document.getElementById('confirm-title');
    const msgEl = document.getElementById('confirm-message');
    const inputWrap = document.getElementById('confirm-input-wrap');
    const inputLabel = document.getElementById('confirm-input-label');
    const inputEl = document.getElementById('confirm-input');
    const btnOk = document.getElementById('btn-confirm-ok');
    const btnCancel = document.getElementById('btn-confirm-cancel');

    if (!overlay) { resolve(false); return; }

    titleEl.textContent = title;
    msgEl.innerHTML = message;
    btnOk.textContent = confirmText;
    btnCancel.textContent = cancelText;
    btnOk.className = danger ? 'btn btn-danger' : 'btn btn-primary';

    if (requireInput) {
      inputWrap.style.display = 'block';
      inputLabel.textContent = requireInput.label || '请输入确认';
      inputEl.value = '';
      inputEl.placeholder = requireInput.placeholder || '';
    } else {
      inputWrap.style.display = 'none';
      inputEl.value = '';
    }

    openModal(overlay);
    if (requireInput) setTimeout(() => inputEl.focus(), 80);

    const cleanup = () => {
      btnOk.removeEventListener('click', onOk);
      btnCancel.removeEventListener('click', onCancel);
      overlay.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKey);
      inputEl.removeEventListener('keydown', onKey);
    };

    const finish = (result) => {
      cleanup();
      closeModal(overlay);
      resolve(result);
    };

    const onOk = () => {
      if (requireInput && requireInput.value !== undefined) {
        if (inputEl.value.trim() !== requireInput.value) {
          inputEl.focus();
          inputEl.style.borderColor = 'var(--danger)';
          setTimeout(() => { inputEl.style.borderColor = ''; }, 1200);
          return;
        }
      }
      finish(true);
    };

    const onCancel = () => finish(false);

    const onBackdrop = (e) => { if (e.target === overlay) finish(false); };

    const onKey = (e) => {
      if (e.key === 'Escape') finish(false);
      if (e.key === 'Enter' && (!requireInput || document.activeElement === inputEl)) {
        e.preventDefault();
        onOk();
      }
    };

    btnOk.addEventListener('click', onOk);
    btnCancel.addEventListener('click', onCancel);
    overlay.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKey);
    inputEl.addEventListener('keydown', onKey);
  });
}

/* ============================================================
   骨架屏
   ============================================================ */

export function skeletonRows(count = 3, cols = 3) {
  const widths = ['w-40', 'w-20', 'w-10'];
  let html = '';
  for (let i = 0; i < count; i++) {
    html += '<div class="skeleton-row">';
    for (let j = 0; j < cols; j++) {
      html += `<div class="skeleton ${widths[j] || 'w-20'}"></div>`;
    }
    html += '</div>';
  }
  return html;
}

export function skeletonTable(count = 4) {
  let html = '';
  for (let i = 0; i < count; i++) {
    html += `
      <div class="skeleton-row">
        <div class="skeleton w-40"></div>
        <div class="skeleton w-20"></div>
        <div class="skeleton w-20"></div>
        <div class="skeleton w-10"></div>
      </div>`;
  }
  return html;
}

/* ============================================================
   空状态
   ============================================================ */

const EMPTY_ICONS = {
  default: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 10h8M8 14h5"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>',
  chain: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 1 0-7.07-7.07l-1.41 1.41"/><path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 1 0 7.07 7.07l1.41-1.41"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
};

export function emptyState(opts = {}) {
  const {
    icon = 'default',
    title = '暂无数据',
    desc = '',
    actionText = '',
    actionId = '',
  } = opts;

  const svg = EMPTY_ICONS[icon] || EMPTY_ICONS.default;

  return `
    <div class="empty">
      ${svg}
      <div class="empty-title">${escapeHtml(title)}</div>
      ${desc ? `<div class="empty-desc">${escapeHtml(desc)}</div>` : ''}
      ${actionText ? `<button class="btn btn-secondary btn-sm" ${actionId ? `id="${escapeHtml(actionId)}"` : ''}>${escapeHtml(actionText)}</button>` : ''}
    </div>
  `;
}

/* ============================================================
   杂项
   ============================================================ */

export function qs(id) { return document.getElementById(id); }
export function qsa(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

export function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve, reject) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      resolve();
    } catch (e) {
      reject(e);
    } finally {
      ta.remove();
    }
  });
}