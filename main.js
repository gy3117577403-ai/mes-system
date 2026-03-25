const { app, BrowserWindow } = require("electron");

/** F5、Ctrl+R（Windows/Linux）、Cmd+R（macOS）重新載入遠端頁面 */
function registerReloadShortcuts(win) {
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    if (input.key === "F5") {
      event.preventDefault();
      win.webContents.reload();
      return;
    }
    const isR = input.key === "r" || input.key === "R";
    if (isR && (input.control || input.meta)) {
      event.preventDefault();
      win.webContents.reload();
    }
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadURL("https://uamdrbfsdoxn.sealoshzh.site");
  registerReloadShortcuts(win);
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
