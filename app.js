import {API,getToken,clearToken} from './auth.js';
import {registerShell,armInstallHint} from './install.js';
registerShell();
if(!getToken()){location.replace('./login.html');throw new Error('auth');}
armInstallHint();
const $ = (selector, parent = document) => parent.querySelector(selector);
const node = (tag, className, text) => {
  const e = document.createElement(tag); if (className) e.className = className;
  if (text != null) e.textContent = text; return e;
};
let lessons = [], current = 0, epoch = 0, pdfModule, catalogExpireAt = 0, viewerIsTeacher = false;
const mediaTimers = [];
const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
function armTape() {
  const tape = document.querySelector('.tape');
  const track = tape?.querySelector('.tape-track');
  const seed = track?.querySelector('.tape-group');
  if (!tape || !track || !seed || reduceMotion) return;
  const motif = [...seed.children].map(node => node.cloneNode(true));
  if (!motif.length) return;
  const fit = () => {
    const view = tape.clientWidth;
    if (view < 20) return;
    const current = track.dataset.filled === '1' ? track.firstElementChild?.getBoundingClientRect().width || 0 : 0;
    if (current >= view + 8) return;
    const group = document.createElement('div');
    group.className = 'tape-group';
    track.replaceChildren(group);
    let guard = 0;
    do {
      for (const node of motif) group.append(node.cloneNode(true));
      guard += 1;
    } while (group.getBoundingClientRect().width < view + 48 && guard < 12);
    const copy = group.cloneNode(true);
    copy.setAttribute('aria-hidden', 'true');
    track.append(copy);
    const shift = group.getBoundingClientRect().width;
    track.style.setProperty('--tape-shift', `-${shift}px`);
    track.style.animationDuration = `${Math.max(shift / 40, 12)}s`;
    track.dataset.filled = '1';
  };
  const start = () => {
    fit();
    if (typeof ResizeObserver === 'function') new ResizeObserver(fit).observe(tape);
  };
  if (document.fonts?.ready) document.fonts.ready.then(start).catch(start);
  else start();
}
armTape();
let revealObserver = null;
if (!reduceMotion && typeof IntersectionObserver === 'function') {
  revealObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.target.isConnected) { revealObserver.unobserve(entry.target); continue; }
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('in');
      revealObserver.unobserve(entry.target);
    }
  }, { rootMargin: '40px 0px 80px 0px', threshold: 0.01 });
}
function armReveals(root) {
  if (!revealObserver || !root) return;
  const seen = new Map();
  for (const el of root.querySelectorAll('.lesson-tab, .file-card, .useful-card, .workbook-card')) {
    if (el.classList.contains('in')) continue;
    if (!el.classList.contains('reveal')) {
      const parent = el.parentElement;
      const i = seen.get(parent) || 0;
      seen.set(parent, i + 1);
      el.style.setProperty('--i', String(Math.min(i, 7)));
      el.classList.add('reveal');
    }
    revealObserver.observe(el);
  }
}
function releaseReveals(root) {
  if (!revealObserver || !root) return;
  for (const el of root.querySelectorAll('.reveal')) revealObserver.unobserve(el);
}
function swapSection(el) {
  if (!el || reduceMotion) return;
  el.classList.remove('section-swap');
  void el.offsetWidth;
  el.classList.add('section-swap');
}
function bindSwipe(target, onStep) {
  if (!target) return;
  let swipe = null;
  const panning = () => target.dataset.zoomed === '1' || target.dataset.pinching === '1';
  target.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' || panning()) return;
    swipe = { x: event.clientX, y: event.clientY, id: event.pointerId, lock: false };
  });
  target.addEventListener('pointermove', event => {
    if (panning()) { swipe = null; return; }
    if (!swipe || event.pointerId !== swipe.id || swipe.lock) return;
    const dx = event.clientX - swipe.x, dy = event.clientY - swipe.y;
    if (Math.hypot(dx, dy) < 14) return;
    if (Math.abs(dx) > Math.abs(dy) * 1.2) {
      swipe.lock = true;
      try { target.setPointerCapture?.(event.pointerId); } catch {}
    } else swipe = null;
  });
  target.addEventListener('pointerup', event => {
    if (!swipe || event.pointerId !== swipe.id || target.dataset.pinching === '1') { swipe = null; return; }
    const dx = event.clientX - swipe.x;
    const locked = swipe.lock;
    swipe = null;
    if (locked && Math.abs(dx) >= 48) onStep(dx < 0 ? 1 : -1);
  });
  target.addEventListener('pointercancel', () => { swipe = null; });
}

function bindTap(target, onTap) {
  if (!target) return;
  let start = null;
  target.addEventListener('pointerdown', event => {
    if (event.target.closest('button, a, select, input, label')) return;
    if (start) { start = null; return; }
    start = { x: event.clientX, y: event.clientY, id: event.pointerId };
  });
  target.addEventListener('pointerup', event => {
    if (!start || event.pointerId !== start.id) return;
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    start = null;
    if (Math.hypot(dx, dy) < 12 && target.dataset.pinching !== '1') onTap();
  });
  target.addEventListener('pointercancel', () => { start = null; });
}
function bindPinch(target, getScale, setScale) {
  if (!target) return;
  const points = new Map();
  let base = 0, origin = 1;
  target.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse') return;
    points.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (points.size >= 2) {
      target.dataset.pinching = '1';
      const [a, b] = [...points.values()];
      base = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      origin = getScale();
    }
  });
  target.addEventListener('pointermove', event => {
    if (!points.has(event.pointerId)) return;
    points.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (points.size < 2 || base < 12) return;
    const [a, b] = [...points.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    setScale(Math.min(3, Math.max(1, origin * (dist / base))), { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  });
  const end = event => {
    points.delete(event.pointerId);
    if (points.size < 2) { base = 0; delete target.dataset.pinching; }
  };
  target.addEventListener('pointerup', end);
  target.addEventListener('pointercancel', end);
}
function zoomAnchor(stage, point) {
  const viewW = stage.clientWidth || 1, viewH = stage.clientHeight || 1, rect = stage.getBoundingClientRect();
  const ox = Math.max(0, Math.min(viewW, point ? point.x - rect.left : viewW / 2));
  const oy = Math.max(0, Math.min(viewH, point ? point.y - rect.top : viewH / 2));
  return { cx: (stage.scrollLeft + ox) / Math.max(stage.scrollWidth, 1), cy: (stage.scrollTop + oy) / Math.max(stage.scrollHeight, 1), ox, oy };
}
function placeZoom(stage, anchor) {
  const apply = () => {
    if (!stage?.isConnected) return;
    if (stage.dataset.zoomed !== '1') { stage.scrollTo?.(0, 0); return; }
    const viewW = stage.clientWidth || 1, viewH = stage.clientHeight || 1;
    if (!anchor) {
      stage.scrollLeft = Math.max(0, (stage.scrollWidth - viewW) / 2);
      stage.scrollTop = Math.max(0, (stage.scrollHeight - viewH) / 2);
      return;
    }
    stage.scrollLeft = anchor.cx * stage.scrollWidth - Math.max(0, Math.min(viewW, anchor.ox));
    stage.scrollTop = anchor.cy * stage.scrollHeight - Math.max(0, Math.min(viewH, anchor.oy));
  };
  apply();
  requestAnimationFrame(apply);
}
function markZoomed(stage, zoomed) {
  if (!stage) return;
  stage.dataset.zoomed = zoomed ? '1' : '0';
  stage.style.touchAction = zoomed ? 'pan-x pan-y' : 'pan-y';
  stage.style.webkitOverflowScrolling = 'touch';
  stage.style.placeItems = zoomed ? 'start' : '';
  stage.style.alignItems = zoomed ? 'start' : '';
  stage.style.justifyItems = zoomed ? 'start' : '';
  stage.style.overflowX = zoomed ? 'auto' : '';
  stage.style.overflowY = zoomed ? 'auto' : '';
  if (!zoomed) stage.scrollTo?.(0, 0);
}
function armZoomPan(stage, onWheelZoom) {
  if (!stage || stage.dataset.panArmed === '1') return;
  stage.dataset.panArmed = '1';
  let drag = null;
  const onScrollbar = event => event.target === stage && (event.offsetX > stage.clientWidth || event.offsetY > stage.clientHeight);
  stage.addEventListener('pointerdown', event => {
    if (event.pointerType === 'touch' || event.button !== 0 || stage.dataset.zoomed !== '1' || onScrollbar(event)) return;
    if (event.target.closest('button, a, select, input, label')) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, l: stage.scrollLeft, t: stage.scrollTop };
    stage.classList.add('is-panning');
    event.preventDefault();
    try { stage.setPointerCapture?.(event.pointerId); } catch {}
  });
  stage.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    stage.scrollLeft = drag.l - (event.clientX - drag.x);
    stage.scrollTop = drag.t - (event.clientY - drag.y);
  });
  const endDrag = event => { if (!drag || event.pointerId !== drag.id) return; drag = null; stage.classList.remove('is-panning'); };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
  stage.addEventListener('wheel', event => {
    if (event.ctrlKey) {
      event.preventDefault();
      onWheelZoom?.(event.deltaY, { x: event.clientX, y: event.clientY });
      return;
    }
    if (stage.dataset.zoomed !== '1') return;
    let dx = event.deltaX, dy = event.deltaY;
    if (event.shiftKey && dx === 0) { dx = dy; dy = 0; }
    const maxX = Math.max(0, stage.scrollWidth - stage.clientWidth);
    const maxY = Math.max(0, stage.scrollHeight - stage.clientHeight);
    if (maxX <= 1 && maxY <= 1) return;
    event.preventDefault();
    stage.scrollLeft = Math.max(0, Math.min(maxX, stage.scrollLeft + dx));
    stage.scrollTop = Math.max(0, Math.min(maxY, stage.scrollTop + dy));
  }, { passive: false });
  const blockPinch = event => { if (event.touches.length > 1) event.preventDefault(); };
  stage.addEventListener('touchstart', event => { if (event.touches.length > 1) stage.addEventListener('touchmove', blockPinch, { passive: false }); }, { passive: true });
  const liftPinch = () => stage.removeEventListener('touchmove', blockPinch);
  stage.addEventListener('touchend', liftPinch);
  stage.addEventListener('touchcancel', liftPinch);
}
const ZOOM_STOPS = [1, 1.25, 1.5, 2, 3];
function stepZoom(scale, direction) {
  const current = Number(scale) || 1;
  if (direction > 0) return ZOOM_STOPS.find(value => value > current + 0.02) || ZOOM_STOPS[ZOOM_STOPS.length - 1];
  return [...ZOOM_STOPS].reverse().find(value => value < current - 0.02) || ZOOM_STOPS[0];
}
function syncZoomSelect(select, scale) {
  if (!select) return;
  for (const option of [...select.options]) if (option.dataset.live) option.remove();
  const presets = ['1', '1.25', '1.5', '2'];
  const match = presets.find(value => Math.abs(Number(value) - scale) < 0.03);
  if (match) { select.value = match; return; }
  const option = node('option', '', `${Math.round(scale * 100)}%`);
  option.value = String(Math.round(scale * 1000) / 1000);
  option.dataset.live = '1';
  select.append(option);
  select.value = option.value;
}
function zoomSelect(onChange) {
  const select = node('select');
  select.setAttribute('aria-label', 'Масштаб документа');
  for (const [value, text] of [['1', 'По ширине'], ['1.25', '125%'], ['1.5', '150%'], ['2', '200%']]) {
    const option = node('option', '', text); option.value = value; select.append(option);
  }
  select.addEventListener('change', () => onChange(Number(select.value)));
  return select;
}
function zoomStepButton(label, name, onClick) {
  const button = node('button', 'zoom-step', label);
  button.type = 'button';
  button.setAttribute('aria-label', name);
  button.addEventListener('click', onClick);
  return button;
}
function stageFullButton() {
  const button = node('button', 'stage-full', 'Экран');
  button.type = 'button';
  button.dataset.full = '1';
  button.setAttribute('aria-pressed', 'false');
  button.setAttribute('aria-label', 'На весь экран');
  return button;
}
function toggleStageFull(root) {
  if (!root) return false;
  const on = root.classList.toggle('is-stage-full');
  const button = root.querySelector('[data-full]');
  if (button) {
    button.setAttribute('aria-pressed', String(on));
    button.setAttribute('aria-label', on ? 'Свернуть' : 'На весь экран');
    button.textContent = on ? 'Свернуть' : 'Экран';
  }
  syncScrollLock();
  return on;
}
function viewerDownload(resource) {
  const link = node('a', 'viewer-download', '↓');
  link.setAttribute('aria-label', 'Скачать');
  downloadLink(link, resource);
  return link;
}
function syncScrollLock() {
  document.body.classList.toggle('no-scroll', Boolean(document.querySelector('dialog[open], .is-stage-full')));
}
const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => { let url=String(input); if (url.startsWith('/api/')) { url=API+url; const h=new Headers(init.headers||{}); h.set('X-School-Token',getToken()); try{const r=localStorage.getItem('smm-role');if(r)h.set('X-School-Role',r);}catch{} init={...init,headers:h,credentials:'omit'}; } const response = await originalFetch(url, init); if (response.status === 401 && url !== String(input)) { clearToken(); location.replace('./login.html'); } return response; };
$('#logout-button').addEventListener('click',async()=>{const button=$('#logout-button');button.disabled=true;try{await Promise.race([fetch('/api/logout',{method:'POST'}),new Promise(r=>setTimeout(r,3000))]);}catch(e){console.warn('logout request failed',e);}clearToken();location.replace('./login.html');});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')fetch('/api/session').catch(()=>{});});
setInterval(()=>fetch('/api/session').catch(()=>{}),60000);
const menuToggle = $('#menu-toggle');
if (menuToggle) {
  const header = menuToggle.closest('.header');
  const setMenu = open => { header.classList.toggle('is-menu-open', open); menuToggle.setAttribute('aria-expanded', String(open)); menuToggle.textContent = open ? 'Закрыть' : 'Меню'; };
  menuToggle.addEventListener('click', () => setMenu(!header.classList.contains('is-menu-open')));
  document.addEventListener('click', event => { if (!header.classList.contains('is-menu-open') || header.contains(event.target)) return; setMenu(false); });
  const desktop = matchMedia('(min-width: 801px)');
  desktop.addEventListener?.('change', event => { if (event.matches) setMenu(false); });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (header.classList.contains('is-menu-open')) { setMenu(false); menuToggle.focus(); return; }
    const full = document.querySelector('.is-stage-full');
    if (!full || full.closest('dialog[open]')) return;
    event.preventDefault();
    toggleStageFull(full);
  });
}

const inlineViewers = [], modalViewers = [];
const safeUrl = value => {
  if (!value) return null;
  const url = new URL(value, location.href);
  return (url.origin === location.origin || url.origin === 'https://storage.yandexcloud.net') && ['http:', 'https:'].includes(url.protocol) ? url.href : null;
};
function downloadLink(anchor, resource) {
  const url = safeUrl(resource?.download);
  anchor.removeAttribute('href'); anchor.removeAttribute('download');
  anchor.setAttribute('aria-disabled', String(!url));
  if (url) { anchor.href = url; anchor.download = resource.filename || url.split('/').pop(); anchor.removeAttribute('title'); }
  else anchor.title = 'Файл появится после добавления материалов урока';
}
function setAnnouncement(text) { $('#announcement').textContent = text; }
function closeDialog(dialog) { dialog.close(); }
for (const dialog of document.querySelectorAll('dialog')) {
  for (const button of dialog.querySelectorAll('[data-close]')) button.addEventListener('click', () => closeDialog(dialog));
  dialog.addEventListener('close', () => {
    if (dialog.id === 'preview-dialog') { for (const viewer of modalViewers.splice(0)) viewer.destroy(); $('#preview-content').replaceChildren(); }
    syncScrollLock();
  });
  dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) closeDialog(dialog); } });
}
$('#help-button').addEventListener('click', () => { $('#help-dialog').showModal(); syncScrollLock(); });
const doneLessons = new Set();
function resourceMaterialId(resource, fallback) {
  const raw = String(resource?.key || resource?.filename || resource?.title || fallback || 'material').replace(/[\u0000-\u001f]/g, '').trim();
  return (raw || fallback || 'material').slice(0, 160);
}
function track(kind, lessonId, materialId) {
  const body = { kind };
  const lesson = lessonId == null || lessonId === '' ? (kind === 'material' ? String(lessons[current]?.id || 'shared') : '') : String(lessonId);
  if (lesson) body.lessonId = lesson;
  if (materialId) body.materialId = String(materialId).replace(/[\u0000-\u001f]/g, '').trim().slice(0, 160);
  if (kind === 'material' && !body.materialId) return;
  const stamp = `${kind}|${body.lessonId || ''}|${body.materialId || ''}`;
  try {
    const prev = sessionStorage.getItem('smm-track') || '';
    if (prev.split('\n').includes(stamp)) return;
    sessionStorage.setItem('smm-track', (prev ? prev + '\n' : '') + stamp);
    const lines = sessionStorage.getItem('smm-track').split('\n');
    if (lines.length > 200) sessionStorage.setItem('smm-track', lines.slice(-200).join('\n'));
  } catch {}
  fetch('/api/activity', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: true }).catch(() => {});
}
function paintProgress() {
  const total = lessons.length;
  const done = lessons.filter(lesson => doneLessons.has(String(lesson.id))).length;
  const box = $('#course-progress');
  if (box) {
    box.hidden = total === 0;
    const label = $('#course-progress-label');
    if (label) label.textContent = `Пройдено ${done} из ${total}`;
    const bar = $('#course-progress-bar');
    if (bar) {
      bar.setAttribute('aria-valuemax', String(total));
      bar.setAttribute('aria-valuenow', String(done));
      bar.setAttribute('aria-label', `Пройдено ${done} из ${total}`);
    }
    const fill = $('#course-progress-fill');
    if (fill) fill.style.width = total ? `${Math.round(done / total * 100)}%` : '0%';
  }
  for (const [index, lesson] of lessons.entries()) {
    const tab = $(`#tab-${lesson.id}`);
    if (!tab) continue;
    const on = doneLessons.has(String(lesson.id));
    tab.classList.toggle('is-done', on);
    const label = tab.querySelector('span');
    if (label) label.textContent = `Урок ${index + 1}${on ? ' ✓' : ''}`;
    const base = `${lesson.title}, досье ${lesson.number}`;
    tab.setAttribute('aria-label', on ? `${base}, урок пройден` : base);
  }
  const button = $('#lesson-done');
  const lesson = lessons[current];
  if (button && lesson) {
    const on = doneLessons.has(String(lesson.id));
    button.setAttribute('aria-pressed', String(on));
    button.setAttribute('aria-label', on ? 'Урок пройден. Нажмите, чтобы снять отметку.' : 'Отметить: урок пройден');
  }
}
function armCabinetBadge(link) {
  fetch('/api/admin/resets').then(response => response.ok ? response.json() : null).then(data => {
    const n = Number(data?.pending) || 0;
    if (!n || !link.isConnected) return;
    const badge = node('span', 'cab-badge', n > 99 ? '99+' : String(n));
    badge.setAttribute('aria-label', `${n} заявок на сброс пароля`);
    link.append(badge);
  }).catch(() => {});
}
function buildTabs() {
  $('#lesson-tabs').replaceChildren(...lessons.map((lesson, index) => {
    const button = node('button', 'lesson-tab'); button.id = `tab-${lesson.id}`;
    button.type = 'button'; button.role = 'tab'; button.setAttribute('aria-controls', 'lesson');
    button.setAttribute('aria-label', `${lesson.title}, досье ${lesson.number}`);
    button.append(node('b', '', lesson.number), node('span', '', `Урок ${index + 1}`), node('em', '', '↗'));
    button.addEventListener('click', () => selectLesson(index));
    button.addEventListener('keydown', event => {
      const next = event.key === 'ArrowRight' ? (index + 1) % lessons.length : event.key === 'ArrowLeft' ? (index + lessons.length - 1) % lessons.length : event.key === 'Home' ? 0 : event.key === 'End' ? lessons.length - 1 : null;
      if (next != null) { event.preventDefault(); selectLesson(next); $(`#tab-${lessons[next].id}`).focus(); }
    }); return button;
  }));
  armReveals($('#lesson-tabs'));
  paintProgress();
}
function presentationPlaceholder(number) {
  const wrap = node('div'), cover = node('div', 'presentation-empty'), center = node('div');
  const folder = node('div', 'empty-folder'); folder.setAttribute('aria-hidden', 'true'); folder.dataset.number = number;
  center.append(folder, node('h4', '', 'Здесь появится презентация'), node('p', '', 'Визуальный брифинг к уроку готовится.'));
  cover.append(center, node('span', 'empty-caption', 'СММ ШКОЛА / УЧЕБНЫЙ АРХИВ'), node('span', 'empty-corner', `ДОСЬЕ № ${number}`));
  const footer = node('div', 'empty-footer'), status = node('span'); status.append(node('i', 'tiny-square'), document.createTextNode('Ожидаем материалы'));
  footer.append(status, node('span', '', 'Просмотр станет доступен после загрузки'));
  wrap.append(cover, footer); return wrap;
}
function lecturePlaceholder() {
  const wrap = node('div'), cover = node('div', 'lecture-empty'), copy = node('div'), symbol = node('div', 'paper-symbol');
  symbol.setAttribute('aria-hidden', 'true'); symbol.append(...Array.from({length:4}, () => node('span')));
  copy.append(node('h4', '', 'Теория без лишнего шума'), node('p', '', 'Здесь будет текст лекции. Его можно будет прочитать прямо на сайте или скачать и вернуться к нему в удобное время.'));
  cover.append(copy, symbol); const bar = node('div', 'lecture-bar');
  bar.append(node('span', '', 'ЧТЕНИЕ НА САЙТЕ + ФАЙЛ ДЛЯ СКАЧИВАНИЯ'), node('span', '', 'Готовится'));
  wrap.append(cover, bar); return wrap;
}
function materialsPlaceholder() {
  const wrap = node('div', 'material-empty'), copy = node('div');
  copy.append(node('h4', '', 'Арсенал скоро пополнится'), node('p', '', 'Шаблоны, примеры и полезные файлы к уроку появятся здесь.'));
  wrap.append(node('span', 'outline-icon', '＋'), copy); return wrap;
}
function workbookPlaceholder() {
  const wrap = node('div', 'workbook-card'), copy = node('div');
  copy.append(node('span', 'section-index', 'ПРОВЕРЬТЕ СЕБЯ ПЕРЕД ВЫХОДОМ В ПОЛЕ'), node('h4', '', 'От теории — к уверенности'), node('p', '', 'Методичка соберёт ключевые мысли урока и задания для самостоятельной проверки.'), node('span', 'state-tag', 'Методичка готовится'));
  const img = node('img'); img.src = './assets/target.webp'; img.alt = 'Точно в ЦА'; img.loading = 'lazy'; wrap.append(copy, img); return wrap;
}
function scrollChip(el) {
  const scroller = el?.parentElement;
  if (!el || !scroller || scroller.scrollWidth <= scroller.clientWidth + 2) return;
  const start = el.offsetLeft, end = start + el.offsetWidth;
  const viewStart = scroller.scrollLeft, viewEnd = viewStart + scroller.clientWidth;
  if (start >= viewStart + 8 && end <= viewEnd - 8) return;
  scroller.scrollTo({ left: Math.max(0, start - (scroller.clientWidth - el.offsetWidth) / 2), behavior: reduceMotion ? 'auto' : 'smooth' });
}
let lightbox;
async function selectLesson(index, scroll = false) {
  if (index < 0 || index >= lessons.length) return;
  const motionSwap = epoch > 0;
  current = index; const version = ++epoch, lesson = lessons[index];
  for (const timer of mediaTimers.splice(0)) clearTimeout(timer);
  for (const viewer of inlineViewers.splice(0)) viewer.destroy();
  for (const id of ['presentation-view', 'lecture-view', 'materials-view', 'workbook-view']) releaseReveals(document.getElementById(id));
  for (const [i, button] of [...$('#lesson-tabs').children].entries()) { button.setAttribute('aria-selected', String(i === index)); button.tabIndex = i === index ? 0 : -1; }
  scrollChip($(`#tab-${lesson.id}`));
  lightbox?.close();
  $('#lesson').setAttribute('aria-labelledby', `tab-${lesson.id}`);
  $('#lesson-code').textContent = `УЧЕБНАЯ МИССИЯ / ${lesson.number.padStart(3, '0')}`;
  $('#lesson-title').textContent = lesson.title; $('#lesson-description').textContent = lesson.description || '';
  const files = [lesson.presentation, lesson.lecture, ...(lesson.videos || []), ...(lesson.pages || []), ...(lesson.materials || []), lesson.workbook].filter(Boolean);
  const hasMaterials = files.length > 0;
  $('#lesson-state').textContent = hasMaterials ? `${files.length} ${fileWord(files.length)} в досье` : 'Материалы готовятся';
  $('#lesson-state').classList.toggle('ready', hasMaterials);
  downloadLink($('#presentation-download'), lesson.presentation); downloadLink($('#lecture-download'), lesson.lecture); downloadLink($('#workbook-download'), lesson.workbook);
  $('#presentation-view').replaceChildren(presentationPlaceholder(lesson.number));
  $('#lecture-view').replaceChildren(lecturePlaceholder());
  $('#materials-view').replaceChildren(materialsPlaceholder());
  $('#workbook-view').replaceChildren(workbookPlaceholder());
  const shown = (lesson.materials?.length || 0) + (lesson.videos?.length || 0) + (lesson.pages?.length || 0);
  $('#material-count').textContent = `${shown} ${fileWord(shown).toUpperCase()}`;
  applySectionVisibility(lesson);
  if (lesson.presentation) {
    $('#presentation-view').replaceChildren();
    await mountPreview($('#presentation-view'), lesson.presentation, inlineViewers, () => epoch === version);
  }
  if (epoch !== version) return;
  if (lesson.lecture) {
    $('#lecture-view').replaceChildren();
    if (lesson.lecture.sections?.length) renderLecture($('#lecture-view'), lesson.lecture, `lecture-${lesson.id}`);
    else await mountPreview($('#lecture-view'), lesson.lecture, inlineViewers, () => epoch === version);
  }
  if (epoch !== version) return;
  if (lesson.videos?.length || lesson.pages?.length || lesson.materials?.length) $('#materials-view').replaceChildren(lessonMedia(lesson));
  if (lesson.workbook) {
    $('#workbook-view').replaceChildren(fileList([lesson.workbook], lesson.id));
    if (lesson.workbook.checks?.length) renderChecks($('#workbook-view'), lesson.workbook.checks, lesson.id);
  }
  applySectionVisibility(lesson);
  $('#lesson-position').textContent = `${lesson.number} / ${String(lessons.length).padStart(2, '0')}`;
  $('#previous-lesson').disabled = index === 0; $('#next-lesson').disabled = index === lessons.length - 1;
  armReveals($('#lesson'));
  if (motionSwap) swapSection($('#lesson'));
  try { localStorage.setItem('smm-school-lesson', lesson.id); } catch {}
  history.replaceState(null, '', `#lesson-${lesson.id}`);
  setAnnouncement(`Выбран ${lesson.title}. ${hasMaterials ? 'Материалы доступны.' : 'Материалы готовятся.'}`);
  if (scroll) $('#lesson').scrollIntoView({behavior: 'smooth'});
  paintProgress();
  track('lesson', lesson.id);
  if (lesson.presentation) track('material', lesson.id, 'presentation');
  if (lesson.lecture) track('material', lesson.id, 'lecture');
  if (lesson.workbook) track('material', lesson.id, 'workbook');
}
// Students see only sections that have content; teachers still see empty ones (marked) so they know what to add.
const SECTION_IDS = ['presentation', 'lecture', 'materials', 'workbook', 'shared'];
function sectionHasContent(id, lesson) {
  if (id === 'presentation') return Boolean(lesson.presentation);
  if (id === 'lecture') return Boolean(lesson.lecture);
  if (id === 'workbook') return Boolean(lesson.workbook);
  if (id === 'materials') return Boolean(lesson.videos?.length || lesson.pages?.length || lesson.materials?.length);
  return Boolean($('#shared-files')?.childElementCount || $('#useful-links')?.childElementCount);
}
function applySectionVisibility(lesson) {
  let n = 0;
  for (const id of SECTION_IDS) {
    const section = document.getElementById(id), link = document.querySelector(`.outline nav a[href="#${id}"]`);
    if (!section) continue;
    const has = sectionHasContent(id, lesson), show = has || viewerIsTeacher;
    section.hidden = !show; if (link) link.hidden = !show;
    section.classList.toggle('is-empty', !has);
    let hint = section.querySelector(':scope > .empty-hint');
    if (!has && viewerIsTeacher) { if (!hint) { hint = node('p', 'empty-hint', 'Пусто — ученики этот раздел не видят'); section.querySelector('.section-heading')?.after(hint); } }
    else hint?.remove();
    for (const a of section.querySelectorAll('.section-heading a.download')) a.hidden = !viewerIsTeacher && a.getAttribute('aria-disabled') === 'true';
    if (!show) continue;
    n += 1; const num = String(n).padStart(2, '0');
    if (link?.firstElementChild) link.firstElementChild.textContent = num;
    const index = section.querySelector('.section-heading .section-index');
    if (index && /^\d\d \/ /.test(index.textContent)) index.textContent = index.textContent.replace(/^\d\d/, num);
  }
  $('#lesson').classList.toggle('lesson-empty', !n);
}
function fileWord(n) { return n % 10 === 1 && n % 100 !== 11 ? 'файл' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'файла' : 'файлов'; }
function lessonMedia(lesson) {
  const wrap = node('div');
  if (lesson.videos?.length) {
    wrap.append(node('h4', 'media-kicker', 'Видео'));
    const list = node('div', 'media-list');
    for (const video of lesson.videos) list.append(video.kind === 'embed' ? renderEmbed(video, lesson.id) : renderVideo(video, lesson.id));
    wrap.append(list);
  }
  if (lesson.pages?.length) {
    wrap.append(node('h4', 'media-kicker', 'Страницы'));
    const list = node('div', 'media-list');
    for (const page of lesson.pages) list.append(renderHtmlPage(page, lesson.id));
    wrap.append(list);
  }
  if (lesson.materials?.length) wrap.append(fileList(lesson.materials, lesson.id));
  return wrap;
}
const EMBED_HOSTS = new Set(['www.youtube-nocookie.com', 'vk.com', 'rutube.ru', 'player.vimeo.com', 'www.loom.com', 'drive.google.com', 'kinescope.io', 'ok.ru', 't.me', 'dzen.ru']);
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);
function safeEmbed(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || !EMBED_HOSTS.has(url.hostname)) return null;
    const path = url.pathname.replace(/\/$/, '');
    const host = url.hostname;
    if (host === 'www.youtube-nocookie.com' && /^\/embed\/[\w-]{6,20}$/.test(path)) return `https://www.youtube-nocookie.com${path}`;
    if (host === 'vk.com' && path === '/video_ext.php') {
      const oid = url.searchParams.get('oid') || '', id = url.searchParams.get('id') || '';
      if (!/^-?\d{1,15}$/.test(oid) || !/^\d{1,15}$/.test(id)) return null;
      return `https://vk.com/video_ext.php?oid=${oid}&id=${id}&hd=2`;
    }
    if (host === 'rutube.ru' && /^\/play\/embed\/[a-f0-9]{32}$/i.test(path)) return `https://rutube.ru${path}`;
    if (host === 'player.vimeo.com' && /^\/video\/\d{6,12}$/.test(path)) {
      const hash = url.searchParams.get('h') || '';
      const id = path.split('/')[2];
      return /^[a-zA-Z0-9]{4,32}$/.test(hash) ? `https://player.vimeo.com/video/${id}?h=${hash}` : `https://player.vimeo.com/video/${id}`;
    }
    if (host === 'www.loom.com' && /^\/embed\/[a-f0-9]{32}$/i.test(path)) return `https://www.loom.com${path}`;
    if (host === 'drive.google.com' && /^\/file\/d\/[a-zA-Z0-9_-]{10,80}\/preview$/.test(path)) return `https://drive.google.com${path}`;
    if (host === 'kinescope.io' && /^\/embed\/[A-Za-z0-9]{6,40}$/.test(path)) return `https://kinescope.io${path}`;
    if (host === 'ok.ru' && /^\/videoembed\/\d{5,20}$/.test(path)) return `https://ok.ru${path}`;
    if (host === 't.me' && /^\/[A-Za-z][A-Za-z0-9_]{3,63}\/\d{1,12}$/.test(path)) return `https://t.me${path}?embed=1`;
    if (host === 'dzen.ru' && /^\/embed\/[A-Za-z0-9_-]{6,80}$/.test(path)) return `https://dzen.ru${path}`;
    return null;
  } catch { return null; }
}
function safeExternal(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    url.hash = '';
    return url.href;
  } catch { return null; }
}
function fileExt(resource) {
  const format = String(resource?.format || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (format === 'jpeg') return 'jpg';
  if (format) return format;
  const name = String(resource?.filename || resource?.download || '').split('?')[0];
  const ext = (name.split('.').pop() || '').toLowerCase();
  return ext === 'jpeg' ? 'jpg' : ext;
}
function isImageResource(resource) {
  return IMAGE_EXT.has(fileExt(resource));
}
function imageViewUrl(resource) {
  const preview = resource?.preview;
  if (preview?.type === 'image') return safeUrl(preview.url);
  if (preview?.type === 'images' && preview.urls?.length === 1) return safeUrl(preview.urls[0]);
  return safeUrl(resource?.url) || safeUrl(resource?.download);
}
async function refreshMedia(resource, lessonId, attachment) {
  if (!resource?.key || !lessonId) return null;
  const response = await fetch('/api/media-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lessonId, key: resource.key, attachment: Boolean(attachment) }) });
  if (!response.ok) return null;
  const data = await response.json().catch(() => ({}));
  if (data.expiresIn) catalogExpireAt = Date.now() + Number(data.expiresIn) * 1000;
  return safeUrl(data.url);
}
function bindFreshLink(anchor, resource, lessonId, attachment) {
  anchor.addEventListener('click', async event => {
    if (Date.now() < catalogExpireAt - 60000) return;
    event.preventDefault();
    const url = await refreshMedia(resource, lessonId, attachment);
    if (!url) return;
    anchor.href = url;
    if (anchor.target === '_blank') window.open(url, '_blank', 'noopener,noreferrer');
    else location.assign(url);
  });
}
function mediaChip(tag, text, label) {
  const el = node(tag, 'media-chip', text);
  if (label) el.setAttribute('aria-label', label);
  return el;
}
function mediaActions(stage, resource, lessonId) {
  const bar = node('div', 'media-actions');
  const full = stageFullButton();
  full.classList.add('media-chip');
  full.addEventListener('click', () => toggleStageFull(stage));
  const open = mediaChip('a', '↗ Вкладка', 'Открыть в новой вкладке');
  open.target = '_blank'; open.rel = 'noopener noreferrer';
  const view = safeUrl(resource.url);
  if (view) open.href = view; else open.setAttribute('aria-disabled', 'true');
  const download = mediaChip('a', '↓ Скачать', 'Скачать');
  downloadLink(download, resource);
  bindFreshLink(open, resource, lessonId, false);
  bindFreshLink(download, resource, lessonId, true);
  bar.append(full, open, download);
  return bar;
}
function renderHtmlPage(resource, lessonId) {
  track('material', lessonId, resourceMaterialId(resource, 'page'));
  const card = node('article', 'media-card');
  card.append(node('h4', '', resource.title || 'Страница урока'));
  const stage = node('div', 'media-stage media-html');
  const frame = node('iframe', 'lesson-html');
  // allow-scripts only: the page must not become same-origin and read the school token.
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.title = resource.title || 'Страница урока';
  frame.loading = 'lazy';
  const src = safeUrl(resource.url);
  if (src) frame.src = src;
  frame.addEventListener('load', () => { frame.dataset.loaded = '1'; });
  const timer = setTimeout(async () => {
    if (!frame.isConnected || frame.dataset.loaded === '1') return;
    const url = await refreshMedia(resource, lessonId, false);
    if (url && frame.isConnected && frame.dataset.loaded !== '1') frame.src = url;
  }, Math.max(20000, catalogExpireAt - Date.now() - 90000));
  mediaTimers.push(timer);
  stage.append(frame, mediaActions(stage, resource, lessonId));
  card.append(stage);
  return card;
}
function renderVideo(resource, lessonId) {
  const card = node('article', 'media-card');
  card.append(node('h4', '', resource.title || 'Видео урока'));
  const stage = node('div', 'media-stage media-video');
  const video = node('video');
  video.controls = true; video.playsInline = true; video.preload = 'metadata';
  video.setAttribute('playsinline', ''); video.setAttribute('preload', 'metadata');
  const poster = safeUrl(resource.poster); if (poster) video.poster = poster;
  const src = safeUrl(resource.url); if (src) video.src = src;
  let refreshing = false, attempts = 0;
  const swap = async () => {
    if (refreshing || attempts > 2 || !video.isConnected) return;
    refreshing = true; attempts += 1;
    const time = video.currentTime || 0;
    const playing = !video.paused && !video.ended;
    const url = await refreshMedia(resource, lessonId, false);
    refreshing = false;
    if (!url || !video.isConnected) return;
    video.src = url;
    const resume = () => {
      if (time > 0 && Math.abs((video.currentTime || 0) - time) > 0.5) { try { video.currentTime = time; } catch {} }
      if (playing) video.play().catch(() => {});
    };
    video.addEventListener('loadedmetadata', resume, { once: true });
    video.addEventListener('playing', () => { attempts = 0; }, { once: true });
  };
  const arm = () => {
    const timer = setTimeout(swap, Math.max(20000, catalogExpireAt - Date.now() - 90000));
    mediaTimers.push(timer);
  };
  arm();
  video.addEventListener('play', () => track('material', lessonId, resourceMaterialId(resource, 'video')), { once: true });
  video.addEventListener('error', () => { if ((video.currentTime || 0) > 0) swap(); });
  video.addEventListener('loadedmetadata', () => {
    const w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) return;
    video.style.aspectRatio = `${w} / ${h}`;
    stage.classList.toggle('is-portrait', h > w);
  });
  stage.append(video, mediaActions(stage, resource, lessonId));
  card.append(stage);
  return card;
}
function renderExternalVideo(resource, lessonId) {
  const card = node('article', 'media-card link-card');
  card.append(node('h4', '', resource.title || 'Видео'));
  const box = node('div', 'link-video');
  box.append(node('span', 'link-mark', '▶'), node('p', '', 'Это видео откроется на сайте, где оно опубликовано.'));
  const open = mediaChip('a', 'Открыть видео', 'Открыть видео на сайте');
  const href = safeExternal(resource.embedUrl);
  if (href) { open.href = href; open.target = '_blank'; open.rel = 'noopener noreferrer'; }
  else open.setAttribute('aria-disabled', 'true');
  open.addEventListener('click', () => track('material', lessonId, resourceMaterialId(resource, 'video')));
  box.append(open);
  card.append(box);
  return card;
}
function renderEmbed(resource, lessonId) {
  const src = safeEmbed(resource.embedUrl);
  if (!src) return renderExternalVideo(resource, lessonId);
  track('material', lessonId, resourceMaterialId(resource, 'video'));
  const card = node('article', 'media-card');
  card.append(node('h4', '', resource.title || 'Видео'));
  const stage = node('div', 'media-stage media-video');
  if (resource.layout === 'portrait') stage.classList.add('is-portrait');
  if (resource.layout === 'post' || resource.provider === 'telegram') stage.classList.add('is-post');
  const frame = node('iframe');
  frame.src = src; frame.title = resource.title || 'Видео';
  frame.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen; screen-wake-lock');
  frame.allowFullscreen = true; frame.loading = 'lazy'; frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
  const bar = node('div', 'media-actions');
  const full = stageFullButton();
  full.classList.add('media-chip');
  full.addEventListener('click', () => toggleStageFull(stage));
  const open = mediaChip('a', '↗ Сайт', 'Открыть на сайте');
  open.href = src; open.target = '_blank'; open.rel = 'noopener noreferrer';
  bar.append(full, open); stage.append(frame, bar); card.append(stage);
  return card;
}
function fileList(resources, lessonId) {
  const images = (resources || []).filter(isImageResource);
  const list = node('div', 'file-list');
  for (const resource of resources) {
    const card = node('article', 'file-card'), info = node('div', 'file-title'), copy = node('div'), actions = node('div', 'file-actions');
    const title = resource.title || resource.filename || 'Материал урока';
    copy.append(node('h4', '', title), node('p', '', [resource.format, resource.size, resource.description].filter(Boolean).join(' · ')));
    const thumbSrc = isImageResource(resource) ? imageViewUrl(resource) : null;
    if (thumbSrc) {
      const thumb = node('button', 'file-thumb'); thumb.type = 'button';
      thumb.setAttribute('aria-label', `Открыть изображение «${title}»`);
      const img = node('img'); img.alt = ''; img.decoding = 'async'; img.src = thumbSrc;
      img.addEventListener('error', () => { thumb.replaceWith(node('span', 'file-type', resource.format || 'ФАЙЛ')); });
      thumb.append(img);
      thumb.addEventListener('click', () => openImageLightbox(resource, images, lessonId));
      info.append(thumb, copy);
    } else info.append(node('span', 'file-type', resource.format || 'ФАЙЛ'), copy);
    const view = node('button', 'button small', isImageResource(resource) ? 'Смотреть' : 'Предпросмотр ↗'); view.type = 'button';
    view.addEventListener('click', () => isImageResource(resource) ? openImageLightbox(resource, images, lessonId) : openPreview(resource, lessonId));
    const download = node('a', 'button small', '↓ Скачать'); downloadLink(download, resource);
    actions.append(view, download); card.append(info, actions); list.append(card);
  } return list;
}
function renderLecture(container, resource, prefix) {
  const reader = node('article', 'reader'), toolbar = node('div', 'reader-toolbar'), body = node('div', 'reader-body');
  toolbar.append(node('span', '', resource.readingTime ? `ЧТЕНИЕ / ${resource.readingTime}` : 'ЛЕКЦИЯ / ЧТЕНИЕ НА САЙТЕ'));
  const size = node('button', '', 'Аа · Крупнее'); size.type = 'button'; size.setAttribute('aria-pressed', 'false');
  size.addEventListener('click', () => { const big = body.classList.toggle('large-text'); size.setAttribute('aria-pressed', String(big)); size.textContent = big ? 'Аа · Обычный размер' : 'Аа · Крупнее'; }); toolbar.append(size);
  const toc = node('nav', 'reader-toc'); toc.setAttribute('aria-label', 'Содержание лекции');
  for (const [i, section] of resource.sections.entries()) {
    const id = `${prefix}-${i}`, heading = node('h4', '', section.title); heading.id = id;
    const link = node('a', '', section.title); link.href = `#${id}`; toc.append(link); body.append(heading);
    for (const block of section.blocks || []) {
      if (['list','orderedList'].includes(block.type)) { const list = node(block.type === 'list' ? 'ul' : 'ol'); for (const item of block.items || []) list.append(node('li', '', item)); body.append(list); }
      else body.append(node(block.type === 'quote' ? 'blockquote' : 'p', '', block.text || ''));
    }
  }
  reader.append(toolbar, toc, body); container.append(reader);
}
function renderChecks(container, checks, lessonId) {
  const wrap = node('div', 'check-list'); wrap.append(node('h4', '', 'Контрольный список'));
  wrap.append(node('p', 'section-index', 'ОТМЕТКИ СОХРАНЯЮТСЯ В ЭТОМ БРАУЗЕРЕ'));
  for (const [i, text] of checks.entries()) {
    const label = node('label'), input = node('input'); input.type = 'checkbox';
    const key = `smm-school-check-${lessonId}-${i}`;
    try { input.checked = localStorage.getItem(key) === 'true'; } catch {}
    input.addEventListener('change', () => { try { localStorage.setItem(key, String(input.checked)); } catch {} });
    label.append(input, node('span', '', text)); wrap.append(label);
  } container.append(wrap);
}
async function openPreview(resource, lessonId) {
  if (isImageResource(resource)) { openImageLightbox(resource, [resource], lessonId); return; }
  track('material', lessonId, resourceMaterialId(resource, 'file'));
  const dialog = $('#preview-dialog'), container = $('#preview-content');
  for (const viewer of modalViewers.splice(0)) viewer.destroy();
  container.replaceChildren(); $('#preview-title').textContent = resource.title || 'Материал урока'; downloadLink($('#preview-download'), resource);
  dialog.showModal(); syncScrollLock();
  if (resource.sections?.length) renderLecture(container, resource, 'preview-lecture');
  else await mountPreview(container, resource, modalViewers, () => dialog.open);
}
async function mountPreview(container, resource, viewers, alive) {
  const preview = resource.preview;
  if (!preview || !(preview.type === 'images' ? preview.urls?.every(safeUrl) && preview.urls.length : safeUrl(preview.url))) { previewError(container, 'Для этого файла ещё не добавлена версия для просмотра.', resource); return; }
  if (preview.type === 'images') { const viewer=new ImageViewer(container,resource,alive);viewers.push(viewer);return; }
  if (preview.type === 'pdf') {
    const viewer = new PDFViewer(container, resource, alive); viewers.push(viewer); await viewer.load();
  } else if (preview.type === 'image') {
    const image = node('img', 'image-preview'); image.alt = resource.title || 'Материал урока';
    image.onerror = () => { if (alive()) previewError(container, 'Не удалось открыть изображение.', resource); }; image.src = safeUrl(preview.url); container.append(image);
  } else if (preview.type === 'text') {
    container.append(node('div', 'viewer-loading', 'Открываем материал…'));
    try { const response = await fetch(safeUrl(preview.url)); if (!response.ok) throw new Error(); const text = await response.text(); if (alive()) container.replaceChildren(node('div', 'text-preview', text)); }
    catch { if (alive()) previewError(container, 'Не удалось открыть текст. Попробуйте скачать исходный файл.', resource); }
  } else previewError(container, 'Версия для просмотра должна быть в PDF, изображении или текстовом формате.', resource);
}
function previewError(container, message, resource) {
  const error = node('div', 'viewer-error', message);
  const url = safeUrl(resource?.download); if (url) { const link = node('a', '', 'Скачать исходный файл ↓'); downloadLink(link, resource); error.append(node('br'), link); }
  container.replaceChildren(error);
}
class PDFViewer {
  constructor(container, resource, alive) {
    this.container = container; this.resource = resource; this.alive = alive; this.page = 1; this.scale = 1; this.dead = false; this.renderId = 0;
    this.root = node('div', 'pdf-viewer'); this.stage = node('div', 'pdf-stage'); this.sheet = node('div', 'pdf-sheet'); this.sheet.append(node('div', 'viewer-loading', 'Открываем документ…')); this.stage.append(this.sheet);
    this.canvas = node('canvas'); this.canvas.setAttribute('role', 'img');
    this.controls = node('div', 'pdf-controls'); const navigation = node('div'), tools = node('div');
    this.previous = node('button', '', '←'); this.previous.setAttribute('aria-label', 'Предыдущая страница');
    this.next = node('button', '', '→'); this.next.setAttribute('aria-label', 'Следующая страница'); this.label = node('span', '', '— / —'); this.label.setAttribute('aria-live', 'polite');
    for (const b of [this.previous,this.next]) { b.type = 'button'; b.disabled = true; }
    this.previous.addEventListener('click', () => this.go(this.page - 1)); this.next.addEventListener('click', () => this.go(this.page + 1));
    navigation.append(this.previous, this.label, this.next);
    this.zoom = node('select'); this.zoom.setAttribute('aria-label', 'Масштаб документа');
    for (const [value,text] of [['1','По ширине'],['1.25','125%'],['1.5','150%'],['2','200%']]) { const o = node('option', '', text); o.value = value; this.zoom.append(o); }
    this.zoom.addEventListener('change', () => this.setScale(Number(this.zoom.value)));
    const expand = node('button', '', '↗'); expand.type = 'button'; expand.setAttribute('aria-label', 'Открыть документ в большом окне'); expand.addEventListener('click', () => openPreview(this.resource));
    const full = stageFullButton();
    full.addEventListener('click', () => { toggleStageFull(this.root); requestAnimationFrame(() => this.render()); });
    tools.append(zoomStepButton('−', 'Уменьшить', () => this.setScale(stepZoom(this.scale, -1))), this.zoom, zoomStepButton('+', 'Увеличить', () => this.setScale(stepZoom(this.scale, 1))), full);
    if (container.closest('#preview-dialog') == null) tools.append(expand);
    tools.append(viewerDownload(this.resource));
    this.controls.append(navigation, tools); this.root.append(this.stage, this.controls); container.append(this.root);
    bindSwipe(this.stage, delta => { if (this.scale > 1.02 || this.stage.dataset.zoomed === '1') return; this.go(this.page + delta); });
    bindTap(this.stage, () => { if (this.stage.dataset.zoomed === '1') return; toggleStageFull(this.root); requestAnimationFrame(() => this.render()); });
    bindPinch(this.stage, () => this.scale, (scale, mid) => this.setScale(scale, mid));
    armZoomPan(this.stage, (delta, point) => this.setScale(this.scale * (delta < 0 ? 1.08 : 0.92), point));
    markZoomed(this.stage, false);
    this.resize = new ResizeObserver(() => { if (this.pdf && !this.dead) { clearTimeout(this.resizeTimer); this.resizeTimer = setTimeout(() => this.render(), 120); } }); this.resize.observe(this.stage);
  }
  async load() {
    try {
      if (!pdfModule) pdfModule = import('./assets/pdf.mjs'); const pdfjs = await pdfModule;
      if (this.dead || !this.alive()) return;
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('./assets/pdf.worker.mjs', import.meta.url).href;
      this.task = pdfjs.getDocument({url:safeUrl(this.resource.preview.url),standardFontDataUrl:new URL('./assets/standard_fonts/',import.meta.url).href,isEvalSupported:false,disableRange:true,disableStream:true,disableAutoFetch:false});
      this.pdf = await this.task.promise; if (this.dead || !this.alive()) return;
      if (!reduceMotion) this.canvas.classList.add('is-fading');
      this.canvas.draggable = false; this.sheet.replaceChildren(this.canvas); this.stage.replaceChildren(this.sheet); await this.render();
    } catch { if (!this.dead && this.alive()) previewError(this.container, 'Не удалось открыть документ. Попробуйте скачать исходный файл.', this.resource); }
  }
  go(page) { if (!this.pdf || page < 1 || page > this.pdf.numPages || this.dead) return; this.page = page; this.render(); }
  async render() {
    if (!this.pdf || this.dead || !this.alive()) return;
    const id = ++this.renderId; this.renderTask?.cancel();
    this.previous.disabled = this.page <= 1; this.next.disabled = this.page >= this.pdf.numPages;
    this.label.textContent = `${this.page} / ${this.pdf.numPages}`; this.canvas.setAttribute('aria-label', `${this.resource.title || 'Документ'} — страница ${this.page} из ${this.pdf.numPages}`);
    try {
      const page = await this.pdf.getPage(this.page); if (id !== this.renderId || this.dead || !this.alive()) return;
      const viewport = page.getViewport({scale:1}), box = getComputedStyle(this.stage), pad = (parseFloat(box.paddingLeft) || 0) + (parseFloat(box.paddingRight) || 0);
      const bar = this.scale > 1.02 ? Math.max(0, this.stage.offsetWidth - this.stage.clientWidth) : 0;
      const width = Math.max(160, this.stage.clientWidth + bar - pad);
      this.fitCssWidth = width; this.pageRatio = viewport.height / Math.max(1, viewport.width);
      const anchor = this.scale > 1.02 ? zoomAnchor(this.stage) : null;
      const cssScale = width / viewport.width * this.scale, ratio = Math.min(devicePixelRatio || 1, 2);
      const view = page.getViewport({scale:cssScale * ratio}); this.canvas.width = Math.round(view.width); this.canvas.height = Math.round(view.height);
      const cssW = view.width / ratio;
      this.canvas.style.width = `${cssW}px`; this.canvas.style.height = `${cssW * this.pageRatio}px`;
      this.canvas.style.maxWidth = this.scale > 1.02 ? 'none' : '100%';
      this.canvas.style.touchAction = this.scale > 1.02 ? 'pan-x pan-y' : '';
      if (this.sheet) this.sheet.style.width = this.scale > 1.02 ? `${cssW}px` : '';
      markZoomed(this.stage, this.scale > 1.02);
      if (this.scale > 1.02) placeZoom(this.stage, anchor); else this.stage.scrollTo?.(0, 0);
      this.renderTask = page.render({canvasContext:this.canvas.getContext('2d'),viewport:view}); await this.renderTask.promise;
      if (id === this.renderId && !this.dead) this.canvas.classList.remove('is-fading');
    } catch(error) { if (error?.name !== 'RenderingCancelledException' && id === this.renderId && !this.dead && this.alive()) previewError(this.container, 'Не удалось показать страницу. Исходный файл доступен для скачивания.', this.resource); }
  }
  setScale(next, point) {
    const scale = Math.min(3, Math.max(1, Number(next) || 1));
    const zoomed = scale > 1.02;
    const anchor = point ? zoomAnchor(this.stage, point) : null;
    this.scale = scale;
    markZoomed(this.stage, zoomed);
    this.syncZoomControl();
    if (this.fitCssWidth && this.canvas?.isConnected) {
      const cssW = this.fitCssWidth * scale;
      this.canvas.style.width = `${cssW}px`;
      this.canvas.style.height = `${cssW * (this.pageRatio || 1)}px`;
      this.canvas.style.maxWidth = zoomed ? 'none' : '100%';
      this.canvas.style.touchAction = zoomed ? 'pan-x pan-y' : '';
      if (this.sheet) this.sheet.style.width = zoomed ? `${cssW}px` : '';
      if (zoomed) placeZoom(this.stage, anchor); else this.stage.scrollTo?.(0, 0);
    }
    clearTimeout(this.zoomTimer);
    this.zoomTimer = setTimeout(() => { if (!this.dead) this.render(); }, 70);
  }
  syncZoomControl() { syncZoomSelect(this.zoom, this.scale); }
  destroy() { this.dead = true; this.root?.classList.remove('is-stage-full'); this.renderId++; clearTimeout(this.resizeTimer); clearTimeout(this.fadeTimer); clearTimeout(this.zoomTimer); this.resize.disconnect(); this.renderTask?.cancel(); this.task?.destroy().catch(() => {}); syncScrollLock(); }
}
class ImageViewer {
  constructor(container, resource, alive) {
    this.resource = resource; this.alive = alive; this.page = 0; this.dead = false; this.nav = 0;
    const root = node('div', 'pdf-viewer gallery-viewer'), stage = node('div', 'pdf-stage'), controls = node('div', 'pdf-controls'), navigation = node('div'), tools = node('div');
    this.frame = node('div', 'slide-frame');
    this.skeleton = node('div', 'slide-skeleton');
    this.skeleton.append(node('span', 'sr-only', 'Открываем страницу…'));
    this.slots = [0, 1].map(() => { const img = node('img', 'gallery-image'); img.alt = ''; img.decoding = 'async'; img.draggable = false; img.setAttribute('aria-hidden', 'true'); return img; });
    this.slot = 0;
    this.frame.append(this.skeleton, ...this.slots);
    stage.append(this.frame);
    this.previous = node('button', '', '←'); this.previous.type = 'button'; this.previous.setAttribute('aria-label', 'Предыдущая страница');
    this.next = node('button', '', '→'); this.next.type = 'button'; this.next.setAttribute('aria-label', 'Следующая страница');
    this.label = node('span'); this.label.setAttribute('aria-live', 'polite');
    this.previous.addEventListener('click', () => this.go(this.page - 1));
    this.next.addEventListener('click', () => this.go(this.page + 1));
    navigation.append(this.previous, this.label, this.next);
    this.zoomScale = 1;
    this.zoom = zoomSelect(value => this.applyZoom(value));
    const zoomTools = node('div', 'zoom-tools');
    zoomTools.append(zoomStepButton('−', 'Уменьшить', () => this.applyZoom(stepZoom(this.zoomScale, -1))), this.zoom, zoomStepButton('+', 'Увеличить', () => this.applyZoom(stepZoom(this.zoomScale, 1))));
    const full = stageFullButton();
    full.addEventListener('click', () => toggleStageFull(root));
    tools.append(zoomTools, full);
    if (!container.closest('#preview-dialog')) {
      const expand = node('button', '', '↗'); expand.type = 'button';
      expand.setAttribute('aria-label', 'Открыть документ в большом окне');
      expand.addEventListener('click', () => openPreview(resource));
      tools.append(expand);
    }
    tools.append(viewerDownload(resource));
    controls.append(navigation, tools); root.append(stage, controls); container.append(root);
    bindSwipe(stage, delta => { if (stage.dataset.zoomed === '1') return; this.go(this.page + delta); });
    bindTap(stage, () => { if (stage.dataset.zoomed === '1') return; toggleStageFull(root); });
    bindPinch(stage, () => this.zoomScale, (scale, mid) => this.applyZoom(scale, mid));
    armZoomPan(stage, (delta, point) => this.applyZoom(this.zoomScale * (delta < 0 ? 1.08 : 0.92), point));
    markZoomed(stage, false);
    this.go(0); this.preload();
  }
  preload() {
    const urls = this.resource.preview.urls.map(safeUrl); this.cache = []; let i = 1;
    const next = () => { if (this.dead || i >= urls.length) return; const im = new Image(); im.decoding = 'async'; this.cache.push(im); im.onload = im.onerror = next; im.src = urls[i++]; };
    for (let k = 0; k < 4; k++) next();
  }
  hideSkeleton() { this.skeleton.classList.add('is-done'); }
  go(page) {
    if (this.dead || !this.alive() || page < 0 || page >= this.resource.preview.urls.length) return;
    const url = safeUrl(this.resource.preview.urls[page]);
    if (!url) return;
    const current = this.slots[this.slot];
    if (page === this.page && current.getAttribute('src')) return;
    this.applyZoom(1);
    const dir = page >= this.page ? 1 : -1;
    const first = !current.getAttribute('src');
    this.page = page;
    const caption = `${this.resource.title}, страница ${page + 1} из ${this.resource.preview.urls.length}`;
    this.label.textContent = `${page + 1} / ${this.resource.preview.urls.length}`;
    this.previous.disabled = page === 0;
    this.next.disabled = page === this.resource.preview.urls.length - 1;
    const incoming = first || reduceMotion ? current : this.slots[1 - this.slot];
    const outgoing = current;
    const token = ++this.nav;
    incoming.alt = caption;
    incoming.onerror = () => { if (token === this.nav && !this.dead && this.alive()) previewError(container, 'Не удалось открыть страницу. Исходный файл можно скачать.', this.resource); };
    const reveal = () => {
      if (token !== this.nav || this.dead || incoming.dataset.shown === String(token)) return;
      incoming.dataset.shown = String(token);
      incoming.removeAttribute('aria-hidden');
      if (incoming !== outgoing) {
        outgoing.style.zIndex = '1';
        incoming.style.zIndex = '2';
        const stale = outgoing;
        const clear = () => {
          if (this.slots[this.slot] === stale) return;
          stale.classList.remove('is-shown');
          stale.setAttribute('aria-hidden', 'true');
          stale.removeAttribute('src');
          stale.alt = '';
          stale.style.zIndex = '';
        };
        if (reduceMotion) clear();
        else {
          incoming.addEventListener('transitionend', event => { if (event.propertyName === 'opacity') clear(); }, { once: true });
          setTimeout(clear, 280);
        }
        this.slot = this.slots.indexOf(incoming);
      }
      const show = () => { if (token === this.nav && !this.dead) { incoming.classList.add('is-shown'); this.hideSkeleton(); } };
      if (reduceMotion) { show(); return; }
      incoming.classList.remove('is-shown');
      requestAnimationFrame(() => requestAnimationFrame(show));
    };
    incoming.onload = () => { incoming.onload = null; reveal(); };
    incoming.src = url;
    if (incoming.complete && incoming.naturalWidth) reveal();
  }
  applyZoom(scale, point) {
    const next = Math.min(3, Math.max(1, Number(scale) || 1));
    const stage = this.frame.parentElement;
    const anchor = point && stage ? zoomAnchor(stage, point) : null;
    this.zoomScale = next;
    const zoomed = next > 1.02;
    this.frame.classList.toggle('is-zoomed', zoomed);
    this.frame.style.setProperty('--zoom', String(zoomed ? next.toFixed(3) : 1));
    if (!stage) return;
    const base = stage.clientWidth || 0;
    this.frame.style.width = zoomed && base ? `${Math.round(base * next)}px` : '';
    this.frame.style.maxWidth = zoomed ? 'none' : '';
    for (const img of this.slots) img.style.touchAction = zoomed ? 'pan-x pan-y' : '';
    markZoomed(stage, zoomed);
    syncZoomSelect(this.zoom, next);
    if (zoomed) placeZoom(stage, anchor);
  }
  destroy() { this.dead = true; this.nav++; this.frame?.closest('.pdf-viewer')?.classList.remove('is-stage-full'); for (const img of this.slots) { img.onload = null; img.onerror = null; img.removeAttribute('src'); } syncScrollLock(); }
}
function openImageLightbox(resource, images, lessonId) {
  track('material', lessonId, resourceMaterialId(resource, 'image'));
  const gallery = (images || []).filter(isImageResource);
  const list = gallery.length ? gallery : [resource];
  if (!lightbox) lightbox = new PhotoLightbox();
  lightbox.open(list, Math.max(0, list.indexOf(resource)), lessonId);
}
class PhotoLightbox {
  constructor() {
    this.dialog = node('dialog', 'image-lightbox');
    this.dialog.setAttribute('aria-label', 'Просмотр изображения');
    const bar = node('div', 'lightbox-bar');
    this.count = node('span', 'lightbox-count');
    this.count.setAttribute('aria-live', 'polite');
    const tools = node('div', 'lightbox-tools');
    this.download = mediaChip('a', '↓ Скачать', 'Скачать');
    const close = node('button', 'icon-button', '×');
    close.type = 'button'; close.setAttribute('aria-label', 'Закрыть');
    close.addEventListener('click', () => this.close());
    tools.append(this.download, close);
    bar.append(this.count, tools);
    this.stage = node('div', 'lightbox-stage');
    this.image = node('img', 'lightbox-image');
    this.image.alt = ''; this.image.draggable = false;
    this.stage.append(this.image);
    this.prev = node('button', 'lightbox-nav prev', '←');
    this.next = node('button', 'lightbox-nav next', '→');
    this.prev.type = 'button'; this.next.type = 'button';
    this.prev.setAttribute('aria-label', 'Предыдущее изображение');
    this.next.setAttribute('aria-label', 'Следующее изображение');
    this.prev.addEventListener('click', () => this.go(this.index - 1));
    this.next.addEventListener('click', () => this.go(this.index + 1));
    this.dialog.append(bar, this.stage, this.prev, this.next);
    document.body.append(this.dialog);
    this.scale = 1; this.panX = 0; this.panY = 0; this.index = 0; this.token = 0; this.drag = null;
    this.dialog.addEventListener('close', () => { this.applyZoom(1); syncScrollLock(); });
    this.dialog.addEventListener('cancel', () => syncScrollLock());
    this.dialog.addEventListener('keydown', event => {
      if (event.key === 'ArrowRight') { event.preventDefault(); this.go(this.index + 1); }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); this.go(this.index - 1); }
    });
    this.download.addEventListener('click', async event => {
      const resource = this.images?.[this.index];
      if (!resource || !this.lessonId || Date.now() < catalogExpireAt - 60000) return;
      event.preventDefault();
      const url = await refreshMedia(resource, this.lessonId, true);
      if (!url) return;
      this.download.href = url;
      location.assign(url);
    });
    bindSwipe(this.stage, delta => this.go(this.index + delta));
    bindPinch(this.stage, () => this.scale, scale => this.applyZoom(scale));
    this.stage.addEventListener('wheel', event => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      this.applyZoom(this.scale * (event.deltaY < 0 ? 1.08 : 0.92));
    }, { passive: false });
    this.stage.addEventListener('pointerdown', event => {
      if (this.scale <= 1.02 || this.stage.dataset.pinching === '1') return;
      this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, ox: this.panX, oy: this.panY };
    });
    this.stage.addEventListener('pointermove', event => {
      if (!this.drag || event.pointerId !== this.drag.id || this.stage.dataset.pinching === '1') return;
      this.panX = this.drag.ox + event.clientX - this.drag.x;
      this.panY = this.drag.oy + event.clientY - this.drag.y;
      this.paint();
    });
    const end = () => { this.drag = null; };
    this.stage.addEventListener('pointerup', end);
    this.stage.addEventListener('pointercancel', end);
  }
  open(images, index, lessonId) {
    this.images = images; this.lessonId = lessonId || null;
    if (!this.dialog.open) this.dialog.showModal();
    syncScrollLock();
    this.go(index, true);
  }
  close() { if (this.dialog.open) this.dialog.close(); }
  applyZoom(scale) {
    const next = Math.min(4, Math.max(1, Number(scale) || 1));
    this.scale = next;
    if (next <= 1.02) { this.panX = 0; this.panY = 0; }
    this.stage.dataset.zoomed = next > 1.02 ? '1' : '0';
    this.paint();
  }
  paint() { this.image.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.scale})`; }
  async go(index, force = false) {
    if (!this.images || index < 0 || index >= this.images.length) return;
    if (!force && index === this.index && this.image.getAttribute('src')) return;
    this.index = index;
    this.applyZoom(1);
    const resource = this.images[index];
    const title = resource.title || resource.filename || 'Изображение';
    this.count.textContent = this.images.length > 1 ? `${index + 1} из ${this.images.length}` : title;
    this.image.alt = title;
    const many = this.images.length > 1;
    this.prev.hidden = !many; this.next.hidden = !many;
    this.prev.disabled = index === 0; this.next.disabled = index === this.images.length - 1;
    downloadLink(this.download, resource);
    const token = ++this.token;
    let src = imageViewUrl(resource);
    if (this.lessonId && resource.key && Date.now() >= catalogExpireAt - 60000) {
      const fresh = await refreshMedia(resource, this.lessonId, false);
      if (fresh) src = fresh;
    }
    if (token !== this.token) return;
    this.image.onerror = () => { if (token === this.token) this.image.alt = 'Не удалось открыть изображение'; };
    if (src) this.image.src = src; else this.image.removeAttribute('src');
    const neighbor = this.images[index + 1] || this.images[index - 1];
    const ahead = neighbor ? imageViewUrl(neighbor) : null;
    if (ahead) { const pre = new Image(); pre.decoding = 'async'; pre.src = ahead; }
  }
}
$('#lesson-done')?.addEventListener('click', async () => {
  const lesson = lessons[current];
  const button = $('#lesson-done');
  if (!lesson || !button || button.disabled) return;
  const id = String(lesson.id);
  const next = !doneLessons.has(id);
  if (next) doneLessons.add(id); else doneLessons.delete(id);
  paintProgress();
  button.disabled = true;
  try {
    const response = await fetch('/api/progress', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lessonId: id, completed: next }) });
    if (!response.ok) throw new Error();
  } catch {
    if (next) doneLessons.delete(id); else doneLessons.add(id);
    paintProgress();
    setAnnouncement('Не удалось сохранить отметку. Попробуйте ещё раз.');
  } finally { button.disabled = false; }
});
$('#previous-lesson').addEventListener('click', () => selectLesson(current - 1, true));
$('#next-lesson').addEventListener('click', () => selectLesson(current + 1, true));
async function apiRetry(path){let last;for(let i=0;i<3;i++){const ctl=new AbortController();const t=setTimeout(()=>ctl.abort(),15000);try{const r=await fetch(path,{signal:ctl.signal});clearTimeout(t);if(r.status<500||i===2)return r;last=new Error(path+' HTTP '+r.status);}catch(e){clearTimeout(t);last=e;}await new Promise(r=>setTimeout(r,800*(i+1)));}throw last;}
const sectionObserver = new IntersectionObserver(entries => {
  const visible = entries.filter(e => e.isIntersecting).sort((a,b) => a.boundingClientRect.top - b.boundingClientRect.top);
  if (!visible.length) return; const id = visible[0].target.id;
  for (const a of document.querySelectorAll('.outline nav a')) {
    const on = a.getAttribute('href') === `#${id}`;
    a.classList.toggle('active', on);
    if (on) scrollChip(a);
  }
}, {rootMargin:'-95px 0px -55% 0px',threshold:0});
for (const section of document.querySelectorAll('.resource-section')) sectionObserver.observe(section);
try {
  const identity=await apiRetry('/api/session');if(!identity.ok)throw new Error('session HTTP '+identity.status);const account=(await identity.json()).user;viewerIsTeacher=account.role==='teacher';const role=account.role==='teacher'?'Преподаватель':'Ученик';$('#account-name').textContent=account.name===role?role:`${account.name} · ${role}`;if(account.role==='teacher'){const cab=document.createElement('a');cab.className='help-button';cab.href='./admin.html';cab.textContent='Кабинет';$('#account-name').after(cab);armCabinetBadge(cab);}if(Array.isArray(account.roles)){const label=r=>r==='teacher'?'Преподаватель':r==='student'?'Ученик':r;const sel=document.createElement('select');sel.id='role-switch';sel.setAttribute('aria-label','Роль');sel.className='role-switch';for(const r of account.roles){const o=document.createElement('option');o.value=r;o.textContent='Роль: '+label(r);o.selected=r===account.role;sel.append(o);}sel.addEventListener('change',async()=>{const res=await fetch('/api/role',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role:sel.value})});if(res.ok){try{localStorage.setItem('smm-role',sel.value);}catch{}location.reload();}});$('#account-name').after(sel);}
  const response = await apiRetry('/api/lessons'); if (!response.ok) throw new Error('lessons HTTP '+response.status);
  const data = await response.json(); lessons = data.lessons;
  try { const progress = await fetch('/api/progress'); if (progress.ok) { const body = await progress.json(); doneLessons.clear(); for (const id of body.completed || []) doneLessons.add(String(id)); } } catch {}
  catalogExpireAt = Date.now() + (Number(data.expiresIn) || 3600) * 1000;
  if(data.shared?.length){$('#shared-files').replaceChildren(fileList(data.shared));armReveals($('#shared-files'));}
  const useful=[
    ['Онлайн-подпись','Подписать документы удалённо','https://onedocs.ru/'],
    ['PDF-объединитель','Соединить несколько PDF-файлов в один','https://www.ilovepdf.com/ru/merge_pdf'],
    ['LabelUp','Аналитика блогеров, аудитории и вовлечённости','https://labelup.ru/'],
    ['SwipeWipe','Чистить галерею простым свайпом','https://swipewipe.app/'],
    ['Google Календарь','Планы, созвоны и напоминания','https://calendar.google.com/'],
    ['Google Таблицы','Контент-планы, аналитика и отчётность','https://sheets.google.com/'],
    ['Google Документы','Стратегии и коммерческие предложения','https://docs.google.com/'],
    ['Google Презентации','Презентации для заказчиков','https://slides.google.com/'],
    ['Canva','Альтернатива для дизайна документов и презентаций','https://www.canva.com/'],
    ['Figma','Макеты, визуальные материалы и совместная работа','https://www.figma.com/'],
    ['LiveDune · Топ аккаунтов','Рейтинги и поиск аккаунтов для анализа','https://livedune.com/ru/top/?utm_source=coursevikkkast']
  ];
  $('#useful-links').replaceChildren(...useful.map(([title,description,url])=>{const link=node('a','useful-card');link.href=url;link.target='_blank';link.rel='noopener noreferrer';link.append(node('h5','',title+' ↗'),node('p','',description));return link;}));
  armReveals($('#useful-links'));
  const count=document.querySelector('#selector-count');if(count){const n=lessons.length;const w=n%10===1&&n%100!==11?'УРОК':n%10>=2&&n%10<=4&&(n%100<12||n%100>14)?'УРОКА':'УРОКОВ';count.textContent=`${String(n).padStart(2,'0')} ${w} / ПЕРВЫЙ ЭТАП`;}
  if (!Array.isArray(lessons) || !lessons.length) throw new Error();
  buildTabs(); let saved; try { saved = localStorage.getItem('smm-school-lesson'); } catch {}
  const chosen = location.hash.match(/^#lesson-(.+)$/)?.[1] || saved;
  const index = lessons.findIndex(l => l.id === chosen); await selectLesson(index < 0 ? 0 : index);
} catch (e) { console.error('Catalog load failed:', e); if (!getToken()) { location.replace('./login.html'); } else { const box=node('div', 'loading-error', 'Не удалось загрузить каталог уроков. Проверьте соединение и попробуйте ещё раз. '); const again=node('button','button small','Повторить'); again.addEventListener('click',()=>location.reload()); box.append(again); $('#lesson').replaceChildren(box); } }

const __loaded=Date.now();document.addEventListener('visibilitychange',()=>{if(document.visibilityState!=='visible'||Date.now()-__loaded<=50*60000)return;if([...document.querySelectorAll('video')].some(video=>!video.paused&&!video.ended))return;location.reload();});
