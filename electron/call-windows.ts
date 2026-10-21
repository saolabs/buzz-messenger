import { app, BrowserWindow, dialog, shell, systemPreferences, type WebContents } from "electron";
import type { CallKind } from "../src/core/types.ts";
import { callMediaAllowed, facebookCallUrl } from "../src/core/call-policy.ts";
import { facebookUrl } from "../src/core/urls.ts";
import { blockedCallDevice } from "../src/core/media-access.ts";

type CallPage = { window: BrowserWindow; accountId: string; threadId: string; kind: CallKind };

export class CallWindows {
  private pages = new Map<WebContents, CallPage>();

  mediaAllowed(wc: WebContents | null, requestingUrl: string, mediaTypes: readonly string[]) {
    const page = wc && this.pages.get(wc);
    return Boolean(page && !wc!.isDestroyed() && !page.window.isDestroyed() && callMediaAllowed({
      kind: page.kind, threadId: page.threadId, topUrl: wc!.getURL(), requestingUrl,
      visible: page.window.isVisible() && !page.window.isMinimized(), mediaTypes,
    }));
  }

  async requestDevices(kind: CallKind) {
    const device = await blockedCallDevice(kind, process.platform, {
      status: (device) => systemPreferences.getMediaAccessStatus(device),
      ask: (device) => systemPreferences.askForMediaAccess(device),
    });
    if (!device) return;
    const vi = app.getLocale().startsWith("vi");
    const mac = process.platform === "darwin";
    const name = vi && device === "microphone" ? "micro" : device;
    const message = vi ? `Chưa được cấp quyền ${name}.` : `${device === "camera" ? "Camera" : "Microphone"} access is blocked.`;
    const detail = mac
      ? (vi ? `Vào Cài đặt hệ thống → Quyền riêng tư & Bảo mật → ${device === "camera" ? "Camera" : "Microphone"} và bật Buzz! Messenger (Electron khi chạy npm run dev). Thoát và mở lại app sau khi thay đổi quyền. Nếu thiết bị được tổ chức quản lý, hãy liên hệ quản trị viên.`
        : `Open System Settings → Privacy & Security → ${device === "camera" ? "Camera" : "Microphone"} and enable Buzz! Messenger (Electron when using npm run dev). Quit and reopen the app after changing access. On a managed device, contact your administrator.`)
      : (vi ? `Vào Settings → Privacy & security → ${device === "camera" ? "Camera" : "Microphone"}. Bật quyền truy cập thiết bị và “Let desktop apps access your ${device}”, rồi thử lại. Nếu quyền bị tổ chức quản lý, hãy liên hệ quản trị viên.`
        : `Open Settings → Privacy & security → ${device === "camera" ? "Camera" : "Microphone"}. Enable device access and “Let desktop apps access your ${device}”, then try again. If access is managed by your organization, contact your administrator.`);
    const { response } = await dialog.showMessageBox({
      type: "warning", title: "Buzz! Messenger", message, detail,
      buttons: vi ? ["Mở cài đặt", "Hủy"] : ["Open Settings", "Cancel"],
      defaultId: 0, cancelId: 1, noLink: true,
    });
    if (response === 0) {
      // Fixed OS destinations only; never accept a URL from the renderer/page.
      const url = mac
        ? `x-apple.systempreferences:com.apple.preference.security?Privacy_${device === "camera" ? "Camera" : "Microphone"}`
        : `ms-settings:privacy-${device === "camera" ? "webcam" : "microphone"}`;
      await shell.openExternal(url).catch(() => undefined);
    }
    // Opening Settings is not consent and must never resume/dial automatically.
    throw new Error(`${message} ${detail}`);
  }

  authorize(wc: WebContents, page: CallPage) {
    this.track(wc, page);
    const blankUntil = Date.now() + 15_000;
    const children = new Set<BrowserWindow>();
    wc.setWindowOpenHandler(({ url }) => {
      if (wc.isDestroyed() || page.window.isDestroyed() || !page.window.isVisible() ||
          (!facebookCallUrl(url) && !(url === "about:blank" && Date.now() < blankUntil))) return { action: "deny" };
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 1000, height: 740, autoHideMenuBar: true,
          webPreferences: { session: wc.session, sandbox: true, contextIsolation: true, nodeIntegration: false, preload: undefined },
        },
      };
    });
    wc.on("did-create-window", (win) => {
      children.add(win);
      this.track(win.webContents, { ...page, window: win });
      win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      const guard = (event: Electron.Event, url: string) => {
        try { facebookUrl(url); } catch { event.preventDefault(); }
      };
      win.webContents.on("will-navigate", guard);
      win.webContents.on("will-redirect", guard);
      win.on("closed", () => children.delete(win));
      win.show();
      win.focus();
    });
    page.window.once("closed", () => {
      this.pages.delete(wc);
      for (const win of children) if (!win.isDestroyed()) win.destroy();
    });
  }

  private track(wc: WebContents, page: CallPage) {
    this.pages.set(wc, page);
    wc.once("destroyed", () => this.pages.delete(wc));
  }

  close(accountId?: string) {
    for (const [wc, page] of [...this.pages]) {
      if (accountId && page.accountId !== accountId) continue;
      this.pages.delete(wc);
      if (!page.window.isDestroyed()) page.window.close();
    }
  }
}
