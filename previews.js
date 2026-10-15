// Slide and document previews are made in the teacher's browser, then uploaded as WebP.
// The container cannot rasterize a 90 MB deck: the request body is capped and the run ends at 30 seconds.
// PDF (preferred) is rendered with the PDF.js already shipped for the student viewer, at about 1600 px wide.
// Word lectures are not rasterized: headings become text sections. A Word workbook or extra file is
// paginated into simple text pages so the existing image viewer can open it. PowerPoint is stored for
// download only — ask for a PDF if the slides should be readable on the site.

const MAX_PAGES = 120;

async function webp(canvas, quality) {
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality));
  if (!blob || !blob.type.includes('webp')) throw new Error('Этот браузер не умеет сохранять картинки WebP. Откройте кабинет в Chrome или Яндекс Браузере.');
  return blob;
}

export async function pdfToWebpBlobs(data, { maxWidth = 1600, quality = 0.8, onProgress, maxPages = MAX_PAGES } = {}) {
  const pdfjs = await import('./assets/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('./assets/pdf.worker.mjs', import.meta.url).href;
  const task = pdfjs.getDocument({ data, isEvalSupported: false, standardFontDataUrl: new URL('./assets/standard_fonts/', import.meta.url).href });
  const doc = await task.promise;
  const total = doc.numPages;
  const count = Math.min(total, maxPages);
  const blobs = [];
  for (let pageNumber = 1; pageNumber <= count; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(maxWidth / base.width, 3) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    blobs.push(await webp(canvas, quality));
    page.cleanup();
    onProgress?.(pageNumber, count);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  await task.destroy().catch(() => {});
  return { blobs, total, truncated: total > count };
}

export async function textToWebpBlobs(lines, { maxWidth = 1600, quality = 0.8, onProgress, maxPages = 40 } = {}) {
  const width = maxWidth;
  const height = Math.round(width * 1.35);
  const margin = Math.round(width * 0.06);
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  const bodySize = Math.round(width / 52);
  const headSize = Math.round(bodySize * 1.35);
  const blobs = [];
  let index = 0;
  const measure = (text, size) => { ctx.font = `${size}px Inter, Arial, sans-serif`; return ctx.measureText(text).width; };
  const wrap = (text, size, max) => {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const rows = []; let row = '';
    for (const word of words) {
      const next = row ? `${row} ${word}` : word;
      if (measure(next, size) > max && row) { rows.push(row); row = word; } else row = next;
    }
    if (row) rows.push(row);
    return rows.length ? rows : [''];
  };
  const start = () => {
    ctx.fillStyle = '#f4f1ea'; ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#8a867c'; ctx.font = `${Math.round(bodySize * 0.62)}px Inter, Arial, sans-serif`;
    ctx.fillText('СММ ШКОЛА', margin, margin * 0.55);
    return margin + bodySize;
  };
  let y = start();
  const flush = async () => {
    if (blobs.length >= maxPages) return false;
    blobs.push(await webp(canvas, quality));
    onProgress?.(blobs.length, blobs.length);
    y = start();
    return true;
  };
  for (const line of lines.length ? lines : [{ kind: 'p', text: 'В документе нет текста для просмотра.' }]) {
    const size = line.kind === 'h' ? headSize : bodySize;
    const gap = line.kind === 'h' ? size * 0.9 : size * 0.45;
    const rows = wrap(line.kind === 'li' ? `• ${line.text}` : line.text, size, width - margin * 2);
    const block = rows.length * size * 1.45 + gap;
    if (y + block > height - margin && y > margin + bodySize) {
      if (!await flush()) break;
    }
    ctx.fillStyle = '#22221e'; ctx.font = `${line.kind === 'h' ? 600 : 400} ${size}px Inter, Arial, sans-serif`;
    for (const row of rows) { ctx.fillText(row, margin, y + size); y += size * 1.45; }
    y += gap; index += 1;
    if (index % 8 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  if (blobs.length < maxPages) await flush();
  onProgress?.(blobs.length, blobs.length);
  return { blobs, total: blobs.length, truncated: false };
}
