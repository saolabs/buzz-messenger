import { app, BrowserWindow, ipcMain, Menu, nativeImage, protocol, safeStorage, screen, shell } from "electron";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { TEXT_SIZES, ZOOMS, type ContactView, type ConversationView, type SessionView, type SignIn } from "../src/core/types.ts";
import { MessengerService } from "./messenger-service.ts";
import { Vault } from "./vault.ts";
import { runStartupSmoke } from "./startup-smoke.ts";
import { Uploads } from "./uploads.ts";
import { AUDIBLES } from "../src/core/uploads.ts";

// Smoke runs use an isolated profile and never start the Messenger service.
const smokeTest = process.argv.includes("--smoke-test");
if (smokeTest) {
  const profile = process.env.BUZZ_SMOKE_USER_DATA;
  if (!profile || !isAbsolute(profile)) throw new Error("Smoke test requires an absolute BUZZ_SMOKE_USER_DATA path.");
  app.setPath("userData", profile);
}

// Tài nguyên runtime nằm trong resources/ym; electron-builder copy cùng bộ này ra ngoài app.asar.
const ROOT = app.isPackaged ? join(process.resourcesPath, "ym") : join(app.getAppPath(), "resources/ym");
const SKINS = join(ROOT, "skins");
// Skin khác chỉ ghi đè một phần lên bộ ảnh nền Default. Riêng "Default" của Y!M 10 thực tế là giao diện tím
// (preview trùng Purple, thư mục Default thiếu khung cửa sổ; nút trong Default là trắng-xanh khác ảnh chụp gốc)
// → Default đọc Purple trước rồi mới tới ảnh nền.
const chainOf = (skin: string) => (skin === "Default" ? ["Purple", "Default"] : [skin, "Default", "Purple"]);
const SETTINGS = join(app.getPath("userData"), "settings.json");

type Settings = { skin: string; lang: string; zoom: number; textSize: number; tabbed: boolean };
// zoom: Y!M gốc thiết kế cho màn hình 96dpi (chữ 11px) — nhỏ so với app hiện nay, nên mặc định phóng 125%.
// Hệ số này nhân thêm vào scale của hệ điều hành (Electron đã tự xử lý 125–200% của Win/Mac).
const DEFAULTS: Settings = { skin: "Purple", lang: "en", zoom: 1.25, textSize: 0.92, tabbed: false };
const settings: Settings = (() => {
  try {
    return { ...DEFAULTS, ...JSON.parse(readFileSync(SETTINGS, "utf8")) };
  } catch {
    return { ...DEFAULTS };
  }
})();

protocol.registerSchemesAsPrivileged([
  { scheme: "ymres", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

// ymres://skin/<Skin>/<file>?n=<số trạng thái>&i=<trạng thái>&y=&h=  → PNG đã cắt đúng trạng thái
// ymres://media/<file>                                                → file gốc (gif động, wav, xml)
const MIME: Record<string, string> = { png: "image/png", gif: "image/gif", bmp: "image/bmp", wav: "audio/wav", xml: "text/xml", svg: "image/svg+xml" };
const cropCache = new Map<string, Buffer>();
function serve(request: Request): Response {
  const url = new URL(request.url);
  const parts = decodeURIComponent(url.pathname).split("/").filter(Boolean);
  let file: string | undefined;
  if (url.host === "media") file = join(ROOT, "Media", ...parts);
  if (url.host === "skin") {
    const [skin, ...rest] = parts;
    file = chainOf(skin).map((s) => join(SKINS, s, ...rest)).find(existsSync);
  }
  if (!file || !file.startsWith(ROOT) || !existsSync(file)) return new Response("not found", { status: 404 });
  const n = Number(url.searchParams.get("n") ?? 1);
  if (n === 1 && !url.searchParams.has("h")) {
    // Renderer (http://localhost khi dev) fetch emoticons.xml → cần header CORS.
    const ext = file.slice(file.lastIndexOf(".") + 1).toLowerCase();
    return new Response(new Uint8Array(readFileSync(file)), {
      headers: { "content-type": MIME[ext] ?? "application/octet-stream", "access-control-allow-origin": "*" },
    });
  }

  const key = file + url.search;
  let png = cropCache.get(key);
  if (!png) {
    const img = nativeImage.createFromPath(file);
    const { width, height } = img.getSize();
    const stateH = Math.floor(height / n);
    const y = stateH * Number(url.searchParams.get("i") ?? 0) + Number(url.searchParams.get("y") ?? 0);
    png = img.crop({ x: 0, y, width, height: Number(url.searchParams.get("h") ?? stateH) }).toPNG();
    cropCache.set(key, png);
  }
  return new Response(new Uint8Array(png), { headers: { "content-type": "image/png" } });
}

function load(win: BrowserWindow, view: string) {
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) win.loadURL(`${process.env.ELECTRON_RENDERER_URL}#${view}`);
  else win.loadFile(join(__dirname, "../renderer/index.html"), { hash: view });
}

// Kích thước gốc của Y!M (px ở zoom 100%): rộng, cao, rộng tối thiểu, cao tối thiểu.
const BASE_SIZE = { buddy: [300, 640, 230, 400], im: [540, 500, 380, 330] } as const;
type View = keyof typeof BASE_SIZE;
const views = new Map<BrowserWindow, View>();

function scaledSize(view: View, zoom: number) {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const [w, h, mw, mh] = BASE_SIZE[view].map((v) => Math.round(v * zoom));
  return { width: Math.min(w, sw), height: Math.min(h, sh), minWidth: Math.min(mw, sw), minHeight: Math.min(mh, sh) };
}

// Icon "B!" (scripts/brand_logo.py + render-icon.mjs); bản đóng gói electron-builder tự gắn icon riêng từng hệ điều hành.
const ICON = join(ROOT, "icon.png");

function createWindow(view: View, inactive = false) {
  const size = scaledSize(view, settings.zoom);
  const area = screen.getPrimaryDisplay().workArea;
  const win = new BrowserWindow({
    ...size,
    ...(view === "buddy" ? { x: area.x + area.width - size.width, y: area.y + Math.round((area.height - size.height) / 2) } : {}),
    ...(existsSync(ICON) ? { icon: ICON } : {}),
    frame: false,
    backgroundColor: "#f9f9f2",
    show: false,
    webPreferences: { preload: join(__dirname, "../preload/preload.js"), sandbox: true, zoomFactor: settings.zoom },
  });
  views.set(win, view);
  win.on("closed", () => views.delete(win));
  win.once("ready-to-show", () => (inactive ? win.showInactive() : win.show()));
  load(win, view);
  return win;
}

// Đổi zoom: phóng nội dung và co giãn cửa sổ theo cùng tỉ lệ, giữ nguyên kích thước người dùng đã kéo.
function applyZoom(from: number, to: number) {
  for (const [win, view] of views) {
    const { minWidth, minHeight } = scaledSize(view, to);
    const [w, h] = win.getSize();
    win.setMinimumSize(minWidth, minHeight);
    if (!win.isMaximized() && !win.isFullScreen()) {
      const { width: sw, height: sh } = screen.getDisplayMatching(win.getBounds()).workAreaSize;
      win.setSize(Math.min(Math.round((w * to) / from), sw), Math.min(Math.round((h * to) / from), sh));
    }
    win.webContents.setZoomFactor(to);
  }
}

let buddyWin: BrowserWindow | null = null;
// Cửa sổ chat: mặc định mỗi người một cửa sổ riêng (imWindows); bật "tabbed" thì gom vào tabWin.
// Người đã tách ra cửa sổ riêng thì luôn mở ở cửa sổ đó, kể cả khi đang ở chế độ tab.
const imWindows = new Map<string, BrowserWindow>();
let tabWin: BrowserWindow | null = null;
const imReady = new WeakMap<BrowserWindow, Promise<void>>();

function newImWindow(inactive = false) {
  const others = [...views].filter(([w, v]) => v === "im" && !w.isDestroyed()).map(([w]) => w);
  const win = createWindow("im", inactive);
  // Cửa sổ đóng → thôi đọc định kỳ những người trong cửa sổ đó.
  const wcId = win.webContents.id;
  win.on("closed", () => service?.watch([], wcId));
  // Xếp so le so với cửa sổ chat mở gần nhất để không chồng khít.
  const last = others.at(-1);
  if (last) {
    const [x, y] = last.getPosition();
    win.setPosition(x + 24, y + 24);
  }
  // Chờ renderer báo đã đăng ký lắng nghe (nó còn phải đọc settings trước khi vẽ), không phải did-finish-load.
  imReady.set(
    win,
    new Promise((resolve) => {
      const ready = (e: Electron.IpcMainEvent) => {
        if (e.sender !== win.webContents) return;
        ipcMain.off("im:ready", ready);
        resolve();
      };
      ipcMain.on("im:ready", ready);
    }),
  );
  return win;
}

// focus=false: tin đến từ người chưa mở cửa sổ → bật cửa sổ nhưng không cướp focus, nháy thanh tác vụ (như Y!M).
function openIm(contactId: string, separate = !settings.tabbed, focus = true) {
  let win = imWindows.get(contactId);
  if (!win || win.isDestroyed()) {
    if (separate) {
      const w = newImWindow(!focus);
      imWindows.set(contactId, w);
      w.on("closed", () => imWindows.get(contactId) === w && imWindows.delete(contactId));
      win = w;
    } else {
      if (!tabWin || tabWin.isDestroyed()) {
        const w = newImWindow(!focus);
        w.on("closed", () => tabWin === w && (tabWin = null));
        tabWin = w;
      }
      win = tabWin;
    }
  }
  const target = win;
  imReady.get(target)!.then(() => {
    target.webContents.send("im:open", contactId, focus);
    if (!focus) {
      if (!target.isFocused()) target.flashFrame(true);
      return;
    }
    if (target.isMinimized()) target.restore();
    target.focus();
  });
}

// BUZZ!: rung cửa sổ như Y!M gốc (~0.5s), giữ nguyên vị trí cuối.
function shake(win: BrowserWindow) {
  if (win.isMaximized() || win.isFullScreen()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  const [x, y] = win.getPosition();
  const offsets = [[-8, 0], [8, -4], [-6, 4], [6, -2], [-4, 2], [4, 0], [-2, 0], [0, 0]];
  offsets.forEach(([dx, dy], i) => setTimeout(() => !win.isDestroyed() && win.setPosition(x + dx, y + dy), i * 55));
}

ipcMain.handle("settings:get", () => ({
  ...settings,
  skins: existsSync(SKINS) ? readdirSync(SKINS).filter((s) => !s.startsWith(".")) : [],
}));
ipcMain.on("settings:set", (_e, patch: Partial<Settings>) => {
  if (typeof patch.skin === "string") settings.skin = patch.skin;
  if (typeof patch.lang === "string") settings.lang = patch.lang;
  if (typeof patch.tabbed === "boolean") settings.tabbed = patch.tabbed;
  if (typeof patch.textSize === "number" && TEXT_SIZES.includes(patch.textSize)) settings.textSize = patch.textSize;
  if (typeof patch.zoom === "number" && ZOOMS.includes(patch.zoom) && patch.zoom !== settings.zoom) {
    applyZoom(settings.zoom, patch.zoom);
    settings.zoom = patch.zoom;
  }
  writeFileSync(SETTINGS, JSON.stringify(settings));
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send("settings:changed", settings);
});
ipcMain.on("win:minimize", (e) => BrowserWindow.fromWebContents(e.sender)?.minimize());
ipcMain.on("win:maximize", (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (w) w.isMaximized() ? w.unmaximize() : w.maximize();
});
ipcMain.on("win:close", (e) => BrowserWindow.fromWebContents(e.sender)?.close());
ipcMain.on("win:buzz", (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (w) shake(w);
});
ipcMain.on("im:open", (_e, contactId: string) => openIm(contactId));
ipcMain.on("im:detach", (_e, contactId: string) => openIm(contactId, true));

// ---- Messenger thật ----
let service: MessengerService | null = null;
let vaultError: string | undefined;
const broadcast = (channel: string, ...args: unknown[]) => {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, ...args);
};
const signedOut: SessionView = { phase: "signedOut", username: "", remember: false, autoSignIn: false, hasPin: false, autoPin: false };
ipcMain.handle("ym:session", () => service?.sessionView() ?? { ...signedOut, error: vaultError ? "vault" : undefined });
ipcMain.on("ym:signIn", (_e, input: SignIn) => {
  if (typeof input?.username === "string" && typeof input.password === "string") { uploads.clear(); void service?.signIn(input); }
});
ipcMain.on("ym:signOut", () => { uploads.clear(); void service?.signOut(); });
ipcMain.on("ym:cancelSignIn", () => { uploads.clear(); void service?.cancelSignIn(); });
ipcMain.on("ym:setDisplayName", (_e, name: string) => typeof name === "string" && void service?.setDisplayName(name));
ipcMain.on("ym:showMessenger", () => service?.showMessenger());
ipcMain.on("ym:openInMessenger", (_e, id: string) => typeof id === "string" && service?.openInMessenger(id));
ipcMain.handle("ym:startCall", (e, id: string, kind: unknown) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win || !views.has(win) || e.senderFrame !== e.sender.mainFrame || typeof id !== "string" || (kind !== "voice" && kind !== "video"))
    return { ok: false, error: "invalid" };
  return service?.startCall(id, kind) ?? { ok: false, error: "Messenger chưa sẵn sàng." };
});
ipcMain.handle("ym:contacts", () => service?.contacts() ?? []);
ipcMain.handle("ym:groupMembers", (e, id: unknown, cursor: unknown) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win || views.get(win) !== "im" || e.senderFrame !== e.sender.mainFrame || typeof id !== "string" || (cursor !== undefined && (typeof cursor !== "string" || !/^\d+$/.test(cursor))))
    return { ok: false, error: "Yêu cầu thành viên nhóm không hợp lệ." };
  return service?.groupMembers(id, cursor as string | undefined) ?? { ok: false, error: "Messenger chưa sẵn sàng." };
});
ipcMain.handle("ym:openGroupMember", async (e, id: unknown, memberId: unknown) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win || views.get(win) !== "im" || e.senderFrame !== e.sender.mainFrame || typeof id !== "string" || typeof memberId !== "string" || !/^\d{1,30}$/.test(memberId) || !service)
    return { ok: false, error: "Thành viên nhóm không hợp lệ." };
  const result = await service.openGroupMember(id, memberId);
  if (!result.id) return { ok: false, error: result.error };
  if (win.isDestroyed()) return { ok: false, error: "Cửa sổ nhóm đã đóng." };
  openIm(result.id);
  return { ok: true };
});
const buddySender = (e: Electron.IpcMainInvokeEvent) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  return !!win && views.get(win) === "buddy" && e.senderFrame === e.sender.mainFrame;
};
ipcMain.handle("ym:searchContacts", (e, query: unknown) => {
  if (!buddySender(e) || typeof query !== "string" || query.length > 100) return { ok: false, contacts: [], error: "Tên tìm kiếm không hợp lệ (tối đa 100 ký tự)." };
  return service?.searchContacts(query) ?? { ok: false, contacts: [], error: "Messenger chưa sẵn sàng." };
});
ipcMain.handle("ym:openSearchContact", async (e, id: unknown) => {
  if (!buddySender(e) || typeof id !== "string" || !service) return { ok: false, error: "Liên hệ không hợp lệ." };
  const result = await service.openSearchContact(id);
  if (!result.id) return { ok: false, error: result.error };
  openIm(result.id);
  return { ok: true };
});
ipcMain.handle("ym:loadMore", () => service?.loadMore() ?? { ok: false, added: 0, error: "Messenger chưa sẵn sàng." });
ipcMain.handle("ym:loadHistory", (e, id: unknown) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win || !views.has(win) || e.senderFrame !== e.sender.mainFrame || typeof id !== "string")
    return { ok: false, added: 0, error: "invalid" };
  return service?.loadHistory(id) ?? { ok: false, added: 0, error: "Messenger chưa sẵn sàng." };
});
ipcMain.handle("ym:attachment", (_e, id: string, messageId: string, attachmentId: string) =>
  [id, messageId, attachmentId].every((x) => typeof x === "string") ? (service?.attachment(id, messageId, attachmentId) ?? { error: "not-ready" }) : { error: "invalid" },
);
// Bấm ảnh đại diện của mình → mở trang cá nhân Facebook trong trình duyệt mặc định.
ipcMain.on("ym:openProfile", () => void shell.openExternal("https://www.facebook.com/me"));
ipcMain.handle("ym:setPin", (_e, pin: string | null, auto: boolean) =>
  pin === null || pin === "" || (typeof pin === "string" && /^\d{6}$/.test(pin)) ? (service?.setPin(pin, auto === true) ?? { ok: false }) : { ok: false },
);
ipcMain.handle("ym:conversation", (_e, id: string) => service?.conversation(id) ?? null);
ipcMain.on("ym:seen", (_e, id: string) => typeof id === "string" && service?.seen(id));
ipcMain.on("ym:watch", (e, ids: string[]) => Array.isArray(ids) && service?.watch(ids.filter((x) => typeof x === "string"), e.sender.id));
ipcMain.handle("ym:send", (_e, id: string, text: string) =>
  typeof text === "string" && text.trim() && text.length <= 5000 ? service?.send(id, text) : { ok: false, error: "invalid" },
);

const uploads = new Uploads();
const composerSender = (e: Electron.IpcMainInvokeEvent) => {
  const wc = e.sender;
  const win = BrowserWindow.fromWebContents(wc);
  return !!win && views.get(win) === "im" && e.senderFrame === wc.mainFrame && new URL(wc.getURL()).hash === "#im";
};
ipcMain.handle("ym:stageFiles", async (e, id: string, paths: string[]) => {
  if (!composerSender(e) || typeof id !== "string" || !service?.conversation(id)) return { error: "Hội thoại không hợp lệ." };
  try { return { files: await uploads.stage(e.sender.id, id, paths) }; }
  catch (error) { return { error: error instanceof Error ? error.message : "Không đọc được tệp." }; }
});
ipcMain.handle("ym:stageAudible", async (e, id: string, audibleId: string) => {
  const audible = AUDIBLES.find(a => a.id === audibleId);
  if (!composerSender(e) || !audible || typeof id !== "string" || !service?.conversation(id)) return { error: "Âm thanh không hợp lệ." };
  return { files: await uploads.stage(e.sender.id, id, [join(ROOT, "Media", audible.file)]) };
});
ipcMain.on("ym:discardFiles", (e, ids: string[]) => {
  if (Array.isArray(ids) && ids.every(id => typeof id === "string")) uploads.discard(e.sender.id, ids);
});
ipcMain.handle("ym:sendFiles", async (e, id: string, ids: string[], text: string) => {
  if (!composerSender(e) || typeof id !== "string" || typeof text !== "string" || text.length > 5000 || !service)
    return { ok: false, error: "Yêu cầu gửi tệp không hợp lệ." };
  let claimed = false;
  try {
    const files = await uploads.claim(e.sender.id, id, ids);
    claimed = true;
    const result = await service.sendFiles(id, files, text.trim());
    uploads.finish(ids, !!result.attempted);
    return result;
  } catch (error) {
    if (claimed) uploads.finish(ids, false);
    return { ok: false, error: error instanceof Error ? error.message : "Không gửi được tệp." };
  }
});
app.on("web-contents-created", (_e, wc) => wc.once("destroyed", () => uploads.discard(wc.id)));
app.on("before-quit", () => uploads.clear());

async function startService(host: BrowserWindow) {
  const vault = new Vault(join(app.getPath("userData"), "secure"), safeStorage);
  try {
    await vault.open();
  } catch (error) {
    // Không có kho khóa của hệ điều hành (vd Linux thiếu keyring) → không lưu mật khẩu dạng chữ thường.
    vaultError = error instanceof Error ? error.message : String(error);
    broadcast("ym:session", { ...signedOut, error: "vault" });
    return;
  }
  service = new MessengerService(vault, host, {
    session: (s: SessionView) => broadcast("ym:session", s),
    contacts: (c: ContactView[]) => broadcast("ym:contacts", c),
    conversation: (id: string, view: ConversationView) => broadcast("ym:conversation", id, view),
    incoming: (id: string) => openIm(id, undefined, false),
  });
  broadcast("ym:session", service.sessionView());
  service.start();
}

app.whenReady().then(() => {
  protocol.handle("ymres", serve);
  // Menu mặc định của Electron có Zoom riêng (⌘+) không lưu vào settings → thay bằng menu tối thiểu.
  // macOS vẫn cần Edit menu để ⌘C/⌘V hoạt động trong ô nhập; Win/Linux không cần menu.
  Menu.setApplicationMenu(
    process.platform === "darwin" ? Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }, { role: "windowMenu" }]) : null,
  );
  if (process.platform === "darwin" && !app.isPackaged && existsSync(ICON)) app.dock?.setIcon(ICON);
  buddyWin = createWindow("buddy");
  buddyWin.on("closed", () => app.quit());
  if (smokeTest) runStartupSmoke(buddyWin);
  else {
    const host = buddyWin;
    // Accessing safeStorage can wait on a macOS Keychain prompt. Let the first
    // renderer paint and connect before opening the vault, or its IPC startup
    // can time out while the main thread waits for the user's confirmation.
    host.once("ready-to-show", () => setImmediate(() => {
      if (!host.isDestroyed()) void startService(host);
    }));
  }
});
app.on("activate", () => {
  if (!buddyWin || buddyWin.isDestroyed() || buddyWin.webContents.isLoading()) return;
  if (buddyWin.isMinimized()) buddyWin.restore();
  buddyWin.show();
  buddyWin.focus();
});
let quitting = false;
app.on("before-quit", (e) => {
  if (quitting || !service) return;
  // Chờ xóa mật khẩu/ phiên (khi không chọn Remember) rồi mới thoát.
  e.preventDefault();
  quitting = true;
  void service.shutdown().finally(() => app.quit());
});
app.on("window-all-closed", () => app.quit());
