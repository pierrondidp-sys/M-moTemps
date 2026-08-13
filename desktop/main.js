"use strict";

const { app, BrowserWindow } = require("electron");
const path = require("path");
const { startServer } = require("./server");

// Fixed port so it can be registered as an allowed OAuth loopback redirect
// (e.g. in the Google Cloud OAuth client) if the user wants Drive sync to
// work from the desktop app too.
const PORT = 51733;
const APP_ROOT = path.join(__dirname, "..");

let mainWindow = null;

async function createWindow() {
  await startServer(APP_ROOT, PORT);

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 480,
    minHeight: 600,
    backgroundColor: "#17140f",
    autoHideMenuBar: true,
    icon: path.join(APP_ROOT, "icons", "icon-512.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadURL(`http://127.0.0.1:${PORT}/index.html`);
  mainWindow.on("closed", () => { mainWindow = null; });
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
