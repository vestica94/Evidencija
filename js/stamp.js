(function () {
'use strict';
// Naljepnica dokaza („Prilog predlagatelja P-03") na slikama i PDF-ovima.
// Naljepnicu crtamo na canvas pa je u PDF ugrađujemo kao sliku – tako
// hrvatska slova (č, ć, đ, š, ž) uvijek izgledaju ispravno.

function exhibitCode(settings, no) {
  const prefix = (settings.prefix || '').trim();
  const num = String(no).padStart(2, '0');
  return prefix ? `${prefix}-${num}` : num;
}

function fitText(ctx, text, maxWidth, size, weight, family) {
  let s = size;
  do {
    ctx.font = `${weight} ${s}px ${family}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    s -= 1;
  } while (s > 6);
  return s;
}

/** Nacrta naljepnicu širine w na (x, y). Vraća visinu. */
function drawSticker(ctx, x, y, w, { title, code, caption }) {
  const h = Math.round(w * 0.62);
  const family = 'Arial, Helvetica, sans-serif';
  const pad = w * 0.06;
  const border = Math.max(2, w * 0.022);

  ctx.save();
  ctx.fillStyle = '#ffe14d';
  ctx.fillRect(x, y, w, h);
  ctx.lineWidth = border;
  ctx.strokeStyle = '#111';
  ctx.strokeRect(x + border / 2, y + border / 2, w - border, h - border);

  ctx.fillStyle = '#111';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const inner = w - pad * 2;
  const cx = x + w / 2;

  const t = (title || '').trim();
  const titleSize = fitText(ctx, t, inner, Math.round(w * 0.12), 700, family);
  ctx.fillText(t, cx, y + pad + titleSize * 0.9);

  const codeSize = fitText(ctx, code, inner, Math.round(w * 0.27), 800, family);
  const codeY = y + h * 0.66;
  ctx.fillText(code, cx, codeY);

  // crta ispod broja
  ctx.fillRect(x + pad, codeY + w * 0.03, inner, Math.max(1, w * 0.008));

  const c = (caption || '').trim();
  if (c) {
    const capSize = fitText(ctx, c.toUpperCase(), inner, Math.round(w * 0.085), 600, family);
    ctx.fillText(c.toUpperCase(), cx, y + h - pad * 0.9 - capSize * 0.1);
  }
  ctx.restore();
  return h;
}

function stickerCanvas(width, opts) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = Math.round(width * 0.62);
  drawSticker(c.getContext('2d'), 0, 0, width, opts);
  return c;
}

function canvasToBlob(canvas, type = 'image/png', quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Slika se ne može učitati.')); };
    img.src = url;
  });
}

function placement(position, pageW, pageH, w, h, margin) {
  switch (position) {
    case 'gore-desno': return { x: pageW - w - margin, y: margin };
    case 'dolje-desno': return { x: pageW - w - margin, y: pageH - h - margin };
    case 'dolje-lijevo': return { x: margin, y: pageH - h - margin };
    default: return { x: margin, y: margin };
  }
}

async function stampImage(blob, opts, position) {
  const img = await loadImage(blob);
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const w = Math.round(Math.max(140, Math.min(W, H) * 0.32));
  const h = Math.round(w * 0.62);
  const m = Math.round(Math.min(W, H) * 0.025);
  const { x, y } = placement(position, W, H, w, h, m);
  drawSticker(ctx, x, y, w, opts);
  const isPng = blob.type === 'image/png';
  return canvasToBlob(c, isPng ? 'image/png' : 'image/jpeg', 0.92);
}

let pdfLibPromise;
function loadPdfLib() {
  if (window.PDFLib) return Promise.resolve(window.PDFLib);
  if (!pdfLibPromise) {
    pdfLibPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'vendor/pdf-lib.min.js';
      s.onload = () => resolve(window.PDFLib);
      s.onerror = () => { pdfLibPromise = null; reject(new Error('PDF biblioteka se ne može učitati.')); };
      document.head.appendChild(s);
    });
  }
  return pdfLibPromise;
}

async function stampPdf(blob, opts, position) {
  const { PDFDocument } = await loadPdfLib();
  const pdf = await PDFDocument.load(await blob.arrayBuffer(), { ignoreEncryption: true });
  const png = await canvasToBlob(stickerCanvas(600, opts));
  const image = await pdf.embedPng(await png.arrayBuffer());
  const page = pdf.getPages()[0];
  if (page) {
    const { width, height } = page.getSize();
    const w = Math.min(width, height) * 0.26;
    const h = w * 0.62;
    const m = Math.min(width, height) * 0.03;
    // PDF koordinate kreću od donjeg lijevog kuta
    const p = placement(position, width, height, w, h, m);
    page.drawImage(image, { x: p.x, y: height - p.y - h, width: w, height: h });
  }
  const bytes = await pdf.save();
  return new Blob([bytes], { type: 'application/pdf' });
}

function isImage(doc) {
  return /^image\/(png|jpe?g|webp|gif|bmp)$/i.test(doc.type || '');
}

function isPdf(doc) {
  return doc.type === 'application/pdf' || /\.pdf$/i.test(doc.name || '');
}

/** Vraća blob dokumenta s naljepnicom (ili original ako vrsta nije podržana). */
async function stampDoc(doc, settings) {
  const opts = {
    title: settings.stickerTitle,
    code: exhibitCode(settings, doc.exhibitNo),
    caption: settings.caseName,
  };
  if (isImage(doc)) return stampImage(doc.blob, opts, settings.stickerPosition);
  if (isPdf(doc)) return stampPdf(doc.blob, opts, settings.stickerPosition);
  return doc.blob;
}

function stampedFileName(doc, settings) {
  const code = exhibitCode(settings, doc.exhibitNo);
  let name = doc.name || 'dokument';
  if (isImage(doc) && doc.blob.type !== 'image/png') name = name.replace(/\.(png|webp|gif|bmp|jpe?g)$/i, '') + '.jpg';
  return `${code} ${name}`;
}

window.EvStamp = { exhibitCode, drawSticker, stickerCanvas, stampImage, stampPdf, isImage, isPdf, stampDoc, stampedFileName };
})();
