import { defineContentScript } from 'wxt/utils/define-content-script';

/* ── Injected stylesheet ──────────────────────────────── */
// Single <style> tag replaces ~50 lines of Object.assign inline styles
const STYLES = `
  /* Picker */
  .ps-picker-highlight {
    outline: 3px solid #6366f1 !important;
    outline-offset: 2px !important;
    background: rgba(99, 102, 241, 0.08) !important;
    cursor: crosshair !important;
  }
  .ps-toast {
    position: fixed; bottom: 24px; left: 50%; z-index: 2147483647;
    transform: translateX(-50%);
    background: #1a1a2e; color: #fff;
    padding: 12px 20px; border-radius: 10px;
    font: 14px/1.4 system-ui, sans-serif;
    box-shadow: 0 4px 16px rgba(0,0,0,0.3);
    animation: ps-fade-in 0.3s;
  }
  @keyframes ps-fade-in {
    from { opacity: 0; transform: translateX(-50%) translateY(8px); }
    to { opacity: 1; transform: translateX(-50%) translateY(0); }
  }
  /* Watched badge */
  .ps-badge {
    position: fixed; top: 8px; right: 8px; z-index: 2147483647;
    padding: 6px 14px; background: #16a34a; color: #fff;
    font: 500 13px/1.4 system-ui, sans-serif;
    border-radius: 8px; cursor: pointer;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    display: none; user-select: none;
    transition: opacity 0.3s;
  }
  .ps-badge::before { content: "● "; font-size: 10px; }
  .ps-badge.show { display: inline-flex; align-items: center; gap: 4px; }
  .ps-badge:hover { background: #15803d; }
  /* Change tooltip */
  #ps-diff-tooltip {
    position: absolute; z-index: 2147483646;
    background: #1a1a2e; color: #fff;
    padding: 6px 12px; border-radius: 6px;
    font: 12px/1.4 system-ui, sans-serif;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    pointer-events: none;
    max-width: 360px;
  }
  /* Change banner */
  #ps-diff-banner {
    position: fixed; top: 0; left: 0; right: 0; z-index: 2147483647;
    background: #fef2f2; color: #991b1b;
    padding: 10px 16px; font: 13px/1.4 system-ui, sans-serif;
    border-bottom: 2px solid #fecaca;
    display: flex; align-items: center; gap: 8px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  }
  #ps-diff-banner a { color: #6366f1; font-weight: 500; cursor: pointer; }
  #ps-diff-banner a:hover { text-decoration: underline; }
`;

/* ── Utilities ────────────────────────────────────────── */

function getSelector(el: Element): string {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const parent = el.parentElement;
  if (!parent || parent === document.body || parent === document.documentElement) {
    const tag = el.tagName.toLowerCase();
    const idx = [...parent?.children ?? document.body.children].indexOf(el) + 1;
    return `${tag}:nth-child(${idx})`;
  }
  const classes = [...el.classList].filter((c) => !c.startsWith('ps-'));
  if (classes.length > 0) {
    const classSel = classes.map((c) => `.${CSS.escape(c)}`).join('');
    const matches = document.querySelectorAll(classSel);
    if (matches.length === 1) return classSel;
    if (matches.length < 10) {
      const idx = [...matches].indexOf(el as HTMLElement) + 1;
      return `${classSel}:nth-of-type(${idx})`;
    }
  }
  const tag = el.tagName.toLowerCase();
  const idx = [...parent.children].indexOf(el) + 1;
  const parentSel = getSelector(parent);
  return `${parentSel} > ${tag}:nth-child(${idx})`;
}

function showToast(msg: string) {
  const toast = document.createElement('div');
  toast.className = 'ps-toast';
  toast.textContent = msg;
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

/* ── Inject styles ────────────────────────────────────── */
const styleTag = document.createElement('style');
styleTag.textContent = STYLES;
document.head.appendChild(styleTag);
// One style element for all injected UI; beats 3 separate Object.assign blocks

/* ── Picker mode ──────────────────────────────────────── */

let pickerActive = false;

function enterPickerMode() {
  pickerActive = true;
  document.addEventListener('mousemove', onHover, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKeydown, true);
  showToast('Click an element to watch. Press Escape to cancel.');
}

function exitPickerMode() {
  pickerActive = false;
  document.removeEventListener('mousemove', onHover, true);
  document.removeEventListener('click', onClick, true);
  document.removeEventListener('keydown', onKeydown, true);
  document.querySelectorAll('.ps-picker-highlight').forEach((el) => {
    el.classList.remove('ps-picker-highlight');
  });
}

let lastHighlighted: Element | null = null;

function onHover(e: MouseEvent) {
  if (!pickerActive) return;
  const el = document.elementFromPoint(e.clientX, e.clientY);
  if (el && el !== lastHighlighted) {
    lastHighlighted?.classList.remove('ps-picker-highlight');
    if (el && el !== document.body && el !== document.documentElement) {
      (el as HTMLElement).classList.add('ps-picker-highlight');
      lastHighlighted = el;
    }
  }
}

function onClick(e: MouseEvent) {
  if (!pickerActive) return;
  e.preventDefault();
  e.stopPropagation();
  const el = e.target as Element;
  if (el === document.body || el === document.documentElement) return;
  const selector = getSelector(el);
  const tag = el.tagName.toLowerCase();
  const text = (el.textContent ?? '').trim().slice(0, 60);
  exitPickerMode();
  const url = window.location.href;
  chrome.runtime.sendMessage(
    { type: 'ADD_PAGE', url, title: document.title, selector },
    (res) => {
      if (res?.ok) showToast(`Watching <${tag}> ${text ? `"${text}"` : ''}`);
    },
  );
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    exitPickerMode();
    showToast('Picker cancelled');
  }
}

/* ── Diff overlay ─────────────────────────────────────── */

function applyDiffOverlay(selector: string | undefined, diffSegments: { type: string; text: string }[]) {
  const meaningful = diffSegments.filter((s) => s.type !== 'unchanged');
  if (meaningful.length === 0) return;

  if (selector) {
    const el = document.querySelector(selector) as HTMLElement | null;
    if (el) {
      el.style.outline = '3px solid #e53e3e';
      el.style.outlineOffset = '2px';
      el.style.background = '#fff5f5';
      const tip = document.createElement('div');
      tip.id = 'ps-diff-tooltip';
      const added = meaningful.filter((s) => s.type === 'added').map((s) => s.text.trim().slice(0, 80)).join(', ');
      const removed = meaningful.filter((s) => s.type === 'removed').map((s) => s.text.trim().slice(0, 80)).join(', ');
      const parts: string[] = [];
      if (added) parts.push(`+ ${added}`);
      if (removed) parts.push(`− ${removed}`);
      tip.textContent = `PriceSentinel: ${parts.join(' | ')}`;
      document.body.appendChild(tip);
      const rect = el.getBoundingClientRect();
      tip.style.top = `${rect.bottom + window.scrollY + 8}px`;
      tip.style.left = `${rect.left + window.scrollX}px`;
      return;
    }
  }

  const banner = document.createElement('div');
  banner.id = 'ps-diff-banner';
  banner.setAttribute('role', 'alert');
  banner.innerHTML = `<span style="font-weight:600">PriceSentinel</span> Changes detected on this page. <a id="ps-banner-link">View in extension popup</a>`;
  banner.querySelector('#ps-banner-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.sendMessage({ type: 'OPEN_POPUP' });
  });
  document.body.appendChild(banner);
  document.body.style.marginTop = '42px';
}

/* ── Main ──────────────────────────────────────────────── */

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'ENTER_PICKER') { enterPickerMode(); return true; }
      if (msg.type === 'EXIT_PICKER') { exitPickerMode(); return true; }
    });

    const url = window.location.href;
    chrome.runtime.sendMessage({ type: 'CHECK_PAGE', url }, (res) => {
      if (!res?.watched) return;

      const badge = document.createElement('div');
      badge.id = 'pricesentinel-badge';
      badge.className = 'ps-badge';
      badge.textContent = 'Watched';
      badge.setAttribute('role', 'button');
      badge.setAttribute('aria-label', 'PriceSentinel — This page is being watched. Click to open popup.');
      badge.setAttribute('tabindex', '0');
      document.body.appendChild(badge);
      requestAnimationFrame(() => badge.classList.add('show'));
      badge.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'OPEN_POPUP' }));
      badge.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          chrome.runtime.sendMessage({ type: 'OPEN_POPUP' });
        }
      });

      chrome.runtime.sendMessage({ type: 'GET_CHANGES', url }, (resp) => {
        if (resp?.changes?.length > 0) {
          const latest = resp.changes[0];
          if (latest.diff) applyDiffOverlay(res.page?.selector, latest.diff);
        }
      });
    });
  },
});
