'use strict';
/**
 * dashboard/statsService.js  — main-process only
 *
 * All business-intelligence queries run here against SQLite.
 * The renderer NEVER calculates metrics — it only renders what this service returns.
 *
 * Every public function accepts an optional `filters` object:
 *   { year?, month?, date_from?, date_to?, client_name?, status? }
 *
 * Return shapes are documented inline and match what dashboard.js expects.
 */

const { get, all } = require('../storage/database');

/* ══════════════════════════════════════════════════════════
   FILTER BUILDER
   Converts the UI filter object into a SQL WHERE clause + params array.
   Used by every query that supports filtering.
══════════════════════════════════════════════════════════ */
function _buildWhere(filters = {}) {
  const conds  = [];
  const params = [];

  if (filters.year) {
    conds.push("strftime('%Y', created_at) = ?");
    params.push(String(filters.year));
  }
  if (filters.month) {
    conds.push("strftime('%m', created_at) = ?");
    params.push(String(filters.month).padStart(2, '0'));
  }
  if (filters.date_from) {
    conds.push('created_at >= ?');
    params.push(filters.date_from);
  }
  if (filters.date_to) {
    conds.push('created_at <= ?');
    params.push(filters.date_to + 'T23:59:59.999Z');
  }
  if (filters.client_name && filters.client_name.trim()) {
    conds.push('LOWER(client_name) LIKE ?');
    params.push('%' + filters.client_name.toLowerCase().trim() + '%');
  }
  if (filters.status) {
    conds.push('status = ?');
    params.push(filters.status);
  }

  return {
    where:  conds.length ? 'WHERE ' + conds.join(' AND ') : '',
    params,
  };
}

/* ══════════════════════════════════════════════════════════
   KPI SUMMARY
   Returns a single object with all top-level KPI values.
══════════════════════════════════════════════════════════ */
function getKpiSummary(filters = {}) {
  const { where, params } = _buildWhere(filters);

  const row = get(`
    SELECT
      COUNT(*)                                      AS total_quotes,
      COALESCE(SUM(total_price),  0)                AS total_revenue,
      COALESCE(SUM(profit),       0)                AS total_profit,
      COALESCE(SUM(total_cost),   0)                AS total_cost,
      COALESCE(AVG(margin_on_price), 0)             AS avg_margin_on_price,
      COALESCE(AVG(margin_on_cost),  0)             AS avg_margin_on_cost,
      COALESCE(AVG(total_price),  0)                AS avg_ticket,
      COALESCE(MIN(total_price),  0)                AS min_price,
      COALESCE(MAX(total_price),  0)                AS max_price,
      COUNT(CASE WHEN status = 'OK' THEN 1 END)     AS ok_count,
      COUNT(CASE WHEN status = 'LOW_MARGIN_RISK' THEN 1 END) AS low_margin_count,
      COUNT(CASE WHEN status = 'OVERPRICE_RISK'  THEN 1 END) AS overprice_count,
      COUNT(CASE WHEN status = 'LOSS' THEN 1 END)   AS loss_count
    FROM quotes ${where}
  `, params);

  // Monthly revenue = same period restricted to current calendar month
  const now = new Date();
  const { where: mw, params: mp } = _buildWhere({
    ...filters,
    year:  filters.year  || now.getFullYear(),
    month: filters.month || (now.getMonth() + 1),
  });
  const monthRow = get(`
    SELECT COALESCE(SUM(total_price), 0) AS monthly_revenue,
           COUNT(*) AS monthly_count
    FROM quotes ${mw}
  `, mp);

  return {
    totalQuotes:       row.total_quotes,
    totalRevenue:      row.total_revenue,
    totalProfit:       row.total_profit,
    totalCost:         row.total_cost,
    avgMarginOnPrice:  row.avg_margin_on_price,
    avgMarginOnCost:   row.avg_margin_on_cost,
    avgTicket:         row.avg_ticket,
    minPrice:          row.min_price,
    maxPrice:          row.max_price,
    monthlyRevenue:    monthRow.monthly_revenue,
    monthlyCount:      monthRow.monthly_count,
    statusBreakdown: {
      ok:          row.ok_count,
      lowMargin:   row.low_margin_count,
      overprice:   row.overprice_count,
      loss:        row.loss_count,
    },
  };
}

/* ══════════════════════════════════════════════════════════
   MONTHLY REVENUE — last N months
   Returns array of { month:'2025-03', revenue, profit, count }
   sorted oldest → newest (Chart.js ready).
══════════════════════════════════════════════════════════ */
function getMonthlyRevenue(filters = {}, months = 12) {
  // Build date_from = first day of (today - months)
  const { where, params } = _buildWhere(filters);
  const rows = all(`
    SELECT
      strftime('%Y-%m', created_at) AS month,
      COALESCE(SUM(total_price), 0) AS revenue,
      COALESCE(SUM(profit),      0) AS profit,
      COALESCE(SUM(total_cost),  0) AS cost,
      COUNT(*)                       AS count,
      COALESCE(AVG(margin_on_price), 0) AS avg_margin
    FROM quotes
    ${where}
    GROUP BY strftime('%Y-%m', created_at)
    ORDER BY month ASC
    LIMIT ?
  `, [...params, months]);

  return rows;
}

/* ══════════════════════════════════════════════════════════
   REVENUE BY STATUS  (for pie/doughnut chart)
══════════════════════════════════════════════════════════ */
function getRevenueByStatus(filters = {}) {
  const { where, params } = _buildWhere(filters);
  return all(`
    SELECT
      status,
      COUNT(*)                       AS count,
      COALESCE(SUM(total_price), 0)  AS revenue,
      COALESCE(SUM(profit),      0)  AS profit,
      COALESCE(AVG(margin_on_price), 0) AS avg_margin
    FROM quotes ${where}
    GROUP BY status
    ORDER BY revenue DESC
  `, params);
}

/* ══════════════════════════════════════════════════════════
   MARGIN EVOLUTION  (trend line — weekly buckets)
══════════════════════════════════════════════════════════ */
function getMarginEvolution(filters = {}) {
  const { where, params } = _buildWhere(filters);
  return all(`
    SELECT
      strftime('%Y-W%W', created_at) AS week,
      strftime('%Y-%m-%d', MIN(created_at)) AS week_start,
      COALESCE(AVG(margin_on_price), 0) AS avg_margin,
      COALESCE(AVG(margin_on_cost),  0) AS avg_margin_cost,
      COUNT(*)                           AS count
    FROM quotes ${where}
    GROUP BY strftime('%Y-W%W', created_at)
    ORDER BY week ASC
    LIMIT 52
  `, params);
}

/* ══════════════════════════════════════════════════════════
   TOP PRODUCTS  (by revenue, profit, or count)
══════════════════════════════════════════════════════════ */
function getTopProducts(filters = {}, limit = 10) {
  const { where, params } = _buildWhere(filters);
  return all(`
    SELECT
      product_name,
      COUNT(*)                          AS quote_count,
      COALESCE(SUM(total_price), 0)     AS total_revenue,
      COALESCE(SUM(profit),      0)     AS total_profit,
      COALESCE(SUM(total_cost),  0)     AS total_cost,
      COALESCE(AVG(total_price), 0)     AS avg_price,
      COALESCE(AVG(margin_on_price), 0) AS avg_margin,
      COALESCE(MAX(total_price), 0)     AS max_price
    FROM quotes ${where}
    GROUP BY LOWER(TRIM(product_name))
    ORDER BY total_revenue DESC
    LIMIT ?
  `, [...params, limit]);
}

/* ══════════════════════════════════════════════════════════
   TOP CLIENTS
══════════════════════════════════════════════════════════ */
function getTopClients(filters = {}, limit = 10) {
  const { where, params } = _buildWhere(filters);
  return all(`
    SELECT
      client_name,
      COUNT(*)                          AS project_count,
      COALESCE(SUM(total_price), 0)     AS total_spent,
      COALESCE(SUM(profit),      0)     AS total_profit,
      COALESCE(AVG(margin_on_price), 0) AS avg_margin,
      MAX(created_at)                   AS last_project_at,
      MIN(created_at)                   AS first_project_at
    FROM quotes
    ${where ? where + ' AND' : 'WHERE'} TRIM(client_name) != ''
    GROUP BY LOWER(TRIM(client_name))
    ORDER BY total_spent DESC
    LIMIT ?
  `, [...params, limit]);
}

/* ══════════════════════════════════════════════════════════
   DAILY REVENUE  (sparkline for last 30 days)
══════════════════════════════════════════════════════════ */
function getDailyRevenue(filters = {}, days = 30) {
  const { where, params } = _buildWhere(filters);
  return all(`
    SELECT
      strftime('%Y-%m-%d', created_at) AS day,
      COALESCE(SUM(total_price), 0)    AS revenue,
      COUNT(*)                          AS count
    FROM quotes ${where}
    GROUP BY strftime('%Y-%m-%d', created_at)
    ORDER BY day ASC
    LIMIT ?
  `, [...params, days]);
}

/* ══════════════════════════════════════════════════════════
   PROFIT DISTRIBUTION  (histogram buckets)
   Returns how many quotes fall into each price range bucket.
══════════════════════════════════════════════════════════ */
function getProfitDistribution(filters = {}) {
  const { where, params } = _buildWhere(filters);
  // Dynamic bucket count based on data range
  const range = get(`
    SELECT
      COALESCE(MIN(profit), 0) AS min_p,
      COALESCE(MAX(profit), 0) AS max_p
    FROM quotes ${where}
  `, params);

  if (!range || range.max_p === 0) return [];

  const bucketSize = Math.max(1000, Math.ceil((range.max_p - range.min_p) / 10 / 1000) * 1000);

  return all(`
    SELECT
      (CAST(profit / ${bucketSize} AS INTEGER) * ${bucketSize}) AS bucket_floor,
      COUNT(*) AS count,
      COALESCE(AVG(margin_on_price), 0) AS avg_margin
    FROM quotes ${where}
    GROUP BY CAST(profit / ${bucketSize} AS INTEGER)
    ORDER BY bucket_floor ASC
  `, params);
}

/* ══════════════════════════════════════════════════════════
   COST BREAKDOWN AVERAGE  (stacked bar)
══════════════════════════════════════════════════════════ */
function getAvgCostBreakdown(filters = {}) {
  const { where, params } = _buildWhere(filters);
  // We need materialsCost, edgeBandingCost, accessoriesCost, laborCost
  // These are in payload_json only, so we read them from there.
  // For performance with large datasets we sample the last 500 rows.
  const rows = all(`
    SELECT payload_json FROM quotes ${where}
    ORDER BY created_at DESC LIMIT 500
  `, params);

  let mat = 0, edge = 0, acc = 0, labor = 0, indirect = 0, n = 0;
  for (const r of rows) {
    try {
      const p = JSON.parse(r.payload_json);
      const inp = p.inputs || {};
      mat    += inp.materialsCost   || 0;
      edge   += inp.edgeBandingCost || 0;
      acc    += inp.accessoriesCost || 0;
      labor  += inp.laborCost       || 0;
      // indirectCost = totalCost - directCost
      const res = p.results || {};
      indirect += (res.totalCost || 0) - (res.directCost || 0);
      n++;
    } catch (_) {}
  }
  if (n === 0) return { materiaux: 0, chant: 0, accessoires: 0, main_oeuvre: 0, frais_generaux: 0 };
  return {
    materiaux:      mat    / n,
    chant:          edge   / n,
    accessoires:    acc    / n,
    main_oeuvre:    labor  / n,
    frais_generaux: indirect / n,
  };
}

/* ══════════════════════════════════════════════════════════
   FILTER OPTIONS  (distinct values for UI dropdowns)
══════════════════════════════════════════════════════════ */
function getFilterOptions() {
  const years = all(`
    SELECT DISTINCT strftime('%Y', created_at) AS year
    FROM quotes ORDER BY year DESC LIMIT 10
  `).map(r => r.year);

  const clients = all(`
    SELECT DISTINCT client_name FROM quotes
    WHERE TRIM(client_name) != ''
    ORDER BY client_name ASC LIMIT 100
  `).map(r => r.client_name);

  const statuses = ['OK', 'LOW_MARGIN_RISK', 'OVERPRICE_RISK', 'LOSS'];

  return { years, clients, statuses };
}

/* ══════════════════════════════════════════════════════════
   FULL DASHBOARD PAYLOAD  (single IPC round-trip)
   Calls all stat functions and returns one big object.
   The renderer calls this once on load and on filter change.
══════════════════════════════════════════════════════════ */
function getDashboardData(filters = {}) {
  return {
    kpi:               getKpiSummary(filters),
    monthlyRevenue:    getMonthlyRevenue(filters, 12),
    revenueByStatus:   getRevenueByStatus(filters),
    marginEvolution:   getMarginEvolution(filters),
    topProducts:       getTopProducts(filters, 10),
    topClients:        getTopClients(filters, 10),
    profitDistribution:getProfitDistribution(filters),
    avgCostBreakdown:  getAvgCostBreakdown(filters),
    filterOptions:     getFilterOptions(),
  };
}

module.exports = {
  getDashboardData,
  getKpiSummary,
  getMonthlyRevenue,
  getRevenueByStatus,
  getMarginEvolution,
  getTopProducts,
  getTopClients,
  getDailyRevenue,
  getProfitDistribution,
  getAvgCostBreakdown,
  getFilterOptions,
};
