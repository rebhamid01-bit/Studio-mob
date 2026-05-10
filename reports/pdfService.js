'use strict';
/**
 * reports/pdfService.js
 *
 * Pure PDF document builder — produces a raw PDF byte-string.
 * Zero I/O, zero Blob, zero browser APIs.
 *
 * The raw string is passed to window.electronAPI.pdf.save() which
 * sends it over IPC to the main process for native filesystem write.
 *
 * Consumed by:
 *   reports/internalPdf.js  — internal/confidential report
 *   reports/clientPdf.js    — client-facing invoice
 */

/* ══════════════════════════════════════════════════════════
   MINI PDF ENGINE  (self-contained, pure JS, no deps)
   Produces valid PDF 1.4.  All browser-download code removed.
══════════════════════════════════════════════════════════ */
const PdfEngine = (() => {

  /* ── Character width table (Helvetica metrics, 1/1000 em) ─ */
  const CHAR_W = {
    ' ':278,'!':278,'"':355,'#':556,'$':556,'%':889,'&':667,"'":191,
    '(':333,')':333,'*':389,'+':584,',':278,'-':333,'.':278,'/':278,
    '0':556,'1':556,'2':556,'3':556,'4':556,'5':556,'6':556,'7':556,
    '8':556,'9':556,':':278,';':278,'<':584,'=':584,'>':584,'?':556,
    '@':1015,'A':667,'B':667,'C':722,'D':722,'E':611,'F':556,'G':722,
    'H':722,'I':278,'J':500,'K':667,'L':556,'M':833,'N':722,'O':778,
    'P':667,'Q':778,'R':667,'S':556,'T':611,'U':722,'V':667,'W':944,
    'X':667,'Y':611,'Z':556,'[':278,'\\':278,']':278,'^':469,'_':556,
    '`':333,'a':556,'b':556,'c':500,'d':556,'e':556,'f':278,'g':556,
    'h':556,'i':222,'j':222,'k':500,'l':222,'m':833,'n':556,'o':556,
    'p':556,'q':556,'r':333,'s':500,'t':278,'u':556,'v':500,'w':722,
    'x':500,'y':500,'z':500,'{':334,'|':260,'}':334,'~':584,
  };

  function _charW(c) { return CHAR_W[c] || 556; }

  /** Measure rendered width of string s at font size fs (points). */
  function strWidth(s, fs) {
    let w = 0;
    for (const c of String(s)) w += _charW(c);
    return w * fs / 1000;
  }

  /** Transliterate accented chars to ASCII for PDF embedding. */
  function toAscii(s) {
    return String(s)
      .replace(/[àáâãäå]/gi, 'a').replace(/[èéêë]/gi, 'e')
      .replace(/[ìíîï]/gi, 'i') .replace(/[òóôõö]/gi, 'o')
      .replace(/[ùúûü]/gi, 'u') .replace(/[ç]/gi, 'c')
      .replace(/[ñ]/gi, 'n')    .replace(/[ý]/gi, 'y')
      .replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2013\u2014]/g, '-').replace(/\u2026/g, '...')
      .replace(/[^\x20-\x7E]/g, '?');
  }

  /** Create a new PDF document. Returns a doc object with drawing commands. */
  function create() {
    const PW = 595.28, PH = 841.89;   // A4 points
    let _pages = [], _cur = '';
    let _isBold = false;
    let _r = '0', _g = '0', _b = '0';
    let _dr = '0', _dg = '0', _db = '0';
    let _lw = 0.5, _fs = 10;

    function _op(s) { _cur += s + '\n'; }
    function _commitPage() { if (_cur) { _pages.push(_cur); _cur = ''; } }
    function _esc(s) {
      return toAscii(String(s))
        .replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    }

    function addPage() { _commitPage(); }

    function setFont(family, style) {
      _isBold = (style || '').toLowerCase() === 'bold';
    }
    function setFontSize(sz)       { _fs = sz; }
    function setTextColor(r, g, b) { _r = (r/255).toFixed(4); _g = (g/255).toFixed(4); _b = (b/255).toFixed(4); }
    function setDrawColor(r, g, b) { _dr= (r/255).toFixed(4); _dg= (g/255).toFixed(4); _db= (b/255).toFixed(4); }
    function setLineWidth(w)       { _lw = w; }

    function text(str, x, y, opts) {
      const align  = (opts && opts.align) || 'left';
      const fRef   = _isBold ? 'F2' : 'F1';
      String(str).split('\n').forEach((line, i) => {
        let tx = x;
        const w = strWidth(line, _fs);
        if (align === 'right')  tx = x - w;
        if (align === 'center') tx = x - w / 2;
        const py = PH - y - i * (_fs * 1.35);
        _op(`BT /${fRef} ${_fs} Tf ${_r} ${_g} ${_b} rg ${tx.toFixed(2)} ${py.toFixed(2)} Td (${_esc(line)}) Tj ET`);
      });
    }

    function line(x1, y1, x2, y2) {
      const py1 = PH - y1, py2 = PH - y2;
      _op(`${_lw.toFixed(2)} w ${_dr} ${_dg} ${_db} RG ${x1.toFixed(2)} ${py1.toFixed(2)} m ${x2.toFixed(2)} ${py2.toFixed(2)} l S`);
    }

    function rect(x, y, w, h, filled) {
      const py = PH - y - h;
      if (filled) {
        const fr = (filled.r/255).toFixed(4), fg = (filled.g/255).toFixed(4), fb = (filled.b/255).toFixed(4);
        _op(`${fr} ${fg} ${fb} rg ${x.toFixed(2)} ${py.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
      } else {
        _op(`${_lw.toFixed(2)} w ${_dr} ${_dg} ${_db} RG ${x.toFixed(2)} ${py.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S`);
      }
    }

    /**
     * build() → raw PDF string (binary-safe UTF-8 Latin-1 subset)
     * Replaces the old save(filename) which used Blob + anchor click.
     * The caller is responsible for writing this string to disk via IPC.
     */
    function build() {
      _commitPage();
      if (!_pages.length) return '';

      const CATALOG = 1, PAGES = 2, F1 = 3, F2 = 4, FIRST = 5;
      const pageIds   = _pages.map((_, i) => FIRST + i * 2 + 1);
      const totalObjs = 4 + _pages.length * 2;

      let raw = '%PDF-1.4\n';
      const xref = new Array(totalObjs + 1).fill(0);

      function addObj(id, def) {
        xref[id] = raw.length;
        raw += `${id} 0 obj\n${def}\nendobj\n`;
      }

      addObj(CATALOG, `<< /Type /Catalog /Pages ${PAGES} 0 R >>`);
      addObj(PAGES,   `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${_pages.length} >>`);
      addObj(F1,      `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`);
      addObj(F2,      `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`);

      _pages.forEach((stream, i) => {
        const streamId = FIRST + i * 2;
        const pageId   = FIRST + i * 2 + 1;
        addObj(streamId, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
        addObj(pageId,
          `<< /Type /Page /Parent ${PAGES} 0 R ` +
          `/MediaBox [0 0 ${PW.toFixed(2)} ${PH.toFixed(2)}] ` +
          `/Contents ${streamId} 0 R ` +
          `/Resources << /Font << /F1 ${F1} 0 R /F2 ${F2} 0 R >> >> >>`
        );
      });

      const xrefOffset = raw.length;
      const xrefCount  = totalObjs + 1;
      raw += `xref\n0 ${xrefCount}\n0000000000 65535 f \n`;
      for (let id = 1; id <= totalObjs; id++) {
        raw += `${String(xref[id]).padStart(10, '0')} 00000 n \n`;
      }
      raw += `trailer\n<< /Size ${xrefCount} /Root ${CATALOG} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
      return raw;
    }

    return { addPage, setFont, setFontSize, setTextColor, setDrawColor, setLineWidth, text, line, rect, build };
  }

  return { create, strWidth, toAscii };
})();

/* ══════════════════════════════════════════════════════════
   FILENAME GENERATOR
══════════════════════════════════════════════════════════ */

/**
 * buildFilename(type, data) → string like "FACTURE-Amine-2026-05-08.pdf"
 *
 * type:  'internal' | 'client'
 * data:  { clientName, invNo }
 */
function buildFilename(type, data) {
  const prefix = type === 'internal' ? 'DEVIS-INTERNE' : 'FACTURE';
  const now    = new Date();
  const yyyy   = now.getFullYear();
  const mm     = String(now.getMonth() + 1).padStart(2, '0');
  const dd     = String(now.getDate()).padStart(2, '0');

  // Sanitise client name: ASCII only, spaces → hyphen, max 20 chars
  let client = '';
  if (data.clientName && data.clientName.trim()) {
    client = '-' + data.clientName.trim()
      .replace(/[àáâãäå]/gi, 'a').replace(/[èéêë]/gi, 'e')
      .replace(/[ìíîï]/gi, 'i').replace(/[òóôõö]/gi, 'o')
      .replace(/[ùúûü]/gi, 'u').replace(/[ç]/gi, 'c')
      .replace(/[^a-zA-Z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 20);
  }

  const ref = data.invNo ? `-${data.invNo}` : '';
  return `${prefix}${client}-${yyyy}-${mm}-${dd}${ref}.pdf`;
}

/* ══════════════════════════════════════════════════════════
   LAYOUT HELPERS  (shared between internalPdf and clientPdf)
══════════════════════════════════════════════════════════ */
const L = 45, R = 550, W = 505;
const PAGE_BOTTOM = 800, FOOTER_Y = 820;

function _clampStr(s, fs, maxW) {
  let o = String(s);
  while (o.length > 1 && PdfEngine.strWidth(PdfEngine.toAscii(o + '...'), fs) > maxW) o = o.slice(0, -1);
  return PdfEngine.strWidth(PdfEngine.toAscii(String(s)), fs) <= maxW ? String(s) : o + '...';
}
function checkBreak(doc, y, need, contFn) {
  if (y + need > PAGE_BOTTOM) { doc.addPage(); return contFn(doc); }
  return y;
}
function band(doc, y, h, rgb) {
  doc.rect(L, y - h + 3, W, h, { r: rgb[0], g: rgb[1], b: rgb[2] });
}
function rule(doc, y, rgb, lw) {
  doc.setDrawColor(...(rgb || [210, 210, 210])); doc.setLineWidth(lw || 0.35);
  doc.line(L, y, R, y); return y + 8;
}
function goldRule(doc, y) {
  doc.setDrawColor(185, 148, 68); doc.setLineWidth(0.9);
  doc.line(L, y, R, y); return y + 12;
}
function section(doc, label, y) {
  band(doc, y, 16, [245, 238, 220]);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(130, 95, 20);
  doc.text(label.toUpperCase(), L + 6, y - 1); return y + 9;
}
function row(doc, label, value, y, bold, opts) {
  const fs = (opts && opts.fontSize)   || (bold ? 10 : 9.5);
  const lh = (opts && opts.lineHeight) || (bold ? 16 : 14);
  const lc = (opts && opts.labelColor) || [60, 60, 60];
  const vc = (opts && opts.valueColor) || lc;
  doc.setFont('helvetica', bold ? 'bold' : ''); doc.setFontSize(fs); doc.setTextColor(...lc);
  doc.text(_clampStr(label, fs, W - 130), L, y);
  doc.setFont('helvetica', bold ? 'bold' : ''); doc.setFontSize(fs); doc.setTextColor(...vc);
  doc.text(value, R, y, { align: 'right' }); return y + lh;
}
function subRow(doc, label, value, y) {
  doc.setFont('helvetica', ''); doc.setFontSize(8.5); doc.setTextColor(120, 120, 120);
  doc.text(_clampStr(label, 8.5, W - 140), L + 12, y);
  doc.setFontSize(8.5); doc.setTextColor(100, 100, 100);
  doc.text(value, R, y, { align: 'right' }); return y + 12;
}
function totalBar(doc, label, value, y, rgb) {
  band(doc, y, 28, rgb || [245, 238, 220]);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(100, 75, 15);
  doc.text(label, L + 8, y - 10);
  doc.setFontSize(15); doc.setTextColor(160, 118, 30);
  doc.text(value, R - 4, y - 8, { align: 'right' }); return y + 10;
}
function footer(doc, confidential) {
  doc.setDrawColor(210, 210, 210); doc.setLineWidth(0.3);
  doc.line(L, FOOTER_Y - 10, R, FOOTER_Y - 10);
  if (confidential) {
    doc.setFont('helvetica', ''); doc.setFontSize(7); doc.setTextColor(180, 80, 80);
    doc.text('CONFIDENTIEL - USAGE INTERNE UNIQUEMENT', L, FOOTER_Y);
    doc.setTextColor(180, 180, 180);
    doc.text('Studio Mobilier Pro', R, FOOTER_Y, { align: 'right' });
  } else {
    doc.setFont('helvetica', ''); doc.setFontSize(8); doc.setTextColor(160, 160, 160);
    doc.text('Merci de votre confiance.', L, FOOTER_Y);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(165, 125, 45);
    doc.text('Studio Mobilier Pro', R, FOOTER_Y, { align: 'right' });
  }
}
function mainHeader(doc, title, d) {
  let y = 40;
  band(doc, y + 2, 26, [28, 22, 10]);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(210, 175, 90);
  doc.text('STUDIO MOBILIER PRO', L + 6, y + 3);
  doc.setFont('helvetica', ''); doc.setFontSize(8.5); doc.setTextColor(160, 140, 80);
  doc.text(title, R - 4, y + 3, { align: 'right' });
  y += 31;
  doc.setFont('helvetica', ''); doc.setFontSize(8); doc.setTextColor(140, 140, 140);
  doc.text(`Ref. ${d.invNo}`, L, y); doc.text(d.date, R, y, { align: 'right' });
  y += 14; y = goldRule(doc, y);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(30, 30, 30);
  doc.text(d.clientName || '-', L, y);
  doc.setFont('helvetica', ''); doc.setFontSize(9); doc.setTextColor(110, 110, 110);
  doc.text(d.clientPhone || '', R, y, { align: 'right' });
  y += 18; y = rule(doc, y, [200, 200, 200]); return y;
}
function contHeader(doc, title, d) {
  let y = 40;
  band(doc, y + 2, 20, [28, 22, 10]);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(210, 175, 90);
  doc.text('STUDIO MOBILIER PRO', L + 6, y + 2);
  doc.setFont('helvetica', ''); doc.setFontSize(8); doc.setTextColor(160, 140, 80);
  doc.text(title + ' (suite)', R - 4, y + 2, { align: 'right' });
  y += 32; y = rule(doc, y, [200, 200, 200]); return y;
}

// Shared numeric formatter (mirrors app.js fmtNum — no DOM dependency)
function _fmtNum(n) {
  const [i, d] = (isNaN(+n) ? 0 : +n).toFixed(2).split('.');
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ',' + d;
}

module.exports = {
  PdfEngine,
  buildFilename,
  // layout helpers
  checkBreak, band, rule, goldRule, section, row, subRow, totalBar, footer, mainHeader, contHeader,
  // formatter
  _fmtNum,
  // constants
  L, R, W, PAGE_BOTTOM, FOOTER_Y,
};
