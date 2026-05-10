'use strict';
/**
 * storage/quotesRepository.js
 *
 * All CRUD operations for the `quotes` table.
 * Runs in the main process only.
 *
 * Public API (called from ipcMain handlers in main.js):
 *   saveQuote(record)                → saved row
 *   getAllQuotes(filters?)           → quote[]  (newest first)
 *   getQuoteById(id)                 → quote | null
 *   deleteQuote(id)                  → { deleted: boolean }
 *   updateQuote(id, partialPayload)  → updated row | null
 *   clearAllQuotes()                 → { deleted: number }
 *   getQuoteCount()                  → number
 *
 * Every function is synchronous (better-sqlite3 is sync).
 * All returned objects use the same shape as the old localStorage records
 * so the renderer (app.js) requires zero changes.
 */

const { run, get, all } = require('./database');

/* ══════════════════════════════════════════════════════════
   SHAPE HELPERS
   Convert between the flat DB row and the rich JS record
   the renderer already knows.
══════════════════════════════════════════════════════════ */

/**
 * _rowToRecord(row) → JS record
 * Parses payload_json and merges it with the denormalised columns.
 */
function _rowToRecord(row) {
  if (!row) return null;
  try {
    const payload = JSON.parse(row.payload_json);
    // The payload IS the full record; denormalised columns are for DB queries only.
    // We restore the top-level id and createdAt from the DB columns (source of truth).
    return {
      ...payload,
      id:        row.id,
      createdAt: row.created_at,
    };
  } catch (err) {
    console.error('[quotesRepository] Failed to parse payload_json for id:', row.id, err.message);
    return null;
  }
}

/**
 * _recordToRow(record) → flat object suitable for DB insertion.
 * Denormalises the key financial fields for indexed query support.
 */
function _recordToRow(record) {
  const results = record.results || {};
  return {
    id:             record.id,
    reference:      record.invNo      || String(Date.now()).slice(-6),
    client_name:    record.clientName || '',
    product_name:   record.productName || '',
    status:         results.status    || 'OK',
    total_price:    results.finalPrice    || 0,
    direct_cost:    results.directCost    || 0,
    total_cost:     results.totalCost     || 0,
    profit:         results.profit        || 0,
    margin_on_cost:  results.marginOnCost  || 0,
    margin_on_price: results.marginOnPrice || 0,
    created_at:     record.createdAt  || new Date().toISOString(),
    payload_json:   JSON.stringify(record),
  };
}

/* ══════════════════════════════════════════════════════════
   ID GENERATOR
══════════════════════════════════════════════════════════ */
function _generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 11);
}

/* ══════════════════════════════════════════════════════════
   PUBLIC API
══════════════════════════════════════════════════════════ */

/**
 * saveQuote(record) → saved record
 *
 * `record` is the object produced by buildHistoryRecord() in history.js,
 * which has: productName, clientName, inputs{}, results{}.
 * We stamp id + createdAt here if missing.
 *
 * @throws if record is structurally invalid
 */
function saveQuote(record) {
  if (!record || !record.results || !record.results.totalCost || record.results.totalCost <= 0) {
    throw new Error('saveQuote: enregistrement invalide — calcul requis (totalCost > 0).');
  }

  // Stamp identity fields
  const stamped = {
    ...record,
    id:        record.id        || _generateId(),
    createdAt: record.createdAt || new Date().toISOString(),
    invNo:     record.invNo     || String(Date.now()).slice(-6),
  };

  const row = _recordToRow(stamped);

  run(
    `INSERT INTO quotes
       (id, reference, client_name, product_name, status,
        total_price, direct_cost, total_cost, profit,
        margin_on_cost, margin_on_price, created_at, payload_json)
     VALUES
       (?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?)`,
    [
      row.id, row.reference, row.client_name, row.product_name, row.status,
      row.total_price, row.direct_cost, row.total_cost, row.profit,
      row.margin_on_cost, row.margin_on_price, row.created_at, row.payload_json,
    ]
  );

  console.log(`[quotesRepository] Saved quote id=${stamped.id} product="${stamped.productName}"`);
  return stamped;
}

/**
 * getAllQuotes(filters?) → record[]  (newest first)
 *
 * filters: {
 *   status?:    string,   // 'OK' | 'LOW_MARGIN_RISK' | 'OVERPRICE_RISK' | 'LOSS'
 *   min_price?: number,
 *   max_price?: number,
 *   date_from?: string,   // ISO date prefix  'YYYY-MM-DD'
 *   date_to?:   string,
 * }
 *
 * All filters are optional; omitting them returns all records.
 */
function getAllQuotes(filters = {}) {
  const { status, min_price, max_price, date_from, date_to } = filters;

  const conditions = [];
  const params     = [];

  if (status)    { conditions.push('status = ?');           params.push(status); }
  if (min_price != null) { conditions.push('total_price >= ?');   params.push(min_price); }
  if (max_price != null) { conditions.push('total_price <= ?');   params.push(max_price); }
  if (date_from) { conditions.push('created_at >= ?');      params.push(date_from); }
  if (date_to)   { conditions.push('created_at <= ?');      params.push(date_to + 'T23:59:59.999Z'); }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const sql   = `SELECT * FROM quotes ${where} ORDER BY created_at DESC`;

  const rows = all(sql, params);
  return rows.map(_rowToRecord).filter(Boolean);
}

/**
 * getQuoteById(id) → record | null
 */
function getQuoteById(id) {
  const row = get('SELECT * FROM quotes WHERE id = ?', [id]);
  return _rowToRecord(row);
}

/**
 * deleteQuote(id) → { deleted: boolean }
 */
function deleteQuote(id) {
  const result = run('DELETE FROM quotes WHERE id = ?', [id]);
  return { deleted: result.changes > 0 };
}

/**
 * updateQuote(id, partialPayload) → updated record | null
 *
 * Merges partialPayload into the existing record's payload_json,
 * then re-denormalises the indexed columns.
 * Useful for adding notes, changing status, etc.
 */
function updateQuote(id, partialPayload) {
  const existing = getQuoteById(id);
  if (!existing) return null;

  const updated  = { ...existing, ...partialPayload };
  const row      = _recordToRow(updated);

  run(
    `UPDATE quotes SET
       client_name   = ?,
       product_name  = ?,
       status        = ?,
       total_price   = ?,
       direct_cost   = ?,
       total_cost    = ?,
       profit        = ?,
       margin_on_cost  = ?,
       margin_on_price = ?,
       payload_json  = ?
     WHERE id = ?`,
    [
      row.client_name, row.product_name, row.status,
      row.total_price, row.direct_cost,  row.total_cost,
      row.profit, row.margin_on_cost, row.margin_on_price,
      row.payload_json,
      id,
    ]
  );

  return updated;
}

/**
 * clearAllQuotes() → { deleted: number }
 */
function clearAllQuotes() {
  const result = run('DELETE FROM quotes');
  console.log(`[quotesRepository] Cleared ${result.changes} quotes.`);
  return { deleted: result.changes };
}

/**
 * getQuoteCount() → number  (total rows, ignoring filters)
 */
function getQuoteCount() {
  const row = get('SELECT COUNT(*) AS cnt FROM quotes');
  return row ? row.cnt : 0;
}

module.exports = {
  saveQuote,
  getAllQuotes,
  getQuoteById,
  deleteQuote,
  updateQuote,
  clearAllQuotes,
  getQuoteCount,
};
