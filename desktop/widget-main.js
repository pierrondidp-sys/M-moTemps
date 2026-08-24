"use strict";

const { app, BrowserWindow, Tray, Menu, screen, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs");
const { startServer } = require("./server");

// Same fixed port as the full desktop app (desktop/main.js) - same origin,
// same localStorage, so objectifs/rendez-vous entered in one app show up in
// the other. startServer() tolerates the port already being taken by
// whichever of the two apps started first, so running both at once still
// works: only one of them actually owns the HTTP server.
const PORT = 51733;
const APP_ROOT = path.join(__dirname, "..");
const STATE_PATH = path.join(app.getPath("userData"), "widget-window-state.json");
const DEFAULT_BOUNDS = { width: 1200, height: 360 };

let widgetWindow = null;
let tray = null;
let alwaysOnTop = true;
let isQuitting = false;

function loadWindowState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  } catch {
    return null;
  }
}

function saveWindowState() {
  if (!widgetWindow) return;
  try {
    fs.writeFileSync(STATE_PATH, JSON.stringify(widgetWindow.getBounds()));
  } catch {
    // Best effort - a failed write just means the position isn't remembered next time.
  }
}

function boundsAreOnScreen(bounds) {
  return screen.getAllDisplays().some((display) => {
    const a = display.workArea;
    return bounds.x < a.x + a.width && bounds.x + bounds.width > a.x &&
           bounds.y < a.y + a.height && bounds.y + bounds.height > a.y;
  });
}

function resetPosition() {
  if (!widgetWindow) return;
  const [width, height] = widgetWindow.getContentSize();
  const { workArea } = screen.getPrimaryDisplay();
  const x = Math.round(workArea.x + (workArea.width - width) / 2);
  const y = Math.round(workArea.y + 40);
  widgetWindow.setPosition(x, y);
  saveWindowState();
}

// On a fresh install (no remembered size yet), DEFAULT_BOUNDS.height is only
// a guess - it rarely matches the widget's real rendered height exactly,
// which leaves either clipped content or a dead transparent strip below it
// (the window is see-through, so that strip shows the desktop underneath).
// Measure the actual content once after first load and snap the window's
// height to it; width is left alone since the widget deliberately fills
// whatever width it's given (see widget.css's width:100% comment).
async function fitHeightToContent() {
  if (!widgetWindow) return;
  try {
    const height = await widgetWindow.webContents.executeJavaScript(
      `Math.ceil(document.querySelector(".mt-widget").getBoundingClientRect().height)`
    );
    if (Number.isFinite(height) && height > 0) {
      const [width] = widgetWindow.getContentSize();
      widgetWindow.setContentSize(width, Math.min(Math.max(height, 200), 900));
    }
  } catch {
    // Best effort - worst case the window keeps its guessed default height.
  }
  resetPosition();
}

async function createWindow() {
  await startServer(APP_ROOT, PORT);

  const saved = loadWindowState();
  const bounds = saved && boundsAreOnScreen(saved) ? saved : null;

  widgetWindow = new BrowserWindow({
    ...DEFAULT_BOUNDS,
    ...(bounds || {}),
    minWidth: 640,
    minHeight: 200,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop,
    show: false,
    icon: path.join(APP_ROOT, "icons", "icon-512.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  widgetWindow.loadURL(`http://127.0.0.1:${PORT}/index.html?mode=widget`);

  if (bounds) {
    widgetWindow.once("ready-to-show", () => widgetWindow.show());
  } else {
    // First launch: size to the widget's real content instead of the guess.
    widgetWindow.webContents.once("did-finish-load", async () => {
      await fitHeightToContent();
      widgetWindow.show();
    });
  }

  widgetWindow.on("resize", saveWindowState);
  widgetWindow.on("move", saveWindowState);

  // Alt+F4 / OS close should hide to the tray, not destroy the window -
  // "Quitter" in the tray menu is the only real exit (see isQuitting below).
  widgetWindow.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    widgetWindow.hide();
    refreshTrayMenu();
  });

  widgetWindow.on("show", refreshTrayMenu);
  widgetWindow.on("hide", refreshTrayMenu);
}

function toggleVisibility() {
  if (!widgetWindow) return;
  if (widgetWindow.isVisible()) widgetWindow.hide();
  else { widgetWindow.show(); widgetWindow.focus(); }
}

function refreshTrayMenu() {
  if (!tray) return;
  const visible = widgetWindow ? widgetWindow.isVisible() : false;
  const menu = Menu.buildFromTemplate([
    { label: visible ? "Masquer le widget" : "Afficher le widget", click: toggleVisibility },
    {
      label: "Toujours au premier plan",
      type: "checkbox",
      checked: alwaysOnTop,
      click: (item) => {
        alwaysOnTop = item.checked;
        if (widgetWindow) widgetWindow.setAlwaysOnTop(alwaysOnTop);
      }
    },
    { label: "Réinitialiser la position", click: resetPosition },
    { type: "separator" },
    { label: "Quitter", click: () => app.quit() }
  ]);
  tray.setContextMenu(menu);
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(APP_ROOT, "icons", "icon-16.png")));
  tray.setToolTip("Mémo Temps — Widget");
  tray.on("click", toggleVisibility);
  refreshTrayMenu();
}

app.whenReady().then(async () => {
  await createWindow();
  createTray();
});

app.on("before-quit", () => { isQuitting = true; });

// Never quit on window-all-closed: the window only ever hides (see the
// "close" handler above), so the app stays alive in the tray until the user
// picks "Quitter".
app.on("window-all-closed", () => {});
