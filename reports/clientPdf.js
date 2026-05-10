'use strict';
/**
 * reports/clientPdf.js
 *
 * Builds the client-facing invoice PDF.
 * Returns raw PDF string — zero I/O, zero browser APIs.
 *
 * @param {object} d   _clientReport from app.js
 * @returns {string}   raw PDF byte-string ready for fs.writeFile
 */

const {
  PdfEngine,
  checkBreak, section, row, subRow, totalBar, footer, mainHeader, contHeader,
  rule,
  _fmtNum,
} = require('./pdfService');

function buildClientPdf(d) {
  const title = 'FACTURE';
  const doc   = PdfEngine.create();
  const cf    = (doc) => contHeader(doc, title, d);
  let y       = mainHeader(doc, title, d);

  /* ── Product ──────────────────────────────────────────── */
  y = section(doc, 'Produit commande', y);
  y = row(doc, 'Produit', d.productName || '-', y, false);
  if (d.clientDesc && d.clientDesc !== d.productName) {
    y = row(doc, 'Description', d.clientDesc, y, false);
  }

  /* ── Accessories ─────────────────────────────────────── */
  if (d.accessories && d.accessories.length) {
    y = checkBreak(doc, y, 30, cf);
    y = section(doc, 'Accessoires inclus', y);
    d.accessories.forEach(a => {
      y = checkBreak(doc, y, 14, cf);
      y = subRow(doc,
        `${a.name} x${a.qty}`,
        _fmtNum(a.priceUnit * a.qty) + ' DA', y);
    });
    y += 4;
  }

  /* ── Delivery ────────────────────────────────────────── */
  if (d.deliveryCost > 0) {
    y = row(doc, 'Livraison', _fmtNum(d.deliveryCost) + ' DA', y, false,
      { labelColor: [100, 100, 100] });
  }

  /* ── Total bar ───────────────────────────────────────── */
  y += 14;
  y = checkBreak(doc, y, 50, cf);
  y = totalBar(doc, 'TOTAL A REGLER', _fmtNum(d.finalPrice) + ' DA', y, [248, 240, 218]);

  /* ── Advance / balance ───────────────────────────────── */
  if (d.advance > 0) {
    y += 14;
    y = rule(doc, y - 4, [215, 215, 215], 0.3);
    y = row(doc, 'Acompte verse', _fmtNum(d.advance) + ' DA', y, false,
      { valueColor: [50, 130, 80] });
    y = row(doc, 'Reste a payer', _fmtNum(d.remaining) + ' DA', y, true,
      { labelColor: [130, 80, 10], valueColor: [160, 110, 20] });
  }

  footer(doc, false); // confidential = false
  return doc.build(); // ← raw PDF string, no browser download
}

module.exports = { buildClientPdf };
