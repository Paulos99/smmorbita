// Turns a teacher HTML file, or a ZIP with index.html and nearby assets, into one HTML file.
// One object in storage can then be opened by a signed URL. Assets stay inside the page.
const HTML_MAX = 40 * 1024 * 1024;
const FILE_MAX = 40;
const MIME = {
  css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', json: 'application/json', txt: 'text/plain',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', mp3: 'audio/mpeg',
};
const TEXT_EXT = new Set(['css', 'js', 'mjs', 'json', 'txt', 'svg', 'html', 'htm']);

export async function packLessonHtml(name, bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const ext = String(name || '').split('.').pop().toLowerCase();
  if (ext === 'html' || ext === 'htm') {
    if (data.byteLength > HTML_MAX) throw new Error('HTML больше 40 МБ.');
    return { filename: ext === 'htm' ? 'index.htm' : 'index.html', bytes: data };
  }
  if (ext !== 'zip') throw new Error('Нужен файл HTML или ZIP с index.html.');
  const files = await unpackZip(data);
  const { root, index } = locateIndex(files);
  let html = decodeText(files.get(index), 'index.html');
  const dir = index.includes('/') ? index.slice(0, index.lastIndexOf('/') + 1) : '';
  html = inlineStyles(html, dir, root, files);
  html = inlineScripts(html, dir, root, files);
  html = inlineSources(html, dir, root, files);
  const out = new TextEncoder().encode(html);
  if (out.byteLength > HTML_MAX) throw new Error('Страница вместе с картинками больше 40 МБ. Уберите лишнее из архива или загрузите видео отдельно.');
  return { filename: 'index.html', bytes: out };
}

function locateIndex(files) {
  const names = [...files.keys()].filter(name => !name.startsWith('__MACOSX/') && !name.endsWith('.DS_Store'));
  const indexes = names.filter(name => /(^|\/)index\.html?$/i.test(name));
  if (!indexes.length) throw new Error('В архиве нужен index.html.');
  const top = indexes.find(name => name.toLowerCase() === 'index.html' || name.toLowerCase() === 'index.htm');
  const index = top || (indexes.length === 1 ? indexes[0] : '');
  if (!index) throw new Error('В архиве несколько index.html. Оставьте один, в корне или в одной папке.');
  return { root: index.slice(0, index.lastIndexOf('/') + 1), index };
}

function inlineStyles(html, dir, root, files) {
  return html.replace(/<link\b([^>]*?)>/gi, (tag, attrs) => {
    if (!/\brel\s*=\s*["']?stylesheet["']?/i.test(attrs) && !/\bstylesheet\b/i.test(attrs)) return tag;
    const href = attr(attrs, 'href');
    const path = href && resolveRel(dir, href);
    if (!path) return tag;
    const file = files.get(root + path) || files.get(path);
    if (!file) throw new Error(`В архиве нет файла ${path}, на который ссылается страница.`);
    const css = rewriteCss(decodeText(file, path), path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '', root, files);
    return `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`;
  });
}

function inlineScripts(html, dir, root, files) {
  return html.replace(/<script\b([^>]*)\bsrc\s*=\s*(["'])(.*?)\2([^>]*)>\s*<\/script>/gi, (tag, before, _q, src, after) => {
    const path = resolveRel(dir, src);
    if (!path) return tag;
    const file = files.get(root + path) || files.get(path);
    if (!file) throw new Error(`В архиве нет файла ${path}, на который ссылается страница.`);
    const type = `${before} ${after}`.match(/\btype\s*=\s*(["'])(.*?)\1/i)?.[2] || '';
    const code = decodeText(file, path).replace(/<\/script/gi, '<\\/script');
    const typeAttr = type ? ` type="${type.replace(/"/g, '')}"` : '';
    return `<script${typeAttr}>${code}</script>`;
  });
}

function inlineSources(html, dir, root, files) {
  const rewrite = value => rewriteOne(value, dir, root, files);
  html = html.replace(/\s(src|poster|href)\s*=\s*(["'])(.*?)\2/gi, (all, name, quote, value) => {
    if (/^href$/i.test(name) && /<link\b/i.test(all)) return all;
    const next = rewrite(value);
    return next === value ? all : ` ${name}=${quote}${next}${quote}`;
  });
  html = html.replace(/\ssrcset\s*=\s*(["'])(.*?)\1/gi, (all, quote, value) => {
    const next = value.split(',').map(part => {
      const bits = part.trim().split(/\s+/);
      if (!bits[0]) return part;
      bits[0] = rewrite(bits[0]);
      return bits.join(' ');
    }).join(', ');
    return ` srcset=${quote}${next}${quote}`;
  });
  return html;
}

function rewriteCss(css, dir, root, files) {
  return css.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (all, quote, value) => {
    const next = rewriteOne(value, dir, root, files);
    return next === value ? all : `url(${quote}${next}${quote})`;
  });
}

function rewriteOne(value, dir, root, files) {
  const path = resolveRel(dir, value);
  if (!path) return value;
  const file = files.get(root + path) || files.get(path);
  if (!file) return value;
  const ext = path.split('.').pop().toLowerCase();
  if (!MIME[ext] || TEXT_EXT.has(ext) && ext !== 'svg') return value;
  return dataUri(MIME[ext], file);
}

function resolveRel(dir, rel) {
  const value = String(rel || '').trim();
  if (!value || /^(https?:)?\/\//i.test(value) || /^(data:|blob:|mailto:|#)/i.test(value)) return null;
  const clean = value.split('#')[0].split('?')[0];
  if (!clean || clean.startsWith('/')) return null;
  const parts = `${dir}${clean}`.split('/');
  const out = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') { if (!out.length) return null; out.pop(); continue; }
    out.push(part);
  }
  return out.join('/');
}

function dataUri(mime, bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return `data:${mime};base64,${btoa(binary)}`;
}

function decodeText(bytes, name) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error(`${name} должен быть в кодировке UTF-8.`); }
}

async function unpackZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  const min = Math.max(0, bytes.length - 22 - 65535);
  for (let i = bytes.length - 22; i >= min; i--) if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Это не ZIP-архив.');
  const count = view.getUint16(eocd + 10, true);
  if (count > FILE_MAX) throw new Error('В архиве слишком много файлов. Максимум — 40.');
  let central = view.getUint32(eocd + 16, true);
  const files = new Map();
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (central + 46 > bytes.length || view.getUint32(central, true) !== 0x02014b50) throw new Error('Архив повреждён.');
    const flags = view.getUint16(central + 8, true);
    const method = view.getUint16(central + 10, true);
    const compSize = view.getUint32(central + 20, true);
    const rawSize = view.getUint32(central + 24, true);
    const nameLen = view.getUint16(central + 28, true);
    const extraLen = view.getUint16(central + 30, true);
    const commentLen = view.getUint16(central + 32, true);
    const localOff = view.getUint32(central + 42, true);
    if (flags & 0x1) throw new Error('Архив с паролем открыть нельзя.');
    if (compSize === 0xffffffff || rawSize === 0xffffffff) throw new Error('Архив слишком большой.');
    const name = safeZipName(new TextDecoder('utf-8').decode(bytes.subarray(central + 46, central + 46 + nameLen)));
    if (localOff + 30 > bytes.length || view.getUint32(localOff, true) !== 0x04034b50) throw new Error('Архив повреждён.');
    const dataOff = localOff + 30 + view.getUint16(localOff + 26, true) + view.getUint16(localOff + 28, true);
    if (dataOff + compSize > bytes.length) throw new Error('Архив повреждён.');
    const raw = await inflate(bytes.subarray(dataOff, dataOff + compSize), method, rawSize);
    if (raw.byteLength > HTML_MAX) throw new Error('В архиве есть файл больше 40 МБ.');
    if (compSize > 0 && raw.byteLength / compSize > 80) throw new Error('Архив слишком сильно сжат. Сохраните его обычным ZIP.');
    total += raw.byteLength;
    if (total > HTML_MAX) throw new Error('Архив больше 40 МБ.');
    if (name && !name.endsWith('/') && !name.startsWith('__MACOSX/') && !name.endsWith('.DS_Store')) {
      if (files.size >= FILE_MAX) throw new Error('В архиве слишком много файлов. Максимум — 40.');
      files.set(name, raw);
    }
    central += 46 + nameLen + extraLen + commentLen;
  }
  if (!files.size) throw new Error('Архив пустой.');
  return files;
}

function safeZipName(name) {
  const norm = String(name || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = norm.replace(/\/$/, '').split('/');
  if (!norm || parts.some(part => !part || part === '.' || part === '..')) throw new Error('В архиве небезопасное имя файла.');
  return norm;
}

async function inflate(bytes, method, rawSize) {
  if (method === 0) return bytes;
  if (method !== 8) throw new Error('В архиве есть файл со сжатием, которое нельзя открыть. Сохраните ZIP обычным способом.');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const raw = new Uint8Array(await new Response(stream).arrayBuffer());
  if (rawSize && raw.byteLength !== rawSize) throw new Error('Архив повреждён.');
  return raw;
}

function attr(source, name) {
  return source.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'))?.[2]
    || source.match(new RegExp(`\\b${name}\\s*=\\s*([^\\s>]+)`, 'i'))?.[1]
    || '';
}
