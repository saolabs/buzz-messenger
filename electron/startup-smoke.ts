import { app, type BrowserWindow } from "electron";

// Exercise the packaged renderer and preload, not just the main process.
// main.ts isolates userData and skips Messenger before entering this mode.
export function runStartupSmoke(win: BrowserWindow) {
  let finished = false;
  const finish = (code: number, message: string) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    const stream = code === 0 ? process.stdout : process.stderr;
    stream.write(message + "\n", () => app.exit(code));
  };
  const timer = setTimeout(() => finish(1, "Startup smoke failed: window did not render within 30 seconds."), 30_000);
  win.webContents.once("did-fail-load", (_event, code, description) => finish(1, `Startup smoke load failed: ${code} ${description}`));
  win.webContents.once("render-process-gone", (_event, details) => finish(1, `Startup smoke renderer exited: ${details.reason}`));

  const visible = new Promise<void>((resolve) => {
    if (win.isVisible()) resolve();
    else win.once("show", () => resolve());
  });
  const loaded = new Promise<void>((resolve) => win.webContents.once("did-finish-load", () => resolve()));
  const rendered = loaded.then(() => win.webContents.executeJavaScript(`
    new Promise((resolve, reject) => {
      const check = async () => {
        if (!document.querySelector('#root')?.childElementCount) {
          setTimeout(check, 50);
          return;
        }
        try {
          const settings = await window.ym.getSettings();
          const asset = await fetch('ymres://media/Smileys/emoticons.xml');
          if (!settings.skins.length || !asset.ok || !(await asset.text()).includes('<')) {
            throw new Error('Packaged skin or media resources are unavailable.');
          }
          resolve({ rendered: true, ipc: true, assets: true });
        } catch (error) { reject(error); }
      };
      check();
    })
  `));
  void Promise.all([visible, rendered]).then(([, proof]) => {
    if (win.isDestroyed() || !win.isVisible() || win.webContents.isLoading()) {
      throw new Error("Main window is not visible and loaded.");
    }
    finish(0, "BUZZ_STARTUP_OK " + JSON.stringify({ visible: true, ...proof }));
  }).catch((error: unknown) => finish(1, `Startup smoke failed: ${String(error)}`));
}
