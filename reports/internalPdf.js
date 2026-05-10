'use strict';
/**
 * reports/internalPdf.js
 *
 * Builds the confidential internal report PDF.
 * Returns raw PDF string — zero I/O, zero browser APIs.
 *
 * @param {object} d   _internalReport from app.js
 * @param {object} riskConfig  RISK_CONFIG from calculatePricing.js
 * @returns {string}   raw PDF byte-string ready for fs.writeFile
 */

const {
  PdfEngine,
  checkBreak, section, row, subRow, totalBar, footer, mainHeader, contHeader,
  rule,
  _fmtNum,
} = require('./pdfService');

function buildInternalPdf(d, riskConfig) {
  const title = 'DOCUMENT INTERNE';
  const doc   = PdfEngine.create();
  const cf    = (doc) => contHeader(doc, title, d);
  let y       = mainHeader(doc, title, d);

  /* ── Product ──────────────────────────────────────────── */
  y = checkBreak(doc, y, 40, cf);
  y = section(doc, 'Produit', y);
  y = row(doc, 'Nom', d.productName || '-', y, false);
  if (d.clientDesc) y = row(doc, 'Description', d.clientDesc, y, false);
  y += 6;

  /* ── Materials ───────────────────────────────────────── */
  if (d.materials && d.materials.length) {
    y = checkBreak(doc, y, 30, cf);
    y = section(doc, 'Materiaux', y);
    d.materials.forEach(m => {
      y = checkBreak(doc, y, 14, cf);
      y = subRow(doc,
        `${m.name || 'Mat'} | ${m.surface} m2 x ${_fmtNum(m.pricePerM2)} DA/m2`,
        _fmtNum(m.surface * m.pricePerM2) + ' DA', y);
    });
    y = row(doc, 'Sous-total materiaux', _fmtNum(d.materialsCost) + ' DA', y, false,
      { labelColor: [80, 80, 80], valueColor: [80, 80, 80] });
    y += 4;
  }

  /* ── Edge banding ────────────────────────────────────── */
  if (d.edges && d.edges.length) {
    y = checkBreak(doc, y, 30, cf);
    y = section(doc, 'Panne de Chant', y);
    d.edges.forEach(e => {
      y = checkBreak(doc, y, 14, cf);
      y = subRow(doc,
        `${e.name || 'Chant'} | ${e.length} ml x ${_fmtNum(e.pricePerMeter)} DA/ml`,
        _fmtNum(e.length * e.pricePerMeter) + ' DA', y);
    });
    y = row(doc, 'Sous-total chant', _fmtNum(d.edgeBandingCost) + ' DA', y, false,
      { labelColor: [80, 80, 80], valueColor: [80, 80, 80] });
    y += 4;
  }

  /* ── Accessories ─────────────────────────────────────── */
  if (d.accessories && d.accessories.length) {
    y = checkBreak(doc, y, 30, cf);
    y = section(doc, 'Accessoires', y);
    d.accessories.forEach(a => {
      y = checkBreak(doc, y, 14, cf);
      const prefix = a.type === 'CUSTOM' ? '[C] ' : '';
      y = subRow(doc,
        `${prefix}${a.name} x${a.qty} @ ${_fmtNum(a.priceUnit)} DA`,
        _fmtNum(a.priceUnit * a.qty) + ' DA', y);
    });
    y = row(doc, 'Sous-total accessoires', _fmtNum(d.accessoriesCost) + ' DA', y, false,
      { labelColor: [80, 80, 80], valueColor: [80, 80, 80] });
    y += 4;
  }

  /* ── Labour ──────────────────────────────────────────── */
  if (d.laborCost > 0) {
    y = checkBreak(doc, y, 20, cf);
    const lbl = d.laborDesc ? `Main oeuvre | ${d.laborDesc}` : 'Main oeuvre';
    y = row(doc, lbl, _fmtNum(d.laborCost) + ' DA', y, false,
      { labelColor: [80, 80, 80], valueColor: [80, 80, 80] });
    y += 4;
  }

  /* ── COGS analysis ───────────────────────────────────── */
  y = checkBreak(doc, y, 160, cf);
  y += 4;
  y = section(doc, 'Analyse COGS', y);
  y = row(doc, 'Cout direct',                                 _fmtNum(d.directCost)  + ' DA', y, true);
  y = row(doc, `+ Frais generaux (${(d.indirectRate * 100).toFixed(1)} %)`,
                                                               _fmtNum(d.indirectCost) + ' DA', y, false,
    { labelColor: [100, 100, 100] });
  y = rule(doc, y - 2, [200, 200, 200], 0.25);
  y = row(doc, 'Cout total / COGS',                           _fmtNum(d.totalCost)   + ' DA', y, true);
  y += 6;

  /* ── Profit & Margins ────────────────────────────────── */
  y = section(doc, 'Profit & Marges', y);
  if (d.pricingMode === 'margin') {
    y = row(doc, `Marge sur COGS (${(d.marginRate * 100).toFixed(1)} %)`,
      _fmtNum(d.profit) + ' DA', y, false, { valueColor: [50, 130, 80] });
  } else {
    y = row(doc, 'Profit (deduit prix marche)',
      _fmtNum(d.profit) + ' DA', y, false, { valueColor: [50, 130, 80] });
  }
  y = row(doc, 'Marge / Cout  (margin_on_cost)',
    (d.marginOnCost  * 100).toFixed(2) + ' %', y, false, { valueColor: [50, 130, 80] });
  y = row(doc, 'Marge / Vente (margin_on_price)',
    (d.marginOnPrice * 100).toFixed(2) + ' %', y, false, { valueColor: [50, 130, 80] });
  y = rule(doc, y - 2, [200, 200, 200], 0.25);
  y = row(doc, 'Prix de vente HT livraison',
    _fmtNum(d.sellingPriceExclDelivery) + ' DA', y, true);
  if (d.deliveryCost > 0) {
    y = row(doc, '+ Livraison (hors base marge)',
      _fmtNum(d.deliveryCost) + ' DA', y, false, { labelColor: [100, 100, 100] });
  }

  /* ── Risk decision ───────────────────────────────────── */
  const rCfg   = (riskConfig && riskConfig[d.status]) || { title: d.status };
  const rColor = d.status === 'OK'   ? [50, 130, 80]
               : d.status === 'LOSS' ? [200, 50, 50]
               :                       [180, 120, 20];
  y += 4;
  y = row(doc, `Decision: ${rCfg.title}`, '[' + d.status + ']', y, false,
    { labelColor: rColor, valueColor: rColor });

  /* ── Advance ─────────────────────────────────────────── */
  if (d.advance > 0) {
    y += 4;
    y = rule(doc, y - 2, [210, 210, 210], 0.3);
    y = row(doc, 'Acompte verse', _fmtNum(d.advance) + ' DA', y, false,
      { valueColor: [50, 130, 80] });
  }

  /* ── Final price bar ─────────────────────────────────── */
  y = checkBreak(doc, y, 40, cf);
  y += 6;
  y = totalBar(doc, 'PRIX FINAL', _fmtNum(d.finalPrice) + ' DA', y, [248, 240, 218]);
  if (d.advance > 0) {
    y += 6;
    y = row(doc, 'Reste a payer', _fmtNum(d.remaining) + ' DA', y, true,
      { labelColor: [130, 80, 10], valueColor: [160, 110, 20] });
  }

  footer(doc, true);  // confidential = true
  return doc.build(); // ← raw PDF string, no browser download
}

module.exports = { buildInternalPdf };
