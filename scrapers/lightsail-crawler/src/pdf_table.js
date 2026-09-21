// Minimal PDF 1.4 table writer. Helvetica / WinAnsi only — never emit
// raw UTF-8 glyphs (checkmark, em-dash) into the stream.

export function winAnsiSafe(str) {
  return String(str ?? '')
    .replace(/✓|✔|☑|√/g, 'Y')
    .replace(/✗|✘|×/g, 'N')
    .replace(/[—–−]/g, '-')
    .replace(/['']/g, "'")
    .replace(/[""]/g, '"')
    .replace(/[^\x20-\x7E]/g, '?');
}

function pdfEscape(str) {
  return winAnsiSafe(str)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function wrapCell(text, maxChars) {
  const raw = winAnsiSafe(String(text ?? '')).replace(/\s+/g, ' ').trim() || '-';
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
  return lines.slice(0, 8);
}

function addObj(objects, body) {
  objects.push(body);
  return objects.length;
}

function assemblePdf(objects, catalogId) {
  let xrefPos = 0;
  const chunks = ['%PDF-1.4\n'];
  xrefPos = Buffer.byteLength(chunks[0], 'latin1');
  const offsets = [0];
  objects.forEach((body, i) => {
    const obj = `${i + 1} 0 obj\n${body}\nendobj\n`;
    offsets.push(xrefPos);
    chunks.push(obj);
    xrefPos += Buffer.byteLength(obj, 'latin1');
  });

  let xref = `xref\n0 ${objects.length + 1}\n`;
  xref += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i++) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  chunks.push(xref, trailer);
  return Buffer.concat(chunks.map((c) => Buffer.from(c, 'latin1')));
}

function drawPlainPage({ title, subtitle, pageIdx, pageCount, pageW, pageH, margin, blocks }) {
  let stream = 'BT\n';
  stream += `/F2 14 Tf\n`;
  stream += `1 0 0 1 ${margin} ${pageH - margin - 16} Tm\n(${pdfEscape(title)}) Tj\n`;
  stream += `/F1 8 Tf\n`;
  stream += `1 0 0 1 ${margin} ${pageH - margin - 28} Tm\n(${pdfEscape(`${subtitle}  |  page ${pageIdx + 1} of ${pageCount}`)}) Tj\n`;
  stream += 'ET\n';

  let y = pageH - margin - 48;
  for (const block of blocks) {
    if (block.heading) {
      stream += 'BT\n';
      stream += `/F2 10 Tf\n`;
      stream += `1 0 0 1 ${margin} ${y} Tm\n(${pdfEscape(block.heading)}) Tj\n`;
      stream += 'ET\n';
      y -= 14;
    }
    for (const line of block.lines || []) {
      if (y < margin + 16) break;
      stream += 'BT\n';
      stream += `/F1 8 Tf\n`;
      stream += `1 0 0 1 ${margin} ${y} Tm\n(${pdfEscape(line)}) Tj\n`;
      stream += 'ET\n';
      y -= 11;
    }
    y -= 8;
  }
  return stream;
}

export function buildTablePdf({
  title = 'Report',
  subtitle = '',
  columns,
  rows,
  summaryBlocks = null,
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
  const tablePages = [];

  let pageRows = [];
  let yUsed = 0;
  const maxBody = pageH - margin * 2 - headerH - 16;

  function flushPage() {
    if (pageRows.length === 0) return;
    tablePages.push(pageRows);
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
  if (tablePages.length === 0) tablePages.push([]);

  const frontCount = summaryBlocks && summaryBlocks.length ? 1 : 0;
  const pageCount = frontCount + tablePages.length;

  const fontId = addObj(objects, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const fontBoldId = addObj(objects, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  const pageIds = [];
  const contentIds = [];

  if (frontCount) {
    const stream = drawPlainPage({
      title,
      subtitle,
      pageIdx: 0,
      pageCount,
      pageW,
      pageH,
      margin,
      blocks: summaryBlocks,
    });
    contentIds.push(addObj(objects, `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`));
    pageIds.push(null);
  }

  tablePages.forEach((bodyRows, tableIdx) => {
    const pageIdx = frontCount + tableIdx;
    let stream = 'BT\n';
    stream += `/F2 12 Tf\n`;
    stream += `1 0 0 1 ${margin} ${pageH - margin - 14} Tm\n(${pdfEscape(title)}) Tj\n`;
    stream += `/F1 8 Tf\n`;
    stream += `1 0 0 1 ${margin} ${pageH - margin - 26} Tm\n(${pdfEscape(`${subtitle}  |  page ${pageIdx + 1} of ${pageCount}`)}) Tj\n`;
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

    contentIds.push(addObj(objects, `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`));
    pageIds.push(null);
  });

  const pagesObjIndex = objects.length;
  addObj(objects, 'placeholder');

  pageIds.forEach((_, i) => {
    const id = addObj(
      objects,
      `<< /Type /Page /Parent ${pagesObjIndex + 1} 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Contents ${contentIds[i]} 0 R /Resources << /Font << /F1 ${fontId} 0 R /F2 ${fontBoldId} 0 R >> >> >>`
    );
    pageIds[i] = id;
  });

  objects[pagesObjIndex] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  const catalogId = addObj(objects, `<< /Type /Catalog /Pages ${pagesObjIndex + 1} 0 R >>`);
  return assemblePdf(objects, catalogId);
}

export function buildSummaryBlocks({ generatedAt, dealerCount, summary, brandRates, ready }) {
  const classLines = Object.entries(summary).map(([cls, n]) => {
    const pct = dealerCount ? Math.round((n / dealerCount) * 100) : 0;
    return `${cls.padEnd(22)} ${String(n).padStart(4)}  (${pct}%)`;
  });

  const brandLines = brandRates.map(
    (b) => `${b.brand.padEnd(18)} ${String(b.ready).padStart(3)}/${String(b.total).padEnd(3)} ready  ${b.passRate}`
  );

  const readyLines = ready.length
    ? ready.map((r) => `${r.brand}  ${r.dealerName}  ${r.domain}  HTTP ${r.httpStatus || 200}`)
    : ['(none this run)'];

  return [
    { heading: 'Classification', lines: classLines },
    { heading: 'Per-brand ready (NONE + HTTP 200)', lines: brandLines.length ? brandLines : ['(none)'] },
    { heading: 'Ready to crawl now', lines: readyLines },
    {
      heading: 'Notes',
      lines: [
        `Generated ${generatedAt}  |  ${dealerCount} rooftops  |  detect only, no WAF bypass`,
        'DNS_DEAD / HTTP_404 / HTTP_5XX / CONN_RESET are infra, not bot protection.',
        'Inbox harvest is a crawl-time job, not this report.',
      ],
    },
  ];
}
