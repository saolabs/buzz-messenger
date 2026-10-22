import { BrowserWindow, nativeImage } from "electron";

let aboutWindow: BrowserWindow | null = null;
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

export function showAboutWindow(parent: BrowserWindow, version: string, lang: string, iconPath: string) {
  if (aboutWindow && !aboutWindow.isDestroyed()) { aboutWindow.show(); aboutWindow.focus(); return; }
  const vi = lang === "vi";
  const title = vi ? "Giới thiệu Buzz! Messenger" : "About Buzz! Messenger";
  const icon = nativeImage.createFromPath(iconPath);
  const win = new BrowserWindow({
    parent,
    title,
    width: 380,
    height: 450,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    backgroundColor: "#fafaf8",
    show: false,
    icon,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  aboutWindow = win;
  win.once("closed", () => { if (aboutWindow === win) aboutWindow = null; });
  win.once("ready-to-show", () => win.show());
  // Render the bundled image directly: macOS's native About panel takes its
  // icon from Electron.app in development and does not support iconPath.
  const html = `<!doctype html><html lang="${vi ? "vi" : "en"}"><head>
    <meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-buzz-about'">
    <title>${title}</title><style>
      *{box-sizing:border-box}html,body{margin:0;height:100%}body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;background:#fafaf8;color:#292929;font:14px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;text-align:center}
      img{width:88px;height:88px;object-fit:contain}h1{font-size:23px;margin:4px 0 0}p{margin:0;line-height:1.5}.version{color:#666;font-size:13px}.description{max-width:290px}button{margin-top:6px;min-width:90px;padding:6px 18px;border:1px solid #bbb;border-radius:6px;background:white;color:inherit;font:inherit;cursor:pointer}button:focus-visible{outline:2px solid #8362d3;outline-offset:3px}
    </style></head><body>
      <img src="${icon.resize({ width: 176, height: 176 }).toDataURL()}" alt="Buzz! Messenger">
      <h1>Buzz! Messenger</h1><p class="version">${vi ? "Phiên bản" : "Version"} ${escapeHtml(version)}</p>
      <p>SaoLabs</p><p class="description">${vi ? "Giao diện chat cổ điển cho Facebook Messenger." : "Classic messenger look for Facebook Messenger."}</p>
      <button autofocus>${vi ? "Đóng" : "Close"}</button>
      <script nonce="buzz-about">document.querySelector('button').addEventListener('click',()=>window.close());window.addEventListener('keydown',e=>{if(e.key==='Escape')window.close()});</script>
    </body></html>`;
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch(() => { if (!win.isDestroyed()) win.close(); });
}
