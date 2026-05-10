'use strict';
/**
 * reports/invoices.js  (renderer-side, v3)
 *
 * Responsibilities:
 *   - renderInternalView()  — populate the internal HTML report panel
 *   - renderClientView()    — populate the client HTML report panel
 *   - generatePDF()         — orchestrate PDF build + native save dialog via IPC
 *
 * ALL PDF byte generation is now in pdfService / internalPdf / clientPdf (main-process modules).
 * ALL file I/O is done in the main process via ipcMain ('pdf:save').
 * Zero Blob, zero createObjectURL, zero anchor-click download tricks.
 *
 * Globals expected from other <script> tags:
 *   fmtDA, fmtPct, fmtNum, fmtPlain  (app.js)
 *   RISK_CONFIG                        (calculatePricing.js)
 *   showToast                          (app.js)
 */

/* ══════════════════════════════════════════════════════════
   generatePDF  — the one entry-point called by app.js
   type: 'internal' | 'client'
══════════════════════════════════════════════════════════ */
async function generatePDF(type, internalReport, clientReport, riskConfig) {
  const d = type === 'internal' ? internalReport : clientReport;
  if (!d) { showToast('error', 'Calculez d\'abord le prix.'); return; }

  try {
    // Disable both PDF buttons while working
    _setPdfBtnsEnabled(false);
    showToast('info', 'Génération du PDF en cours…');

    // Ask main process to: build PDF bytes + open save dialog + write to disk
    const result = await window.electronAPI.pdf.save({
      type,
      internalReport,
      clientReport,
    });

    if (result.cancelled) {
      showToast('info', 'Sauvegarde annulée.');
      return;
    }
    if (!result.ok) {
      throw new Error(result.error || 'Erreur inconnue lors de la sauvegarde.');
    }

    showToast('success', `PDF sauvegardé :\n${result.filePath}`);

  } catch (err) {
    console.error('[invoices] generatePDF error:', err);
    showToast('error', 'Erreur PDF : ' + err.message);
  } finally {
    _setPdfBtnsEnabled(true);
  }
}

function _setPdfBtnsEnabled(enabled) {
  ['pdfIntBtn', 'pdfCliBtn'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.disabled      = !enabled;
    el.style.opacity = enabled ? '1' : '0.5';
  });
}


/* ══════════════════════════════════════════════════════════
   renderInternalView
══════════════════════════════════════════════════════════ */
function renderInternalView(internalReport, riskConfig) {
  const d = internalReport;

  // Integrity guard before rendering
  const checkDirect = d.materialsCost + d.edgeBandingCost + d.accessoriesCost + d.laborCost;
  if (Math.abs(d.directCost - checkDirect) > 0.0001) {
    throw new Error(
      `Rendu bloqué: cout direct incohérent. ` +
      `directCost=${d.directCost.toFixed(2)} ≠ ${checkDirect.toFixed(2)}`
    );
  }

  const rows = [
    { label: 'Materiaux',      value: fmtDA(d.materialsCost)   },
    { label: 'Panne de chant', value: fmtDA(d.edgeBandingCost) },
  ];

  // Accessories breakdown
  let accBreakdownHtml = '';
  if (d.accessories && d.accessories.length > 0) {
    const items = d.accessories.map(a => {
      const badge     = a.type === 'CUSTOM' ? `<span class="acc-badge-custom">custom</span>` : '';
      const lineTotal = a.priceUnit * a.qty;
      return `<div class="acc-breakdown-row">
        <span class="acc-bd-name">${badge}${a.name}</span>
        <span class="acc-bd-calc">${fmtPlain(a.priceUnit)} x ${a.qty}</span>
        <span class="acc-bd-total">${fmtDA(lineTotal)}</span>
      </div>`;
    }).join('');
    accBreakdownHtml = `<div class="acc-breakdown">${items}</div>`;
  }
  rows.push({ label: 'Accessoires', value: fmtDA(d.accessoriesCost), breakdown: accBreakdownHtml });

  if (d.laborCost > 0) {
    const lbl = d.laborDesc ? `Main oeuvre — ${d.laborDesc}` : 'Main oeuvre';
    rows.push({ label: lbl, value: fmtDA(d.laborCost) });
  }

  rows.push(
    { label: 'Cout direct',                                    value: fmtDA(d.directCost),   cls: 'subtotal' },
    { label: `+ Frais generaux (${fmtPct(d.indirectRate)})`,  value: fmtDA(d.indirectCost)  },
    { label: 'Cout total / COGS',                              value: fmtDA(d.totalCost),    cls: 'subtotal' },
  );

  if (d.pricingMode === 'margin') {
    rows.push({ label: `Marge sur COGS (${fmtPct(d.marginRate)})`, value: fmtDA(d.profit), cls: 'profit' });
  } else {
    rows.push({ label: 'Profit (deduit du prix marche)', value: fmtDA(d.profit), cls: 'profit' });
  }

  rows.push(
    { label: 'Marge / Cout  (profit / COGS)',       value: fmtPct(d.marginOnCost),  cls: 'profit' },
    { label: 'Marge / Vente (profit / prix vente)', value: fmtPct(d.marginOnPrice), cls: 'profit' },
    { label: 'Prix de vente HT livraison',           value: fmtDA(d.sellingPriceExclDelivery), cls: 'subtotal' },
  );

  if (d.deliveryCost > 0) {
    rows.push({ label: '+ Livraison (hors base marge)', value: fmtDA(d.deliveryCost) });
  }

  const rCfg = riskConfig[d.status] || riskConfig.OK;

  let html = rows.map(r =>
    `<div class="inv-row ${r.cls || ''}">` +
    `<span class="lbl">${r.label}</span>` +
    `<span class="val">${r.value}</span></div>` +
    (r.breakdown || '')
  ).join('');

  html += `<div class="final-price-block">
    <span class="lbl">Prix Final</span>
    <span class="val">${fmtDA(d.finalPrice)}</span>
  </div>`;

  if (d.advance > 0) {
    html += `
    <div class="inv-row" style="margin-top:8px">
      <span class="lbl">Acompte verse</span>
      <span class="val" style="color:var(--green)">${fmtDA(d.advance)}</span>
    </div>
    <div class="inv-row">
      <span class="lbl">Reste a payer</span>
      <span class="val" style="color:var(--gold)">${fmtDA(d.remaining)}</span>
    </div>`;
  }

  html += `<div class="conf-note">Decision: <strong>${rCfg.title}</strong> [${d.status}] — Vue interne confidentielle.</div>`;
  document.getElementById('outBody').innerHTML = html;
}


/* ══════════════════════════════════════════════════════════
   renderClientView
══════════════════════════════════════════════════════════ */
function renderClientView(clientReport) {
  const d = clientReport;

  const accLine = (d.accessories && d.accessories.length)
    ? `<div class="inv-row"><span class="lbl">Accessoires inclus</span><span class="val"></span></div>` +
      d.accessories.map(a =>
        `<div class="acc-breakdown-row">
          <span class="acc-bd-name">${a.name}</span>
          <span class="acc-bd-calc">x${a.qty}</span>
          <span class="acc-bd-total">${fmtDA(a.priceUnit * a.qty)}</span>
        </div>`
      ).join('')
    : '';

  let html = `<div class="inv-row"><span class="lbl">Produit</span><span class="val">${d.productName || '-'}</span></div>`;
  if (d.clientDesc && d.clientDesc !== d.productName) {
    html += `<div class="inv-row"><span class="lbl">Description</span><span class="val">${d.clientDesc}</span></div>`;
  }
  html += accLine;
  if (d.deliveryCost > 0) {
    html += `<div class="inv-row"><span class="lbl">Livraison</span><span class="val">${fmtDA(d.deliveryCost)}</span></div>`;
  }

  html += `<div class="final-price-block">
    <span class="lbl">Total à Régler</span>
    <span class="val">${fmtDA(d.finalPrice)}</span>
  </div>`;

  if (d.advance > 0) {
    html += `
    <div class="inv-row" style="margin-top:8px">
      <span class="lbl">Acompte verse</span>
      <span class="val" style="color:var(--green)">${fmtDA(d.advance)}</span>
    </div>
    <div class="inv-row">
      <span class="lbl">Reste a payer</span>
      <span class="val" style="color:var(--gold)">${fmtDA(d.remaining)}</span>
    </div>`;
  }

  document.getElementById('outBody').innerHTML = html;
}
