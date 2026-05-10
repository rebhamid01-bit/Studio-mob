'use strict';
/**
 * storage/migrations.js
 *
 * Versioned, additive schema migrations.
 *
 * Rules:
 *   - Each migration has a version number (integer, 1-based).
 *   - Migrations are run in order, only if user_version < migration.version.
 *   - Never edit an existing migration — add a new one.
 *   - Each migration runs inside a transaction.
 *
 * To add a new migration: append an entry to MIGRATIONS array.
 */

/* ══════════════════════════════════════════════════════════
   MIGRATION DEFINITIONS
══════════════════════════════════════════════════════════ */
const MIGRATIONS = [

  /* ── v1 — Initial schema ─────────────────────────────── */
  {
    version: 1,
    label: 'Initial schema — quotes table',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS quotes (
          -- Identity
          id            TEXT    PRIMARY KEY NOT NULL,   -- UUID v4
          reference     TEXT    NOT NULL,               -- 6-digit invoice ref (e.g. "483921")

          -- Indexed query columns (denormalised from payload_json for fast filtering)
          client_name   TEXT    NOT NULL DEFAULT '',
          product_name  TEXT    NOT NULL DEFAULT '',
          status        TEXT    NOT NULL DEFAULT 'OK',  -- OK | LOW_MARGIN_RISK | OVERPRICE_RISK | LOSS

          -- Key financials (denormalised for dashboards / filters without JSON parsing)
          total_price   REAL    NOT NULL DEFAULT 0,     -- finalPrice
          direct_cost   REAL    NOT NULL DEFAULT 0,
          total_cost    REAL    NOT NULL DEFAULT 0,     -- COGS
          profit        REAL    NOT NULL DEFAULT 0,
          margin_on_cost  REAL  NOT NULL DEFAULT 0,     -- fraction, e.g. 0.42
          margin_on_price REAL  NOT NULL DEFAULT 0,

          -- Timestamps
          created_at    TEXT    NOT NULL,               -- ISO 8601, e.g. "2024-03-15T14:22:05.123Z"

          -- Full serialised quote (inputs + results + line-items)
          payload_json  TEXT    NOT NULL                -- JSON string
        );

        -- Indexes for the filter queries used by the history panel
        CREATE INDEX IF NOT EXISTS idx_quotes_created_at   ON quotes (created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_quotes_status       ON quotes (status);
        CREATE INDEX IF NOT EXISTS idx_quotes_total_price  ON quotes (total_price);
        CREATE INDEX IF NOT EXISTS idx_quotes_client_name  ON quotes (client_name);
      `);
    },
  },

  /* ── v2 — Add deleted_at soft-delete column ──────────── */
  /*
   * Uncomment and increment version when you need soft-delete:
   *
  {
    version: 2,
    label: 'Soft-delete support',
    up(db) {
      db.exec(`
        ALTER TABLE quotes ADD COLUMN deleted_at TEXT DEFAULT NULL;
        CREATE INDEX IF NOT EXISTS idx_quotes_deleted ON quotes (deleted_at);
      `);
    },
  },
  */

];

/* ══════════════════════════════════════════════════════════
   RUNNER
══════════════════════════════════════════════════════════ */

/**
 * runMigrations(db)
 * Applies every migration whose version > current user_version,
 * each inside its own transaction.  Updates user_version after each.
 */
function runMigrations(db) {
  const currentVersion = db.pragma('user_version', { simple: true });
  console.log(`[migrations] Current schema version: ${currentVersion}`);

  const pending = MIGRATIONS.filter(m => m.version > currentVersion)
                            .sort((a, b) => a.version - b.version);

  if (!pending.length) {
    console.log('[migrations] No pending migrations.');
    return;
  }

  for (const migration of pending) {
    console.log(`[migrations] Applying v${migration.version}: ${migration.label}`);
    try {
      // Run the migration inside a transaction
      db.transaction(() => {
        migration.up(db);
        // Stamp the new version INSIDE the same transaction
        db.pragma(`user_version = ${migration.version}`);
      })();
      console.log(`[migrations] v${migration.version} applied OK.`);
    } catch (err) {
      console.error(`[migrations] FAILED at v${migration.version}:`, err.message);
      throw err;   // bubble up — app will not start with a broken schema
    }
  }

  const finalVersion = db.pragma('user_version', { simple: true });
  console.log(`[migrations] Schema is now at version ${finalVersion}.`);
}

module.exports = { runMigrations, MIGRATIONS };
