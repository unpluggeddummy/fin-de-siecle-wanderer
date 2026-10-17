// 화면 도우미: 요소 만들기, 서랍, 확대 보기, 토스트

/** h('div.cls#id', {attrs}, ...children) */
export function h(sel, attrs, ...kids) {
  const m = sel.match(/^([a-z0-9-]+)?((?:[.#][^.#]+)*)$/i);
  const el = document.createElement((m && m[1]) || 'div');
  if (m && m[2]) {
    for (const part of m[2].match(/[.#][^.#]+/g) || []) {
      if (part[0] === '.') el.classList.add(part.slice(1));
      else el.id = part.slice(1);
    }
  }
  if (attrs !== undefined && (attrs === null || typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    kids.unshift(attrs);
    attrs = null;
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className += ' ' + v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string' && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, kids);
  return el;
}

export function append(el, kids) {
  for (const k of kids) {
    if (k === null || k === undefined || k === false) continue;
    if (Array.isArray(k)) append(el, k);
    else Element.prototype.append.call(el, k instanceof Node ? k : String(k));
  }
}

/** replaceChildren 대신: null·false·배열을 안전하게 처리 */
export function fill(el, ...kids) { el.replaceChildren(); append(el, kids); return el; }

export const fmt = (n) => (n === null || n === undefined || n === '' || Number.isNaN(+n)) ? '—' : Number(n).toLocaleString('ko-KR');

export function img(src, alt = '', cls) {
  if (!src) return h('div' + (cls ? '.' + cls : ''), { 'aria-hidden': 'true' });
  const i = h('img', { src, alt, loading: 'lazy', decoding: 'async', class: cls || undefined });
  i.addEventListener('error', () => { i.style.visibility = 'hidden'; }, { once: true });
  return i;
}

export function toast(msg, kind) {
  const zone = document.querySelector('.toast-zone');
  const t = h('div.toast' + (kind === 'err' ? '.err' : ''), { role: kind === 'err' ? 'alert' : 'status' }, msg);
  zone.append(t);
  setTimeout(() => t.remove(), kind === 'err' ? 7000 : 3200);
}

let openDrawerEl = null;
/** 오른쪽 서랍. returns {close, body} */
export function drawer({ title, body, foot, wide, onClose }) {
  closeDrawer();
  const back = h('div.drawer-backdrop');
  const closeBtn = h('button.close', { type: 'button', 'aria-label': '닫기' }, '×');
  const panel = h('section.drawer' + (wide ? '.wide' : ''), { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div.drawer-head', h('h2', title), closeBtn),
    h('div.drawer-body', body),
    foot ? h('div.drawer-foot', foot) : null,
  );
  const prevFocus = document.activeElement;
  const close = () => {
    back.remove(); panel.remove(); document.removeEventListener('keydown', onKey);
    openDrawerEl = null; document.body.style.overflow = '';
    onClose && onClose();
    prevFocus && prevFocus.focus && prevFocus.focus();
  };
  const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.lightbox')) close(); };
  back.addEventListener('click', close);
  closeBtn.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.append(back, panel);
  document.body.style.overflow = 'hidden';
  openDrawerEl = { close };
  closeBtn.focus();
  return { close, panel };
}
export function closeDrawer() { if (openDrawerEl) openDrawerEl.close(); }

export function lightbox(src, caption) {
  const box = h('div.lightbox', { role: 'dialog', 'aria-label': caption || '이미지 크게 보기' },
    h('figure', { style: { margin: 0 } }, h('img', { src, alt: caption || '' }), caption ? h('p', caption) : null));
  const close = () => { box.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  box.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.append(box);
}

/** 단계 선택 버튼 묶음 */
export function stepper(values, current, onPick, label = (v) => String(v), opts = {}) {
  const wrap = h('div.stepper', { role: 'group', 'aria-label': opts.aria || '' });
  const render = (cur) => {
    wrap.replaceChildren(...values.map((v) => h('button', {
      type: 'button', 'aria-pressed': String(v === cur), disabled: opts.disabled ? opts.disabled(v) : false,
      onclick: () => { onPick(v); render(v); },
    }, label(v))));
  };
  render(current);
  return wrap;
}

export function chip(text, pressed, onClick, extra) {
  return h('button.chip', { type: 'button', 'aria-pressed': String(!!pressed), onclick: onClick }, extra || null, text);
}

export function field(label, control, cls) {
  return h('label.field' + (cls ? '.' + cls : ''), h('span', label), control);
}

export function confirmAsk(msg) { return window.confirm(msg); }

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function debounce(fn, ms = 250) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function downloadJSON(name, data) {
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function pickFile(accept) {
  return new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept });
    inp.addEventListener('change', () => resolve(inp.files[0] || null), { once: true });
    inp.click();
  });
}

export function readFileText(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(file); });
}
export function readFileDataURL(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
}

/** 큰 이미지를 webp로 줄인다 (스크린샷 업로드용) */
export async function shrinkImage(file, maxW = 1600, quality = 0.82) {
  const url = await readFileDataURL(file);
  const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const scale = Math.min(1, maxW / im.width);
  const c = document.createElement('canvas');
  c.width = Math.round(im.width * scale); c.height = Math.round(im.height * scale);
  c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
  const out = c.toDataURL('image/webp', quality);
  return out.startsWith('data:image/webp') ? out : c.toDataURL('image/jpeg', quality);
}
