// Desktop shell for Lumen (Electron).
const { app, BrowserWindow, session, shell } = require("electron");
const path = require("node:path");

let win;

function createWindow() {
	win = new BrowserWindow({
		width: 1440,
		height: 900,
		minWidth: 420,
		minHeight: 520,
		backgroundColor: "#05060b",
		autoHideMenuBar: true,
		title: "Lumen",
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			backgroundThrottling: false,
		},
	});
	win.loadFile(path.join(__dirname, "index.html"));
	// The app is fully local: open any external link in the browser instead.
	win.webContents.setWindowOpenHandler(({ url }) => {
		if (/^https?:/.test(url)) shell.openExternal(url);
		return { action: "deny" };
	});
	win.webContents.on("will-navigate", (e) => e.preventDefault());
	win.on("closed", () => (win = null));
}

if (!app.requestSingleInstanceLock()) {
	app.quit();
} else {
	app.on("second-instance", () => {
		if (!win) return;
		if (win.isMinimized()) win.restore();
		win.focus();
	});
	app.whenReady().then(() => {
		// Only the microphone (audio-reactive mode) and fullscreen are ever needed.
		session.defaultSession.setPermissionRequestHandler((wc, permission, cb) =>
			cb(permission === "media" || permission === "fullscreen")
		);
		createWindow();
		app.on("activate", () => {
			if (BrowserWindow.getAllWindows().length === 0) createWindow();
		});
	});
	app.on("window-all-closed", () => {
		if (process.platform !== "darwin") app.quit();
	});
}
