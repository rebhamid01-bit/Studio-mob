'use strict';
/**
 * app.js — UI Orchestrator  (v3 — native PDF save)
 *
 * Changes from v2:
 *   - PDF buttons call generatePDF() in invoices.js, which uses
 *     window.electronAPI.pdf.save() (IPC → main → dialog + fs.writeFile)
 *   - showToast() provides non-blocking user feedback (replaces alert() for PDF ops)
 *   - No Blob, no createObjectURL, no anchor-click hacks anywhere
 *
 * Module dependencies (loaded via <script> in index.html):
 *   pricing/calculatePricing.js  → calculatePricing, sumMaterials, sumEdges, sumAccessories, RISK_CONFIG
 *   storage/history.js           → buildHistoryRecord, saveToHistory, getHistory, loadHistoryItem,
 *                                  deleteHistoryItem, clearHistory, filterHistory
 *   reports/invoices.js          → renderInternalView, renderClientView, generatePDF
 */

/* ══════════════════════════════════════════════════════════
   FORMATTING HELPERS  (globals used by invoices.js too)
══════════════════════════════════════════════════════════ */
function fmtDA(n) {
  return new Intl.NumberFormat('fr-DZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .format(+n) + ' DA';
}
function fmtPct(f)  { return (f * 100).toFixed(2) + ' %'; }
function fmtNum(n)  {
  const [i, d] = (isNaN(+n) ? 0 : +n).toFixed(2).split('.');
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ',' + d;
}
function fmtPlain(n) {
  return new Intl.NumberFormat('fr-DZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(+n);
}


/* ══════════════════════════════════════════════════════════
   TOAST NOTIFICATION  (global — used by invoices.js too)
   type: 'success' | 'error' | 'info'
══════════════════════════════════════════════════════════ */
let _toastTimer = null;
function showToast(type, message) {
  const toast = document.getElementById('toast');
  if (!toast) return;

  // Multi-line path: show as two lines
  const lines = message.split('\n');
  toast.innerHTML = lines.map((l, i) =>
    i === 0
      ? `<span class="toast-msg">${l}</span>`
      : `<span class="toast-path">${l}</span>`
  ).join('');

  toast.className = `toast toast-${type} toast-visible`;

  if (_toastTimer) clearTimeout(_toastTimer);
  const duration = type === 'success' ? 5000 : type === 'error' ? 7000 : 3000;
  _toastTimer = setTimeout(() => {
    toast.className = 'toast';
  }, duration);
}


/* ══════════════════════════════════════════════════════════
   APP STATE
══════════════════════════════════════════════════════════ */
let _internalReport    = null;
let _clientReport      = null;
let _viewMode          = 'internal';
let _locked            = false;
let _pricingMode       = 'margin';   // 'margin' | 'market'
let _laborMode         = 'fixed';    // 'fixed'  | 'hourly'
let _loadedFromHistory = false;

// In-memory cache of the full history list — refreshed after every DB write
// so the history panel renders synchronously from cache rather than awaiting IPC each time
let _historyCache = [];


/* ══════════════════════════════════════════════════════════
   ACCESSORIES CATALOG
══════════════════════════════════════════════════════════ */
const ACC_PREDEFINED   = ['Glissiere','Poignee','Pied','Ferrure','Verin hydraulique','Charniere','Serrure','Equerre','Goujon','Vis'];
const ACC_CUSTOM_VALUE = '__custom__';


/* ══════════════════════════════════════════════════════════
   INPUT COLLECTION
══════════════════════════════════════════════════════════ */
function collectInput() {
  const materials   = readMaterialRows();
  const edges       = readEdgeRows();
  const accessories = readAccessoryRows();

  const materialsCost    = Number(sumMaterials(materials).toFixed(10));
  const edgeBandingCost  = Number(sumEdges(edges).toFixed(10));
  const accessoriesCost  = Number(sumAccessories(accessories).toFixed(10));
  const laborCost        = computeLaborCost();

  const indirectRatePct = Number(document.getElementById('indirectRate').value || 0);
  const indirectRate    = indirectRatePct / 100;
  const deliveryCost    = Number(document.getElementById('deliveryCost').value || 0);
  const advance         = Number(document.getElementById('advance').value       || 0);

  let marginRate  = null;
  let marketPrice = null;
  if (_pricingMode === 'margin') {
    marginRate  = Number(document.getElementById('marginRate').value  || 0) / 100;
  } else {
    marketPrice = Number(document.getElementById('marketPrice').value || 0);
  }

  const laborDesc = buildLaborDescription();

  return {
    clientName:   document.getElementById('clientName').value.trim(),
    clientPhone:  document.getElementById('clientPhone').value.trim(),
    productName:  document.getElementById('productName').value.trim(),
    clientDesc:   document.getElementById('clientDesc').value.trim(),
    laborDesc,
    materials,
    edges,
    accessories,
    materialsCost,
    edgeBandingCost,
    accessoriesCost,
    laborCost,
    indirectRate,
    deliveryCost,
    marginRate,
    marketPrice,
    advance,
    pricingMode: _pricingMode,
  };
}

function computeLaborCost() {
  if (_laborMode === 'hourly') {
    const hours = Number(document.getElementById('laborHours').value || 0);
    const rate  = Number(document.getElementById('laborRate').value  || 0);
    return hours * rate;
  }
  return Number(document.getElementById('laborFixed').value || 0);
}

function buildLaborDescription() {
  if (_laborMode === 'hourly') {
    const hours = Number(document.getElementById('laborHours').value || 0);
    const rate  = Number(document.getElementById('laborRate').value  || 0);
    const desc  = document.getElementById('laborDescH').value.trim();
    return `${hours}h x ${fmtNum(rate)} DA/h${desc ? ' — ' + desc : ''}`;
  }
  return document.getElementById('laborDesc').value.trim();
}

function readMaterialRows() {
  const rows = [];
  document.querySelectorAll('.mat-row-item').forEach(row => {
    const name       = row.querySelector('.mat-name')?.value?.trim()    || '';
    const surface    = Number(row.querySelector('.mat-surface')?.value) || 0;
    const pricePerM2 = Number(row.querySelector('.mat-price')?.value)   || 0;
    if (surface > 0 && pricePerM2 > 0)
      rows.push({ name: name || 'Materiau', surface, pricePerM2 });
  });
  return rows;
}

function readEdgeRows() {
  const rows = [];
  document.querySelectorAll('.edge-row-item').forEach(row => {
    const name          = row.querySelector('.edge-name')?.value?.trim()    || '';
    const length        = Number(row.querySelector('.edge-length')?.value)  || 0;
    const pricePerMeter = Number(row.querySelector('.edge-price')?.value)   || 0;
    if (length > 0 || pricePerMeter > 0)
      rows.push({ name: name || 'Chant', length, pricePerMeter });
  });
  return rows;
}

function readAccessoryRows() {
  const rows = [], seen = {};
  document.querySelectorAll('.acc-row-item').forEach(row => {
    const typeVal  = row.querySelector('.acc-name')?.value || '';
    const isCustom = typeVal === ACC_CUSTOM_VALUE;
    const type     = isCustom ? 'CUSTOM' : 'PREDEFINED';
    const name     = isCustom
      ? (row.querySelector('.acc-custom-name')?.value?.trim() || '')
      : typeVal.trim();
    const priceUnit = Number(row.querySelector('.acc-price')?.value) || 0;
    const qty       = parseInt(row.querySelector('.acc-qty')?.value, 10) || 0;
    if (!name || priceUnit <= 0 || qty <= 0) return;
    const key = `${type}__${name}__${priceUnit.toFixed(2)}`;
    if (seen[key] !== undefined) {
      rows[seen[key]].qty += qty;
    } else {
      seen[key] = rows.length;
      rows.push({ type, name, priceUnit, qty });
    }
  });
  return rows;
}


/* ══════════════════════════════════════════════════════════
   BUILD REPORT OBJECTS
══════════════════════════════════════════════════════════ */
function buildReports(inp, result) {
  const invNo     = Date.now().toString().slice(-6);
  const date      = new Date().toLocaleDateString('fr-FR');
  const remaining = Math.max(0, result.finalPrice - inp.advance);

  _internalReport = Object.freeze({
    ...result,
    clientName:   inp.clientName,
    clientPhone:  inp.clientPhone,
    productName:  inp.productName,
    clientDesc:   inp.clientDesc,
    laborDesc:    inp.laborDesc,
    materials:    inp.materials,
    edges:        inp.edges,
    accessories:  inp.accessories,
    pricingMode:  inp.pricingMode,
    indirectRate: inp.indirectRate,
    marginRate:   inp.marginRate,
    marketPrice:  inp.marketPrice,
    advance:      inp.advance,
    remaining,
    invNo,
    date,
  });

  _clientReport = Object.freeze({
    clientName:   inp.clientName,
    clientPhone:  inp.clientPhone,
    productName:  inp.productName,
    clientDesc:   inp.clientDesc || inp.productName,
    accessories:  inp.accessories,
    finalPrice:   result.finalPrice,
    deliveryCost: result.deliveryCost,
    advance:      inp.advance,
    remaining,
    invNo,
    date,
  });
}


/* ══════════════════════════════════════════════════════════
   RENDERING
══════════════════════════════════════════════════════════ */
function updateMetricsPanel(result, advance) {
  const remaining = Math.max(0, result.finalPrice - advance);
  const cfg       = RISK_CONFIG[result.status] || RISK_CONFIG.OK;

  document.getElementById('mcTotalCost').textContent  = fmtDA(result.totalCost);
  document.getElementById('mcProfit').textContent     = fmtDA(result.profit);
  document.getElementById('mcFinalPrice').textContent = fmtDA(result.finalPrice);
  document.getElementById('mcMarginCost').textContent = fmtPct(result.marginOnCost);
  document.getElementById('mcMarginSell').textContent = fmtPct(result.marginOnPrice);
  document.getElementById('mcRemaining').textContent  = fmtDA(remaining);

  const riskClass = {
    OK: 'mc-profit', LOW_MARGIN_RISK: 'mc-risk-low',
    OVERPRICE_RISK: 'mc-risk-over', LOSS: 'mc-risk-loss',
  }[result.status] || 'mc-profit';

  ['mcProfitCard','mcMarginCostCard','mcMarginSellCard'].forEach(id => {
    const el = document.getElementById(id);
    el.classList.remove('mc-profit','mc-risk-low','mc-risk-over','mc-risk-loss');
    el.classList.add(riskClass);
  });

  document.getElementById('metricsGrid').style.display = 'grid';

  const banner = document.getElementById('riskBanner');
  banner.className = `risk-banner visible ${cfg.cls}`;
  document.getElementById('riskIcon').textContent  = cfg.icon;
  document.getElementById('riskTitle').textContent = cfg.title;
  document.getElementById('riskDesc').textContent  = cfg.desc;
}

function renderOutput() {
  if (!_internalReport) return;
  const d = _internalReport;

  document.getElementById('outClientName').textContent  = d.clientName  || '—';
  document.getElementById('outClientPhone').textContent = d.clientPhone || '';
  document.getElementById('outMeta').innerHTML = `N ${d.invNo}<br>${d.date}`;

  if (_viewMode === 'internal') {
    document.getElementById('tabInt').className = 'tab active-int';
    document.getElementById('tabCli').className = 'tab';
    renderInternalView(_internalReport, RISK_CONFIG);
  } else {
    document.getElementById('tabInt').className = 'tab';
    document.getElementById('tabCli').className = 'tab active-cli';
    renderClientView(_clientReport);
  }

  const panel = document.getElementById('outputPanel');
  panel.classList.add('visible');
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function switchTab(mode) { _viewMode = mode; renderOutput(); }


/* ══════════════════════════════════════════════════════════
   VALIDATION
══════════════════════════════════════════════════════════ */
function runValidation() {
  const errors = [];

  function fieldError(id, msg) {
    document.getElementById(id)?.classList.add('input-error');
    errors.push(msg);
  }
  function fieldClear(id) {
    document.getElementById(id)?.classList.remove('input-error');
  }

  if (!document.getElementById('productName').value.trim()) {
    fieldError('productName', 'Nom du produit requis.');
  } else {
    fieldClear('productName');
  }

  let hasValidMaterial = false;
  document.querySelectorAll('.mat-row-item').forEach(row => {
    const surfEl  = row.querySelector('.mat-surface');
    const priceEl = row.querySelector('.mat-price');
    const surface    = Number(surfEl?.value)  || 0;
    const pricePerM2 = Number(priceEl?.value) || 0;
    if (surface > 0 && pricePerM2 > 0) {
      hasValidMaterial = true;
      surfEl?.classList.remove('input-error');
      priceEl?.classList.remove('input-error');
    } else {
      surfEl?.classList.add('input-error');
      priceEl?.classList.add('input-error');
      errors.push('Materiau invalide: surface et prix requis > 0.');
    }
  });
  if (!hasValidMaterial) errors.push('Au moins un materiau valide est requis.');

  document.querySelectorAll('.edge-row-item').forEach(row => {
    const lenEl   = row.querySelector('.edge-length');
    const priceEl = row.querySelector('.edge-price');
    const length        = Number(lenEl?.value)   || 0;
    const pricePerMeter = Number(priceEl?.value) || 0;
    const hasAny = length > 0 || pricePerMeter > 0;
    if (hasAny && (length <= 0 || pricePerMeter <= 0)) {
      lenEl?.classList.add('input-error');
      priceEl?.classList.add('input-error');
      errors.push('Panne de chant: longueur ET prix requis si ligne remplie.');
    } else {
      lenEl?.classList.remove('input-error');
      priceEl?.classList.remove('input-error');
    }
  });

  document.querySelectorAll('.acc-row-item').forEach(row => {
    const typeVal  = row.querySelector('.acc-name')?.value || '';
    const isCustom = typeVal === ACC_CUSTOM_VALUE;
    const nameEl   = row.querySelector('.acc-custom-name');
    const priceEl  = row.querySelector('.acc-price');
    const qtyEl    = row.querySelector('.acc-qty');
    const name     = isCustom ? (nameEl?.value?.trim() || '') : typeVal.trim();
    const price    = Number(priceEl?.value) || 0;
    const qty      = parseInt(qtyEl?.value, 10) || 0;
    if (!name) {
      if (isCustom) nameEl?.classList.add('input-error');
      errors.push('Nom accessoire requis.');
    } else {
      if (nameEl) nameEl.classList.remove('input-error');
    }
    if (price <= 0) { priceEl?.classList.add('input-error'); errors.push(`Accessoire "${name||'?'}": prix > 0 requis.`); }
    else              priceEl?.classList.remove('input-error');
    if (qty <= 0)   { qtyEl?.classList.add('input-error');   errors.push(`Accessoire "${name||'?'}": quantite > 0 requise.`); }
    else              qtyEl?.classList.remove('input-error');
  });

  if (_laborMode === 'fixed') {
    const v = Number(document.getElementById('laborFixed').value) || 0;
    if (v < 0) { fieldError('laborFixed', 'Cout MO invalide.'); }
    else        fieldClear('laborFixed');
  } else {
    const hours = Number(document.getElementById('laborHours').value) || 0;
    const rate  = Number(document.getElementById('laborRate').value)  || 0;
    const hasAny = hours > 0 || rate > 0;
    if (hasAny && hours <= 0) { fieldError('laborHours', 'Heures > 0 requises.'); }
    else                        fieldClear('laborHours');
    if (hasAny && rate  <= 0) { fieldError('laborRate',  'Taux > 0 requis.');     }
    else                        fieldClear('laborRate');
  }

  const indirectPct = Number(document.getElementById('indirectRate').value) || 0;
  if (indirectPct < 10) fieldError('indirectRate', 'Frais generaux minimum 10 %.');
  else                   fieldClear('indirectRate');

  const delivery = Number(document.getElementById('deliveryCost').value) || 0;
  if (delivery < 0) fieldError('deliveryCost', 'Frais de livraison invalides.');
  else               fieldClear('deliveryCost');

  if (_pricingMode === 'margin') {
    const marginPct = Number(document.getElementById('marginRate').value) || 0;
    if (marginPct < 10 || marginPct > 100) fieldError('marginRate', 'Marge entre 10 % et 100 %.');
    else                                    fieldClear('marginRate');
    fieldClear('marketPrice');
  } else {
    const market = Number(document.getElementById('marketPrice').value) || 0;
    if (market <= 0) fieldError('marketPrice', 'Prix marche > 0 requis.');
    else              fieldClear('marketPrice');
    fieldClear('marginRate');
  }

  return { ok: errors.length === 0, errors };
}

function onAnyInput() {
  const { ok } = runValidation();
  const btn = document.getElementById('calcBtn');
  btn.disabled      = !ok;
  btn.style.opacity = ok ? '1' : '0.4';
  btn.style.cursor  = ok ? 'pointer' : 'not-allowed';
}

function wireRowValidation(row) {
  row.querySelectorAll('input, select').forEach(el => {
    el.addEventListener('input',  onAnyInput);
    el.addEventListener('change', onAnyInput);
  });
}

function wireStaticValidation() {
  [
    'productName','clientName','clientPhone','clientDesc',
    'laborFixed','laborDesc','laborHours','laborRate','laborDescH',
    'indirectRate','deliveryCost','marginRate','marketPrice','advance',
  ].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input',  onAnyInput);
    el.addEventListener('change', onAnyInput);
  });
}


/* ══════════════════════════════════════════════════════════
   MAIN PROCESS  (async — SQLite write + UI refresh)
══════════════════════════════════════════════════════════ */
async function processInvoice() {
  const { ok, errors } = runValidation();
  if (!ok) { alert(errors.join('\n')); return; }

  let inp, result;
  try {
    inp    = collectInput();
    result = calculatePricing(inp);
  } catch (err) {
    alert('Erreur de calcul: ' + err.message);
    return;
  }

  buildReports(inp, result);
  updateMetricsPanel(result, inp.advance);

  // Save to SQLite (async IPC)
  try {
    const record = buildHistoryRecord(inp, result, _laborMode);
    await saveToHistory(record);
    await refreshHistoryCache();   // pull the updated list and re-render
  } catch (e) {
    console.warn('[app] History save failed:', e.message);
  }

  _loadedFromHistory = false;
  document.getElementById('histLoadedBanner').classList.remove('visible');

  lockForm();
  renderOutput();
}


/* ══════════════════════════════════════════════════════════
   MODE CONTROLS
══════════════════════════════════════════════════════════ */
function setPricingMode(mode) {
  _pricingMode = mode;
  const isMargin = mode === 'margin';
  document.getElementById('modeMarginBtn').className = `mode-pill-btn${isMargin  ? ' active' : ''}`;
  document.getElementById('modeMarketBtn').className = `mode-pill-btn${!isMargin ? ' active' : ''}`;
  document.getElementById('panelMargin').style.display =  isMargin ? '' : 'none';
  document.getElementById('panelMarket').style.display = !isMargin ? '' : 'none';
  document.getElementById('marginRate').disabled  = !isMargin;
  document.getElementById('marketPrice').disabled =  isMargin;
  if (isMargin)  document.getElementById('marketPrice').value = '';
  else           document.getElementById('marginRate').value  = '';
  onAnyInput();
}

function setLaborMode(mode) {
  _laborMode = mode;
  document.getElementById('laborFixedTab').className  = `labor-tab${mode === 'fixed'  ? ' active' : ''}`;
  document.getElementById('laborHourlyTab').className = `labor-tab${mode === 'hourly' ? ' active' : ''}`;
  document.getElementById('laborFixedPanel').style.display  = mode === 'fixed'  ? '' : 'none';
  document.getElementById('laborHourlyPanel').style.display = mode === 'hourly' ? '' : 'none';
  onAnyInput();
}


/* ══════════════════════════════════════════════════════════
   LOCK / UNLOCK / RESET
══════════════════════════════════════════════════════════ */
function lockForm() {
  _locked = true;
  document.querySelectorAll('input, select').forEach(el => el.disabled = true);
  document.querySelectorAll('.btn-remove,.btn-add-row,.labor-tab,.mode-pill-btn').forEach(el => el.disabled = true);
  document.getElementById('lockBanner').classList.add('visible');
  document.getElementById('calcBtn').style.display   = 'none';
  document.getElementById('unlockBtn').style.display = 'inline-block';
}

function unlockForm() {
  _locked = false;
  document.querySelectorAll('input, select').forEach(el => el.disabled = false);
  document.querySelectorAll('.btn-remove,.btn-add-row,.labor-tab,.mode-pill-btn').forEach(el => el.disabled = false);
  document.getElementById('lockBanner').classList.remove('visible');
  document.getElementById('calcBtn').style.display   = 'inline-block';
  document.getElementById('unlockBtn').style.display = 'none';
  setPricingMode(_pricingMode);
  setLaborMode(_laborMode);
  onAnyInput();
}

function resetForm() {
  if (_locked && !confirm('Reinitialiser le formulaire ?')) return;

  _internalReport = null; _clientReport = null;
  _viewMode = 'internal'; _locked = false;

  document.querySelectorAll('input, select').forEach(el => el.disabled = false);
  document.querySelectorAll('.btn-remove,.btn-add-row,.labor-tab,.mode-pill-btn').forEach(el => el.disabled = false);
  document.getElementById('lockBanner').classList.remove('visible');
  document.getElementById('calcBtn').style.display   = 'inline-block';
  document.getElementById('unlockBtn').style.display = 'none';

  [
    'clientName','clientPhone','productName','clientDesc',
    'laborDesc','laborDescH','marginRate','indirectRate',
    'marketPrice','laborHours','laborRate',
  ].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  ['laborFixed','deliveryCost','advance'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '0';
  });

  document.getElementById('riskBanner').className      = 'risk-banner';
  document.getElementById('metricsGrid').style.display = 'none';
  document.getElementById('outputPanel').classList.remove('visible');

  _loadedFromHistory = false;
  document.getElementById('histLoadedBanner').classList.remove('visible');

  setPricingMode('margin');
  setLaborMode('fixed');

  document.getElementById('matContainer').innerHTML  = '';
  document.getElementById('edgeContainer').innerHTML = '';
  document.getElementById('accContainer').innerHTML  = '';

  addMaterialRow();
  addEdgeRow();
  addAccessoryRow();
  onAnyInput();
}


/* ══════════════════════════════════════════════════════════
   DYNAMIC ROW FACTORIES
══════════════════════════════════════════════════════════ */
function addMaterialRow() {
  const container = document.getElementById('matContainer');
  const row = document.createElement('div');
  row.className = 'mat-row mat-row-item';
  row.innerHTML = `
    <div class="field"><label>Nom / Type</label>
      <input class="mat-name" type="text" placeholder="ex. Melamine blanc, MDF..."></div>
    <div class="field"><label>Surface (m²)</label>
      <input class="mat-surface" type="number" min="0" step="0.01" placeholder="0.00"></div>
    <div class="field"><label>Prix / m² (DA)</label>
      <input class="mat-price" type="number" min="0" step="0.01" placeholder="0.00"></div>
    <button class="btn-remove" title="Supprimer" type="button">×</button>`;
  row.querySelector('.btn-remove').addEventListener('click', () => { row.remove(); onAnyInput(); });
  wireRowValidation(row);
  container.appendChild(row);
  onAnyInput();
}

function addEdgeRow() {
  const container = document.getElementById('edgeContainer');
  const row = document.createElement('div');
  row.className = 'edge-row edge-row-item';
  row.innerHTML = `
    <div class="field"><label>Nom / Type de chant</label>
      <input class="edge-name" type="text" placeholder="ex. Chant ABS blanc..."></div>
    <div class="field"><label>Longueur (ml)</label>
      <input class="edge-length" type="number" min="0" step="0.01" placeholder="0.00"></div>
    <div class="field"><label>Prix / ml (DA)</label>
      <input class="edge-price" type="number" min="0" step="0.01" placeholder="0.00"></div>
    <button class="btn-remove" title="Supprimer" type="button">×</button>`;
  row.querySelector('.btn-remove').addEventListener('click', () => { row.remove(); onAnyInput(); });
  wireRowValidation(row);
  container.appendChild(row);
}

function addAccessoryRow() {
  const container = document.getElementById('accContainer');
  const row = document.createElement('div');
  row.className = 'acc-row acc-row-item';

  const opts = ACC_PREDEFINED.map(o => `<option value="${o}">${o}</option>`).join('')
    + `<option value="${ACC_CUSTOM_VALUE}">Autre (personnalise)...</option>`;

  row.innerHTML = `
    <div class="field">
      <label>Type</label>
      <select class="acc-name">${opts}</select>
    </div>
    <div class="field acc-custom-wrap" style="display:none">
      <label>Nom <span style="color:var(--danger);font-size:0.6rem">requis</span></label>
      <input class="acc-custom-name" type="text" placeholder="ex. LED Strip, Cheville...">
    </div>
    <div class="field">
      <label>Prix unit. (DA)</label>
      <input class="acc-price" type="number" min="0" step="0.01" placeholder="0.00">
    </div>
    <div class="field">
      <label>Quantite</label>
      <input class="acc-qty" type="number" min="0" step="1" placeholder="0">
    </div>
    <button class="btn-remove" title="Supprimer" type="button">×</button>`;

  const selectEl     = row.querySelector('.acc-name');
  const customWrap   = row.querySelector('.acc-custom-wrap');
  const customNameEl = row.querySelector('.acc-custom-name');

  function handleTypeChange() {
    const isCustom = selectEl.value === ACC_CUSTOM_VALUE;
    row.classList.toggle('has-custom', isCustom);
    customWrap.style.display = isCustom ? 'flex' : 'none';
    customWrap.classList.toggle('visible', isCustom);
    selectEl.classList.toggle('is-custom', isCustom);
    if (!isCustom) customNameEl.value = '';
    else           customNameEl.focus();
    onAnyInput();
  }

  selectEl.addEventListener('change', handleTypeChange);
  row.querySelector('.btn-remove').addEventListener('click', () => { row.remove(); onAnyInput(); });
  wireRowValidation(row);
  container.appendChild(row);
  onAnyInput();
}


/* ══════════════════════════════════════════════════════════
   HISTORY UI
   _historyCache holds the full unfiltered list in memory.
   refreshHistoryCache() is called after every write.
   renderHistoryPanel() is synchronous — reads from cache.
══════════════════════════════════════════════════════════ */

/** Fetch all records from SQLite, update cache, re-render. */
async function refreshHistoryCache() {
  try {
    _historyCache = await getHistory();
  } catch (e) {
    console.error('[app] refreshHistoryCache failed:', e.message);
    _historyCache = [];
  }
  renderHistoryPanel();
}

/** Synchronous render from _historyCache with UI filter applied. */
function renderHistoryPanel() {
  const filters = readFilterState();
  const records = filterHistory(filters, _historyCache);
  document.getElementById('histCount').textContent = _historyCache.length;

  const list = document.getElementById('histList');
  if (!records.length) {
    list.innerHTML = `<div class="hist-empty">${
      _historyCache.length === 0
        ? 'Aucun enregistrement. Calculez un prix pour commencer.'
        : 'Aucun enregistrement ne correspond aux filtres.'
    }</div>`;
    return;
  }

  const STATUS_LABELS = {
    OK: 'OK', LOW_MARGIN_RISK: 'Marge faible',
    OVERPRICE_RISK: 'Prix eleve', LOSS: 'Perte',
  };

  list.innerHTML = records.map(item => {
    const date = new Date(item.createdAt).toLocaleString('fr-FR', {
      day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit',
    });
    const statusLabel = STATUS_LABELS[item.results.status] || item.results.status;
    return `
      <div class="hist-record">
        <div class="hist-rec-main">
          <div class="hist-rec-product">${item.productName}${item.clientName ? ' — ' + item.clientName : ''}</div>
          <div class="hist-rec-meta">
            <span class="hist-rec-date">${date}</span>
            <span class="hist-rec-price">${fmtDA(item.results.finalPrice)}</span>
            <span class="hist-rec-profit">+${fmtDA(item.results.profit)}</span>
            <span class="hist-rec-status hist-status-${item.results.status}">${statusLabel}</span>
          </div>
        </div>
        <div class="hist-rec-actions">
          <button class="hist-btn hist-btn-load" onclick="handleLoadRecord('${item.id}')">Charger</button>
          <button class="hist-btn hist-btn-del"  onclick="handleDeleteRecord('${item.id}')">✕</button>
        </div>
      </div>`;
  }).join('');
}

function toggleHistoryPanel() {
  const body    = document.getElementById('histBody');
  const chevron = document.getElementById('histChevron');
  const open    = body.classList.toggle('open');
  chevron.classList.toggle('open', open);
  // Refresh from DB the first time the panel opens (cache may be stale after restart)
  if (open) refreshHistoryCache();
}

async function handleLoadRecord(id) {
  let record;
  try {
    record = await loadHistoryItem(id);
  } catch (e) {
    alert(e.message);
    return;
  }
  if (_locked) unlockForm();
  resetForm();
  restoreFormFromRecord(record);
}

function restoreFormFromRecord(record) {
  const inp = record.inputs;

  document.getElementById('clientName').value  = record.clientName || '';
  document.getElementById('productName').value = record.productName || '';

  document.getElementById('matContainer').innerHTML = '';
  (inp.materials || []).forEach(m => {
    addMaterialRow();
    const rows = document.querySelectorAll('.mat-row-item');
    const row  = rows[rows.length - 1];
    row.querySelector('.mat-name').value    = m.name || '';
    row.querySelector('.mat-surface').value = m.surface;
    row.querySelector('.mat-price').value   = m.pricePerM2;
  });

  document.getElementById('edgeContainer').innerHTML = '';
  (inp.edges || []).forEach(e => {
    addEdgeRow();
    const rows = document.querySelectorAll('.edge-row-item');
    const row  = rows[rows.length - 1];
    row.querySelector('.edge-name').value   = e.name || '';
    row.querySelector('.edge-length').value = e.length;
    row.querySelector('.edge-price').value  = e.pricePerMeter;
  });

  document.getElementById('accContainer').innerHTML = '';
  (inp.accessories || []).forEach(a => {
    addAccessoryRow();
    const rows = document.querySelectorAll('.acc-row-item');
    const row  = rows[rows.length - 1];
    const sel  = row.querySelector('.acc-name');
    if (a.type === 'CUSTOM') {
      sel.value = ACC_CUSTOM_VALUE;
      row.classList.add('has-custom');
      const wrap = row.querySelector('.acc-custom-wrap');
      wrap.style.display = 'flex';
      wrap.classList.add('visible');
      sel.classList.add('is-custom');
      row.querySelector('.acc-custom-name').value = a.name;
    } else {
      sel.value = a.name;
    }
    row.querySelector('.acc-price').value = a.priceUnit;
    row.querySelector('.acc-qty').value   = a.qty;
  });

  setLaborMode(inp.labor?.mode === 'HOURLY' ? 'hourly' : 'fixed');
  document.getElementById('laborFixed').value = inp.labor?.value || 0;

  document.getElementById('indirectRate').value = (inp.indirectRate * 100).toFixed(1);
  document.getElementById('deliveryCost').value = inp.deliveryCost || 0;
  document.getElementById('advance').value      = inp.advance || 0;

  const mode = inp.pricingMode === 'MARGE' ? 'margin' : 'market';
  setPricingMode(mode);
  if (mode === 'margin' && inp.marginRate != null)
    document.getElementById('marginRate').value = (inp.marginRate * 100).toFixed(1);
  else if (mode === 'market' && inp.marketPrice != null)
    document.getElementById('marketPrice').value = inp.marketPrice;

  _loadedFromHistory = true;
  document.getElementById('histLoadedBanner').classList.add('visible');
  onAnyInput();
}

async function handleDeleteRecord(id) {
  if (!confirm('Supprimer cet enregistrement ?')) return;
  try {
    await deleteHistoryItem(id);
    // Update cache by removing the deleted item locally (avoids full DB round-trip)
    _historyCache = _historyCache.filter(x => x.id !== id);
    renderHistoryPanel();
  } catch (e) {
    console.error('[app] deleteHistoryItem failed:', e.message);
    alert('Erreur lors de la suppression: ' + e.message);
  }
}

function readFilterState() {
  return {
    status:    document.getElementById('hfStatus')?.value    || '',
    min_price: parseFloat(document.getElementById('hfMinPrice')?.value) || null,
    max_price: parseFloat(document.getElementById('hfMaxPrice')?.value) || null,
    date_from: document.getElementById('hfDateFrom')?.value  || '',
    date_to:   document.getElementById('hfDateTo')?.value    || '',
  };
}

function wireHistoryFilters() {
  ['hfStatus','hfMinPrice','hfMaxPrice','hfDateFrom','hfDateTo'].forEach(id => {
    // Filter changes are synchronous — apply to cache, no IPC needed
    document.getElementById(id)?.addEventListener('input',  renderHistoryPanel);
    document.getElementById(id)?.addEventListener('change', renderHistoryPanel);
  });
  document.getElementById('hfResetBtn')?.addEventListener('click', () => {
    ['hfStatus','hfMinPrice','hfMaxPrice','hfDateFrom','hfDateTo'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    renderHistoryPanel();
  });
  document.getElementById('histClearBtn')?.addEventListener('click', async () => {
    if (!confirm('Supprimer tout l\'historique ? Cette action est irreversible.')) return;
    try {
      await clearHistory();
      _historyCache = [];
      renderHistoryPanel();
    } catch (e) {
      console.error('[app] clearHistory failed:', e.message);
      alert('Erreur lors de la suppression: ' + e.message);
    }
  });
  document.getElementById('histToggle')?.addEventListener('click', toggleHistoryPanel);
}


/* ══════════════════════════════════════════════════════════
   EVENT LISTENERS & BOOTSTRAP
══════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  // Core buttons
  document.getElementById('addMatBtn').addEventListener('click',  addMaterialRow);
  document.getElementById('addEdgeBtn').addEventListener('click', addEdgeRow);
  document.getElementById('addAccBtn').addEventListener('click',  addAccessoryRow);
  document.getElementById('calcBtn').addEventListener('click',    processInvoice);
  document.getElementById('unlockBtn').addEventListener('click',  unlockForm);
  document.getElementById('resetBtn').addEventListener('click',   resetForm);

  // PDF buttons — fully async, native save dialog via IPC
  document.getElementById('pdfIntBtn').addEventListener('click', () => {
    if (!_internalReport) { showToast('error', 'Calculez d\'abord le prix.'); return; }
    generatePDF('internal', _internalReport, _clientReport, RISK_CONFIG);
  });
  document.getElementById('pdfCliBtn').addEventListener('click', () => {
    if (!_clientReport) { showToast('error', 'Calculez d\'abord le prix.'); return; }
    generatePDF('client', _internalReport, _clientReport, RISK_CONFIG);
  });

  // Dashboard navigation
  const _navDash = document.getElementById('navDashboard');
  if (_navDash) {
    _navDash.addEventListener('click', () => { window.location.href = 'dashboard/dashboard.html'; });
  }
  const _navPricing = document.getElementById('navPricing');
  if (_navPricing) _navPricing.classList.add('active');

  // Electron menu integration
  if (window.electronAPI) {
    window.electronAPI.onMenuReset(() => resetForm());
    if (window.electronAPI.onMenuDashboard)
      window.electronAPI.onMenuDashboard(() => { window.location.href = 'dashboard/dashboard.html'; });
  }

  // Bootstrap UI
  wireStaticValidation();
  wireHistoryFilters();
  setPricingMode('margin');
  setLaborMode('fixed');
  addMaterialRow();
  addEdgeRow();
  addAccessoryRow();
  onAnyInput();

  // Load history from SQLite on startup
  await refreshHistoryCache();
});
