// Reel Studio desktop shell: runs the local server inside Electron and shows it in a window.
const { app, BrowserWindow, shell, Menu, dialog } = require("electron");
const path = require("path");

process.env.NO_OPEN = "1";                       // the window replaces the browser tab
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

let win;
async function start() {
  let url;
  try {
    url = await require(path.join(__dirname, "..", "server", "index.js")).ready;
  } catch (e) {
    dialog.showErrorBox("Reel Studio couldn't start", String(e && e.stack || e));
    app.quit(); return;
  }
  win = new BrowserWindow({
    width: 1360, height: 900, minWidth: 980, minHeight: 640, title: "Reel Studio", backgroundColor: "#F6F0E6",
    icon: path.join(__dirname, "icon.png"), autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  Menu.setApplicationMenu(null);
  // links to other sites (checkout, docs, renders opened "in new tab") go to the normal browser
  win.webContents.setWindowOpenHandler(({ url: u }) => {
    if (!u.startsWith(url)) { shell.openExternal(u); return { action: "deny" }; }
    return { action: "allow", overrideBrowserWindowOptions: { autoHideMenuBar: true, width: 1100, height: 900 } };
  });
  win.webContents.on("will-navigate", (e, u) => { if (!u.startsWith(url)) { e.preventDefault(); shell.openExternal(u); } });
  win.loadURL(url);
  if (process.env.REEL_STUDIO_SHOT) { // test hook: screenshot the window and quit
    win.webContents.once("did-finish-load", () => setTimeout(async () => {
      require("fs").writeFileSync(process.env.REEL_STUDIO_SHOT, (await win.webContents.capturePage()).toPNG()); app.quit();
    }, 2500));
  }
}

app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(start);
app.on("window-all-closed", () => app.quit());
