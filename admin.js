import { API, getToken, clearToken } from './auth.js?v=20261026a';
import { showNews } from './news.js?v=20261026a';
import { docxToSections, linesFromSections } from './docx.js';
import { pdfToWebpBlobs, textToWebpBlobs } from './previews.js';
import { packLessonHtml } from './htmlpack.js';

const $ = (selector, root = document) => root.querySelector(selector);
const node = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text != null) el.textContent = text; return el; };
const screen = $('#screen');
const state = { revision: 1, lessons: [], people: [], notice: '', editing: null, busy: false, me: '', userForm: null, userQuery: '', userRole: 'all', userStatus: 'all', userLesson: '', period: '30', pending: 0, stats: null, resets: [] };

const localApi = () => location.hostname === 'localhost' || location.hostname === '127.0.0.1';
const apiBase = () => localApi() ? '' : API;

function say(text) { $('#live').textContent = text || ''; }
function showToast(message, announce = true) {
  if (!message) return;
  if (announce) say(message);
  for (const old of document.querySelectorAll('.toast')) old.remove();
  const el = node('div', 'toast', message);
  el.setAttribute('role', 'status');
  document.body.append(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('is-in')));
  const close = () => { el.classList.remove('is-in'); setTimeout(() => el.remove(), 320); };
  el.addEventListener('click', close);
  setTimeout(close, 4200);
}
async function api(path, { method = 'GET', body } = {}) {
  const headers = new Headers();
  const token = getToken();
  if (token) headers.set('X-School-Token', token);
  try { const role = localStorage.getItem('smm-role'); if (role) headers.set('X-School-Role', role); } catch {}
  if (body != null) headers.set('Content-Type', 'application/json');
  const response = await fetch(apiBase() + path, { method, headers, body: body != null ? JSON.stringify(body) : undefined, credentials: token ? 'omit' : 'same-origin' });
  if (response.status === 401) { let expired = false; try { expired = (await response.clone().json()).code === 'access_expired'; } catch {} clearToken(); location.replace(expired ? './login.html?expired=1' : './login.html'); throw new Error('Нужно войти снова.'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || 'Не удалось выполнить запрос. Попробуйте ещё раз.'), { status: response.status });
  return data;
}
const PART_SIZE = 16 * 1024 * 1024;
const MULTIPART_FROM = 32 * 1024 * 1024;
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1048576) return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1).replace('.', ',')} МБ`;
  return `${(bytes / 1073741824).toFixed(1).replace('.', ',')} ГБ`;
}
function extOf(name) { return (String(name).split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function putFile(ticket, blob, onProgress) {
  const url = ticket.via === 'put' ? ticket.url : apiBase() + ticket.uploadPath;
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', ticket.contentType);
    const token = getToken();
    if (ticket.via !== 'put' && token) xhr.setRequestHeader('X-School-Token', token);
    try { const role = localStorage.getItem('smm-role'); if (ticket.via !== 'put' && role) xhr.setRequestHeader('X-School-Role', role); } catch {}
    xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress?.(event.loaded / event.total); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('Файл не загрузился. Проверьте интернет и нажмите сохранить ещё раз.')));
    xhr.onerror = () => reject(new Error('Нет связи с хранилищем. Проверьте интернет и повторите.'));
    xhr.send(blob);
  });
}
async function upload(lessonId, slot, blob, name, extra, onProgress) {
  if (slot === 'video' && blob.size >= MULTIPART_FROM) return uploadMultipart(lessonId, blob, name, extra, onProgress);
  const ticket = await api('/api/admin/upload-url', { method: 'POST', body: { lessonId, slot, ext: extOf(name), size: blob.size, ...extra } });
  await putFile(ticket, blob, onProgress);
  return ticket;
}
function putPart(url, blob, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress?.(event.loaded, event.total); };
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) { reject(new Error('Часть видео не загрузилась. Проверьте интернет и сохраните ещё раз.')); return; }
      const etag = xhr.getResponseHeader('ETag');
      if (!etag) reject(new Error('Хранилище не подтвердило часть файла. В CORS бакета должен быть открыт заголовок ETag.'));
      else resolve(etag);
    };
    xhr.onerror = () => reject(new Error('Нет связи с хранилищем. Проверьте интернет и повторите.'));
    xhr.send(blob);
  });
}
async function uploadMultipart(lessonId, blob, name, extra, onProgress) {
  const storeKey = `smm-video:${lessonId}:${extra.index || 0}:${blob.size}:${blob.lastModified || 0}:${blob.name}`;
  let hadResume = false;
  try { hadResume = Boolean(JSON.parse(sessionStorage.getItem(storeKey) || 'null')?.uploadId); } catch {}
  try { return await sendMultipart(storeKey, lessonId, blob, name, extra, onProgress); }
  catch (error) {
    if (!hadResume) throw error;
    try {
      const old = JSON.parse(sessionStorage.getItem(storeKey) || 'null');
      if (old?.uploadId && old?.key) await api('/api/admin/upload-multipart/abort', { method: 'POST', body: { key: old.key, uploadId: old.uploadId } });
    } catch {}
    try { sessionStorage.removeItem(storeKey); } catch {}
    return sendMultipart(storeKey, lessonId, blob, name, extra, onProgress);
  }
}
async function sendMultipart(storeKey, lessonId, blob, name, extra, onProgress) {
  let session = null;
  try { session = JSON.parse(sessionStorage.getItem(storeKey) || 'null'); } catch {}
  if (!session?.uploadId || !session.key) {
    session = await api('/api/admin/upload-multipart', { method: 'POST', body: { lessonId, slot: 'video', ext: extOf(name), size: blob.size, ...extra } });
    session.done = {};
  }
  const partSize = session.partSize || PART_SIZE;
  const partCount = session.partCount || Math.ceil(blob.size / partSize);
  const done = { ...(session.done || {}) };
  let listed = { uploaded: [] };
  try { listed = await api('/api/admin/upload-parts', { method: 'POST', body: { key: session.key, uploadId: session.uploadId, size: blob.size, partNumbers: [], list: true } }); }
  catch { listed = { uploaded: [] }; }
  for (const part of listed.uploaded || []) done[part.partNumber] = part.etag;
  const loaded = new Array(partCount + 1).fill(0);
  for (let n = 1; n <= partCount; n++) if (done[n]) loaded[n] = Math.min(partSize, blob.size - (n - 1) * partSize);
  const report = () => onProgress?.(loaded.reduce((sum, value) => sum + value, 0) / blob.size);
  report();
  const queue = [];
  for (let n = 1; n <= partCount; n++) if (!done[n]) queue.push(n);
  const persist = () => { try { sessionStorage.setItem(storeKey, JSON.stringify({ uploadId: session.uploadId, key: session.key, path: session.path, contentType: session.contentType, partSize, partCount, done })); } catch {} };
  persist();
  const worker = async () => {
    while (queue.length) {
      const partNumber = queue.shift();
      const start = (partNumber - 1) * partSize;
      const chunk = blob.slice(start, Math.min(start + partSize, blob.size));
      let etag = null; let error;
      for (let attempt = 0; attempt < 3 && !etag; attempt++) {
        try {
          const signed = await api('/api/admin/upload-parts', { method: 'POST', body: { key: session.key, uploadId: session.uploadId, size: blob.size, partNumbers: [partNumber] } });
          const url = signed.parts?.find(part => part.partNumber === partNumber)?.url;
          if (!url) throw new Error('Нет ссылки для части видео.');
          etag = await putPart(url, chunk, got => { loaded[partNumber] = got; report(); });
        } catch (err) { error = err; await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1))); }
      }
      if (!etag) throw error || new Error('Часть видео не загрузилась.');
      done[partNumber] = etag; loaded[partNumber] = chunk.size; report(); persist();
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, Math.max(1, queue.length)) }, worker));
  await api('/api/admin/upload-multipart/complete', { method: 'POST', body: { key: session.key, uploadId: session.uploadId, size: blob.size, parts: Object.entries(done).map(([partNumber, etag]) => ({ partNumber: Number(partNumber), etag })) } });
  try { sessionStorage.removeItem(storeKey); } catch {}
  return { key: session.key, path: session.path || `/${session.key}`, contentType: session.contentType || 'video/mp4' };
}
function resourceFrom(ticket, file, extra = {}) {
  return { title: extra.title, format: extOf(file.name).toUpperCase(), size: formatSize(file.size), filename: file.name, download: ticket.path, ...extra.fields };
}

$('#logout').addEventListener('click', async () => {
  try { await api('/api/logout', { method: 'POST', body: {} }); } catch {}
  clearToken(); location.replace('./login.html');
});

function denied(message) {
  screen.replaceChildren(node('section', 'denied'));
  const box = screen.firstChild;
  box.append(node('div', 'eyebrow', 'ДОСТУП ЗАКРЫТ'), node('h1', '', 'Кабинет только для преподавателя'), node('p', 'lead', message), node('a', 'primary', 'Вернуться в архив'));
  box.querySelector('a').href = './';
}
function setBusy(on) { state.busy = on; for (const button of screen.querySelectorAll('button')) button.disabled = on || button.dataset.keep === 'off'; }

async function boot() {
  if (!getToken() && !localApi()) { location.replace('./login.html'); return; }
  try {
    const session = await api('/api/session');
    const user = session.user;
    state.me = String(user.login || '').toLowerCase();
    $('#who').textContent = user.name || '';
    setTimeout(() => showNews(user), 600);
    if (user.role !== 'teacher') { denied(user.roles?.includes('teacher') ? 'Сейчас включена роль ученика. В архиве переключитесь на «Преподаватель» и откройте кабинет снова.' : 'Этот вход — ученический. Кабинет открывается только преподавателю.'); return; }
    const [catalog, accounts, resets] = await Promise.all([
      api('/api/admin/lessons'),
      api('/api/admin/accounts'),
      api('/api/admin/resets').catch(() => ({ pending: 0, requests: [] })),
    ]);
    state.revision = catalog.revision; state.lessons = catalog.lessons; state.people = accounts.accounts;
    state.pending = Number(resets.pending) || 0; state.resets = resets.requests || [];
    if (location.hash === '#users') await openUsers();
    else if (location.hash === '#stats') await openStats();
    else renderList();
  } catch (error) { denied(error.message || 'Не удалось открыть кабинет.'); }
}

function tabs(active) {
  const nav = node('div', 'tabs');
  nav.setAttribute('role', 'tablist');
  nav.setAttribute('aria-label', 'Разделы кабинета');
  const lessons = node('button', 'tab', 'Уроки');
  lessons.type = 'button';
  lessons.setAttribute('role', 'tab');
  lessons.setAttribute('aria-selected', active === 'lessons' ? 'true' : 'false');
  lessons.addEventListener('click', () => { if (active !== 'lessons') showLessons(); });
  const users = node('button', 'tab', 'Пользователи');
  users.type = 'button';
  users.id = 'tab-users';
  users.setAttribute('role', 'tab');
  users.setAttribute('aria-selected', active === 'users' ? 'true' : 'false');
  users.addEventListener('click', () => { if (active !== 'users') openUsers(); });
  const stats = node('button', 'tab');
  stats.type = 'button';
  stats.id = 'tab-stats';
  stats.setAttribute('role', 'tab');
  stats.setAttribute('aria-selected', active === 'stats' ? 'true' : 'false');
  stats.append(document.createTextNode('Статистика'));
  if (state.pending > 0) {
    const badge = node('span', 'tab-badge', state.pending > 99 ? '99+' : String(state.pending));
    badge.setAttribute('aria-label', `${state.pending} заявок на сброс пароля`);
    stats.append(badge);
  }
  stats.addEventListener('click', () => { if (active !== 'stats') openStats(); });
  nav.append(lessons, users, stats);
  return nav;
}
async function showLessons() {
  state.editing = null;
  state.userForm = null;
  if (location.hash !== '#lessons') location.hash = 'lessons';
  try { state.people = (await api('/api/admin/accounts')).accounts; } catch (error) { state.notice = error.message; }
  try { state.pending = Number((await api('/api/admin/resets')).pending) || 0; } catch {}
  renderList();
}
function renderList() {
  screen.replaceChildren();
  screen.append(tabs('lessons'));
  const head = node('div', 'page-head');
  const copy = node('div');
  copy.append(node('div', 'eyebrow', 'ШТАБ / УРОКИ'), node('h1', '', 'Уроки школы'), node('p', 'lead', 'Создайте урок, приложите файлы и опубликуйте, когда всё готово. Черновик видите только вы.'));
  const add = node('button', 'primary', 'Новый урок'); add.type = 'button'; add.addEventListener('click', () => openEditor(blank()));
  head.append(copy, add); screen.append(head);
  if (state.notice) { const text = state.notice; state.notice = ''; showToast(text); }
  if (!state.lessons.length) {
    const empty = node('div', 'empty'); empty.append(node('h2', '', 'Пока нет уроков'), node('p', '', 'Нажмите «Новый урок», чтобы собрать первое досье.')); screen.append(empty); return;
  }
  const list = node('div', 'list');
  state.lessons.forEach((lesson, index) => list.append(row(lesson, index)));
  screen.append(list);
}
function moveButton(direction) {
  const up = direction < 0;
  const button = node('button', 'arrow', up ? '↑' : '↓');
  button.type = 'button';
  button.setAttribute('aria-label', up ? 'Выше' : 'Ниже');
  button.title = up ? 'Выше' : 'Ниже';
  return button;
}
function row(lesson, index) {
  const article = node('article', 'row');
  article.append(node('div', 'num', lesson.number));
  const copy = node('div');
  copy.append(node('h2', '', lesson.title || 'Без названия'));
  if (lesson.description) copy.append(node('p', '', lesson.description));
  const meta = node('div', 'meta');
  meta.append(node('span', lesson.status === 'published' ? 'badge live' : 'badge draft', lesson.status === 'published' ? 'Ученики видят' : 'Черновик'));
  meta.append(node('span', 'badge quiet', lesson.access?.mode === 'logins' ? `Только выбранные · ${lesson.access.logins.length}` : 'Все ученики'));
  copy.append(meta);
  const actions = node('div', 'actions');
  const edit = node('button', '', 'Изменить'); edit.type = 'button'; edit.addEventListener('click', () => openEditor(fromLesson(lesson)));
  const up = moveButton(-1); up.disabled = index === 0; up.addEventListener('click', () => move(index, -1));
  const down = moveButton(1); down.disabled = index === state.lessons.length - 1; down.addEventListener('click', () => move(index, 1));
  const remove = node('button', 'danger', 'Удалить'); remove.type = 'button'; remove.addEventListener('click', () => confirmDelete(lesson));
  actions.append(edit, up, down, remove); article.append(copy, actions); return article;
}
async function move(index, delta) {
  const ids = state.lessons.map(lesson => lesson.id);
  const next = index + delta; if (next < 0 || next >= ids.length) return;
  [ids[index], ids[next]] = [ids[next], ids[index]];
  try {
    const data = await api('/api/admin/lessons/reorder', { method: 'POST', body: { ids, revision: state.revision } });
    state.revision = data.revision; state.lessons = data.lessons; say('Порядок уроков сохранён.'); renderList();
  } catch (error) { state.notice = error.message; renderList(); }
}
function confirmDelete(lesson) {
  const dialog = $('#delete-dialog');
  $('#delete-heading').textContent = `Удалить урок «${lesson.title || lesson.number}»?`;
  const confirm = $('#delete-confirm'), cancel = $('#delete-cancel');
  const close = () => { dialog.close(); confirm.removeEventListener('click', go); cancel.removeEventListener('click', close); };
  const go = async () => {
    confirm.disabled = true;
    try {
      const data = await api(`/api/admin/lessons/${lesson.id}`, { method: 'DELETE', body: { revision: state.revision } });
      state.revision = data.revision; state.lessons = state.lessons.filter(item => item.id !== lesson.id); state.editing = null;
      state.notice = 'Урок удалён.'; close(); renderList();
    } catch (error) { confirm.disabled = false; $('#delete-copy').textContent = error.message; }
  };
  confirm.addEventListener('click', go); cancel.addEventListener('click', close); dialog.showModal();
}

function blank() {
  const numbers = state.lessons.map(lesson => Number(lesson.number)).filter(number => Number.isInteger(number));
  return { id: null, number: String((numbers.length ? Math.max(...numbers) : 0) + 1).padStart(2, '0'), title: '', description: '', status: 'draft', accessMode: 'all', logins: new Set(), pdfFile: null, pptxFile: null, presentation: null, clearPresentation: false, lectureFile: null, lecture: null, lectureNote: '', clearLecture: false, workbookFile: null, workbook: null, clearWorkbook: false, materials: [], pages: [], videos: [], sectionOrder: SECTION_KEYS.slice() };
}
function fromLesson(lesson) {
  const draft = blank();
  Object.assign(draft, { id: lesson.id, number: lesson.number, title: lesson.title, description: lesson.description || '', status: lesson.status, accessMode: lesson.access?.mode === 'logins' ? 'logins' : 'all', logins: new Set(lesson.access?.logins || []), presentation: lesson.presentation || null, lecture: lesson.lecture || null, workbook: lesson.workbook || null, materials: (lesson.materials || []).filter(item => !String(item.download || '').endsWith('/presentation.pptx')).map(item => ({ title: item.title || '', resource: item, file: null })) });
  const pptxExtra = (lesson.materials || []).find(item => String(item.download || '').endsWith('/presentation.pptx'));
  draft.pptxKept = pptxExtra || ((lesson.presentation?.download || '').endsWith('.pptx') ? lesson.presentation : null);
  if ((lesson.presentation?.download || '').endsWith('.pptx')) draft.presentation = lesson.presentation;
  draft.sectionOrder = normalizeSectionOrder(lesson.sectionOrder);
  draft.pages = (lesson.pages || []).map(item => ({ title: item.title || '', resource: item, file: null }));
  draft.videos = (lesson.videos || []).map(item => ({ title: item.title || '', resource: item, file: null, posterFile: null, link: item.embedUrl || '' }));
  return draft;
}
function openEditor(draft) { state.editing = draft; renderEditor(); }

function renderEditor() {
  const draft = state.editing;
  screen.replaceChildren();
  screen.append(tabs('lessons'));
  const back = node('button', 'back', '← К списку уроков'); back.type = 'button'; back.addEventListener('click', () => { state.editing = null; renderList(); });
  const layout = node('div', 'editor');
  const form = node('form'); form.id = 'lesson-form'; form.noValidate = true;
  form.append(node('div', 'eyebrow', draft.id ? `УРОК ${draft.number}` : 'НОВЫЙ УРОК'), node('h1', '', draft.id ? (draft.title || 'Урок') : 'Новый урок'));
  form.append(field('Номер', 'number', draft.number, '04'));
  form.append(field('Название', 'title', draft.title, 'Например: Контент-план на месяц'));
  form.append(area('Коротко, о чём урок', 'description', draft.description, 'Одно-два предложения. Ученик увидит их под названием.'));
  form.append(accessBlock(draft));
  form.append(sectionsBlock(draft));
  const status = node('p', 'status'); status.id = 'save-status';
  const bar = node('div', 'progress'); bar.hidden = true; bar.append(node('span')); bar.id = 'save-bar';
  const error = node('div', 'error'); error.hidden = true; error.id = 'save-error';
  const barButtons = node('div', 'savebar');
  const draftButton = node('button', 'secondary', draft.status === 'published' ? 'Скрыть от учеников' : 'Сохранить черновик');
  draftButton.type = 'submit'; draftButton.dataset.status = 'draft';
  const publish = node('button', 'primary', draft.status === 'published' ? 'Сохранить' : 'Опубликовать');
  publish.type = 'submit'; publish.dataset.status = 'published';
  barButtons.append(draftButton, publish);
  if (draft.id) { const remove = node('button', 'danger', 'Удалить урок'); remove.type = 'button'; remove.addEventListener('click', () => confirmDelete(state.lessons.find(lesson => lesson.id === draft.id) || draft)); barButtons.append(remove); }
  form.append(bar, status, error, barButtons);
  form.addEventListener('submit', event => { event.preventDefault(); save(event.submitter?.dataset.status || 'draft'); });
  const side = node('aside', 'side');
  side.append(node('h3', '', 'Как это работает'), node('ol'));
  const steps = ['Номер и название видят ученики в списке уроков.', 'PDF презентации превращается в картинки слайдов. PowerPoint — только для скачивания.', 'Видео лучше загружать как MP4 (H.264). Ссылку YouTube, VK, Rutube, Дзен, Vimeo, Kinescope и других плееров можно вставить без файла.', 'HTML-страница открывается у ученика прямо в уроке. ZIP с index.html соберётся в одну страницу.', 'Черновик не виден ученикам. «Опубликовать» открывает урок сразу.', 'Большое видео грузится частями напрямую в хранилище, с полоской загрузки.'];
  for (const step of steps) side.querySelector('ol').append(node('li', '', step));
  layout.append(form, side); screen.append(back, layout); form.querySelector('[name=title]').focus();
}
function field(label, name, value, placeholder) {
  const wrap = node('label', 'field'); wrap.append(node('span', '', label.toUpperCase()));
  const input = node('input'); input.type = 'text'; input.name = name; input.value = value || ''; input.placeholder = placeholder; input.maxLength = name === 'number' ? 4 : 200; wrap.append(input); return wrap;
}
function area(label, name, value, placeholder) {
  const wrap = node('label', 'field'); wrap.append(node('span', '', label.toUpperCase()));
  const input = node('textarea'); input.name = name; input.value = value || ''; input.placeholder = placeholder; input.maxLength = 600; wrap.append(input); return wrap;
}
function accessBlock(draft) {
  const card = node('section', 'card'); card.append(node('h3', '', 'Кому виден урок'), node('p', 'hint', 'Можно открыть всем ученикам или только нескольким логинам.'));
  const choices = node('fieldset', 'choices'); const legend = node('legend', 'sr-only', 'Кому виден урок'); choices.append(legend);
  for (const [value, title, note] of [['all', 'Всем ученикам', 'Каждый, кому открыт архив'], ['logins', 'Только выбранным', 'Отметьте логины ниже']]) {
    const label = node('label', 'choice'); const input = node('input'); input.type = 'radio'; input.name = 'access'; input.value = value; input.checked = draft.accessMode === value;
    const text = node('span'); text.append(node('b', '', title), node('small', '', note)); label.append(input, text); choices.append(label);
  }
  const people = node('div', 'people'); people.id = 'people';
  const students = state.people.filter(person => person.role !== 'teacher' && !person.roles?.includes('teacher') && !person.disabled);
  if (!students.length) people.append(node('p', 'hint', 'В списке пока нет учеников. Можно открыть урок всем.'));
  for (const person of students) {
    const label = node('label', 'person'); const input = node('input'); input.type = 'checkbox'; input.value = person.login; input.checked = draft.logins.has(person.login);
    label.append(input, node('span', '', `${person.name} · ${person.login}`)); people.append(label);
  }
  choices.addEventListener('change', () => { people.hidden = formAccess() !== 'logins'; });
  people.hidden = draft.accessMode !== 'logins';
  card.append(choices, people); return card;
}
function formAccess() { return screen.querySelector('input[name=access]:checked')?.value || 'all'; }
const SECTION_KEYS = ['presentation', 'lecture', 'videos', 'pages', 'materials', 'workbook'];
const SECTION_NAMES = { presentation: 'Презентация', lecture: 'Лекция', videos: 'Видео', pages: 'HTML-страница', materials: 'Дополнительные материалы', workbook: 'Методичка' };
function normalizeSectionOrder(value) {
  const list = Array.isArray(value) ? value.filter((key, i) => SECTION_KEYS.includes(key) && value.indexOf(key) === i) : [];
  return [...list, ...SECTION_KEYS.filter(key => !list.includes(key))];
}
function isDefaultSectionOrder(order) { return order.every((key, i) => key === SECTION_KEYS[i]); }
const SECTION_BUILDERS = { presentation: presentationBlock, lecture: lectureBlock, videos: videosBlock, pages: pagesBlock, materials: materialsBlock, workbook: workbookBlock };
function sectionsBlock(draft) {
  draft.sectionOrder = normalizeSectionOrder(draft.sectionOrder);
  const wrap = node('div', 'section-blocks'); wrap.id = 'section-blocks';
  const cards = {};
  for (const key of SECTION_KEYS) { const card = SECTION_BUILDERS[key](draft); card.dataset.section = key; card.classList.add('section-card'); cards[key] = card; }
  const paint = () => {
    draft.sectionOrder.forEach((key, index) => {
      const card = cards[key]; wrap.append(card);
      let bar = card.querySelector(':scope > .section-move');
      if (!bar) {
        bar = node('div', 'actions section-move');
        const handle = node('button', 'drag-handle', '⠿'); handle.type = 'button'; handle.title = 'Перетащить раздел';
        handle.setAttribute('aria-label', `Перетащить раздел «${SECTION_NAMES[key]}»`);
        const up = moveButton(-1), down = moveButton(1);
        up.classList.add('section-up'); down.classList.add('section-down');
        up.setAttribute('aria-label', `Раздел «${SECTION_NAMES[key]}» выше`); down.setAttribute('aria-label', `Раздел «${SECTION_NAMES[key]}» ниже`);
        up.addEventListener('click', () => moveSection(draft, key, -1, paint));
        down.addEventListener('click', () => moveSection(draft, key, 1, paint));
        bar.append(handle, up, down); card.prepend(bar);
        bindSectionDrag(wrap, card, handle, draft, paint);
      }
      bar.querySelector('.section-up').disabled = index === 0;
      bar.querySelector('.section-down').disabled = index === SECTION_KEYS.length - 1;
    });
  };
  paint();
  return wrap;
}
function moveSection(draft, key, delta, paint) {
  const from = draft.sectionOrder.indexOf(key), to = from + delta;
  if (from < 0 || to < 0 || to >= draft.sectionOrder.length) return;
  const previous = draft.sectionOrder.slice();
  draft.sectionOrder.splice(from, 1); draft.sectionOrder.splice(to, 0, key);
  paint(); say(`Раздел «${SECTION_NAMES[key]}» перемещён`);
  document.querySelector(`[data-section="${key}"] .section-${delta < 0 ? 'up' : 'down'}`)?.focus();
  void persistSectionOrder(draft, previous, paint);
}
function bindSectionDrag(wrap, card, handle, draft, paint) {
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    const pointer = event.pointerId, startY = event.clientY, origin = draft.sectionOrder.slice();
    let active = false;
    const onMove = ev => {
      if (ev.pointerId !== pointer) return;
      if (!active) { if (Math.abs(ev.clientY - startY) < 8) return; active = true; card.classList.add('is-dragging'); }
      ev.preventDefault();
      const rows = [...wrap.querySelectorAll(':scope > .section-card')], current = rows.indexOf(card);
      let target = rows.length - 1;
      for (let i = 0; i < rows.length; i++) { const box = rows[i].getBoundingClientRect(); if (ev.clientY < box.top + box.height / 2) { target = i; break; } }
      if (target === current) return;
      if (target > current) rows[target].after(card); else rows[target].before(card);
      draft.sectionOrder = [...wrap.querySelectorAll(':scope > .section-card')].map(el => el.dataset.section);
      const edge = ev.clientY < 60 ? -12 : ev.clientY > innerHeight - 60 ? 12 : 0; if (edge) scrollBy(0, edge);
    };
    const finish = ev => {
      if (ev.pointerId !== pointer) return;
      removeEventListener('pointermove', onMove); removeEventListener('pointerup', finish); removeEventListener('pointercancel', finish);
      card.classList.remove('is-dragging');
      if (!active || origin.every((key, i) => key === draft.sectionOrder[i])) return;
      paint(); say('Порядок разделов изменён');
      void persistSectionOrder(draft, origin, paint);
    };
    try { handle.setPointerCapture(pointer); } catch {}
    addEventListener('pointermove', onMove); addEventListener('pointerup', finish); addEventListener('pointercancel', finish);
  });
}
let sectionOrderChain = Promise.resolve();
function persistSectionOrder(draft, previous, paint) {
  if (!draft.id) return Promise.resolve();
  const intended = draft.sectionOrder.slice(), same = (a, b) => a.every((key, i) => key === b[i]);
  sectionOrderChain = sectionOrderChain.then(async () => {
    if (!same(draft.sectionOrder, intended)) return;
    try {
      const saved = await api(`/api/admin/lessons/${draft.id}`, { method: 'PUT', body: { sectionOrder: isDefaultSectionOrder(intended) ? null : intended, revision: state.revision } });
      state.revision = saved.revision;
      const cached = state.lessons.find(lesson => lesson.id === draft.id); if (cached) cached.sectionOrder = saved.lesson?.sectionOrder;
      showError('');
    } catch (error) {
      if (error.status === 409) { try { const fresh = await api(`/api/admin/lessons/${draft.id}`); state.revision = fresh.revision; } catch {} }
      if (!same(draft.sectionOrder, intended)) return;
      draft.sectionOrder = previous; paint(); showError(error.message);
    }
  });
  return sectionOrderChain;
}
function fileBlock(title, hint, body) { const card = node('section', 'card'); card.append(node('h3', '', title), node('p', 'hint', hint)); card.append(body); return card; }
function filePicker(label, accept, onPick) {
  const row = node('div', 'file-row');
  const name = node('div', 'file-name', 'Файл не выбран');
  const button = node('button', 'mini', label); button.type = 'button';
  const input = node('input'); input.type = 'file'; input.accept = accept; input.hidden = true;
  button.addEventListener('click', () => input.click());
  input.addEventListener('change', () => { const file = input.files?.[0] || null; name.textContent = file ? `${file.name} · ${formatSize(file.size)}` : 'Файл не выбран'; onPick(file); });
  row.append(name, button, input); return row;
}
function presentationBlock(draft) {
  const body = node('div');
  if (draft.presentation && !draft.clearPresentation) body.append(existingLine(draft.presentation, () => { draft.clearPresentation = true; draft.presentation = null; draft.pdfFile = null; draft.pptxFile = null; renderEditor(); }));
  body.append(node('p', 'hint', 'PDF — чтобы листать слайды на сайте.'), filePicker('Выбрать PDF', '.pdf,application/pdf', file => { draft.pdfFile = file; draft.clearPresentation = false; }));
  body.append(node('p', 'hint', 'PowerPoint — по желанию, ученики смогут его скачать. Без PDF слайды на сайте не листаются.'), filePicker('Выбрать PPTX', '.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation', file => { draft.pptxFile = file; }));
  return fileBlock('Презентация', 'Лучше всего загрузить PDF. Файл на 70–90 МБ загружается напрямую, с полоской прогресса.', body);
}
function lectureBlock(draft) {
  const body = node('div');
  if (draft.lecture && !draft.clearLecture) body.append(existingLine(draft.lecture, () => { draft.clearLecture = true; draft.lecture = null; draft.lectureFile = null; renderEditor(); }));
  const note = node('p', 'warn'); note.hidden = true;
  body.append(filePicker('Выбрать Word', '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document', async file => {
    draft.lectureFile = file; draft.clearLecture = false; note.hidden = true;
    if (!file) return;
    try { const parsed = await docxToSections(await file.arrayBuffer()); draft.lecturePreview = parsed; note.hidden = parsed.headingCount > 0; note.textContent = 'В документе нет стиля «Заголовок 1». На сайте лекция будет одним разделом. В Word выделите заголовки и выберите «Заголовок 1», если нужны разделы.'; }
    catch (error) { note.hidden = false; note.textContent = error.message; draft.lectureFile = null; }
  }), note);
  return fileBlock('Лекция', 'Документ Word. Заголовки в нём станут разделами, которые ученик читает на сайте.', body);
}
function workbookBlock(draft) {
  const body = node('div');
  if (draft.workbook && !draft.clearWorkbook) body.append(existingLine(draft.workbook, () => { draft.clearWorkbook = true; draft.workbook = null; draft.workbookFile = null; renderEditor(); }));
  body.append(filePicker('Выбрать файл', '.docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document', file => { draft.workbookFile = file; draft.clearWorkbook = false; }));
  return fileBlock('Методичка', 'Word или PDF. Из PDF получаются страницы как в оригинале. Из Word — аккуратные текстовые страницы.', body);
}
function videosBlock(draft) {
  const body = node('div');
  const render = () => {
    body.replaceChildren();
    if (!draft.videos.length) body.append(node('p', 'hint', 'Пока нет видео.'));
    draft.videos.forEach((item, index) => {
      const row = node('div', 'material');
      const title = node('input'); title.type = 'text'; title.value = item.title; title.placeholder = 'Как видео называется для ученика'; title.maxLength = 200;
      title.addEventListener('input', () => { item.title = title.value; });
      const controls = node('div', 'actions');
      const up = moveButton(-1); up.disabled = index === 0; up.addEventListener('click', () => { swap(draft.videos, index, index - 1); render(); });
      const down = moveButton(1); down.disabled = index === draft.videos.length - 1; down.addEventListener('click', () => { swap(draft.videos, index, index + 1); render(); });
      const remove = node('button', 'mini danger', 'Убрать'); remove.type = 'button'; remove.addEventListener('click', () => { draft.videos.splice(index, 1); render(); });
      controls.append(up, down, remove); row.append(title, controls); body.append(row);
      const note = item.file ? item.file.name : item.link ? item.link : (item.resource?.filename || item.resource?.embedUrl || 'Видео уже в уроке');
      body.append(node('div', 'file-name', note));
      if (!item.link && !item.resource?.embedUrl) {
        const poster = node('div', 'file-row');
        const posterName = node('div', 'file-name', item.posterFile ? `Обложка: ${item.posterFile.name}` : (item.resource?.poster ? 'Обложка уже есть' : 'Обложка не выбрана'));
        const posterButton = node('button', 'mini', 'Обложка'); posterButton.type = 'button';
        const posterInput = node('input'); posterInput.type = 'file'; posterInput.accept = '.webp,.png,.jpg,.jpeg,image/webp,image/png,image/jpeg'; posterInput.hidden = true;
        posterButton.addEventListener('click', () => posterInput.click());
        posterInput.addEventListener('change', () => { item.posterFile = posterInput.files?.[0] || null; posterName.textContent = item.posterFile ? `Обложка: ${item.posterFile.name}` : 'Обложка не выбрана'; });
        poster.append(posterName, posterButton, posterInput); body.append(poster);
      }
    });
    const add = node('button', 'mini', 'Добавить видео'); add.type = 'button';
    const input = node('input'); input.type = 'file'; input.hidden = true; input.accept = '.mp4,.webm,.mov,video/mp4,video/webm,video/quicktime';
    add.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
      const file = input.files?.[0]; if (!file) return;
      if (file.size > 2 * 1024 * 1024 * 1024) { showError('Видео больше 2 ГБ. Сожмите его или вставьте ссылку.'); return; }
      draft.videos.push({ title: file.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' '), file, posterFile: null, resource: null, link: '' });
      render();
    });
    const linkRow = node('div', 'file-row');
    const linkInput = node('input'); linkInput.type = 'url'; linkInput.placeholder = 'YouTube, VK, Rutube, Дзен, Kinescope…'; linkInput.setAttribute('aria-label', 'Ссылка на видео');
    const addLink = node('button', 'mini', 'Добавить ссылку'); addLink.type = 'button';
    addLink.addEventListener('click', () => {
      const link = linkInput.value.trim();
      if (!link) return;
      draft.videos.push({ title: 'Видео', file: null, posterFile: null, resource: null, link });
      linkInput.value = '';
      render();
    });
    linkRow.append(linkInput, addLink);
    body.append(add, input, linkRow);
  };
  render();
  return fileBlock('Видео', 'MP4 с кодеком H.264 открывается на телефонах. WebM и MOV тоже можно, но не везде. Файл больше 32 МБ загружается частями: если связь оборвётся, сохранение продолжит с той же части. Ссылку можно вставить без файла: плеер откроет YouTube, VK, Rutube, код встраивания Дзена, Vimeo, Loom, Google Диск, Kinescope, OK и публичный пост Telegram. Яндекс Диск, Кинопоиск и Boosty в страницу не встраиваются — ученик увидит кнопку «Открыть видео». Так же откроется любая другая https-ссылка.', body);
}
function pagesBlock(draft) {
  const body = node('div');
  const render = () => {
    body.replaceChildren();
    if (!draft.pages.length) body.append(node('p', 'hint', 'Пока нет HTML-страниц.'));
    draft.pages.forEach((item, index) => {
      const row = node('div', 'material');
      const title = node('input'); title.type = 'text'; title.value = item.title; title.placeholder = 'Как страница называется для ученика'; title.maxLength = 200;
      title.addEventListener('input', () => { item.title = title.value; });
      const controls = node('div', 'actions');
      const up = moveButton(-1); up.disabled = index === 0; up.addEventListener('click', () => { swap(draft.pages, index, index - 1); render(); });
      const down = moveButton(1); down.disabled = index === draft.pages.length - 1; down.addEventListener('click', () => { swap(draft.pages, index, index + 1); render(); });
      const remove = node('button', 'mini danger', 'Убрать'); remove.type = 'button'; remove.addEventListener('click', () => { draft.pages.splice(index, 1); render(); });
      controls.append(up, down, remove); row.append(title, controls); body.append(row);
      body.append(node('div', 'file-name', item.file ? item.file.name : (item.resource?.filename || 'Страница уже в уроке')));
    });
    const add = node('button', 'mini', 'Добавить HTML'); add.type = 'button';
    const input = node('input'); input.type = 'file'; input.hidden = true; input.accept = '.html,.htm,.zip,text/html,application/zip';
    add.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
      const file = input.files?.[0]; if (!file) return;
      draft.pages.push({ title: file.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' '), file, resource: null });
      render();
    });
    body.append(add, input);
  };
  render();
  return fileBlock('HTML-страница', 'Файл .html или .htm. Можно ZIP: внутри index.html и картинки, стили, скрипты рядом. Имена файлов лучше латиницей. Страница откроется у ученика в отдельном окне внутри урока и не увидит вход на сайт.', body);
}
function materialsBlock(draft) {
  const body = node('div'); body.id = 'materials';
  const render = () => {
    body.replaceChildren();
    if (!draft.materials.length) body.append(node('p', 'hint', 'Пока нет дополнительных файлов.'));
    draft.materials.forEach((item, index) => {
      const row = node('div', 'material');
      const title = node('input'); title.type = 'text'; title.value = item.title; title.placeholder = 'Как файл называется для ученика'; title.maxLength = 200;
      title.addEventListener('input', () => { item.title = title.value; });
      const controls = node('div', 'actions');
      const handle = node('button', 'drag-handle', '⠿'); handle.type = 'button'; handle.setAttribute('aria-label', 'Перетащить материал'); handle.title = 'Перетащить';
      const up = moveButton(-1); up.disabled = index === 0; up.addEventListener('click', () => reorderMaterials(draft, index, index - 1, render));
      const down = moveButton(1); down.disabled = index === draft.materials.length - 1; down.addEventListener('click', () => reorderMaterials(draft, index, index + 1, render));
      const remove = node('button', 'mini danger', 'Убрать'); remove.type = 'button'; remove.addEventListener('click', () => { draft.materials.splice(index, 1); render(); });
      const file = node('div', 'file-name', item.file ? item.file.name : (item.resource?.filename || 'Файл уже в уроке'));
      controls.append(handle, up, down, remove); row.append(title, controls); body.append(row, file);
    });
    bindMaterialDrag(body, draft, render);
    const add = node('button', 'mini', 'Добавить файл'); add.type = 'button';
    const input = node('input'); input.type = 'file'; input.hidden = true; input.accept = '.pdf,.docx,.pptx,.png,.jpg,.jpeg,.webp,.gif,.zip,.txt,.xlsx,image/png,image/jpeg,image/webp,image/gif';
    add.addEventListener('click', () => input.click());
    input.addEventListener('change', () => { const file = input.files?.[0]; if (!file) return; draft.materials.push({ title: file.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' '), file, resource: null }); render(); });
    body.append(add, input);
  };
  render();
  return fileBlock('Дополнительные материалы', 'Шаблоны, памятки и картинки PNG, JPG, WEBP, GIF. Картинку ученик увидит в карточке и откроет на весь экран. Название видит ученик. Порядок можно менять стрелками или перетаскиванием за ручку.', body);
}
function existingLine(resource, onClear) {
  const box = node('div', 'file-box');
  const row = node('div', 'file-row');
  row.append(node('div', 'file-name', `Сейчас в уроке: ${resource.filename || resource.title} · ${resource.size || ''}`));
  const button = node('button', 'mini danger', 'Убрать'); button.type = 'button'; button.addEventListener('click', onClear);
  row.append(button); box.append(row); return box;
}
function swap(list, a, b) { [list[a], list[b]] = [list[b], list[a]]; }
let materialOrderChain = Promise.resolve();
function reorderMaterials(draft, from, to, render) {
  if (from === to || from < 0 || to < 0 || to >= draft.materials.length) return;
  const previous = draft.materials.slice();
  const [item] = draft.materials.splice(from, 1);
  draft.materials.splice(to, 0, item);
  render();
  say('Порядок материалов изменён');
  void persistMaterialOrder(draft, previous, render);
}
function bindMaterialDrag(body, draft, render) {
  body.querySelectorAll('.material').forEach(row => {
    const handle = row.querySelector('.drag-handle');
    if (!handle) return;
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0 || draft.materials.length < 2) return;
      event.preventDefault();
      const pointer = event.pointerId;
      const startY = event.clientY;
      const origin = draft.materials.slice();
      let active = false;
      const onMove = ev => {
        if (ev.pointerId !== pointer) return;
        if (!active) {
          if (Math.abs(ev.clientY - startY) < 8) return;
          active = true;
          row.classList.add('is-dragging');
        }
        ev.preventDefault();
        const rows = [...body.querySelectorAll(':scope > .material')];
        const current = rows.indexOf(row);
        if (current < 0) return;
        let target = rows.length - 1;
        for (let i = 0; i < rows.length; i++) {
          const box = rows[i].getBoundingClientRect();
          if (ev.clientY < box.top + box.height / 2) { target = i; break; }
        }
        if (target === current) return;
        const file = row.nextElementSibling?.classList.contains('file-name') ? row.nextElementSibling : null;
        const [item] = draft.materials.splice(current, 1);
        draft.materials.splice(target, 0, item);
        const anchor = rows[target];
        const anchorFile = anchor.nextElementSibling?.classList.contains('file-name') ? anchor.nextElementSibling : anchor;
        if (target > current) anchorFile.after(row);
        else anchor.before(row);
        if (file) row.after(file);
      };
      const finish = ev => {
        if (ev.pointerId !== pointer) return;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', finish);
        window.removeEventListener('pointercancel', finish);
        row.classList.remove('is-dragging');
        if (!active) return;
        if (origin.every((item, i) => item === draft.materials[i])) return;
        render();
        say('Порядок материалов изменён');
        void persistMaterialOrder(draft, origin, render);
      };
      try { handle.setPointerCapture(pointer); } catch {}
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', finish);
      window.addEventListener('pointercancel', finish);
    });
  });
}
function catalogMaterials(draft) {
  const items = [];
  for (const item of draft.materials) {
    if (item.file || !item.resource?.download) continue;
    items.push({ ...item.resource, title: item.title.trim() || item.resource.title });
  }
  const pptx = draft.pptxUpload || (!draft.clearPresentation ? draft.pptxKept : null);
  if (pptx?.download && pptx.download !== draft.presentation?.download) items.push({ ...pptx, title: 'Презентация (PowerPoint)' });
  const seen = new Set();
  return items.filter(item => item.download && !seen.has(item.download) && seen.add(item.download));
}
function materialOrderReady(draft) {
  return Boolean(draft.id) && !state.busy && draft.materials.length > 0 && draft.materials.every(item => item.resource?.download && !item.file);
}
function sameMaterials(list, snapshot) {
  return list.length === snapshot.length && list.every((item, index) => item === snapshot[index]);
}
async function persistMaterialOrder(draft, previous, render) {
  if (!materialOrderReady(draft)) return;
  const intended = draft.materials.slice();
  const run = materialOrderChain.then(async () => {
    if (!sameMaterials(draft.materials, intended) || !materialOrderReady(draft)) return;
    try {
      const saved = await api(`/api/admin/lessons/${draft.id}`, { method: 'PUT', body: { materials: catalogMaterials(draft), revision: state.revision } });
      state.revision = saved.revision;
      if (!sameMaterials(draft.materials, intended)) return;
      const extras = (saved.lesson?.materials || []).filter(item => !String(item.download || '').endsWith('/presentation.pptx'));
      const pptx = (saved.lesson?.materials || []).find(item => String(item.download || '').endsWith('/presentation.pptx'));
      if (pptx) draft.pptxKept = pptx;
      draft.materials.forEach((item, index) => {
        if (extras[index]?.download && extras[index].download === item.resource?.download) item.resource = extras[index];
      });
      showError('');
    } catch (error) {
      if (error.status === 409 && draft.id) {
        try { const fresh = await api(`/api/admin/lessons/${draft.id}`); state.revision = fresh.revision; } catch {}
      }
      if (!sameMaterials(draft.materials, intended)) return;
      draft.materials.splice(0, draft.materials.length, ...previous);
      render();
      showError(error.message);
    }
  });
  materialOrderChain = run.catch(() => {});
  await run;
}
function readForm(draft) {
  const form = $('#lesson-form');
  draft.number = form.number.value.trim();
  draft.title = form.title.value.trim();
  draft.description = form.description.value.trim();
  draft.accessMode = formAccess();
  draft.logins = new Set([...screen.querySelectorAll('#people input:checked')].map(input => input.value));
}
function showError(message) { const box = $('#save-error'); box.hidden = !message; box.textContent = message || ''; say(message || ''); }
function showStatus(text, ratio) {
  const status = $('#save-status'); status.textContent = text || ''; say(text || '');
  const bar = $('#save-bar'); bar.hidden = ratio == null;
  if (ratio != null) bar.firstChild.style.transform = `scaleX(${Math.max(0.04, Math.min(1, ratio))})`;
  if (ratio != null && ratio >= 1 && text && !text.startsWith('Сохраняем')) showToast(text, false);
}
async function save(status) {
  const draft = state.editing; if (!draft || state.busy) return;
  readForm(draft);
  if (!/^\d{1,4}$/.test(draft.number)) return showError('Номер урока — это число, например 04.');
  if (!draft.title) return showError('Напишите название урока.');
  if (draft.accessMode === 'logins' && !draft.logins.size) return showError('Отметьте хотя бы одного ученика или откройте урок всем.');
  for (const item of draft.materials) if (!item.title.trim()) return showError('У каждого дополнительного файла нужно название, которое увидит ученик.');
  for (const item of draft.pages) if (!item.title.trim()) return showError('У каждой HTML-страницы нужно название, которое увидит ученик.');
  for (const item of draft.videos) if (!item.title.trim()) return showError('У каждого видео нужно название, которое увидит ученик.');
  showError(''); setBusy(true);
  try {
    if (!draft.id) {
      showStatus('Создаём урок…');
      const created = await api('/api/admin/lessons', { method: 'POST', body: { ...meta(draft), status: 'draft', revision: state.revision } });
      draft.id = created.lesson.id; state.revision = created.revision; draft.status = 'draft';
    }
    const patch = { ...meta(draft), status, revision: state.revision };
    const presentation = await buildPresentation(draft);
    if (presentation !== undefined) patch.presentation = presentation;
    patch.materials = await buildMaterials(draft, presentation === undefined ? draft.presentation : presentation);
    const lecture = await buildLecture(draft);
    if (lecture !== undefined) patch.lecture = lecture;
    const workbook = await buildWorkbook(draft);
    if (workbook !== undefined) patch.workbook = workbook;
    patch.videos = await buildVideos(draft);
    patch.pages = await buildPages(draft);
    patch.sectionOrder = isDefaultSectionOrder(draft.sectionOrder) ? null : draft.sectionOrder.slice();
    showStatus('Сохраняем урок…', 1);
    const saved = await api(`/api/admin/lessons/${draft.id}`, { method: 'PUT', body: patch });
    state.revision = saved.revision;
    const catalog = await api('/api/admin/lessons');
    state.revision = catalog.revision; state.lessons = catalog.lessons; state.editing = null;
    state.notice = status === 'published' ? 'Урок опубликован. Ученики уже могут его открыть.' : 'Черновик сохранён. Ученики его не видят.';
    renderList();
  } catch (error) { showError(error.message); showStatus(''); }
  finally { setBusy(false); }
}
function meta(draft) {
  return { number: draft.number, title: draft.title, description: draft.description, access: draft.accessMode === 'logins' ? { mode: 'logins', logins: [...draft.logins] } : { mode: 'all' } };
}
async function buildPresentation(draft) {
  if (!draft.pdfFile && !draft.pptxFile && !draft.clearPresentation) return undefined;
  if (draft.clearPresentation && !draft.pdfFile && !draft.pptxFile) return null;
  let pdf = null, pptx = null;
  if (draft.pdfFile) {
    showStatus('Загружаем PDF…', 0.02);
    const ticket = await upload(draft.id, 'presentation', draft.pdfFile, draft.pdfFile.name, {}, ratio => showStatus(`Загружаем PDF… ${Math.round(ratio * 100)}%`, ratio));
    showStatus('Делаем картинки слайдов…');
    const rendered = await pdfToWebpBlobs(await draft.pdfFile.arrayBuffer(), { onProgress: (done, total) => showStatus(`Делаем картинки слайдов… ${done} из ${total}`, done / total) });
    const urls = [];
    for (let i = 0; i < rendered.blobs.length; i++) {
      showStatus(`Загружаем картинки слайдов… ${i + 1} из ${rendered.blobs.length}`, (i + 1) / rendered.blobs.length);
      const slide = await upload(draft.id, 'slide', rendered.blobs[i], `${i + 1}.webp`, { index: i + 1 });
      urls.push(slide.path);
    }
    pdf = { ...resourceFrom(ticket, draft.pdfFile, { title: 'Презентация урока' }), pages: rendered.blobs.length, preview: { type: 'images', kind: 'slides', urls } };
    if (rendered.truncated) draft.noticeTail = ` На сайт попали первые ${rendered.blobs.length} слайдов из ${rendered.total}. Полный файл можно скачать.`;
  }
  if (draft.pptxFile) {
    showStatus('Загружаем PowerPoint…', 0.02);
    const ticket = await upload(draft.id, 'presentation', draft.pptxFile, draft.pptxFile.name, {}, ratio => showStatus(`Загружаем PowerPoint… ${Math.round(ratio * 100)}%`, ratio));
    pptx = resourceFrom(ticket, draft.pptxFile, { title: 'Презентация (PowerPoint)' });
    draft.pptxUpload = pptx;
  }
  return pdf || pptx || draft.presentation || null;
}
async function buildLecture(draft) {
  if (!draft.lectureFile && !draft.clearLecture) return undefined;
  if (draft.clearLecture && !draft.lectureFile) return null;
  const parsed = draft.lecturePreview || await docxToSections(await draft.lectureFile.arrayBuffer());
  showStatus('Загружаем лекцию…', 0.2);
  const ticket = await upload(draft.id, 'lecture', draft.lectureFile, draft.lectureFile.name, {});
  return { ...resourceFrom(ticket, draft.lectureFile, { title: 'Лекция' }), sections: parsed.sections, readingTime: parsed.readingTime };
}
async function buildWorkbook(draft) {
  if (!draft.workbookFile && !draft.clearWorkbook) return undefined;
  if (draft.clearWorkbook && !draft.workbookFile) return null;
  const file = draft.workbookFile;
  const extension = extOf(file.name);
  if (extension !== 'pdf' && extension !== 'docx') throw new Error('Методичка — это Word (DOCX) или PDF.');
  showStatus('Загружаем методичку…', 0.05);
  const ticket = await upload(draft.id, 'workbook', file, file.name, {}, ratio => showStatus(`Загружаем методичку… ${Math.round(ratio * 100)}%`, ratio));
  const pages = extension === 'pdf'
    ? await pdfToWebpBlobs(await file.arrayBuffer(), { onProgress: (done, total) => showStatus(`Готовим страницы методички… ${done} из ${total}`, done / total) })
    : await textToWebpBlobs(linesFromSections((await docxToSections(await file.arrayBuffer())).sections), { onProgress: done => showStatus(`Готовим страницы методички… ${done}`, 0.5) });
  const urls = [];
  for (let i = 0; i < pages.blobs.length; i++) {
    const page = await upload(draft.id, 'workbook-page', pages.blobs[i], `page-${i + 1}.webp`, { index: i + 1 });
    urls.push(page.path);
  }
  const preview = urls.length === 1 ? { type: 'image', url: urls[0] } : { type: 'images', kind: 'pages', urls };
  return { ...resourceFrom(ticket, file, { title: 'Методичка и самопроверка' }), pages: urls.length, preview };
}
async function buildMaterials(draft, presentation) {
  const used = new Set(draft.materials.map(item => extraIndex(item.resource?.download)));
  let cursor = 1;
  const nextIndex = () => { while (used.has(cursor)) cursor += 1; used.add(cursor); return cursor; };
  const items = [];
  for (const item of draft.materials) {
    if (item.file) {
      const index = nextIndex();
      showStatus(`Загружаем «${item.title.trim()}»…`, 0.1);
      const ticket = await upload(draft.id, 'extra', item.file, item.file.name, { index }, ratio => showStatus(`Загружаем «${item.title.trim()}»… ${Math.round(ratio * 100)}%`, ratio));
      const extension = extOf(item.file.name);
      let preview, pages;
      if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(extension)) preview = { type: 'image', url: ticket.path };
      else if (extension === 'pdf' || extension === 'docx') {
        const rendered = extension === 'pdf'
          ? await pdfToWebpBlobs(await item.file.arrayBuffer(), { maxPages: 12, onProgress: (done, total) => showStatus(`Страницы «${item.title.trim()}»… ${done} из ${total}`) })
          : await textToWebpBlobs(linesFromSections((await docxToSections(await item.file.arrayBuffer())).sections), { maxPages: 8 });
        const urls = [];
        for (let i = 0; i < rendered.blobs.length; i++) {
          const page = await upload(draft.id, 'extra-page', rendered.blobs[i], `extra-${index}-${i + 1}.webp`, { index, page: i + 1 });
          urls.push(page.path);
        }
        pages = urls.length;
        preview = urls.length === 1 ? { type: 'image', url: urls[0] } : { type: 'images', kind: 'pages', urls };
      }
      items.push({ ...resourceFrom(ticket, item.file, { title: item.title.trim() }), ...(pages ? { pages } : {}), ...(preview ? { preview } : {}) });
    } else if (item.resource) items.push({ ...item.resource, title: item.title.trim() });
  }
  const pptx = draft.pptxUpload || (!draft.clearPresentation ? draft.pptxKept : null);
  if (pptx?.download && pptx.download !== presentation?.download) items.push({ ...pptx, title: 'Презентация (PowerPoint)' });
  const seen = new Set();
  return items.filter(item => item.download && !seen.has(item.download) && seen.add(item.download));
}
function extraIndex(download) { return Number(String(download || '').match(/\/extras\/(\d+)\./)?.[1] || 0); }
function mediaIndex(download, kind) {
  const match = kind === 'page' ? String(download || '').match(/\/html\/(\d+)\.html?$/) : String(download || '').match(/\/videos\/(\d+)\./);
  return Number(match?.[1] || 0);
}
async function buildPages(draft) {
  const used = new Set(draft.pages.map(item => mediaIndex(item.resource?.download, 'page')));
  let cursor = 1;
  const nextIndex = () => { while (used.has(cursor)) cursor += 1; if (cursor > 20) throw new Error('Слишком много HTML-страниц. Максимум — 20.'); used.add(cursor); return cursor; };
  const items = [];
  for (const item of draft.pages) {
    if (item.file) {
      showStatus(`Собираем «${item.title.trim()}»…`);
      const packed = await packLessonHtml(item.file.name, await item.file.arrayBuffer());
      const blob = new Blob([packed.bytes], { type: 'text/html' });
      const index = nextIndex();
      showStatus(`Загружаем «${item.title.trim()}»…`, 0.05);
      const ticket = await upload(draft.id, 'html', blob, packed.filename, { index }, ratio => showStatus(`Загружаем «${item.title.trim()}»… ${Math.round(ratio * 100)}%`, ratio));
      items.push({ ...resourceFrom(ticket, { name: packed.filename, size: blob.size }, { title: item.title.trim() }), url: ticket.path });
    } else if (item.resource) items.push({ ...item.resource, title: item.title.trim() });
  }
  return items;
}
async function buildVideos(draft) {
  const used = new Set(draft.videos.map(item => mediaIndex(item.resource?.download, 'video')));
  let cursor = 1;
  const nextIndex = () => { while (used.has(cursor)) cursor += 1; if (cursor > 20) throw new Error('Слишком много видео. Максимум — 20.'); used.add(cursor); return cursor; };
  const items = [];
  for (const item of draft.videos) {
    const title = item.title.trim();
    if (item.file) {
      const index = nextIndex();
      showStatus(`Загружаем «${title}»…`, 0.02);
      const ticket = await upload(draft.id, 'video', item.file, item.file.name, { index }, ratio => showStatus(`Загружаем «${title}»… ${Math.round(ratio * 100)}%`, ratio));
      const video = { ...resourceFrom(ticket, item.file, { title }), url: ticket.path, kind: 'file' };
      if (item.posterFile) {
        const posterExt = extOf(item.posterFile.name);
        showStatus(`Загружаем обложку «${title}»…`);
        const poster = await upload(draft.id, 'poster', item.posterFile, item.posterFile.name, { index });
        video.poster = poster.path;
        if (!['webp', 'png', 'jpg', 'jpeg'].includes(posterExt)) throw new Error('Обложка — это WebP, PNG или JPEG.');
      } else if (item.resource?.poster) video.poster = item.resource.poster;
      items.push(video);
    } else if (item.link && !item.resource) items.push({ title, kind: 'embed', embedUrl: item.link });
    else if (item.resource) {
      const copy = { ...item.resource, title };
      if (item.posterFile && copy.download) {
        const index = mediaIndex(copy.download, 'video');
        showStatus(`Загружаем обложку «${title}»…`);
        copy.poster = (await upload(draft.id, 'poster', item.posterFile, item.posterFile.name, { index })).path;
      }
      items.push(copy);
    }
  }
  return items;
}

function formatWhen(ts) {
  if (!ts) return 'ещё не заходил';
  try { return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(ts)); }
  catch { return '—'; }
}
async function loadStats() {
  const period = state.period || '30';
  const [stats, resets] = await Promise.all([
    api('/api/admin/stats?period=' + encodeURIComponent(period)),
    api('/api/admin/resets'),
  ]);
  state.stats = stats;
  state.resets = resets.requests || [];
  state.pending = Number(resets.pending) || 0;
}
async function openStats() {
  state.editing = null;
  state.userForm = null;
  if (location.hash !== '#stats') location.hash = 'stats';
  try { await loadStats(); }
  catch (error) { state.notice = error.message; }
  renderStats();
}
function renderStats() {
  screen.replaceChildren();
  screen.append(tabs('stats'));
  const head = node('div', 'page-head');
  const copy = node('div');
  copy.append(node('div', 'eyebrow', 'ШТАБ / СТАТИСТИКА'), node('h1', '', 'Статистика'), node('p', 'lead', 'Кто заходил, какие уроки открывали и кто отметил урок пройденным. Пароль по заявке выдаётся здесь же.'));
  head.append(copy);
  screen.append(head);
  if (state.notice) { const text = state.notice; state.notice = ''; showToast(text); }
  const periods = node('div', 'chip-set period-set');
  periods.setAttribute('role', 'group');
  periods.setAttribute('aria-label', 'Период');
  for (const [value, label] of [['7', '7 дней'], ['30', '30 дней'], ['all', 'Всё время']]) {
    const button = node('button', 'chip', label);
    button.type = 'button';
    button.setAttribute('aria-checked', String((state.period || '30') === value));
    button.addEventListener('click', async () => {
      if ((state.period || '30') === value || state.busy) return;
      state.period = value;
      setBusy(true);
      try { await loadStats(); }
      catch (error) { state.notice = error.message; }
      finally { setBusy(false); }
      renderStats();
    });
    periods.append(button);
  }
  screen.append(periods);
  screen.append(resetSection());
  screen.append(studentSection());
  screen.append(lessonSection());
}
function resetSection() {
  const section = node('section', 'stat-section');
  const title = node('h2', '', 'Заявки на пароль');
  section.append(title);
  const list = state.resets || [];
  if (!list.length) {
    section.append(node('p', 'hint', 'Заявок нет. Если ученик нажмёт «Забыли пароль?», заявка появится здесь.'));
    return section;
  }
  const grid = node('div', 'stat-grid');
  for (const item of list) grid.append(resetCard(item));
  section.append(grid);
  return section;
}
function resetCard(item) {
  const card = node('article', 'stat-card reset-card');
  if (item.status === 'done') card.classList.add('is-done');
  card.append(node('h3', '', item.query || 'Без имени'));
  const meta = node('p', 'hint');
  const who = item.matchedLogin ? `${item.matchedName || item.matchedLogin} · ${item.matchedLogin}` : 'Учётка не найдена';
  meta.textContent = `${who} · ${formatWhen(item.createdAt)}`;
  card.append(meta);
  if (item.contact) card.append(node('p', 'reset-contact', `Связь: ${item.contact}`));
  if (item.status === 'done') {
    card.append(node('p', 'hint', 'Готово'));
    return card;
  }
  const actions = node('div', 'reset-actions');
  if (item.matchedLogin) {
    const reset = node('button', 'primary', 'Сбросить пароль');
    reset.type = 'button';
    reset.addEventListener('click', () => resetFromRequest(item));
    actions.append(reset);
  } else card.append(node('p', 'hint', 'Сбросьте пароль во вкладке «Пользователи», затем отметьте заявку готовой.'));
  const done = node('button', 'secondary', 'Готово');
  done.type = 'button';
  done.addEventListener('click', () => closeRequest(item));
  actions.append(done);
  card.append(actions);
  return card;
}
async function resetFromRequest(item) {
  if (state.busy || !item.matchedLogin) return;
  const who = item.matchedName || item.matchedLogin;
  const ok = await ask('Новый пароль', `Старый пароль «${who}» перестанет работать, а текущий вход этого человека закроется.`, 'Сбросить пароль');
  if (!ok) return;
  setBusy(true);
  try {
    const data = await api(`/api/admin/resets/${item.id}/reset`, { method: 'POST', body: {} });
    state.pending = Number(data.pending) || 0;
    const self = item.matchedLogin === state.me;
    showPassword(data.password, self ? 'Ваш новый пароль' : `Пароль для ${who}`, self);
    if (!self) await loadStats();
  } catch (error) { state.notice = error.message; }
  finally { setBusy(false); }
  if (item.matchedLogin !== state.me) renderStats();
}
async function closeRequest(item) {
  if (state.busy) return;
  setBusy(true);
  try {
    const data = await api(`/api/admin/resets/${item.id}/done`, { method: 'POST', body: {} });
    state.pending = Number(data.pending) || 0;
    state.notice = 'Заявка закрыта.';
    await loadStats();
  } catch (error) { state.notice = error.message; }
  finally { setBusy(false); }
  renderStats();
}
function metric(value, label) {
  const cell = node('div');
  cell.append(node('b', '', String(value)), node('span', '', label));
  return cell;
}
function studentSection() {
  const section = node('section', 'stat-section');
  section.append(node('h2', '', 'Ученики'));
  const rows = state.stats?.students || [];
  if (!state.stats) { section.append(node('p', 'hint', 'Не удалось загрузить статистику.')); return section; }
  if (!rows.length) { section.append(node('p', 'hint', 'Пока нет учеников.')); return section; }
  const grid = node('div', 'stat-grid');
  for (const person of rows) {
    const card = node('article', 'stat-card');
    card.append(node('h3', '', person.name || person.login));
    const login = node('p', 'stat-login', person.login);
    card.append(login);
    if (person.disabled) card.append(node('span', 'badge quiet', 'отключён'));
    card.append(node('p', 'hint', `Последний визит: ${formatWhen(person.lastVisit)}`));
    const metrics = node('div', 'stat-metrics');
    metrics.append(metric(person.visits, 'визитов'), metric(person.lessonsOpened, 'уроков открыто'), metric(person.lessonsCompleted, 'уроков пройдено'));
    card.append(metrics);
    grid.append(card);
  }
  section.append(grid);
  return section;
}
function lessonSection() {
  const section = node('section', 'stat-section');
  section.append(node('h2', '', 'Уроки'));
  const rows = state.stats?.lessons || [];
  if (!state.stats) return section;
  if (!rows.length) { section.append(node('p', 'hint', 'В каталоге пока нет уроков.')); return section; }
  const grid = node('div', 'stat-grid');
  for (const lesson of rows) {
    const card = node('article', 'stat-card lesson-stat');
    const title = `${lesson.number || ''} · ${lesson.title || 'Без названия'}`.replace(/^ · /, '');
    card.append(node('h3', '', title));
    if (lesson.status === 'draft') card.append(node('span', 'badge draft', 'черновик'));
    const metrics = node('div', 'stat-metrics');
    metrics.append(metric(lesson.opened, 'открыли'), metric(lesson.completed, 'прошли'));
    card.append(metrics);
    grid.append(card);
  }
  section.append(grid);
  return section;
}
async function openUsers() {
  state.editing = null;
  if (location.hash !== '#users') location.hash = 'users';
  try { state.people = (await api('/api/admin/accounts')).accounts; }
  catch (error) { state.notice = error.message; }
  try { state.pending = Number((await api('/api/admin/resets')).pending) || 0; } catch {}
  renderUsers();
}
function mskToday() { return new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10); }
function ruDate(iso) { const [y, m, d] = String(iso).split('-'); return `${d}.${m}.${y}`; }
// Whole days until the end of the access day (23:59 Moscow time).
function daysLeft(iso) { return Math.floor((Date.parse(`${iso}T23:59:59+03:00`) - Date.now()) / 86400e3); }
function personIsTeacher(person) { return person.role === 'teacher' || person.roles?.includes('teacher'); }
function roleTitle(person) { return personIsTeacher(person) ? 'Преподаватель' : 'Ученик'; }
function lessonTitle(id) {
  const lesson = state.lessons.find(item => String(item.id) === String(id));
  return lesson ? `${lesson.number} · ${lesson.title || 'Без названия'}` : `урок ${id}`;
}
function lessonsTitle(person) {
  if (personIsTeacher(person)) return 'все уроки';
  if (!person.lessons?.length) return 'все уроки';
  return person.lessons.map(lessonTitle).join(', ');
}
function ask(title, copy, confirmLabel) {
  const dialog = $('#confirm-dialog');
  $('#confirm-heading').textContent = title;
  $('#confirm-copy').textContent = copy;
  const ok = $('#confirm-ok');
  const cancel = $('#confirm-cancel');
  ok.textContent = confirmLabel;
  ok.className = confirmLabel === 'Удалить' || confirmLabel === 'Отключить' ? 'danger' : 'primary';
  return new Promise(resolve => {
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      dialog.removeEventListener('close', onClose);
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      if (dialog.open) dialog.close();
      resolve(value);
    };
    const onOk = () => finish(true);
    const onCancel = () => finish(false);
    const onClose = () => finish(false);
    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
    dialog.addEventListener('close', onClose);
    dialog.showModal();
  });
}
function showPassword(password, title, self, login) {
  $('#password-heading').textContent = title || 'Новый пароль';
  const loginRow = $('#credential-login-row');
  const loginInput = $('#credential-login');
  const shownLogin = String(login || '');
  if (loginRow) loginRow.hidden = !shownLogin;
  if (loginInput) loginInput.value = shownLogin;
  $('#password-note').textContent = self
    ? (shownLogin
      ? 'Скопируйте логин и пароль. Этот вход сейчас закроется — войдите заново. После закрытия окна пароль больше не появится.'
      : 'Скопируйте пароль. Этот вход сейчас закроется — войдите заново. После закрытия окна пароль больше не появится.')
    : (shownLogin
      ? 'Скопируйте логин и пароль и передайте их человеку. После закрытия окна пароль больше не появится.'
      : 'Скопируйте пароль и передайте его человеку. После закрытия окна он больше не появится.');
  const input = $('#password-value');
  const copy = $('#password-copy');
  const dialog = $('#password-dialog');
  let current = password;
  input.value = current;
  copy.textContent = 'Скопировать';
  const close = () => { current = ''; input.value = ''; if (loginInput) loginInput.value = ''; if (dialog.open) dialog.close(); };
  $('#password-close').onclick = close;
  copy.onclick = async () => {
    const value = current ? (shownLogin ? `Логин: ${shownLogin}\nПароль: ${current}` : current) : '';
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      copy.textContent = 'Скопировано';
      say(shownLogin ? 'Логин и пароль скопированы' : 'Пароль скопирован');
    } catch {
      input.focus();
      input.select();
      try { document.execCommand('copy'); copy.textContent = 'Скопировано'; say(shownLogin ? 'Логин и пароль скопированы' : 'Пароль скопирован'); }
      catch { copy.textContent = 'Выделите и скопируйте'; }
    }
  };
  dialog.addEventListener('close', () => { current = ''; input.value = ''; if (loginInput) loginInput.value = ''; }, { once: true });
  dialog.showModal();
  input.focus();
  input.select();
}
async function refreshPeople() {
  state.people = (await api('/api/admin/accounts')).accounts;
}
function personSeesLesson(person, lessonId) {
  if (!lessonId) return true;
  if (personIsTeacher(person) || !person.lessons?.length) return true;
  return person.lessons.some(id => String(id) === String(lessonId));
}
function filteredPeople() {
  const query = state.userQuery.trim().toLowerCase();
  return state.people.filter(person => {
    if (query && !`${person.login || ''} ${person.name || ''}`.toLowerCase().includes(query)) return false;
    const teacher = personIsTeacher(person);
    if (state.userRole === 'teacher' && !teacher) return false;
    if (state.userRole === 'student' && teacher) return false;
    if (state.userStatus === 'on' && person.disabled) return false;
    if (state.userStatus === 'off' && !person.disabled) return false;
    return personSeesLesson(person, state.userLesson);
  });
}
function userFiltersOn() {
  return Boolean(state.userQuery.trim() || state.userRole !== 'all' || state.userStatus !== 'all' || state.userLesson);
}
function clearUserFilters() {
  state.userQuery = '';
  state.userRole = 'all';
  state.userStatus = 'all';
  state.userLesson = '';
}
function rememberUserForm() {
  if (state.userForm && $('#user-form')) readUserForm();
}
function renderUsers() {
  closeUserMenu(false);
  const queryFocused = document.activeElement?.id === 'user-query';
  const caret = queryFocused ? document.activeElement.selectionStart : null;
  const focusId = queryFocused ? '' : (document.activeElement?.id || '');
  screen.replaceChildren();
  screen.append(tabs('users'));
  const head = node('div', 'page-head');
  const copy = node('div');
  copy.append(node('div', 'eyebrow', 'ШТАБ / ЛЮДИ'), node('h1', '', 'Пользователи'), node('p', 'lead', 'Добавьте ученика или преподавателя. Логин соберётся из имени и фамилии, пароль создаётся сам и показывается один раз.'));
  const add = node('button', 'primary', 'Добавить пользователя');
  add.type = 'button';
  add.addEventListener('click', () => {
    state.userForm = { mode: 'create', login: '', first: '', last: '', name: '', role: 'student', lessons: new Set(), accessUntil: '', error: '', loginManual: false };
    renderUsers();
    $('#user-first')?.focus();
  });
  head.append(copy, add);
  screen.append(head);
  if (state.notice) { const text = state.notice; state.notice = ''; showToast(text); }
  if (state.userForm) screen.append(userForm(state.userForm));
  if (!state.people.length) {
    const empty = node('div', 'empty');
    empty.append(node('h2', '', 'Пока никого нет'), node('p', '', 'Нажмите «Добавить пользователя», чтобы выдать первый вход.'));
    screen.append(empty);
    return;
  }
  screen.append(userTools());
  const people = filteredPeople();
  if (userFiltersOn()) {
    const meta = node('div', 'user-meta');
    meta.append(node('p', '', `Показано ${people.length} из ${state.people.length}`));
    const reset = node('button', 'text-link', 'Сбросить фильтры');
    reset.type = 'button';
    reset.addEventListener('click', () => { rememberUserForm(); clearUserFilters(); renderUsers(); $('#user-query')?.focus(); });
    meta.append(reset);
    screen.append(meta);
  }
  if (!people.length) {
    const empty = node('div', 'empty');
    empty.append(node('h2', '', 'Никого не нашлось'), node('p', '', 'Измените запрос или сбросьте фильтры.'));
    screen.append(empty);
    restoreUserFocus(queryFocused, caret, focusId);
    return;
  }
  const wrap = node('div', 'table-wrap');
  const table = node('table', 'user-table');
  const caption = node('caption', 'sr-only', 'Учётные записи школы');
  const thead = node('thead');
  const headRow = node('tr');
  for (const label of ['Логин', 'Имя', 'Роль', 'Уроки', 'Статус', 'Действия']) headRow.append(node('th', '', label));
  for (const cell of headRow.children) cell.scope = 'col';
  thead.append(headRow);
  const tbody = node('tbody');
  for (const person of people) tbody.append(userRow(person));
  table.append(caption, thead, tbody);
  wrap.append(table);
  screen.append(wrap);
  restoreUserFocus(queryFocused, caret, focusId);
}
function restoreUserFocus(queryFocused, caret, focusId) {
  if (queryFocused) {
    const input = $('#user-query');
    input?.focus();
    if (caret != null) input?.setSelectionRange(caret, caret);
    return;
  }
  if (focusId?.startsWith('filter-') || focusId === 'user-lesson') document.getElementById(focusId)?.focus();
}
function userTools() {
  const tools = node('div', 'user-tools');
  const search = node('label', 'field user-search');
  search.append(node('span', '', 'ПОИСК'));
  const input = node('input');
  input.type = 'search';
  input.id = 'user-query';
  input.placeholder = 'Имя или логин';
  input.value = state.userQuery;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('aria-label', 'Поиск по имени или логину');
  input.addEventListener('input', () => {
    rememberUserForm();
    state.userQuery = input.value;
    renderUsers();
  });
  search.append(input);
  const groups = node('div', 'user-filter-groups');
  groups.append(chipSet('Роль', 'userRole', [['all', 'Все'], ['teacher', 'Преподаватели'], ['student', 'Ученики']]));
  groups.append(chipSet('Статус', 'userStatus', [['all', 'Все'], ['on', 'Включены'], ['off', 'Отключены']]));
  const lesson = lessonFilter();
  if (lesson) groups.append(lesson);
  tools.append(search, groups);
  return tools;
}
function chipSet(label, key, options) {
  const block = node('div', 'filter-block');
  block.append(node('span', '', label));
  const group = node('div', 'chip-set');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', label);
  for (const [id, text] of options) {
    const button = node('button', 'chip', text);
    button.type = 'button';
    button.id = `filter-${key}-${id}`;
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', state[key] === id ? 'true' : 'false');
    button.addEventListener('click', () => {
      if (state[key] === id) return;
      rememberUserForm();
      state[key] = id;
      renderUsers();
    });
    group.append(button);
  }
  block.append(group);
  return block;
}
function lessonFilter() {
  const lessons = [...state.lessons].sort((a, b) => String(a.number).localeCompare(String(b.number), 'ru', { numeric: true }));
  if (!lessons.length) return null;
  const block = node('label', 'filter-block user-lesson');
  block.append(node('span', '', 'Видит урок'));
  const select = node('select');
  select.id = 'user-lesson';
  const any = node('option', '', 'Любой');
  any.value = '';
  select.append(any);
  for (const lesson of lessons) {
    const option = node('option', '', `${lesson.number} · ${lesson.title || 'Без названия'}`);
    option.value = String(lesson.id);
    select.append(option);
  }
  if (![...select.options].some(option => option.value === state.userLesson)) state.userLesson = '';
  select.value = state.userLesson;
  select.addEventListener('change', () => {
    rememberUserForm();
    state.userLesson = select.value;
    renderUsers();
  });
  block.append(select);
  return block;
}
let userMenuState = null;
function closeUserMenu(restoreFocus) {
  const current = userMenuState;
  if (!current) return;
  userMenuState = null;
  current.menu.hidden = true;
  current.menu.classList.remove('is-open', 'is-up', 'is-sheet');
  current.menu.style.top = '';
  current.menu.style.left = '';
  current.menu.style.maxHeight = '';
  current.button.setAttribute('aria-expanded', 'false');
  current.backdrop.remove();
  if (current.placeholder.isConnected) current.placeholder.replaceWith(current.menu);
  else current.menu.remove();
  document.removeEventListener('keydown', onUserMenuKey);
  document.removeEventListener('pointerdown', onUserMenuPointer);
  window.removeEventListener('resize', onUserMenuPlace);
  document.removeEventListener('scroll', onUserMenuPlace, true);
  document.body.classList.remove('menu-open');
  if (restoreFocus) current.button.focus();
}
function onUserMenuPlace(event) {
  if (!userMenuState) return;
  if (event?.target instanceof Node && userMenuState.menu.contains(event.target)) return;
  placeUserMenu(userMenuState.button, userMenuState.menu, userMenuState.backdrop);
}
function onUserMenuPointer(event) {
  if (!userMenuState) return;
  const target = event.target;
  if (target instanceof Node && (userMenuState.button.contains(target) || userMenuState.menu.contains(target) || userMenuState.backdrop.contains(target))) return;
  closeUserMenu(false);
}
function userMenuItems(menu) {
  return [...menu.querySelectorAll('[role="menuitem"]')];
}
function focusNeighbor(from, backward) {
  const list = [...document.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])')]
    .filter(el => !el.closest('[hidden]') && el.tabIndex !== -1 && el.getClientRects().length > 0);
  const index = list.indexOf(from);
  if (index < 0) { from.focus(); return; }
  const next = list[index + (backward ? -1 : 1)];
  (next || from).focus();
}
function onUserMenuKey(event) {
  if (!userMenuState) return;
  const items = userMenuItems(userMenuState.menu);
  if (!items.length) return;
  const index = items.indexOf(document.activeElement);
  const sheet = userMenuState.menu.classList.contains('is-sheet');
  if (event.key === 'Escape') {
    event.preventDefault();
    closeUserMenu(true);
    return;
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    items[index < 0 ? 0 : (index + 1) % items.length].focus();
    return;
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    items[index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length].focus();
    return;
  }
  if (event.key === 'Home') {
    event.preventDefault();
    items[0].focus();
    return;
  }
  if (event.key === 'End') {
    event.preventDefault();
    items[items.length - 1].focus();
    return;
  }
  if (event.key !== 'Tab') return;
  event.preventDefault();
  if (sheet) {
    const next = event.shiftKey ? (index <= 0 ? items.length - 1 : index - 1) : (index + 1) % items.length;
    items[next].focus();
    return;
  }
  const button = userMenuState.button;
  const backward = event.shiftKey;
  closeUserMenu(false);
  focusNeighbor(button, backward);
}
function placeUserMenu(button, menu, backdrop) {
  const sheet = window.matchMedia('(max-width: 640px)').matches;
  menu.classList.toggle('is-sheet', sheet);
  menu.classList.remove('is-up');
  menu.style.top = '';
  menu.style.left = '';
  menu.style.maxHeight = '';
  document.body.classList.toggle('menu-open', sheet);
  if (sheet) {
    if (!backdrop.isConnected) menu.before(backdrop);
    return;
  }
  backdrop.remove();
  const margin = 8;
  const gap = 6;
  const rect = button.getBoundingClientRect();
  if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) {
    closeUserMenu(false);
    return;
  }
  const width = menu.offsetWidth;
  const natural = menu.scrollHeight;
  const spaceBelow = window.innerHeight - rect.bottom - margin - gap;
  const spaceAbove = rect.top - margin - gap;
  const openUp = natural > spaceBelow && spaceAbove > spaceBelow;
  const room = Math.max(120, Math.floor(openUp ? spaceAbove : spaceBelow));
  menu.classList.toggle('is-up', openUp);
  menu.style.maxHeight = `${room}px`;
  const used = Math.min(natural, room);
  let top = openUp ? rect.top - gap - used : rect.bottom + gap;
  if (top < margin) top = margin;
  if (top + used > window.innerHeight - margin) top = Math.max(margin, window.innerHeight - margin - used);
  let left = rect.right - width;
  if (left < margin) left = margin;
  if (left + width > window.innerWidth - margin) left = Math.max(margin, window.innerWidth - margin - width);
  menu.style.top = `${Math.round(top)}px`;
  menu.style.left = `${Math.round(left)}px`;
}
function openUserMenu(button, menu, backdrop, which) {
  closeUserMenu(false);
  const placeholder = document.createComment('user-menu');
  menu.before(placeholder);
  document.body.append(menu);
  menu.hidden = false;
  menu.classList.add('is-open');
  button.setAttribute('aria-expanded', 'true');
  userMenuState = { button, menu, backdrop, placeholder };
  placeUserMenu(button, menu, backdrop);
  if (!userMenuState) return;
  document.addEventListener('keydown', onUserMenuKey);
  document.addEventListener('pointerdown', onUserMenuPointer);
  window.addEventListener('resize', onUserMenuPlace);
  document.addEventListener('scroll', onUserMenuPlace, true);
  const items = userMenuItems(menu);
  const focusItem = () => {
    if (userMenuState?.menu !== menu) return;
    items[which === 'last' ? items.length - 1 : 0]?.focus();
  };
  focusItem();
  queueMicrotask(focusItem);
}
function userMenuId(login) {
  return `user-menu-${encodeURIComponent(login).replace(/[^a-zA-Z0-9_-]/g, '')}`;
}
function userKebab(person) {
  const wrap = node('div', 'kebab');
  const button = node('button', 'kebab-btn', '⋯');
  button.type = 'button';
  const menu = node('div', 'kebab-menu');
  const id = userMenuId(person.login);
  menu.id = id;
  menu.hidden = true;
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', `Действия для ${person.name}`);
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', id);
  button.setAttribute('aria-label', `Действия для ${person.name}`);
  const title = node('div', 'kebab-title', person.name);
  title.id = `${id}-title`;
  title.setAttribute('role', 'presentation');
  menu.append(title);
  const actions = [
    ['Изменить', false, () => {
      state.userForm = {
        mode: 'edit',
        login: person.login,
        name: person.name,
        role: personIsTeacher(person) ? 'teacher' : 'student',
        lessons: new Set(person.lessons || []),
        accessUntil: person.accessUntil || '',
        error: '',
      };
      renderUsers();
      $('#user-name')?.focus();
    }],
    ['Новый пароль', false, () => resetUser(person)],
    [person.disabled ? 'Включить' : 'Отключить', false, () => toggleUser(person)],
    ['Удалить', true, () => removeUser(person)],
  ];
  for (const [label, danger, run] of actions) {
    if (danger) {
      const sep = node('div', 'kebab-sep');
      sep.setAttribute('role', 'separator');
      menu.append(sep);
    }
    const item = node('button', danger ? 'kebab-danger' : '', label);
    item.type = 'button';
    item.setAttribute('role', 'menuitem');
    item.tabIndex = -1;
    item.addEventListener('click', () => {
      closeUserMenu(false);
      run();
    });
    menu.append(item);
  }
  const backdrop = node('div', 'kebab-backdrop');
  backdrop.setAttribute('aria-hidden', 'true');
  backdrop.addEventListener('pointerdown', event => {
    event.preventDefault();
    closeUserMenu(true);
  });
  button.addEventListener('click', () => {
    if (userMenuState?.button === button) closeUserMenu(false);
    else openUserMenu(button, menu, backdrop, 'first');
  });
  button.addEventListener('keydown', event => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    if (userMenuState?.button === button) return;
    event.preventDefault();
    openUserMenu(button, menu, backdrop, event.key === 'ArrowUp' ? 'last' : 'first');
  });
  wrap.append(button, menu);
  return wrap;
}
function userRow(person) {
  const row = node('tr');
  const teacher = personIsTeacher(person);
  const lessons = lessonsTitle(person);
  const statusText = person.disabled ? 'Отключена' : 'Включена';
  const loginCell = node('td', 'user-login');
  loginCell.dataset.label = 'Логин';
  loginCell.title = person.login;
  loginCell.append(node('span', 'user-login-text', person.login));
  const nameCell = node('td', 'user-name');
  nameCell.dataset.label = 'Имя';
  nameCell.title = person.name;
  nameCell.append(node('span', 'user-name-text', person.name));
  const sub = node('span', 'user-sub', `${person.name} · ${lessons}`);
  sub.title = `${person.name} · ${lessons}`;
  nameCell.append(sub);
  const roleCell = node('td', teacher ? 'nowrap user-role is-teacher' : 'nowrap user-role', roleTitle(person));
  roleCell.dataset.label = 'Роль';
  if (!teacher && person.accessUntil) {
    const left = daysLeft(person.accessUntil);
    const badge = node('span', left < 7 ? 'access-until is-soon' : 'access-until', `до ${ruDate(person.accessUntil)}`);
    badge.title = left < 7 ? `Доступ закончится через ${Math.max(0, left)} дн.` : 'Доступ к материалам до этой даты включительно';
    roleCell.append(badge);
  }
  const lessonsCell = node('td', 'lessons-cell', lessons);
  lessonsCell.dataset.label = 'Уроки';
  lessonsCell.title = lessons;
  const statusCell = node('td', person.disabled ? 'nowrap user-status is-off' : 'nowrap user-status');
  statusCell.dataset.label = 'Статус';
  statusCell.title = statusText;
  statusCell.append(node('span', 'status-word', statusText));
  row.append(loginCell, nameCell, roleCell, lessonsCell, statusCell);
  const actions = node('td', 'actions-cell');
  actions.dataset.label = 'Действия';
  actions.append(userKebab(person));
  row.append(actions);
  return row;
}
export function transliterate(value) {
  const cyrillic = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
    и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
    с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch',
    ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  };
  let out = '';
  for (const ch of String(value ?? '')) {
    const lower = ch.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(cyrillic, lower)) {
      out += cyrillic[lower];
      continue;
    }
    if (/[A-Za-z0-9_]/.test(ch)) out += ch;
  }
  return out;
}
export function loginFromNames(first, last) {
  const initial = transliterate(String(first ?? '').trim()).match(/[A-Za-z]/)?.[0];
  if (!initial) return '';
  const lastRaw = transliterate(String(last ?? '').trim());
  const letterAt = lastRaw.search(/[A-Za-z]/);
  if (letterAt < 0) return '';
  const lower = lastRaw.toLowerCase();
  const pretty = lower.slice(0, letterAt) + lower.charAt(letterAt).toUpperCase() + lower.slice(letterAt + 1);
  let base = `${initial.toUpperCase()}_${pretty}`.replace(/[^A-Za-z0-9_]/g, '');
  if (base.length > 64) base = base.slice(0, 64);
  return /^[A-Za-z]_[A-Za-z0-9_]+$/.test(base) ? base : '';
}
export function uniqueLogin(base, taken) {
  const stem = String(base ?? '');
  if (!/^[A-Za-z]_[A-Za-z0-9_]+$/.test(stem)) return '';
  const used = new Set();
  for (const item of taken || []) {
    const login = String(item ?? '').trim().toLowerCase();
    if (login) used.add(login);
  }
  const fit = (suffix) => {
    const extra = suffix ? String(suffix) : '';
    const room = 64 - extra.length;
    if (room < 3) return '';
    const candidate = stem.slice(0, room) + extra;
    return /^[A-Za-z]_[A-Za-z0-9_]+$/.test(candidate) ? candidate : '';
  };
  const first = fit('');
  if (first && !used.has(first.toLowerCase())) return first;
  for (let n = 2; n <= 9999; n++) {
    const candidate = fit(n);
    if (candidate && !used.has(candidate.toLowerCase())) return candidate;
  }
  return '';
}
// end login-from-name
function suggestLogin(first, last, people) {
  return uniqueLogin(loginFromNames(first, last), (people || []).map(person => person?.login));
}
function userForm(draft) {
  const form = node('form', 'card user-card');
  form.id = 'user-form';
  form.noValidate = true;
  form.autocomplete = 'off';
  form.append(node('h3', '', draft.mode === 'create' ? 'Новый пользователь' : `Правка · ${draft.login}`));
  if (draft.mode === 'create') {
    if (!draft.loginManual) draft.login = suggestLogin(draft.first || '', draft.last || '', state.people);
    form.append(node('p', 'hint', 'Логин собирается сам: первая латинская буква имени, подчёркивание и фамилия, например «Павел Анцибор» → P_Antsibor. Поле можно поправить — после ручной правки оно больше не заполняется само. Если логин занят, в конце будет 2, 3 и дальше. Пароль сайт покажет один раз вместе с логином.'));
    const pair = node('div', 'name-pair');
    pair.append(textField('Имя', 'first', draft.first, 'Павел', 40), textField('Фамилия', 'last', draft.last, 'Анцибор', 40));
    form.append(pair);
    form.append(textField('Логин', 'login', draft.login, 'Соберётся из имени и фамилии', 64));
    const firstInput = form.querySelector('#user-first');
    const lastInput = form.querySelector('#user-last');
    const loginInput = form.querySelector('#user-login');
    const sync = () => {
      draft.first = firstInput.value;
      draft.last = lastInput.value;
      if (draft.loginManual) return;
      const next = suggestLogin(firstInput.value, lastInput.value, state.people);
      if (loginInput.value !== next) loginInput.value = next;
      draft.login = next;
    };
    firstInput.addEventListener('input', sync);
    lastInput.addEventListener('input', sync);
    loginInput.addEventListener('input', () => {
      draft.loginManual = true;
      draft.login = loginInput.value;
    });
  } else {
    form.append(node('p', 'hint', 'Логин этого человека не меняется. Новый пароль выдаётся кнопкой «Новый пароль» в строке.'));
    form.append(textField('Имя', 'name', draft.name, 'Как обращаться к человеку', 80));
  }
  const choices = node('fieldset', 'choices');
  choices.append(node('legend', '', 'РОЛЬ'));
  for (const [value, title, note] of [['teacher', 'Преподаватель', 'Видит все уроки и этот кабинет'], ['student', 'Ученик', 'Видит только отмеченные уроки']]) {
    const label = node('label', 'choice');
    const input = node('input');
    input.type = 'radio';
    input.name = 'user-role';
    input.value = value;
    input.checked = draft.role === value;
    const text = node('span');
    text.append(node('b', '', title), node('small', '', note));
    label.append(input, text);
    choices.append(label);
  }
  form.append(choices);
  const until = node('div', 'field access-until-field'); until.id = 'access-until-field';
  until.append(node('span', '', 'ДОСТУП ДО'));
  const untilRow = node('div', 'access-until-row');
  const untilInput = node('input'); untilInput.type = 'date'; untilInput.id = 'user-access-until'; untilInput.name = 'accessUntil'; untilInput.value = draft.accessUntil || ''; untilInput.min = mskToday();
  const untilClear = node('button', 'mini', 'Без срока'); untilClear.type = 'button'; untilClear.addEventListener('click', () => { untilInput.value = ''; });
  untilRow.append(untilInput, untilClear);
  until.append(untilRow, node('small', 'hint', 'Пусто — без ограничений. Доступ работает до 23:59 по Москве в этот день, потом закроется, а аккаунт ученика удалится вместе с его статистикой.'));
  const syncUntil = () => { until.hidden = (form.querySelector('input[name=user-role]:checked')?.value || draft.role) !== 'student'; };
  choices.addEventListener('change', syncUntil); syncUntil();
  form.append(until);
  form.append(node('p', 'hint', 'Отметьте уроки ученика. Если не отмечать ничего — ему видны все. Преподавателю открыты все уроки в любом случае.'));
  const picks = node('div', 'lesson-picks');
  const lessons = [...state.lessons].sort((a, b) => String(a.number).localeCompare(String(b.number), 'ru', { numeric: true }));
  if (!lessons.length) picks.append(node('p', 'hint', 'В каталоге пока нет уроков. Ограничение можно поставить позже.'));
  for (const lesson of lessons) {
    const label = node('label');
    const input = node('input');
    input.type = 'checkbox';
    input.name = 'lesson';
    input.value = String(lesson.id);
    input.checked = draft.lessons.has(String(lesson.id));
    label.append(input, node('span', '', `${lesson.number} · ${lesson.title || 'Без названия'}`));
    picks.append(label);
  }
  form.append(picks);
  if (draft.error) { const error = node('div', 'error', draft.error); form.append(error); }
  const bar = node('div', 'savebar');
  const save = node('button', 'primary', draft.mode === 'create' ? 'Создать и показать пароль' : 'Сохранить');
  save.type = 'submit';
  const cancel = node('button', 'secondary', 'Отмена');
  cancel.type = 'button';
  cancel.addEventListener('click', () => { state.userForm = null; renderUsers(); });
  bar.append(save, cancel);
  form.append(bar);
  form.addEventListener('submit', event => { event.preventDefault(); saveUser(); });
  return form;
}
function textField(label, name, value, placeholder, max) {
  const wrap = node('label', 'field');
  wrap.append(node('span', '', label.toUpperCase()));
  const input = node('input');
  input.type = 'text';
  input.name = name;
  const ids = { login: 'user-login', name: 'user-name', first: 'user-first', last: 'user-last' };
  if (ids[name]) input.id = ids[name];
  input.value = value || '';
  input.placeholder = placeholder;
  input.maxLength = max;
  input.autocomplete = 'off';
  input.spellcheck = false;
  if (name === 'login') input.autocapitalize = 'off';
  wrap.append(input);
  return wrap;
}
function readUserForm() {
  const form = $('#user-form');
  const draft = state.userForm;
  if (!form || !draft) return null;
  if (draft.mode === 'create') {
    draft.first = $('#user-first', form).value.trim();
    draft.last = $('#user-last', form).value.trim();
    draft.login = $('#user-login', form).value.trim();
    draft.name = [draft.first, draft.last].filter(Boolean).join(' ');
    if (!draft.loginManual) draft.login = suggestLogin(draft.first, draft.last, state.people);
  } else draft.name = form.name.value.trim();
  draft.role = form.querySelector('input[name=user-role]:checked')?.value || 'student';
  draft.lessons = new Set([...form.querySelectorAll('input[name=lesson]:checked')].map(input => input.value));
  draft.accessUntil = draft.role === 'student' ? ($('#user-access-until', form)?.value || '') : '';
  return draft;
}
async function saveUser() {
  const draft = readUserForm();
  if (!draft || state.busy) return;
  if (draft.mode === 'create') {
    if (!draft.first || !draft.last) { draft.error = 'Напишите имя и фамилию.'; renderUsers(); return; }
    if (!draft.login && !draft.loginManual) { draft.error = 'Не получилось собрать логин из имени и фамилии. Напишите логин сами.'; renderUsers(); return; }
  } else if (!draft.name) { draft.error = 'Напишите имя.'; renderUsers(); return; }
  if (draft.mode === 'edit' && draft.login.toLowerCase() === state.me && draft.role !== 'teacher') { draft.error = 'Нельзя понизить свою роль.'; renderUsers(); return; }
  setBusy(true);
  try {
    const lessons = [...draft.lessons];
    if (draft.mode === 'create') {
      const payload = { name: `${draft.first} ${draft.last}`, firstName: draft.first, lastName: draft.last, role: draft.role, lessons };
      if (draft.role === 'student' && draft.accessUntil) payload.accessUntil = draft.accessUntil;
      if (draft.loginManual) payload.login = draft.login;
      const data = await api('/api/admin/accounts', { method: 'POST', body: payload });
      state.userForm = null;
      clearUserFilters();
      state.notice = `Пользователь ${data.account.name} создан. Логин ${data.account.login}.`;
      showPassword(data.password, `Вход для ${data.account.name}`, false, data.account.login);
      await refreshPeople();
    } else {
      await api(`/api/admin/accounts/${encodeURIComponent(draft.login)}`, { method: 'PATCH', body: { name: draft.name, role: draft.role, lessons, ...(draft.role === 'student' ? { accessUntil: draft.accessUntil } : {}) } });
      state.userForm = null;
      state.notice = 'Изменения сохранены.';
      await refreshPeople();
    }
  } catch (error) {
    if (state.userForm) state.userForm.error = error.message;
    else state.notice = error.message;
  } finally { setBusy(false); }
  renderUsers();
}
async function resetUser(person) {
  if (state.busy) return;
  const ok = await ask('Новый пароль', `Старый пароль «${person.name}» перестанет работать, а текущий вход этого человека закроется.`, 'Сбросить пароль');
  if (!ok) return;
  setBusy(true);
  try {
    const data = await api(`/api/admin/accounts/${encodeURIComponent(person.login)}/reset-password`, { method: 'POST', body: {} });
    const self = person.login.toLowerCase() === state.me;
    showPassword(data.password, self ? 'Ваш новый пароль' : `Пароль для ${person.name}`, self, person.login);
    if (!self) await refreshPeople();
  } catch (error) { state.notice = error.message; }
  finally { setBusy(false); }
  if (person.login.toLowerCase() !== state.me) renderUsers();
}
async function toggleUser(person) {
  if (state.busy) return;
  const off = !person.disabled;
  const ok = await ask(off ? 'Отключить вход?' : 'Включить вход?', off ? `${person.name} не сможет войти, пока вы снова не включите учётную запись. Текущий вход тоже закроется.` : `${person.name} снова сможет войти со своим паролем.`, off ? 'Отключить' : 'Включить');
  if (!ok) return;
  setBusy(true);
  try {
    await api(`/api/admin/accounts/${encodeURIComponent(person.login)}`, { method: 'PATCH', body: { disabled: off } });
    await refreshPeople();
    state.notice = off ? 'Вход отключён.' : 'Вход снова включён.';
  } catch (error) { state.notice = error.message; }
  finally { setBusy(false); }
  renderUsers();
}
async function removeUser(person) {
  if (state.busy) return;
  const ok = await ask('Удалить пользователя?', `${person.name} (${person.login}) будет удалён. Вернуть учётную запись будет нельзя.`, 'Удалить');
  if (!ok) return;
  setBusy(true);
  try {
    await api(`/api/admin/accounts/${encodeURIComponent(person.login)}`, { method: 'DELETE' });
    if (state.userForm?.login === person.login) state.userForm = null;
    await refreshPeople();
    state.notice = 'Пользователь удалён.';
  } catch (error) { state.notice = error.message; }
  finally { setBusy(false); }
  renderUsers();
}

boot();
