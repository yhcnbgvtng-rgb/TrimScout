// Minimal PDF 1.4 table writer. No extra dependency — landscape pages with
// a header + wrapped cells. Used by the dealer bot-protection report.

function pdfEscape(str) {
  return String(str ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function wrapCell(text, maxChars) {
  const raw = String(text ?? '').replace(/\s+/g, ' ').trim() || '—';
  const words = raw.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > maxChars && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 6);
}

export function buildTablePdf({
  title = 'Report',
  subtitle = '',
  columns,
  rows,
} = {}) {
  const pageW = 792;
  const pageH = 612;
  const margin = 36;
  const headerH = 48;
  const fontSize = 8;
  const lineH = 10;
  const usableW = pageW - margin * 2;
  const totalWeight = columns.reduce((s, c) => s + (c.width || 1), 0);
  const colWidths = columns.map((c) => ((c.width || 1) / totalWeight) * usableW);
  const colChars = colWidths.map((w) => Math.max(8, Math.floor(w / 4.4)));

  const objects = [];
  const pages = [];

  function addObj(body) {
    objects.push(body);
    return objects.length;
  }

  let pageRows = [];
  let yUsed = 0;
  const maxBody = pageH - margin * 2 - headerH - 16;

  function flushPage() {
    if (pageRows.length === 0) return;
    pages.push(pageRows);
    pageRows = [];
    yUsed = 0;
  }

  for (const row of rows) {
    const wrapped = columns.map((col, i) => wrapCell(row[col.key], colChars[i]));
    const rowLines = Math.max(1, ...wrapped.map((w) => w.length));
    const h = rowLines * lineH + 6;
    if (yUsed + h > maxBody && pageRows.length) flushPage();
    pageRows.push({ wrapped, h });
    yUsed += h;
  }
  flushPage();
  if (pages.length === 0) pages.push([]);

  const fontId = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const fontBoldId = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  const pageIds = [];
  const contentIds = [];

  pages.forEach((bodyRows, pageIdx) => {
    let stream = 'BT\n';
    stream += `/F2 12 Tf\n`;
    stream += `1 0 0 1 ${margin} ${pageH - margin - 14} Tm\n(${pdfEscape(title)}) Tj\n`;
    stream += `/F1 8 Tf\n`;
    stream += `1 0 0 1 ${margin} ${pageH - margin - 26} Tm\n(${pdfEscape(subtitle)}  ·  page ${pageIdx + 1} of ${pages.length}) Tj\n`;
    stream += 'ET\n';

    let y = pageH - margin - headerH;
    const drawRow = (cells, bold) => {
      let x = margin;
      stream += 'BT\n';
      cells.forEach((lines, i) => {
        const font = bold ? '/F2' : '/F1';
        lines.forEach((line, li) => {
          stream += `${font} ${fontSize} Tf\n`;
          stream += `1 0 0 1 ${x + 2} ${y - 10 - li * lineH} Tm\n(${pdfEscape(line)}) Tj\n`;
        });
        x += colWidths[i];
      });
      stream += 'ET\n';
      const h = Math.max(1, ...cells.map((c) => c.length)) * lineH + 6;
      stream += `0.75 0.8 0.86 RG\n${margin} ${y - h} ${usableW} ${h} re S\n`;
      y -= h;
    };

    drawRow(columns.map((c, i) => wrapCell(c.header, colChars[i])), true);
    for (const row of bodyRows) drawRow(row.wrapped, false);

    const bytes = Buffer.from(stream, 'utf8');
    contentIds.push(addObj(`<< /Length ${bytes.length} >>\nstream\n${stream}\nendstream`));
    pageIds.push(null);
  });

  const pagesObjIndex = objects.length;
  addObj('placeholder');

  pages.forEach((_, i) => {
    const id = addObj(
      `<< /Type /Page /Parent ${pagesObjIndex + 1} 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Contents ${contentIds[i]} 0 R /Resources << /Font << /F1 ${fontId} 0 R /F2 ${fontBoldId} 0 R >> >> >>`
    );
    pageIds[i] = id;
  });

  objects[pagesObjIndex] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  const catalogId = addObj(`<< /Type /Catalog /Pages ${pagesObjIndex + 1} 0 R >>`);

  let xrefPos = 0;
  const chunks = ['%PDF-1.4\n'];
  xrefPos = Buffer.byteLength(chunks[0]);
  const offsets = [0];
  objects.forEach((body, i) => {
    const obj = `${i + 1} 0 obj\n${body}\nendobj\n`;
    offsets.push(xrefPos);
    chunks.push(obj);
    xrefPos += Buffer.byteLength(obj);
  });

  let xref = `xref\n0 ${objects.length + 1}\n`;
  xref += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i++) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  chunks.push(xref, trailer);
  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}
