// Answer shapes used on both the teacher screen and the phones
window.RQ_SHAPES = [
  '<svg viewBox="0 0 32 32" class="shape"><path d="M16 3 L30 28 H2 Z" fill="#fff"/></svg>',
  '<svg viewBox="0 0 32 32" class="shape"><path d="M16 2 L30 16 L16 30 L2 16 Z" fill="#fff"/></svg>',
  '<svg viewBox="0 0 32 32" class="shape"><circle cx="16" cy="16" r="13.5" fill="#fff"/></svg>',
  '<svg viewBox="0 0 32 32" class="shape"><rect x="4" y="4" width="24" height="24" rx="2" fill="#fff"/></svg>'
];
window.RQ_LETTERS = ['A', 'B', 'C', 'D'];
window.RQ_esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
