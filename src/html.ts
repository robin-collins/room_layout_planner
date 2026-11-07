export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function toast(msg: string, kind: 'info' | 'error' = 'info') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = `toast show ${kind}`;
  window.clearTimeout((el as any)._t);
  (el as any)._t = window.setTimeout(() => (el.className = 'toast'), kind === 'error' ? 4500 : 2500);
}
