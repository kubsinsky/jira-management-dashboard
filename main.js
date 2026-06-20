const { app, BrowserWindow, shell, dialog, ipcMain, Notification, globalShortcut } = require('electron');
const path = require('path');
const fs   = require('fs');
const net  = require('net');

let mainWindow = null;
let serverPort = 3000;

// ── Load .env and inject into process.env before requiring server.js ──────────
function loadEnv() {
  const envPath = app.isPackaged
    ? path.join(process.resourcesPath, '.env')
    : path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  fs.readFileSync(envPath, 'utf8')
    .split('\n')
    .filter(l => l.trim() && !l.startsWith('#') && l.includes('='))
    .forEach(l => {
      const i = l.indexOf('=');
      const key = l.slice(0, i).trim();
      const val = l.slice(i + 1).trim();
      if (!process.env[key]) process.env[key] = val; // don't override existing
    });
}

// ── Find a free port starting from `from` ─────────────────────────────────────
function findFreePort(from) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(findFreePort(from + 1)));
    server.once('listening', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.listen(from);
  });
}

// ── Start Express in this process (no fork — works reliably when packaged) ────
async function startServer() {
  loadEnv();
  // Pass userData path so server.js knows where to read/write config.json
  process.env.USER_DATA_PATH = app.getPath('userData');
  serverPort = await findFreePort(3000);
  const serverPath = path.join(__dirname, 'server.js');
  const { start } = require(serverPath);
  return start(serverPort);
}

// ── Splash: shown while server is booting ─────────────────────────────────────
function createSplash() {
  const splash = new BrowserWindow({
    width: 360, height: 220,
    frame: false, resizable: false,
    alwaysOnTop: true, center: true,
    backgroundColor: '#2563eb',
    webPreferences: { nodeIntegration: false },
  });
  splash.loadFile(path.join(__dirname, 'splash.html'));
  return splash;
}

// ── Main window ───────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440, height: 900,
    minWidth: 960, minHeight: 600,
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    title: 'Jira Management Dashboard',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // Handle window.open() calls
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  // Handle <a target="_blank"> clicks
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('http://localhost')) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  // Keep traffic-light buttons visible even when the window loses focus
  // (macOS hides them on blur for hiddenInset windows without this workaround)
  if (process.platform === 'darwin') {
    mainWindow.on('blur',  () => { if (!mainWindow.isDestroyed()) mainWindow.setWindowButtonVisibility(true); });
    mainWindow.on('focus', () => { if (!mainWindow.isDestroyed()) mainWindow.setWindowButtonVisibility(true); });
  }

  return mainWindow;
}

// ── Native notifications via IPC ──────────────────────────────────────────────
ipcMain.on('show-notification', (_event, payload) => {
  if (!Notification.isSupported()) return;
  const { title, body, key, updated } = payload || {};

  const options = { title, body, silent: false };
  
  // Dodajemy natywne przyciski akcji (wspierane w pełni na macOS)
  if (process.platform === 'darwin') {
    options.actions = [
      { type: 'button', text: 'Mark as Read' },
      { type: 'button', text: 'Open Note' }
    ];
  }

  const n = new Notification(options);

  n.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      // Informujemy interfejs, że kliknięto powiadomienie, by otworzyć szufladę biletów
      mainWindow.webContents.send('notif-clicked', { key });
    }
  });

  n.on('action', (event, index) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (index === 0) {
        // Kliknięto "Mark as Read" -> wysyłamy żądanie do okna
        mainWindow.webContents.send('notif-action-read', { key, updated });
      } else if (index === 1) {
        // Kliknięto "Open Note" -> otwieramy małe pływające okno notatnika biletów
        mainWindow.webContents.send('show-quick-note', { key, summary: '' });
      }
    }
  });

  n.show();
});

// Register app with macOS Notification Center on every launch.
// This is needed after reinstall or when the user grants permission in System Settings.
// Uses a silent, minimal notification so the app appears in System Settings → Notifications.
ipcMain.on('register-notifications', () => {
  if (!Notification.isSupported()) return;
  try {
    const n = new Notification({ title: 'Jira Management Dashboard', body: '', silent: true });
    n.show();
  } catch {}
});

// ── Dock / taskbar badge count ────────────────────────────────────────────────
ipcMain.on('set-badge-count', (_event, count) => {
  try {
    if (process.platform === 'darwin') {
      app.dock.setBadge(count > 0 ? String(count) : '');
    } else if (app.setBadgeCount) {
      app.setBadgeCount(count || 0);
    }
  } catch {}
});

// ── Global shortcut — opens a small floating quick-note window ────────────────
let quickNoteWin = null;

function showQuickNoteWindow() {
  if (quickNoteWin && !quickNoteWin.isDestroyed()) {
    if (quickNoteWin.isVisible()) {
      // Toggle: window is open → auto-save and hide it
      quickNoteWin.webContents.send('save-and-hide');
      return;
    }
    // Window exists but hidden → reload and show
    quickNoteWin.webContents.send('reload-quick-note');
    quickNoteWin.show();
    quickNoteWin.focus();
    return;
  }
  quickNoteWin = new BrowserWindow({
    width: 600, height: 540,
    frame: false,
    alwaysOnTop: true,
    resizable: true,
    minWidth: 420, minHeight: 360,
    center: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  quickNoteWin.loadURL(`http://localhost:${serverPort}/quick-note-win.html`);
  quickNoteWin.once('ready-to-show', () => {
    quickNoteWin.show();
    quickNoteWin.focus();
  });
  quickNoteWin.on('closed', () => { quickNoteWin = null; });
}

ipcMain.on('close-quick-note-window', () => {
  if (quickNoteWin && !quickNoteWin.isDestroyed()) {
    // Temporarily make main window non-focusable so macOS doesn't activate it
    // when the floating quick-note panel is hidden. Focus returns to the
    // previously active app (e.g. Chrome) instead.
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setFocusable(false);
    }
    quickNoteWin.hide();
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setFocusable(true);
      }
    }, 150);
  }
});

function registerAppShortcut(sc) {
  try { globalShortcut.unregisterAll(); } catch(e) {}
  if (!sc || !sc.trim()) return;
  try {
    const ok = globalShortcut.register(sc.trim(), () => showQuickNoteWindow());
    if (!ok) console.warn('[shortcut] Failed to register:', sc);
  } catch(e) { console.warn('[shortcut] Error:', e.message); }
}

ipcMain.on('set-shortcut', (_event, sc) => { registerAppShortcut(sc); });

ipcMain.on('open-external-link', (_event, url) => {
  if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
    shell.openExternal(url);
  }
});

ipcMain.on('open-quick-note-key', (_event, payload) => {
  // payload may be a plain string (legacy) or {key, summary} object
  const notePayload = (payload && typeof payload === 'object') ? payload : { key: payload || '', summary: '' };
  if (quickNoteWin && !quickNoteWin.isDestroyed()) {
    if (!quickNoteWin.isVisible()) {
      quickNoteWin.show();
    }
    quickNoteWin.focus();
    setTimeout(() => { if (!quickNoteWin.isDestroyed()) quickNoteWin.webContents.send('show-quick-note', notePayload); }, 80);
  } else {
    quickNoteWin = new BrowserWindow({
      width: 600, height: 540,
      frame: false, alwaysOnTop: true, resizable: true,
      minWidth: 420, minHeight: 360, center: true, show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') },
    });
    quickNoteWin.loadURL(`http://localhost:${serverPort}/quick-note-win.html`);
    quickNoteWin.once('ready-to-show', () => {
      quickNoteWin.show();
      quickNoteWin.focus();
      setTimeout(() => { if (!quickNoteWin.isDestroyed()) quickNoteWin.webContents.send('show-quick-note', notePayload); }, 150);
    });
    quickNoteWin.on('closed', () => { quickNoteWin = null; });
  }
});

// ── Lifecycle ─────────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  const splash = createSplash();

  try {
    await startServer();

    const win = createWindow();

    // Load and register saved shortcut
    try {
      const cfgPath = path.join(app.getPath('userData'), 'config.json');
      const cfgData = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, 'utf8')) : {};
      if (cfgData.quickNoteShortcut) registerAppShortcut(cfgData.quickNoteShortcut);
    } catch(e) {}

    // Safety timeout — if ready-to-show never fires, show after 8s anyway
    const showTimeout = setTimeout(() => {
      if (!win.isDestroyed() && !win.isVisible()) {
        splash.destroy();
        win.show();
      }
    }, 8000);

    win.once('ready-to-show', () => {
      clearTimeout(showTimeout);
      splash.destroy();
      win.show();
    });

    // Handle load failure (e.g. server crashed after start)
    win.webContents.on('did-fail-load', (e, code, desc) => {
      clearTimeout(showTimeout);
      if (!splash.isDestroyed()) splash.destroy();
      dialog.showErrorBox(
        'Jira Management Dashboard — Load Error',
        `Failed to load app (${code}: ${desc})\n\nTry restarting the application.`
      );
      app.quit();
    });

    win.loadURL(`http://localhost:${serverPort}`);

  } catch (err) {
    if (!splash.isDestroyed()) splash.destroy();
    dialog.showErrorBox(
      'Jira Management Dashboard — Startup Error',
      `Failed to start server:\n\n${err.message}`
    );
    app.quit();
  }
});

app.on('will-quit', () => {
  try { globalShortcut.unregisterAll(); } catch(e) {}
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    try {
      const win = createWindow();
      win.once('ready-to-show', () => win.show());
      win.loadURL(`http://localhost:${serverPort}`);
    } catch {}
  }
});
