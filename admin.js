import { API, getToken, clearToken } from './auth.js';
import { docxToSections, linesFromSections } from './docx.js';
import { pdfToWebpBlobs, textToWebpBlobs } from './previews.js';

const $ = (selector, root = document) => root.querySelector(selector);
const node = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text != null) el.textContent = text; return el; };
const screen = $('#screen');
const state = { revision: 1, lessons: [], people: [], notice: '', editing: null, busy: false, me: '', userForm: null, userQuery: '', userRole: 'all', userStatus: 'all', userLesson: '' };

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
  if (response.status === 401) { clearToken(); location.replace('./login.html'); throw new Error('Нужно войти снова.'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || 'Не удалось выполнить запрос. Попробуйте ещё раз.'), { status: response.status });
  return data;
}
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1048576) return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
  return `${(bytes / 1048576).toFixed(1).replace('.', ',')} МБ`;
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
  const ticket = await api('/api/admin/upload-url', { method: 'POST', body: { lessonId, slot, ext: extOf(name), size: blob.size, ...extra } });
  await putFile(ticket, blob, onProgress);
  return ticket;
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
    if (user.role !== 'teacher') { denied(user.roles?.includes('teacher') ? 'Сейчас включена роль ученика. В архиве переключитесь на «Преподаватель» и откройте кабинет снова.' : 'Этот вход — ученический. Кабинет открывается только преподавателю.'); return; }
    const [catalog, accounts] = await Promise.all([api('/api/admin/lessons'), api('/api/admin/accounts')]);
    state.revision = catalog.revision; state.lessons = catalog.lessons; state.people = accounts.accounts;
    if (location.hash === '#users') await openUsers();
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
  nav.append(lessons, users);
  return nav;
}
async function showLessons() {
  state.editing = null;
  state.userForm = null;
  if (location.hash !== '#lessons') location.hash = 'lessons';
  try { state.people = (await api('/api/admin/accounts')).accounts; } catch (error) { state.notice = error.message; }
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
  return { id: null, number: String((numbers.length ? Math.max(...numbers) : 0) + 1).padStart(2, '0'), title: '', description: '', status: 'draft', accessMode: 'all', logins: new Set(), pdfFile: null, pptxFile: null, presentation: null, clearPresentation: false, lectureFile: null, lecture: null, lectureNote: '', clearLecture: false, workbookFile: null, workbook: null, clearWorkbook: false, materials: [] };
}
function fromLesson(lesson) {
  const draft = blank();
  Object.assign(draft, { id: lesson.id, number: lesson.number, title: lesson.title, description: lesson.description || '', status: lesson.status, accessMode: lesson.access?.mode === 'logins' ? 'logins' : 'all', logins: new Set(lesson.access?.logins || []), presentation: lesson.presentation || null, lecture: lesson.lecture || null, workbook: lesson.workbook || null, materials: (lesson.materials || []).filter(item => !String(item.download || '').endsWith('/presentation.pptx')).map(item => ({ title: item.title || '', resource: item, file: null })) });
  const pptxExtra = (lesson.materials || []).find(item => String(item.download || '').endsWith('/presentation.pptx'));
  draft.pptxKept = pptxExtra || ((lesson.presentation?.download || '').endsWith('.pptx') ? lesson.presentation : null);
  if ((lesson.presentation?.download || '').endsWith('.pptx')) draft.presentation = lesson.presentation;
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
  form.append(presentationBlock(draft), lectureBlock(draft), workbookBlock(draft), materialsBlock(draft));
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
  const steps = ['Номер и название видят ученики в списке уроков.', 'PDF презентации превращается в картинки слайдов. PowerPoint — только для скачивания.', 'В лекции Word заголовки становятся разделами.', 'Черновик не виден ученикам. «Опубликовать» открывает урок сразу.', 'Большой файл идёт напрямую в хранилище, с полоской загрузки.'];
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
      const up = moveButton(-1); up.disabled = index === 0; up.addEventListener('click', () => { swap(draft.materials, index, index - 1); render(); });
      const down = moveButton(1); down.disabled = index === draft.materials.length - 1; down.addEventListener('click', () => { swap(draft.materials, index, index + 1); render(); });
      const remove = node('button', 'mini danger', 'Убрать'); remove.type = 'button'; remove.addEventListener('click', () => { draft.materials.splice(index, 1); render(); });
      const file = node('div', 'file-name', item.file ? item.file.name : (item.resource?.filename || 'Файл уже в уроке'));
      controls.append(up, down, remove); row.append(title, controls); body.append(row, file);
    });
    const add = node('button', 'mini', 'Добавить файл'); add.type = 'button';
    const input = node('input'); input.type = 'file'; input.hidden = true; input.accept = '.pdf,.docx,.pptx,.png,.jpg,.jpeg,.webp,.zip,.txt,.xlsx';
    add.addEventListener('click', () => input.click());
    input.addEventListener('change', () => { const file = input.files?.[0]; if (!file) return; draft.materials.push({ title: file.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' '), file, resource: null }); render(); });
    body.append(add, input);
  };
  render();
  return fileBlock('Дополнительные материалы', 'Шаблоны и памятки. Название видит ученик. Порядок можно менять стрелками.', body);
}
function existingLine(resource, onClear) {
  const box = node('div', 'file-box');
  const row = node('div', 'file-row');
  row.append(node('div', 'file-name', `Сейчас в уроке: ${resource.filename || resource.title} · ${resource.size || ''}`));
  const button = node('button', 'mini danger', 'Убрать'); button.type = 'button'; button.addEventListener('click', onClear);
  row.append(button); box.append(row); return box;
}
function swap(list, a, b) { [list[a], list[b]] = [list[b], list[a]]; }
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
      if (extension === 'pdf' || extension === 'docx') {
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
      items.push({ ...resourceFrom(ticket, item.file, { title: item.title.trim() }), ...(pages ? { pages, preview } : {}) });
    } else if (item.resource) items.push({ ...item.resource, title: item.title.trim() });
  }
  const pptx = draft.pptxUpload || (!draft.clearPresentation ? draft.pptxKept : null);
  if (pptx?.download && pptx.download !== presentation?.download) items.push({ ...pptx, title: 'Презентация (PowerPoint)' });
  const seen = new Set();
  return items.filter(item => item.download && !seen.has(item.download) && seen.add(item.download));
}
function extraIndex(download) { return Number(String(download || '').match(/\/extras\/(\d+)\./)?.[1] || 0); }

async function openUsers() {
  state.editing = null;
  if (location.hash !== '#users') location.hash = 'users';
  try { state.people = (await api('/api/admin/accounts')).accounts; }
  catch (error) { state.notice = error.message; }
  renderUsers();
}
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
function showPassword(password, title, self) {
  $('#password-heading').textContent = title || 'Новый пароль';
  $('#password-note').textContent = self
    ? 'Скопируйте пароль. Этот вход сейчас закроется — войдите заново. После закрытия окна пароль больше не появится.'
    : 'Скопируйте пароль и передайте его человеку. После закрытия окна он больше не появится.';
  const input = $('#password-value');
  const copy = $('#password-copy');
  const dialog = $('#password-dialog');
  let current = password;
  input.value = current;
  copy.textContent = 'Скопировать';
  const close = () => { current = ''; input.value = ''; if (dialog.open) dialog.close(); };
  $('#password-close').onclick = close;
  copy.onclick = async () => {
    const value = current;
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      copy.textContent = 'Скопировано';
      say('Пароль скопирован');
    } catch {
      input.focus();
      input.select();
      try { document.execCommand('copy'); copy.textContent = 'Скопировано'; say('Пароль скопирован'); }
      catch { copy.textContent = 'Выделите и скопируйте'; }
    }
  };
  dialog.addEventListener('close', () => { current = ''; input.value = ''; }, { once: true });
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
  const queryFocused = document.activeElement?.id === 'user-query';
  const caret = queryFocused ? document.activeElement.selectionStart : null;
  const focusId = queryFocused ? '' : (document.activeElement?.id || '');
  screen.replaceChildren();
  screen.append(tabs('users'));
  const head = node('div', 'page-head');
  const copy = node('div');
  copy.append(node('div', 'eyebrow', 'ШТАБ / ЛЮДИ'), node('h1', '', 'Пользователи'), node('p', 'lead', 'Добавьте ученика или преподавателя. Пароль создаётся сам и показывается один раз.'));
  const add = node('button', 'primary', 'Добавить пользователя');
  add.type = 'button';
  add.addEventListener('click', () => {
    state.userForm = { mode: 'create', login: '', name: '', role: 'student', lessons: new Set(), error: '' };
    renderUsers();
    $('#user-login')?.focus();
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
function userRow(person) {
  const row = node('tr');
  const cells = [
    ['Логин', person.login, 'user-login'],
    ['Имя', person.name, ''],
    ['Роль', roleTitle(person), 'nowrap'],
    ['Уроки', lessonsTitle(person), 'lessons-cell'],
    ['Статус', person.disabled ? 'Отключена' : 'Включена', 'nowrap'],
  ];
  for (const [label, text, className] of cells) {
    const cell = node('td', className, text);
    cell.dataset.label = label;
    row.append(cell);
  }
  const actions = node('td', 'actions-cell');
  actions.dataset.label = 'Действия';
  const bar = node('div', 'actions');
  const edit = node('button', '', 'Изменить');
  edit.type = 'button';
  edit.addEventListener('click', () => {
    state.userForm = {
      mode: 'edit',
      login: person.login,
      name: person.name,
      role: personIsTeacher(person) ? 'teacher' : 'student',
      lessons: new Set(person.lessons || []),
      error: '',
    };
    renderUsers();
    $('#user-name')?.focus();
  });
  const reset = node('button', '', 'Новый пароль');
  reset.type = 'button';
  reset.addEventListener('click', () => resetUser(person));
  const power = node('button', '', person.disabled ? 'Включить' : 'Отключить');
  power.type = 'button';
  power.addEventListener('click', () => toggleUser(person));
  const remove = node('button', 'danger', 'Удалить');
  remove.type = 'button';
  remove.addEventListener('click', () => removeUser(person));
  bar.append(edit, reset, power, remove);
  actions.append(bar);
  row.append(actions);
  return row;
}
function userForm(draft) {
  const form = node('form', 'card user-card');
  form.id = 'user-form';
  form.noValidate = true;
  form.autocomplete = 'off';
  form.append(node('h3', '', draft.mode === 'create' ? 'Новый пользователь' : `Правка · ${draft.login}`));
  form.append(node('p', 'hint', 'Логин — почта или короткие латинские буквы. Пароль придумает сайт и покажет его один раз.'));
  if (draft.mode === 'create') form.append(textField('Логин', 'login', draft.login, 'ivan или ivan@school.ru', 64));
  form.append(textField('Имя', 'name', draft.name, 'Как обращаться к человеку', 80));
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
  input.id = name === 'login' ? 'user-login' : 'user-name';
  input.value = value || '';
  input.placeholder = placeholder;
  input.maxLength = max;
  input.autocomplete = 'off';
  input.spellcheck = false;
  wrap.append(input);
  return wrap;
}
function readUserForm() {
  const form = $('#user-form');
  const draft = state.userForm;
  if (!form || !draft) return null;
  if (draft.mode === 'create') draft.login = form.login.value.trim();
  draft.name = form.name.value.trim();
  draft.role = form.querySelector('input[name=user-role]:checked')?.value || 'student';
  draft.lessons = new Set([...form.querySelectorAll('input[name=lesson]:checked')].map(input => input.value));
  return draft;
}
async function saveUser() {
  const draft = readUserForm();
  if (!draft || state.busy) return;
  if (draft.mode === 'create' && !draft.login) { draft.error = 'Напишите логин.'; renderUsers(); return; }
  if (!draft.name) { draft.error = 'Напишите имя.'; renderUsers(); return; }
  if (draft.mode === 'edit' && draft.login === state.me && draft.role !== 'teacher') { draft.error = 'Нельзя понизить свою роль.'; renderUsers(); return; }
  setBusy(true);
  try {
    const lessons = [...draft.lessons];
    if (draft.mode === 'create') {
      const data = await api('/api/admin/accounts', { method: 'POST', body: { login: draft.login, name: draft.name, role: draft.role, lessons } });
      state.userForm = null;
      clearUserFilters();
      state.notice = `Пользователь ${data.account.name} создан.`;
      showPassword(data.password, `Пароль для ${data.account.name}`, false);
      await refreshPeople();
    } else {
      await api(`/api/admin/accounts/${encodeURIComponent(draft.login)}`, { method: 'PATCH', body: { name: draft.name, role: draft.role, lessons } });
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
    const self = person.login === state.me;
    showPassword(data.password, self ? 'Ваш новый пароль' : `Пароль для ${person.name}`, self);
    if (!self) await refreshPeople();
  } catch (error) { state.notice = error.message; }
  finally { setBusy(false); }
  if (person.login !== state.me) renderUsers();
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
