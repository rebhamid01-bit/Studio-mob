'use strict';
/**
 * storage/history.js  (renderer-side)
 *
 * Responsibilities AFTER the SQLite migration:
 *   1. buildHistoryRecord()  — pure builder, no I/O
 *   2. All storage calls go through window.electronAPI (IPC → main process → SQLite)
 *
 * The renderer-visible API is IDENTICAL to the old localStorage version,
 * so app.js requires zero changes.  All functions are async and return Promises.
 *
 * Call graph:
 *   app.js  →  history.js  →  window.electronAPI.db.*  →  ipcMain  →  quotesRepository.js  →  SQLite
 */

/* ══════════════════════════════════════════════════════════
   RECORD BUILDER  (pure, no I/O)
══════════════════════════════════════════════════════════ */

/**
 * buildHistoryRecord(inp, result, laborMode) → plain object (not saved yet)
 */
function buildHistoryRecord(inp, result, laborMode) {
  return {
    productName: inp.productName,
    clientName:  inp.clientName || '',
    invNo:       String(Date.now()).slice(-6),
    inputs: {
      materials:    inp.materials.map(function(m) { return { name: m.name, surface: m.surface, pricePerM2: m.pricePerM2 }; }),
      edges:        inp.edges.map(function(e)    { return { name: e.name, length: e.length, pricePerMeter: e.pricePerMeter }; }),
      accessories:  inp.accessories.map(function(a) { return { type: a.type, name: a.name, priceUnit: a.priceUnit, qty: a.qty }; }),
      labor: {
        mode:  laborMode === 'hourly' ? 'HOURLY' : 'FIXED',
        value: inp.laborCost,
        desc:  inp.laborDesc || '',
      },
      materialsCost:   inp.materialsCost,
      edgeBandingCost: inp.edgeBandingCost,
      accessoriesCost: inp.accessoriesCost,
      laborCost:       inp.laborCost,
      indirectRate:    inp.indirectRate,
      pricingMode:     inp.pricingMode === 'margin' ? 'MARGE' : 'MARCHE',
      marginRate:      inp.marginRate,
      marketPrice:     inp.marketPrice,
      deliveryCost:    inp.deliveryCost,
      advance:         inp.advance,
    },
    results: {
      directCost:    result.directCost,
      indirectCost:  result.indirectCost,
      totalCost:     result.totalCost,
      profit:        result.profit,
      sellingPrice:  result.sellingPriceExclDelivery,
      finalPrice:    result.finalPrice,
      marginOnCost:  result.marginOnCost,
      marginOnPrice: result.marginOnPrice,
      status:        result.status,
    },
  };
}

/* ══════════════════════════════════════════════════════════
   STORAGE API  (async, delegates to IPC bridge)
══════════════════════════════════════════════════════════ */

async function saveToHistory(record) {
  if (!record || !record.results || record.results.totalCost <= 0) {
    throw new Error('Enregistrement invalide — calcul requis.');
  }
  return window.electronAPI.db.saveQuote(record);
}

async function getHistory(filters) {
  return window.electronAPI.db.getAllQuotes(filters || {});
}

async function loadHistoryItem(id) {
  const record = await window.electronAPI.db.getQuoteById(id);
  if (!record) throw new Error('Enregistrement introuvable: ' + id);
  return record;
}

async function deleteHistoryItem(id) {
  return window.electronAPI.db.deleteQuote(id);
}

async function clearHistory() {
  return window.electronAPI.db.clearAllQuotes();
}

async function getHistoryCount() {
  return window.electronAPI.db.getQuoteCount();
}

/**
 * filterHistory(filters, allRecords) → record[]
 * Client-side filter on a pre-loaded array.
 * Called after getHistory() to apply UI filter state without
 * a second IPC round-trip.
 */
function filterHistory(filters, allRecords) {
  if (!allRecords) allRecords = [];
  var status    = filters.status    || '';
  var min_price = filters.min_price != null ? filters.min_price : null;
  var max_price = filters.max_price != null ? filters.max_price : null;
  var date_from = filters.date_from || '';
  var date_to   = filters.date_to   || '';

  return allRecords.filter(function(item) {
    if (status    && item.results.status     !== status)                       return false;
    if (min_price !== null && item.results.finalPrice < min_price)             return false;
    if (max_price !== null && item.results.finalPrice > max_price)             return false;
    if (date_from && item.createdAt           < date_from)                     return false;
    if (date_to   && item.createdAt           > date_to + 'T23:59:59.999Z')   return false;
    return true;
  });
}
