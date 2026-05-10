'use strict';
/**
 * storage/database.js
 *
 * Low-level SQLite layer (main-process only).
 *
 * Responsibilities:
 *   - Open / create the database file in app.getPath('userData')
 *   - Run all migrations via storage/migrations.js
 *   - Expose a single shared `db` handle to the rest of the main process
 *   - Provide thin, typed wrappers: run(), get(), all()
 *
 * Never import this file from the renderer.
 * All renderer access goes through IPC → quotesRepository.js
 */

const path    = require('path');
const fs      = require('fs');
const Database = require('better-sqlite3');

let _db = null;   // module-level singleton

/* ══════════════════════════════════════════════════════════
   INITIALISE
   Call once from main.js before creating the BrowserWindow.
   Returns the open database handle.
══════════════════════════════════════════════════════════ */
function initDatabase(userDataPath) {
  if (_db) return _db;   // already open — idempotent

  // Ensure the userData directory exists (Electron creates it, but guard anyway)
  if (!fs.existsSync(userDataPath)) {
    fs.mkdirSync(userDataPath, { recursive: true });
  }

  const dbPath = path.join(userDataPath, 'studio_mobilier.db');
  console.log('[database] Opening DB at:', dbPath);

  try {
    _db = new Database(dbPath, {
      // Verbose logging in development
      verbose: process.env.NODE_ENV === 'development'
        ? (msg) => console.log('[SQLite]', msg)
        : null,
    });

    // Recommended SQLite pragmas for performance & integrity
    _db.pragma('journal_mode = WAL');     // Write-Ahead Logging: faster concurrent reads
    _db.pragma('foreign_keys = ON');      // enforce FK constraints
    _db.pragma('synchronous = NORMAL');   // safe with WAL
    _db.pragma('cache_size = -8000');     // 8 MB page cache
    _db.pragma('temp_store = MEMORY');

    // Run all schema migrations
    const { runMigrations } = require('./migrations');
    runMigrations(_db);

    console.log('[database] Ready. Schema version:', getSchemaVersion());
    return _db;

  } catch (err) {
    console.error('[database] FATAL — could not open database:', err);
    throw err;   // bubble up to main.js crash handler
  }
}

/* ══════════════════════════════════════════════════════════
   ACCESSORS
══════════════════════════════════════════════════════════ */

/** Returns the open db handle. Throws if initDatabase() was not called. */
function getDb() {
  if (!_db) throw new Error('[database] Database not initialised. Call initDatabase() first.');
  return _db;
}

/** Current user_version pragma (mirrors migration version). */
function getSchemaVersion() {
  return _db.pragma('user_version', { simple: true });
}

/* ══════════════════════════════════════════════════════════
   TYPED WRAPPERS
   Thin helpers that add consistent error logging.
   Use these inside quotesRepository.js rather than calling
   _db.prepare() directly, so every query failure is logged.
══════════════════════════════════════════════════════════ */

/**
 * run(sql, params) → { changes, lastInsertRowid }
 * For INSERT / UPDATE / DELETE.
 */
function run(sql, params = []) {
  try {
    return getDb().prepare(sql).run(...(Array.isArray(params) ? params : [params]));
  } catch (err) {
    console.error('[database] run() error\nSQL:', sql, '\nParams:', params, '\nError:', err.message);
    throw err;
  }
}

/**
 * get(sql, params) → row | undefined
 * For SELECT returning zero or one row.
 */
function get(sql, params = []) {
  try {
    return getDb().prepare(sql).get(...(Array.isArray(params) ? params : [params]));
  } catch (err) {
    console.error('[database] get() error\nSQL:', sql, '\nParams:', params, '\nError:', err.message);
    throw err;
  }
}

/**
 * all(sql, params) → row[]
 * For SELECT returning multiple rows.
 */
function all(sql, params = []) {
  try {
    return getDb().prepare(sql).all(...(Array.isArray(params) ? params : [params]));
  } catch (err) {
    console.error('[database] all() error\nSQL:', sql, '\nParams:', params, '\nError:', err.message);
    throw err;
  }
}

/**
 * transaction(fn) → result of fn
 * Wraps fn in a BEGIN/COMMIT block; rolls back on throw.
 */
function transaction(fn) {
  return getDb().transaction(fn)();
}

/* ══════════════════════════════════════════════════════════
   CLOSE (called on app quit)
══════════════════════════════════════════════════════════ */
function closeDatabase() {
  if (_db) {
    _db.close();
    _db = null;
    console.log('[database] Connection closed.');
  }
}

module.exports = { initDatabase, getDb, getSchemaVersion, run, get, all, transaction, closeDatabase };
