// DOCX (Office Open XML) → lecture sections. Headings become sections; body becomes paragraphs and lists.
// Runs in the browser (DecompressionStream) and in Node (the same API, or zlib).

async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== 'undefined') {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  const { inflateRawSync } = await import('node:zlib');
  return new Uint8Array(inflateRawSync(bytes));
}

export async function unzip(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  const min = Math.max(0, bytes.length - 22 - 65536);
  for (let i = bytes.length - 22; i >= min; i--) if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Не удалось прочитать документ Word.');
  const count = view.getUint16(eocd + 10, true);
  let ptr = view.getUint32(eocd + 16, true);
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (ptr + 46 > bytes.length || view.getUint32(ptr, true) !== 0x02014b50) throw new Error('Не удалось прочитать документ Word.');
    const method = view.getUint16(ptr + 10, true);
    const compSize = view.getUint32(ptr + 20, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localOff = view.getUint32(ptr + 42, true);
    if (compSize === 0xffffffff || localOff + 30 > bytes.length) throw new Error('Этот документ Word слишком необычный. Сохраните его ещё раз из Word.');
    const name = new TextDecoder().decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
    const localName = view.getUint16(localOff + 26, true);
    const localExtra = view.getUint16(localOff + 28, true);
    const dataOff = localOff + 30 + localName + localExtra;
    const comp = bytes.subarray(dataOff, dataOff + compSize);
    let data;
    if (method === 0) data = comp;
    else if (method === 8) data = await inflateRaw(comp);
    else throw new Error('Не удалось прочитать документ Word.');
    files.set(name, data);
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

function decodeXml(value) {
  return value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

function paragraphText(xml) {
  let out = '';
  const re = /<w:t\b[^>]*>([^<]*)<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>/g;
  let match;
  while ((match = re.exec(xml))) out += match[1] != null ? decodeXml(match[1]) : ' ';
  return out.replace(/\s+/g, ' ').trim();
}

function isHeading(style, outline) {
  if (outline != null && Number(outline) <= 2) return true;
  const name = String(style || '').toLowerCase().replace(/\s+/g, '');
  return /^heading[1-3]$/.test(name) || /^заголовок[1-3]$/.test(name) || name === 'title' || name === 'название';
}

function minutesLabel(words) {
  const minutes = Math.max(1, Math.round(words / 130));
  const mod10 = minutes % 10, mod100 = minutes % 100;
  const word = mod10 === 1 && mod100 !== 11 ? 'минута' : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'минуты' : 'минут';
  return `${minutes} ${word}`;
}

export async function docxToSections(buffer) {
  const files = await unzip(buffer);
  const xmlBytes = files.get('word/document.xml');
  if (!xmlBytes) throw new Error('В файле Word нет текста.');
  const xml = new TextDecoder('utf-8').decode(xmlBytes).replace(/^\uFEFF/, '').replace(/<w:del\b[\s\S]*?<\/w:del>/g, '');
  const paragraphs = xml.match(/<w:p\b[\s\S]*?<\/w:p>/g) || [];
  const sections = [];
  let current = null, list = null, headingCount = 0;
  const ensure = () => {
    if (!current) { current = { title: 'Лекция', blocks: [] }; sections.push(current); }
    return current;
  };
  for (const paragraph of paragraphs) {
    const style = /<w:pStyle\b[^>]*w:val="([^"]+)"/.exec(paragraph)?.[1] || '';
    const outline = /<w:outlineLvl\b[^>]*w:val="(\d+)"/.exec(paragraph)?.[1];
    const text = paragraphText(paragraph);
    if (!text) continue;
    if (isHeading(style, outline)) {
      list = null; headingCount += 1;
      current = { title: text, blocks: [] };
      sections.push(current);
      continue;
    }
    const target = ensure();
    if (/<w:numPr\b/.test(paragraph)) {
      if (!list) { list = { type: 'list', items: [] }; target.blocks.push(list); }
      list.items.push(text);
    } else {
      list = null;
      target.blocks.push({ type: 'paragraph', text });
    }
  }
  const kept = sections.filter(section => section.title && section.blocks.length);
  if (!kept.length) throw new Error('В документе не нашлось текста.');
  const words = kept.reduce((sum, section) => sum + [section.title, ...section.blocks.flatMap(block => block.items || [block.text || ''])].join(' ').split(/\s+/).filter(Boolean).length, 0);
  return { sections: kept, readingTime: minutesLabel(words), headingCount };
}

export function linesFromSections(sections) {
  const lines = [];
  for (const section of sections || []) {
    lines.push({ kind: 'h', text: section.title });
    for (const block of section.blocks || []) {
      if (block.items) for (const item of block.items) lines.push({ kind: 'li', text: item });
      else if (block.text) lines.push({ kind: block.type === 'quote' ? 'q' : 'p', text: block.text });
    }
  }
  return lines;
}
