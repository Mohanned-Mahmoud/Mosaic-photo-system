import { app, BrowserWindow } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure we are in production mode to serve static files
process.env.NODE_ENV = 'production';

// Force portable mode by setting userData to a local folder near the executable
const portableDataPath = path.join(path.dirname(process.execPath), 'UserData');
if (!fs.existsSync(portableDataPath)) {
    fs.mkdirSync(portableDataPath, { recursive: true });
}
app.setPath('userData', portableDataPath);

// Set paths to user data to avoid writing inside ASAR archive
const userDataPath = app.getPath('userData');
const dbPath = path.join(userDataPath, 'sqlite.db');
const uploadsPath = path.join(userDataPath, 'uploads');

process.env.DATABASE_URL = `file:${dbPath.replace(/\\/g, '/')}`;
process.env.UPLOADS_DIR = uploadsPath;

// Ensure database exists (copy from template if needed)
const templateDbPath = path.join(__dirname, 'sqlite.db');
if (!fs.existsSync(dbPath) && fs.existsSync(templateDbPath)) {
  fs.copyFileSync(templateDbPath, dbPath);
}

import { fork } from 'child_process';

// Start the Express backend in a separate process to avoid blocking the Electron main thread
const backendPath = path.join(__dirname, 'dist', 'index.js');
const backendProcess = fork(backendPath, [], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  stdio: 'inherit'
});

backendProcess.on('error', (err) => {
    console.error("Failed to start backend:", err);
});

// Enforce single instance
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance, we should focus our window.
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false, // Don't show until ready
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    },
    autoHideMenuBar: true
  });

  // Poll for the local server to start listening
  const checkServer = () => {
    fetch('http://localhost:3000/api/health')
      .then(res => {
        if (res.ok) {
          win.webContents.session.clearCache().then(() => {
            win.loadURL('http://localhost:3000');
          });
          win.once('ready-to-show', () => {
            win.show();
          });
        } else {
          setTimeout(checkServer, 500);
        }
      })
      .catch(() => {
        setTimeout(checkServer, 500);
      });
  };

  checkServer();
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', () => {
  if (backendProcess) {
    backendProcess.kill();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
