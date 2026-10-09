// js/utils.js

export function showMessage(msg, type = 'info') {
  const el = document.getElementById('message');
  if (!el) {
    alert(msg);
    return;
  }
  el.textContent = msg;
  el.className = `message message-${type}`;
  el.style.display = 'block';
}

export function hideMessage() {
  const el = document.getElementById('message');
  if (el) el.style.display = 'none';
}

export function setLoading(btn, loading, text = '处理中...') {
  if (!btn) return;
  if (loading) {
    btn.dataset.originalText = btn.textContent;
    btn.textContent = text;
    btn.disabled = true;
  } else {
    btn.textContent = btn.dataset.originalText || btn.textContent;
    btn.disabled = false;
  }
}

export function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleString('zh-CN', { hour12: false });
}

export function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}