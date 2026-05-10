'use strict';
/**
 * preload.js — Context Bridge  (v4 — dashboard stats)
 *
 * Exposes to renderer window.electronAPI with namespaces:
 *   .app.*    — version, dialogs, menu events
 *   .db.*     — SQLite quote CRUD
 *   .pdf.*    — native save dialog + fs write
 *   .stats.*  — dashboard aggregations (IPC → statsService.js)
 */

const { contextBridge, ipcRenderer } = require('electron');

async function invoke(channel, ...args) {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (result && result.ok === false) {
    throw new Error(result.error || `IPC error: ${channel}`);
  }
  return result && result.data !== undefined ? result.data : result;
}

contextBridge.exposeInMainWorld('electronAPI', {

  /* ── App utilities ──────────────────────────────────── */
  getVersion:  () => ipcRenderer.invoke('app:get-version'),
  showError:   (title, message) => ipcRenderer.invoke('app:show-error', { title, message }),
  confirm:     (title, message) => ipcRenderer.invoke('app:confirm', { title, message }),
  onMenuReset:     (cb) => ipcRenderer.on('menu:reset',     cb),
  onMenuDashboard: (cb) => ipcRenderer.on('menu:dashboard', cb),

  /* ── Database API ───────────────────────────────────── */
  db: {
    saveQuote:      (record)         => invoke('db:saveQuote',      record),
    getAllQuotes:   (filters)        => invoke('db:getAllQuotes',    filters || {}),
    getQuoteById:  (id)              => invoke('db:getQuoteById',   id),
    deleteQuote:   (id)              => invoke('db:deleteQuote',    id),
    updateQuote:   (id, payload)     => invoke('db:updateQuote',    { id, payload }),
    clearAllQuotes:()                => invoke('db:clearAllQuotes'),
    getQuoteCount: ()                => invoke('db:getQuoteCount'),
  },

  /* ── PDF API ────────────────────────────────────────── */
  pdf: {
    save: ({ type, internalReport, clientReport }) =>
      ipcRenderer.invoke('pdf:save', { type, internalReport, clientReport }),
  },

  /* ── Dashboard / Stats API ──────────────────────────── */
  stats: {
    getDashboardData:  (filters) => invoke('stats:getDashboardData',  filters || {}),
    getKpiSummary:     (filters) => invoke('stats:getKpiSummary',     filters || {}),
    getMonthlyRevenue: (filters) => invoke('stats:getMonthlyRevenue', filters || {}),
    getTopProducts:    (filters) => invoke('stats:getTopProducts',    filters || {}),
    getTopClients:     (filters) => invoke('stats:getTopClients',     filters || {}),
    getFilterOptions:  ()        => invoke('stats:getFilterOptions'),
  },
});
