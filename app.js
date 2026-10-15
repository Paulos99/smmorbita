import {API,getToken,clearToken} from './auth.js';
if(!getToken()){location.replace('./login.html');throw new Error('auth');}
const $ = (selector, parent = document) => parent.querySelector(selector);
const node = (tag, className, text) => {
  const e = document.createElement(tag); if (className) e.className = className;
  if (text != null) e.textContent = text; return e;
};
let lessons = [], current = 0, epoch = 0, pdfModule;
const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
let revealObserver = null;
if (!reduceMotion && typeof IntersectionObserver === 'function') {
  revealObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.target.isConnected) { revealObserver.unobserve(entry.target); continue; }
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('in');
      revealObserver.unobserve(entry.target);
    }
  }, { rootMargin: '0px 0px -4% 0px', threshold: 0.12 });
}
function armReveals(root) {
  if (!revealObserver || !root) return;
  const seen = new Map();
  for (const el of root.querySelectorAll('.lesson-tab, .file-card, .useful-card, .workbook-card')) {
    if (el.classList.contains('reveal')) continue;
    const parent = el.parentElement;
    const i = seen.get(parent) || 0;
    seen.set(parent, i + 1);
    el.style.setProperty('--i', String(Math.min(i, 7)));
    el.classList.add('reveal');
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
  target.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse') return;
    swipe = { x: event.clientX, y: event.clientY, id: event.pointerId, lock: false };
  });
  target.addEventListener('pointermove', event => {
    if (!swipe || event.pointerId !== swipe.id || swipe.lock) return;
    const dx = event.clientX - swipe.x, dy = event.clientY - swipe.y;
    if (Math.hypot(dx, dy) < 14) return;
    if (Math.abs(dx) > Math.abs(dy) * 1.2) {
      swipe.lock = true;
      try { target.setPointerCapture?.(event.pointerId); } catch {}
    } else swipe = null;
  });
  target.addEventListener('pointerup', event => {
    if (!swipe || event.pointerId !== swipe.id) return;
    const dx = event.clientX - swipe.x;
    const locked = swipe.lock;
    swipe = null;
    if (locked && Math.abs(dx) >= 48) onStep(dx < 0 ? 1 : -1);
  });
  target.addEventListener('pointercancel', () => { swipe = null; });
}
const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => { let url=String(input); if (url.startsWith('/api/')) { url=API+url; const h=new Headers(init.headers||{}); h.set('X-School-Token',getToken()); try{const r=localStorage.getItem('smm-role');if(r)h.set('X-School-Role',r);}catch{} init={...init,headers:h,credentials:'omit'}; } const response = await originalFetch(url, init); if (response.status === 401 && url.startsWith(API)) { clearToken(); location.replace('./login.html'); } return response; };
$('#logout-button').addEventListener('click',async()=>{const button=$('#logout-button');button.disabled=true;try{const r=await fetch('/api/logout',{method:'POST'});clearToken();if(r.ok||true)location.replace('./login.html');else{button.disabled=false;setAnnouncement('Не удалось выйти. Попробуйте снова.');}}catch{button.disabled=false;setAnnouncement('Не удалось выйти. Проверьте соединение.');}});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')fetch('/api/session').catch(()=>{});});
setInterval(()=>fetch('/api/session').catch(()=>{}),60000);
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
function closeDialog(dialog) { dialog.close(); document.body.classList.remove('no-scroll'); }
for (const dialog of document.querySelectorAll('dialog')) {
  for (const button of dialog.querySelectorAll('[data-close]')) button.addEventListener('click', () => closeDialog(dialog));
  dialog.addEventListener('close', () => {
    document.body.classList.remove('no-scroll');
    if (dialog.id === 'preview-dialog') { for (const viewer of modalViewers.splice(0)) viewer.destroy(); $('#preview-content').replaceChildren(); }
  });
  dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) closeDialog(dialog); } });
}
$('#help-button').addEventListener('click', () => { $('#help-dialog').showModal(); document.body.classList.add('no-scroll'); });
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
async function selectLesson(index, scroll = false) {
  if (index < 0 || index >= lessons.length) return;
  const motionSwap = epoch > 0;
  current = index; const version = ++epoch, lesson = lessons[index];
  for (const viewer of inlineViewers.splice(0)) viewer.destroy();
  releaseReveals($('#lesson'));
  for (const [i, button] of [...$('#lesson-tabs').children].entries()) { button.setAttribute('aria-selected', String(i === index)); button.tabIndex = i === index ? 0 : -1; }
  $('#lesson').setAttribute('aria-labelledby', `tab-${lesson.id}`);
  $('#lesson-code').textContent = `УЧЕБНАЯ МИССИЯ / ${lesson.number.padStart(3, '0')}`;
  $('#lesson-title').textContent = lesson.title; $('#lesson-description').textContent = lesson.description || '';
  const files = [lesson.presentation, lesson.lecture, ...(lesson.materials || []), lesson.workbook].filter(Boolean);
  const hasMaterials = files.length > 0;
  $('#lesson-state').textContent = hasMaterials ? `${files.length} ${fileWord(files.length)} в досье` : 'Материалы готовятся';
  $('#lesson-state').classList.toggle('ready', hasMaterials);
  downloadLink($('#presentation-download'), lesson.presentation); downloadLink($('#lecture-download'), lesson.lecture); downloadLink($('#workbook-download'), lesson.workbook);
  $('#presentation-view').replaceChildren(presentationPlaceholder(lesson.number));
  $('#lecture-view').replaceChildren(lecturePlaceholder());
  $('#materials-view').replaceChildren(materialsPlaceholder());
  $('#workbook-view').replaceChildren(workbookPlaceholder());
  $('#material-count').textContent = `${lesson.materials?.length || 0} ${fileWord(lesson.materials?.length || 0).toUpperCase()}`;
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
  if (lesson.materials?.length) $('#materials-view').replaceChildren(fileList(lesson.materials));
  if (lesson.workbook) {
    $('#workbook-view').replaceChildren(fileList([lesson.workbook]));
    if (lesson.workbook.checks?.length) renderChecks($('#workbook-view'), lesson.workbook.checks, lesson.id);
  }
  $('#lesson-position').textContent = `${lesson.number} / ${String(lessons.length).padStart(2, '0')}`;
  $('#previous-lesson').disabled = index === 0; $('#next-lesson').disabled = index === lessons.length - 1;
  armReveals($('#lesson'));
  if (motionSwap) swapSection($('#lesson'));
  try { localStorage.setItem('smm-school-lesson', lesson.id); } catch {}
  history.replaceState(null, '', `#lesson-${lesson.id}`);
  setAnnouncement(`Выбран ${lesson.title}. ${hasMaterials ? 'Материалы доступны.' : 'Материалы готовятся.'}`);
  if (scroll) $('#lesson').scrollIntoView({behavior: 'smooth'});
}
function fileWord(n) { return n % 10 === 1 && n % 100 !== 11 ? 'файл' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'файла' : 'файлов'; }
function fileList(resources) {
  const list = node('div', 'file-list');
  for (const resource of resources) {
    const card = node('article', 'file-card'), info = node('div', 'file-title'), copy = node('div'), actions = node('div', 'file-actions');
    copy.append(node('h4', '', resource.title || resource.filename || 'Материал урока'), node('p', '', [resource.format, resource.size, resource.description].filter(Boolean).join(' · ')));
    info.append(node('span', 'file-type', resource.format || 'ФАЙЛ'), copy);
    const view = node('button', 'button small', 'Предпросмотр ↗'); view.type = 'button';
    view.addEventListener('click', () => openPreview(resource));
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
async function openPreview(resource) {
  const dialog = $('#preview-dialog'), container = $('#preview-content');
  for (const viewer of modalViewers.splice(0)) viewer.destroy();
  container.replaceChildren(); $('#preview-title').textContent = resource.title || 'Материал урока'; downloadLink($('#preview-download'), resource);
  dialog.showModal(); document.body.classList.add('no-scroll');
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
    this.root = node('div', 'pdf-viewer'); this.stage = node('div', 'pdf-stage'); this.stage.append(node('div', 'viewer-loading', 'Открываем документ…'));
    this.canvas = node('canvas'); this.canvas.setAttribute('role', 'img');
    this.controls = node('div', 'pdf-controls'); const navigation = node('div'), tools = node('div');
    this.previous = node('button', '', '←'); this.previous.setAttribute('aria-label', 'Предыдущая страница');
    this.next = node('button', '', '→'); this.next.setAttribute('aria-label', 'Следующая страница'); this.label = node('span', '', '— / —'); this.label.setAttribute('aria-live', 'polite');
    for (const b of [this.previous,this.next]) { b.type = 'button'; b.disabled = true; }
    this.previous.addEventListener('click', () => this.go(this.page - 1)); this.next.addEventListener('click', () => this.go(this.page + 1));
    navigation.append(this.previous, this.label, this.next);
    this.zoom = node('select'); this.zoom.setAttribute('aria-label', 'Масштаб документа');
    for (const [value,text] of [['1','По ширине'],['1.25','125%'],['1.5','150%'],['2','200%']]) { const o = node('option', '', text); o.value = value; this.zoom.append(o); }
    this.zoom.addEventListener('change', () => { this.scale = Number(this.zoom.value); this.stage.style.touchAction = this.scale > 1 ? 'auto' : 'pan-y'; this.render(); });
    const expand = node('button', '', '↗'); expand.type = 'button'; expand.setAttribute('aria-label', 'Открыть документ в большом окне'); expand.addEventListener('click', () => openPreview(this.resource));
    tools.append(this.zoom); if (container.closest('#preview-dialog') == null) tools.append(expand);
    this.controls.append(navigation, tools); this.root.append(this.stage, this.controls); container.append(this.root);
    bindSwipe(this.stage, delta => { if (this.scale > 1) return; this.go(this.page + delta); });
    this.stage.style.touchAction = 'pan-y';
    this.resize = new ResizeObserver(() => { if (this.pdf && !this.dead) { clearTimeout(this.resizeTimer); this.resizeTimer = setTimeout(() => this.render(), 120); } }); this.resize.observe(container);
  }
  async load() {
    try {
      if (!pdfModule) pdfModule = import('./assets/pdf.mjs'); const pdfjs = await pdfModule;
      if (this.dead || !this.alive()) return;
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('./assets/pdf.worker.mjs', import.meta.url).href;
      this.task = pdfjs.getDocument({url:safeUrl(this.resource.preview.url),standardFontDataUrl:new URL('./assets/standard_fonts/',import.meta.url).href,isEvalSupported:false,disableRange:true,disableStream:true,disableAutoFetch:false});
      this.pdf = await this.task.promise; if (this.dead || !this.alive()) return;
      if (!reduceMotion) this.canvas.classList.add('is-fading');
      this.stage.replaceChildren(this.canvas); await this.render();
    } catch { if (!this.dead && this.alive()) previewError(this.container, 'Не удалось открыть документ. Попробуйте скачать исходный файл.', this.resource); }
  }
  go(page) { if (!this.pdf || page < 1 || page > this.pdf.numPages || this.dead) return; this.page = page; this.fadePage = !reduceMotion; this.render(); }
  async render() {
    if (!this.pdf || this.dead || !this.alive()) return;
    const id = ++this.renderId; this.renderTask?.cancel();
    this.previous.disabled = this.page <= 1; this.next.disabled = this.page >= this.pdf.numPages;
    this.label.textContent = `${this.page} / ${this.pdf.numPages}`; this.canvas.setAttribute('aria-label', `${this.resource.title || 'Документ'} — страница ${this.page} из ${this.pdf.numPages}`);
    const fade = this.fadePage; this.fadePage = false;
    if (fade) {
      this.canvas.classList.add('is-fading');
      await new Promise(resolve => { this.fadeTimer = setTimeout(resolve, 200); });
      if (id !== this.renderId || this.dead || !this.alive()) return;
    }
    try {
      const page = await this.pdf.getPage(this.page); if (id !== this.renderId || this.dead || !this.alive()) return;
      const viewport = page.getViewport({scale:1}), width = Math.max(200, this.stage.clientWidth - (innerWidth < 760 ? 20 : 40));
      const cssScale = width / viewport.width * this.scale, ratio = Math.min(devicePixelRatio || 1, 2);
      const view = page.getViewport({scale:cssScale * ratio}); this.canvas.width = Math.round(view.width); this.canvas.height = Math.round(view.height);
      this.canvas.style.width = `${view.width / ratio}px`; this.canvas.style.maxWidth = this.scale > 1 ? 'none' : '100%';
      this.renderTask = page.render({canvasContext:this.canvas.getContext('2d'),viewport:view}); await this.renderTask.promise;
      if (id === this.renderId && !this.dead) this.canvas.classList.remove('is-fading');
    } catch(error) { if (error?.name !== 'RenderingCancelledException' && id === this.renderId && !this.dead && this.alive()) previewError(this.container, 'Не удалось показать страницу. Исходный файл доступен для скачивания.', this.resource); }
  }
  destroy() { this.dead = true; this.renderId++; clearTimeout(this.resizeTimer); clearTimeout(this.fadeTimer); this.resize.disconnect(); this.renderTask?.cancel(); this.task?.destroy().catch(() => {}); }
}
class ImageViewer {
  constructor(container, resource, alive) {
    this.resource = resource; this.alive = alive; this.page = 0; this.dead = false; this.nav = 0;
    const root = node('div', 'pdf-viewer gallery-viewer'), stage = node('div', 'pdf-stage'), controls = node('div', 'pdf-controls'), navigation = node('div'), tools = node('div');
    this.frame = node('div', 'slide-frame');
    this.skeleton = node('div', 'slide-skeleton');
    this.skeleton.append(node('span', 'sr-only', 'Открываем страницу…'));
    this.slots = [0, 1].map(() => { const img = node('img', 'gallery-image'); img.alt = ''; img.decoding = 'async'; img.setAttribute('aria-hidden', 'true'); return img; });
    this.slot = 0;
    this.frame.append(this.skeleton, ...this.slots);
    stage.append(this.frame);
    this.previous = node('button', '', '←'); this.previous.type = 'button'; this.previous.setAttribute('aria-label', 'Предыдущая страница');
    this.next = node('button', '', '→'); this.next.type = 'button'; this.next.setAttribute('aria-label', 'Следующая страница');
    this.label = node('span'); this.label.setAttribute('aria-live', 'polite');
    this.previous.addEventListener('click', () => this.go(this.page - 1));
    this.next.addEventListener('click', () => this.go(this.page + 1));
    navigation.append(this.previous, this.label, this.next);
    if (!container.closest('#preview-dialog')) {
      const expand = node('button', '', '↗'); expand.type = 'button';
      expand.setAttribute('aria-label', 'Открыть документ в большом окне');
      expand.addEventListener('click', () => openPreview(resource));
      tools.append(expand);
    }
    controls.append(navigation, tools); root.append(stage, controls); container.append(root);
    bindSwipe(stage, delta => this.go(this.page + delta));
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
    incoming.dataset.wave = String(token);
    incoming.alt = caption;
    incoming.onerror = () => { if (token === this.nav && !this.dead && this.alive()) previewError(container, 'Не удалось открыть страницу. Исходный файл можно скачать.', this.resource); };
    const reveal = () => {
      if (token !== this.nav || this.dead || incoming.dataset.shown === String(token)) return;
      incoming.dataset.shown = String(token);
      incoming.removeAttribute('aria-hidden');
      if (!reduceMotion && incoming !== outgoing) {
        outgoing.style.setProperty('--slide-x', `${-dir * 16}px`);
        outgoing.classList.remove('is-shown');
        outgoing.setAttribute('aria-hidden', 'true');
        const stale = outgoing;
        const clear = () => { if (stale.dataset.wave !== String(token)) return; stale.removeAttribute('src'); stale.alt = ''; };
        stale.addEventListener('transitionend', event => { if (event.propertyName === 'opacity') clear(); }, { once: true });
        setTimeout(clear, 420);
        this.slot = this.slots.indexOf(incoming);
      }
      const show = () => { if (token === this.nav && !this.dead) { incoming.classList.add('is-shown'); this.hideSkeleton(); } };
      if (reduceMotion) { show(); return; }
      incoming.style.setProperty('--slide-x', first ? '0px' : `${dir * 16}px`);
      incoming.classList.remove('is-shown');
      requestAnimationFrame(() => requestAnimationFrame(show));
    };
    incoming.onload = () => { incoming.onload = null; reveal(); };
    incoming.src = url;
    if (incoming.complete && incoming.naturalWidth) reveal();
  }
  destroy() { this.dead = true; this.nav++; for (const img of this.slots) { img.onload = null; img.onerror = null; img.removeAttribute('src'); } }
}
$('#previous-lesson').addEventListener('click', () => selectLesson(current - 1, true));
$('#next-lesson').addEventListener('click', () => selectLesson(current + 1, true));
const sectionObserver = new IntersectionObserver(entries => {
  const visible = entries.filter(e => e.isIntersecting).sort((a,b) => a.boundingClientRect.top - b.boundingClientRect.top);
  if (!visible.length) return; const id = visible[0].target.id;
  for (const a of document.querySelectorAll('.outline nav a')) a.classList.toggle('active', a.getAttribute('href') === `#${id}`);
}, {rootMargin:'-95px 0px -55% 0px',threshold:0});
for (const section of document.querySelectorAll('.resource-section')) sectionObserver.observe(section);
try {
  const identity=await fetch('/api/session');if(!identity.ok)throw new Error();const account=(await identity.json()).user;const role=account.role==='teacher'?'Преподаватель':'Ученик';$('#account-name').textContent=account.name===role?role:`${account.name} · ${role}`;if(account.role==='teacher'){const cab=document.createElement('a');cab.className='help-button';cab.href='./admin.html';cab.textContent='Кабинет';$('#account-name').after(cab);}if(Array.isArray(account.roles)){const label=r=>r==='teacher'?'Преподаватель':r==='student'?'Ученик':r;const sel=document.createElement('select');sel.id='role-switch';sel.setAttribute('aria-label','Роль');sel.style.cssText='font-size:10px;background:#1e211c;color:#c4d5eb;border:1px solid #44443b;border-radius:6px;padding:4px';for(const r of account.roles){const o=document.createElement('option');o.value=r;o.textContent='Роль: '+label(r);o.selected=r===account.role;sel.append(o);}sel.addEventListener('change',async()=>{const res=await fetch('/api/role',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role:sel.value})});if(res.ok){try{localStorage.setItem('smm-role',sel.value);}catch{}location.reload();}});$('#account-name').after(sel);}
  const response = await fetch('/api/lessons'); if (!response.ok) throw new Error();
  const data = await response.json(); lessons = data.lessons;
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
} catch { $('#lesson').replaceChildren(node('div', 'loading-error', 'Не удалось загрузить каталог уроков. Обновите страницу, чтобы повторить попытку.')); }

const __loaded=Date.now();document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&Date.now()-__loaded>50*60000)location.reload();});
