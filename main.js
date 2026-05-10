'use strict';
/**
 * main.js — Electron main process  (v3 — native PDF save)
 *
 * New in v3:
 *   - ipcMain.handle('pdf:save')  → build PDF bytes (main process) + dialog.showSaveDialog() + fs.writeFile
 *   - _getPdfDefaultDir()         → Documents/Studio Mobilier Pro/YYYY/MM, auto-created
 */

const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs   = require('fs');

/* ══════════════════════════════════════════════════════════
   DATABASE BOOTSTRAP
══════════════════════════════════════════════════════════ */
let _db;
function bootDatabase() {
  const { initDatabase } = require('./storage/database');
  _db = initDatabase(app.getPath('userData'));
  _registerDbHandlers();
}

function _registerDbHandlers() {
  const repo = require('./storage/quotesRepository');

  const dbOps = {
    'db:saveQuote':     (_, r)         => repo.saveQuote(r),
    'db:getAllQuotes':  (_, f)         => repo.getAllQuotes(f || {}),
    'db:getQuoteById': (_, id)        => repo.getQuoteById(id),
    'db:deleteQuote':  (_, id)        => repo.deleteQuote(id),
    'db:updateQuote':  (_, { id, payload }) => repo.updateQuote(id, payload),
    'db:clearAllQuotes': ()           => repo.clearAllQuotes(),
    'db:getQuoteCount':  ()           => repo.getQuoteCount(),
  };

  for (const [channel, fn] of Object.entries(dbOps)) {
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        return { ok: true, data: fn(event, ...args) };
      } catch (err) {
        console.error(`[ipc] ${channel} error:`, err.message);
        return { ok: false, error: err.message };
      }
    });
  }
}


/* ══════════════════════════════════════════════════════════
   PDF SAVE HANDLER
══════════════════════════════════════════════════════════ */

/**
 * Returns the default Documents/Studio Mobilier Pro/YYYY/MM directory,
 * creating it on first use if it doesn't exist.
 */
function _getPdfDefaultDir() {
  const now   = new Date();
  const yyyy  = String(now.getFullYear());
  const mm    = String(now.getMonth() + 1).padStart(2, '0');
  const dir   = path.join(
    app.getPath('documents'),
    'Studio Mobilier Pro',
    yyyy,
    mm
  );
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    console.warn('[pdf] Could not create default dir:', e.message);
  }
  return dir;
}

function _registerPdfHandler() {
  const { buildInternalPdf } = require('./reports/internalPdf');
  const { buildClientPdf }   = require('./reports/clientPdf');
  const { buildFilename }    = require('./reports/pdfService');

  ipcMain.handle('pdf:save', async (_, { type, internalReport, clientReport }) => {
    try {
      // 1. Build PDF bytes in main process (pure string, no DOM)
      let pdfRaw;
      if (type === 'internal') {
        if (!internalReport) throw new Error('Rapport interne manquant.');
        pdfRaw = buildInternalPdf(internalReport, _getRiskConfig());
      } else {
        if (!clientReport) throw new Error('Rapport client manquant.');
        pdfRaw = buildClientPdf(clientReport);
      }

      if (!pdfRaw || pdfRaw.length < 100) {
        throw new Error('Le moteur PDF n\'a produit aucune donnée.');
      }

      // 2. Suggested filename + default directory
      const dataForName = type === 'internal' ? internalReport : clientReport;
      const suggestedName = buildFilename(type, dataForName);
      const defaultPath   = path.join(_getPdfDefaultDir(), suggestedName);

      // 3. Native save dialog
      const win = BrowserWindow.getFocusedWindow();
      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        title:       type === 'internal' ? 'Sauvegarder le document interne' : 'Sauvegarder la facture',
        defaultPath,
        filters:     [{ name: 'PDF', extensions: ['pdf'] }],
        properties:  ['createDirectory', 'showOverwriteConfirmation'],
      });

      if (canceled || !filePath) {
        return { ok: true, cancelled: true };
      }

      // 4. Write raw PDF string as binary Buffer (Latin-1)
      //    PDF 1.4 content streams are ASCII; this is safe.
      const buf = Buffer.from(pdfRaw, 'binary');
      fs.writeFileSync(filePath, buf);

      console.log(`[pdf] Saved ${buf.length} bytes → ${filePath}`);

      // 5. Reveal file in Explorer (optional — non-blocking)
      try { shell.showItemInFolder(filePath); } catch (_) {}

      return { ok: true, cancelled: false, filePath };

    } catch (err) {
      console.error('[pdf:save] error:', err);
      return { ok: false, error: err.message };
    }
  });
}

/* ══════════════════════════════════════════════════════════
   DASHBOARD STATS HANDLERS
══════════════════════════════════════════════════════════ */
function _registerStatsHandlers() {
  const stats = require('./dashboard/statsService');

  const statsOps = {
    'stats:getDashboardData':    (_, f) => stats.getDashboardData(f || {}),
    'stats:getKpiSummary':       (_, f) => stats.getKpiSummary(f || {}),
    'stats:getMonthlyRevenue':   (_, f) => stats.getMonthlyRevenue(f || {}),
    'stats:getTopProducts':      (_, f) => stats.getTopProducts(f || {}),
    'stats:getTopClients':       (_, f) => stats.getTopClients(f || {}),
    'stats:getFilterOptions':    ()     => stats.getFilterOptions(),
  };

  for (const [channel, fn] of Object.entries(statsOps)) {
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        return { ok: true, data: fn(event, ...args) };
      } catch (err) {
        console.error(`[ipc] ${channel} error:`, err.message);
        return { ok: false, error: err.message };
      }
    });
  }
}

/** Inline RISK_CONFIG copy so main process doesn't import renderer files. */
function _getRiskConfig() {
  return {
    OK:             { title: 'Prix valide' },
    LOW_MARGIN_RISK:{ title: 'Marge faible' },
    OVERPRICE_RISK: { title: 'Prix potentiellement eleve' },
    LOSS:           { title: 'PERTE DETECTEE' },
  };
}


/* ══════════════════════════════════════════════════════════
   APP IPC — general
══════════════════════════════════════════════════════════ */
ipcMain.handle('app:get-version', () => app.getVersion());

ipcMain.handle('app:show-error', async (_, { title, message }) => {
  await dialog.showMessageBox({ type: 'error', title, message, buttons: ['OK'] });
});

ipcMain.handle('app:confirm', async (_, { title, message }) => {
  const { response } = await dialog.showMessageBox({
    type: 'question', title, message,
    buttons: ['Annuler', 'Confirmer'], defaultId: 1,
  });
  return response === 1;
});


/* ══════════════════════════════════════════════════════════
   WINDOW FACTORY
══════════════════════════════════════════════════════════ */
function createWindow() {
  const win = new BrowserWindow({
    width:  1400,
    height: 900,
    minWidth:  900,
    minHeight: 600,
    title: 'Studio Mobilier Pro',
    backgroundColor: '#0f0f0f',
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: true,
      sandbox:          false,
      preload: path.join(__dirname, 'preload.js'),
    },
    frame: true,
    show:  false,
  });

  win.loadFile(path.join(__dirname, 'index.html'));
  win.once('ready-to-show', () => win.show());

  // Allow navigation within the app (index.html ↔ dashboard/dashboard.html)
  // Block everything else (http/https external URLs)
  win.webContents.on('will-navigate', (event, url) => {
    try {
      const parsed = new URL(url);
      // Allow file:// protocol (same-app pages) and about:blank
      if (parsed.protocol !== 'file:' && parsed.protocol !== 'about:') {
        console.warn('[main] Blocked external navigation to:', url);
        event.preventDefault();
      }
    } catch (_) {
      event.preventDefault();
    }
  });

  if (process.env.NODE_ENV === 'development') {
    win.webContents.openDevTools();
  }

  return win;
}


/* ══════════════════════════════════════════════════════════
   MENU
══════════════════════════════════════════════════════════ */
function buildMenu() {
  const template = [
    {
      label: 'Fichier',
      submenu: [
        {
          label: 'Réinitialiser le formulaire', accelerator: 'CmdOrCtrl+N',
          click: (_, win) => win && win.webContents.send('menu:reset'),
        },
        { type: 'separator' },
        {
          label: 'Ouvrir le Dashboard', accelerator: 'CmdOrCtrl+D',
          click: (_, win) => {
            if (win) win.webContents.loadFile(path.join(__dirname, 'dashboard', 'dashboard.html'));
          },
        },
        {
          label: 'Ouvrir le dossier PDF', accelerator: 'CmdOrCtrl+Shift+O',
          click: () => {
            const dir = _getPdfDefaultDir();
            shell.openPath(dir);
          },
        },
        { type: 'separator' },
        { label: 'Quitter', accelerator: 'Alt+F4', role: 'quit' },
      ],
    },
    {
      label: 'Affichage',
      submenu: [
        { role: 'reload',           label: 'Recharger' },
        { role: 'togglefullscreen', label: 'Plein écran' },
        { type: 'separator' },
        { role: 'zoomin',   label: 'Zoom +' },
        { role: 'zoomout',  label: 'Zoom −' },
        { role: 'resetzoom', label: 'Zoom normal' },
      ],
    },
    {
      label: 'Aide',
      submenu: [
        {
          label: 'À propos',
          click: () => dialog.showMessageBox({
            type: 'info',
            title: 'Studio Mobilier Pro',
            message: 'Studio Mobilier Pro',
            detail: [
              `Version ${app.getVersion()}`,
              'Système de Décision Tarifaire',
              '',
              'Stockage : SQLite (studio_mobilier.db)',
              `PDF enregistrés dans : Documents\\Studio Mobilier Pro\\`,
            ].join('\n'),
            buttons: ['OK'],
          }),
        },
      ],
    },
  ];

  if (process.platform === 'darwin') {
    template.unshift({
      label: app.name,
      submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }],
    });
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}


/* ══════════════════════════════════════════════════════════
   APP LIFECYCLE
══════════════════════════════════════════════════════════ */
app.whenReady().then(() => {
  // 1. Database
  try {
    bootDatabase();
  } catch (err) {
    dialog.showErrorBox(
      'Erreur base de données',
      `Impossible d'ouvrir la base de données:\n${err.message}\n\nL'application va se fermer.`
    );
    app.quit();
    return;
  }

  // 2. PDF handler
  _registerPdfHandler();

  // 3. Dashboard stats handlers
  _registerStatsHandlers();

  // 3. UI
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  try {
    const { closeDatabase } = require('./storage/database');
    closeDatabase();
  } catch (_) {}
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

process.on('uncaughtException', (err) => {
  console.error('[main] Uncaught exception:', err);
  dialog.showErrorBox('Erreur inattendue', err.message || String(err));
});
