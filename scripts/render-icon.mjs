// Xuất logo SVG thành icon app PNG 1024×1024 nền trong suốt, dùng Chromium của Electron (chạy được trên Win/Mac/Linux).
// Dùng: electron scripts/render-icon.mjs <logo.svg> <icon.png>
import { app, BrowserWindow } from "electron";
import { readFileSync, writeFileSync } from "node:fs";

const [svgPath, out] = process.argv.slice(-2);
const SIZE = 1024;
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: SIZE, height: SIZE, show: false, frame: false, transparent: true, webPreferences: { offscreen: true } });
  const svg = Buffer.from(readFileSync(svgPath)).toString("base64");
  const html = `<body style="margin:0;width:${SIZE}px;height:${SIZE}px;display:flex;align-items:center;justify-content:center;background:transparent"><img src="data:image/svg+xml;base64,${svg}" style="width:${SIZE * 0.92}px"></body>`;
  await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString("base64")}`);
  await new Promise((r) => setTimeout(r, 300));
  const image = await win.webContents.capturePage();
  writeFileSync(out, image.resize({ width: SIZE, height: SIZE, quality: "best" }).toPNG());
  console.log("icon", out);
  app.quit();
});
