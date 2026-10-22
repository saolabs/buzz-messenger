import {
  BrowserWindow,
  WebContentsView,
  session,
  Notification,
  type WebContents,
} from "electron";
import { randomUUID } from "node:crypto";
import { uploadState } from "./file-send.ts";
import { callGroupRead, callMemberRead } from "./groups.ts";
import { enrichGroupRead, type GroupSnapshot } from "../src/core/groups.ts";
import { searchMessengerContacts } from "./contact-search.ts";
import { contactSearchScript, type MessengerContactHit } from "../src/core/contact-search.ts";
import type {
  Account,
  CallKind,
  BrowserTab,
  Conversation,
  DOMProfile,
  Message,
  InboxScan,
  InboxThread,
} from "../src/core/types.ts";
import { facebookUrl, inboxUrl, threadIdentity } from "../src/core/urls.ts";
import { readScript, sendCheck } from "../src/core/dom.ts";
import { loginScript, type LoginProbe } from "../src/core/login.ts";
import {
  messengerPinScript,
  restoreBannerScript,
  waitForPinInput,
  type PinProbe,
} from "../src/core/messenger-pin.ts";
import {
  messengerScript,
  type MessengerRead,
  type NativeOptions,
} from "../src/core/messenger.ts";
import type { Vault } from "./vault.ts";
import { CallWindows } from "./call-windows.ts";
import { betaMode, callMessengerBeta, tryMessengerBetaSend } from "./messenger-beta.ts";
import { enrichBetaMessages, type BetaResult } from "../src/core/messenger-beta.ts";
import { findObservedMessage } from "../src/core/message-identity.ts";
import { disambiguate, waitForMessengerRead } from "../src/core/messenger-readiness.ts";
import { SendNotAttemptedError } from "../src/core/send-status.ts";
import { TaskPool } from "../src/core/task-pool.ts";
import { ownLinkScript } from "../src/core/profile.ts";
import {
  allowedMediaSource,
  boundedMedia,
  readMediaBlob,
  type MediaPayload,
} from "../src/core/media.ts";
const PIN_DIGIT_DELAY = 1000;
const LIVE_RELOAD_EVERY = 5 * 60_000;

type Entry = {
  meta: BrowserTab;
  view: WebContentsView;
  window?: BrowserWindow;
  worker?: boolean;
  blocking?: boolean;
};
export class Browsers {
  private knownGroups = new Set<string>();
  private groupReads = new Map<string, { accountId: string; platformId: string; window: string; expires: number; result: GroupSnapshot }>();
  threadInfo(c: Conversation) {
    const cached = this.groupReads.get(c.id);
    return cached?.accountId === c.accountId && cached.platformId === c.platformId && cached.result.status === "ready" ? cached.result : undefined;
  }
  private async groupRead(wc: WebContents, c: Conversation, read: MessengerRead, cursor?: string, force = false): Promise<GroupSnapshot> {
    if (this.betaMode === "off") return { status: "unavailable" };
    if (read.blocked || read.threadId !== c.platformId || threadIdentity(wc.getURL()) !== c.platformId) return { status: "unavailable" };
    const cached = this.groupReads.get(c.id);
    const timestamps = read.messages.flatMap(m => m.timestamp === null ? [] : [m.timestamp]);
    const window = JSON.stringify([timestamps.length ? Math.min(...timestamps) : null, timestamps.length ? Math.max(...timestamps) : null, read.messages.length]);
    if (!force && cached && cached.accountId === c.accountId && cached.platformId === c.platformId && cached.window === window && cached.expires > Date.now()) return cached.result;
    const userId = this.account(c.accountId).facebookUserId;
    if (!userId) return { status: "unavailable" };
    const result = await callGroupRead(wc, { userId, threadId: c.platformId, cursor, limit: cursor ? 0 : Math.min(500, read.messages.length + 150),
      ...(timestamps.length ? { oldest: Math.min(...timestamps), newest: Math.max(...timestamps) } : {}) });
    if (wc.isDestroyed() || threadIdentity(wc.getURL()) !== c.platformId) return { status: "unavailable" };
    await this.assertSession(wc, this.account(c.accountId));
    if (result.status === "ready") {
      if (result.kind === "group") this.knownGroups.add(`${c.accountId}:${c.platformId}`);
      else this.knownGroups.delete(`${c.accountId}:${c.platformId}`);
    }
    if (!cursor) this.groupReads.set(c.id, { accountId: c.accountId, platformId: c.platformId, window: result.status === "unavailable" && cached?.result.status === "ready" ? cached.window : window, expires: Date.now() + (result.status === "ready" ? 2000 : 1000), result: result.status === "unavailable" && cached?.result.status === "ready" ? cached.result : result });
    return result;
  }
  private betaMode = betaMode();
  private betaReads = new WeakMap<WebContents, { url: string; expires: number; result: Extract<BetaResult, { status: "read" }> | null }>();
  private betaStatuses = new WeakMap<WebContents, string>();

  private betaStatus(wc: WebContents, status: string) {
    if (this.betaStatuses.get(wc) === status) return;
    this.betaStatuses.set(wc, status);
    // Fixed messages only: never log script source, message text, IDs or credentials.
    console.log(`[buzz beta] ${status}`);
  }

  private async enrichFromBeta(wc: WebContents, c: Conversation, read: MessengerRead, limit = 100): Promise<MessengerRead> {
    if (this.threadInfo(c)?.kind === "group") return read;
    if (this.betaMode === "off" || read.blocked || read.threadId !== c.platformId) return read;
    const userId = this.account(c.accountId).facebookUserId;
    if (!userId) return read;
    const url = wc.getURL();
    if (!/^https:\/\/(?:www\.)?facebook\.com\/messages\/(?:e2ee\/)?t\//.test(url)) return read;
    let cached = this.betaReads.get(wc);
    if (!cached || cached.url !== url || cached.expires <= Date.now()) {
      const result = await callMessengerBeta(wc, { action: "read", threadId: c.platformId, userId, limit });
      cached = { url, expires: Date.now() + (result.status === "read" ? 2_000 : 30_000), result: result.status === "read" ? result : null };
      this.betaReads.set(wc, cached);
    }
    if (!cached.result || wc.isDestroyed() || wc.getURL() !== url) {
      this.betaStatus(wc, "read:dom-fallback");
      return read;
    }
    const enriched = enrichBetaMessages(read.messages, cached.result.messages, cached.result.media, cached.result.total);
    this.betaStatus(wc, enriched.matched ? "read:mps+dom-media" : "read:dom-no-overlap");
    return { ...read, messages: enriched.messages, invalid: enriched.messages.filter(m => m.timestamp === null).length };
  }

  private callWindows = new CallWindows();
  private callTasks = new Map<string, Promise<void>>();
  private callEntries = new Map<string, { id: string; started: boolean }>();
  private entries = new Map<string, Entry>();
  private sessions = new Map<string, Promise<Electron.Session>>();
  private monitors = new Map<string, WebContentsView>();
  private inboxOffsets = new Map<string, number>();
  private workers = new Map<string, WebContentsView>();
  private workerPool = new TaskPool<WebContentsView>(3);
  private historyPool = new TaskPool<BrowserWindow>(2);
  private historyWindows = new Map<string, BrowserWindow>();
  private uploadWindows = new Map<BrowserWindow, string>();
  private searchWindows = new Map<BrowserWindow, string>();
  private stopped = false;
  private liveViews = new Map<string, WebContentsView>();
  private accountQueues = new Map<string, Promise<unknown>>();
  private pageRefreshes = new WeakMap<WebContents, number>();
  private pageAccounts = new WeakMap<WebContents, string>();
  private pageStatuses = new WeakMap<WebContents, string>();
  private rateLimitedAccounts = new Map<string, string>();
  private selected: string | null = null;
  private bounds: Electron.Rectangle | null = null;
  private loginAttempts = new Map<string, { wcId: number; at: number }>();
  private loginBusy = new Set<number>();
  private bannerClicks = new Map<number, number>();
  private loginTimers = new Map<number, ReturnType<typeof setInterval>>();
  private challenges = new Set<number>();
  private pinRestores = new Map<
    number,
    Promise<"absent" | "restored" | "blocked">
  >();
  constructor(
    private host: BrowserWindow,
    private vault: Vault,
    private changed: () => void,
    private pause: (reason?: string) => void,
  ) {
    for (const c of vault.read().conversations) if (c.kind === "group") this.knownGroups.add(`${c.accountId}:${c.platformId}`);
  }
  list() {
    return Array.from(this.entries.values()).map((e) => ({ ...e.meta }));
  }
  account(id: string) {
    const a = this.vault.read().accounts.find((a) => a.id === id);
    if (!a) throw new Error("Tài khoản không tồn tại.");
    return a;
  }
  private async accountSession(a: Account) {
    let existing = this.sessions.get(a.id);
    if (!existing) {
      existing = (async () => {
        const s = session.fromPartition(`ym-${a.id}`, {
          cache: false,
        });
        s.setPermissionRequestHandler((wc, permission, cb, details) => cb(
          permission === "media" && this.callWindows.mediaAllowed(wc, details.requestingUrl, (details as Electron.MediaAccessPermissionRequest).mediaTypes ?? []),
        ));
        s.setPermissionCheckHandler((wc, permission, origin, details) =>
          permission === "media" && this.callWindows.mediaAllowed(wc, details.requestingUrl ?? origin, [details.mediaType ?? "unknown"]),
        );
        s.on("will-download", (event) => event.preventDefault());
        // Only restore cookies protected by the application vault; Chromium never persists this partition.
        for (const raw of a.cookies) {
          const c = raw as Electron.Cookie;
          if (
            !c.domain ||
            !/(^|\.)facebook\.com$/.test(c.domain.replace(/^\./, ""))
          )
            continue;
          await s.cookies
            .set({
              url: `${c.secure ? "https" : "http"}://${c.domain.replace(/^\./, "")}${c.path || "/"}`,
              name: c.name,
              value: c.value,
              domain: c.hostOnly ? undefined : c.domain,
              path: c.path,
              secure: c.secure,
              httpOnly: c.httpOnly,
              sameSite: c.sameSite,
              expirationDate: c.expirationDate,
            })
            .catch(() => undefined);
        }
        s.cookies.on("changed", () => {
          void s.cookies
            .get({})
            .then((cookies) =>
              this.vault.mutate((state) => {
                const saved = state.accounts.find((x) => x.id === a.id);
                if (saved)
                  saved.cookies = cookies.filter((c) =>
                    /(^|\.)facebook\.com$/.test(
                      (c.domain || "").replace(/^\./, ""),
                    ),
                  );
              }),
            )
            .catch(() => this.changed());
        });
        return s;
      })();
      this.sessions.set(a.id, existing);
    }
    return existing;
  }
  private protect(wc: WebContents, a: Account, update?: () => void) {
    this.pageAccounts.set(wc, a.id);
    wc.setWindowOpenHandler(() => ({ action: "deny" }));
    const navigationGuard = (e: Electron.Event, url: string) => {
      try {
        facebookUrl(url);
      } catch {
        e.preventDefault();
      }
    };
    wc.on("will-navigate", navigationGuard);
    wc.on("will-redirect", navigationGuard);
    wc.on("did-navigate", () => {
      update?.();
      void this.login(wc, a);
    });
    wc.on("did-navigate-in-page", () => {
      update?.();
      void this.login(wc, a);
    });
    wc.on("did-finish-load", () => {
      update?.();
      void this.login(wc, a);
    });
    wc.on("dom-ready", () => void this.login(wc, a));
    const timer = setInterval(() => void this.login(wc, a), 1500);
    this.loginTimers.set(wc.id, timer);
    wc.once("destroyed", () => {
      clearInterval(timer);
      this.loginTimers.delete(wc.id);
      this.loginBusy.delete(wc.id);
    });
    wc.on("render-process-gone", () =>
      this.pause("Trang Messenger bị đóng hoặc lỗi."),
    );
    wc.on("before-input-event", (_event, input) => {
      if (input.type === "keyDown")
        this.pause("Bạn đang nhập trong trình duyệt Messenger.");
    });
  }
  private loginStatus(wc: WebContents, status: string) {
    this.pageStatuses.set(wc, status);
    const entry = [...this.entries.values()].find(
      (e) => e.view.webContents.id === wc.id,
    );
    if (entry?.worker && entry.blocking === false && status === "Đã đăng nhập")
      return;
    if (entry && entry.meta.status !== status) {
      entry.meta.status = status;
      this.changed();
    }
  }
  private restorePin(wc: WebContents, original: Account) {
    const existing = this.pinRestores.get(wc.id);
    if (existing) return existing;
    const task = this.serialized(`pin:${original.id}`, () =>
      this.restorePinOnce(wc, original),
    ).finally(() => this.pinRestores.delete(wc.id));
    this.pinRestores.set(wc.id, task);
    return task;
  }
  private pageExecution<T>(wc: WebContents, operation: () => Promise<T>) {
    return new Promise<T>((resolve, reject) => {
      if (wc.isDestroyed()) {
        reject(new Error("Trang Messenger đã đóng."));
        return;
      }
      const stop = () => finish(new Error("Trang Messenger không phản hồi."));
      const timer = setTimeout(stop, 5000);
      const finish = (error?: unknown, result?: T) => {
        clearTimeout(timer);
        wc.removeListener("destroyed", stop);
        if (error) reject(error);
        else resolve(result as T);
      };
      wc.once("destroyed", stop);
      try {
        operation().then((result) => finish(undefined, result), finish);
      } catch (error) {
        finish(error);
      }
    });
  }
  private pinScript(wc: WebContents, script: string) {
    return this.pageExecution(wc, () => wc.executeJavaScript(script));
  }
  private async pinRestored(wc: WebContents, a: Account): Promise<boolean> {
    if (wc.isDestroyed()) return false;
    const read = (await this.pageExecution(wc, () =>
      this.native(wc, "read"),
    )) as MessengerRead;
    const inboxReady =
      /^\/messages\/?$/.test(new URL(wc.getURL()).pathname) &&
      (await this.pinScript(
        wc,
        `Boolean(document.querySelector('[role="grid"] a[href*="/messages/"]'))`,
      ));
    return !read.blocked && Boolean(read.composerPresent || inboxReady);
  }
  private async confirmPinRestored(wc: WebContents, a: Account) {
    await this.assertSession(wc, a);
    await this.vault.mutate((state) => {
      const current = state.accounts.find((x) => x.id === a.id);
      if (
        current &&
        current.recoveryPin === a.recoveryPin &&
        current.pinRestorePending
      ) {
        current.pinAutoFillBlocked = false;
        current.pinRestorePending = false;
      }
    });
    this.loginStatus(wc, "Đã khôi phục lịch sử bằng PIN local");
    const verification = [...this.entries.values()].find(
      (entry) => entry.worker && entry.view.webContents === wc,
    );
    if (verification) this.close(verification.meta.id);
    this.changed();
  }
  private async restorePinOnce(
    wc: WebContents,
    original: Account,
  ): Promise<"absent" | "restored" | "blocked"> {
    // All failures are fixed messages: execution errors must never echo source code containing the secret.
    let reserved = false;
    try {
      this.assertNotRateLimited(original.id);
      facebookUrl(wc.getURL());
      // Buzz!: dải "Restore now" → bấm để hiện hộp nhập PIN (tối đa 1 lần/ 60s mỗi trang, chỉ khi đã bật tự nhập PIN).
      const saved = this.account(original.id);
      if (saved.recoveryPin && saved.autoRestorePin && !saved.pinAutoFillBlocked && Date.now() - (this.bannerClicks.get(wc.id) ?? 0) > 60_000) {
        if ((await this.pinScript(wc, restoreBannerScript())) === "clicked") {
          this.bannerClicks.set(wc.id, Date.now());
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
      const probe = (await this.pinScript(
        wc,
        messengerPinScript("probe"),
      )) as PinProbe;
      const a = this.account(original.id);
      if (probe === "absent") {
        // A slow accepted restore may finish after the first wait. Confirm it
        // on later readiness checks instead of permanently blocking a valid PIN.
        if (a.pinRestorePending && (await this.pinRestored(wc, a))) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          if (await this.pinRestored(wc, a))
            await this.confirmPinRestored(wc, a);
        }
        return "absent";
      }
      if (probe === "rejected" && a.pinRestorePending) {
        await this.vault.mutate((state) => {
          const current = state.accounts.find((x) => x.id === a.id);
          if (current && current.recoveryPin === a.recoveryPin)
            current.pinRestorePending = false;
        });
      }
      if (
        probe !== "ready" ||
        !a.recoveryPin ||
        !a.autoRestorePin ||
        a.pinAutoFillBlocked
      ) {
        this.loginStatus(
          wc,
          a.pinAutoFillBlocked
            ? "PIN chưa được xác nhận · kiểm tra Messenger hoặc lưu lại PIN"
            : "Cần PIN khôi phục · nhập thủ công hoặc cấu hình trong Tài khoản",
        );
        return "blocked";
      }
      // A matching Facebook identity is required before supplying the secret.
      await this.assertSession(wc, a);
      reserved = await this.vault.mutate((state) => {
        const current = state.accounts.find((x) => x.id === a.id);
        if (
          !current ||
          !current.autoRestorePin ||
          current.pinAutoFillBlocked ||
          current.recoveryPin !== a.recoveryPin
        )
          return false;
        // Persist BEFORE filling: a wrong PIN or an interrupted process cannot cause repeated automatic attempts.
        current.pinAutoFillBlocked = true;
        current.pinRestorePending = true;
        return true;
      });
      if (!reserved) return "blocked";
      this.changed();
      this.loginStatus(wc, "Đang khôi phục lịch sử bằng PIN đã lưu trên máy…");
      // Chromium input reaches Messenger's real editing handlers; setting the
      // DOM value and dispatching synthetic events can leave recovery unstarted.
      let result = (await this.pinScript(
        wc,
        messengerPinScript("focus", a.recoveryPin),
      )) as PinProbe;
      let inputAttempted = false;
      if (result === "single" || result === "split") {
        const split = result === "split";
        let completedInputs = 0;
        if (!wc.debugger.isAttached()) wc.debugger.attach("1.3");
        for (let index = 0; index < (split ? 6 : 1); index++) {
          if (index) {
            const focused = await this.pinScript(
              wc,
              messengerPinScript("focus", a.recoveryPin, index),
            );
            if (focused !== "split") throw new Error("PIN input changed.");
          }
          inputAttempted = true;
          // Buzz!: chờ 1s trước mỗi ô — nhập liền 6 ô bị Facebook chặn.
          await new Promise((r) => setTimeout(r, PIN_DIGIT_DELAY));
          await wc.debugger.sendCommand("Input.insertText", {
            text: split ? a.recoveryPin[index] : a.recoveryPin,
          });
          completedInputs = index + 1;
          result = await waitForPinInput(async () => {
            if (wc.isDestroyed() || this.stopped) return "unsupported";
            this.assertNotRateLimited(a.id);
            const current = this.account(a.id);
            if (
              !current.autoRestorePin ||
              current.recoveryPin !== a.recoveryPin
            )
              return "unsupported";
            return (await this.pinScript(
              wc,
              messengerPinScript("progress", a.recoveryPin, index + 1),
            )) as PinProbe;
          });
          // Auto-submit can remove the form only after the final input.
          if (result !== "accepted") break;
        }
        if (result === "accepted")
          result = (await this.pinScript(
            wc,
            messengerPinScript("confirm", a.recoveryPin),
          )) as PinProbe;
        if (result === "absent" && completedInputs === (split ? 6 : 1))
          result = "submitted";
      }
      if (result !== "submitted" && result !== "filled") {
        // A failed input is not a pending submission. Otherwise a different
        // already-open page can mistake its own ready inbox for this attempt's
        // success and release the persisted no-retry guard.
        if (inputAttempted || result === "rejected")
          await this.vault.mutate((state) => {
            const current = state.accounts.find((x) => x.id === a.id);
            if (current && current.recoveryPin === a.recoveryPin)
              current.pinRestorePending = false;
          });
        // A form that changed before any input was supplied is safe to re-probe.
        if (!inputAttempted && ["absent", "manual"].includes(result))
          await this.vault.mutate((state) => {
            const current = state.accounts.find((x) => x.id === a.id);
            if (current && current.recoveryPin === a.recoveryPin) {
              current.pinAutoFillBlocked = false;
              current.pinRestorePending = false;
            }
          });
        return "blocked";
      }
      let needsConfirmation = result === "filled";
      let readyChecks = 0;
      for (let n = 0; n < 120; n++) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        if (wc.isDestroyed()) return "blocked";
        const next = (await this.pinScript(
          wc,
          messengerPinScript("probe"),
        )) as PinProbe;
        if (next === "rejected") {
          await this.vault.mutate((state) => {
            const current = state.accounts.find((x) => x.id === a.id);
            if (current && current.recoveryPin === a.recoveryPin)
              current.pinRestorePending = false;
          });
          break;
        }
        if (needsConfirmation && next === "manual") {
          const confirmation = await this.pinScript(
            wc,
            messengerPinScript("confirm", a.recoveryPin),
          );
          if (confirmation === "submitted") needsConfirmation = false;
        }
        if (next !== "absent") {
          readyChecks = 0;
          continue;
        }
        if (!(await this.pinRestored(wc, a))) {
          readyChecks = 0;
          continue;
        }
        if (++readyChecks < 2) continue;
        await this.confirmPinRestored(wc, a);
        return "restored";
      }
    } catch {
      // Intentionally omit exception details and PIN values from notices, logs and snapshots.
      this.loginStatus(
        wc,
        "Không kiểm tra được biểu mẫu khôi phục PIN; tải lại Messenger để thử lại.",
      );
    } finally {
      if (reserved && this.account(original.id).pinAutoFillBlocked)
        this.loginStatus(
          wc,
          "Chưa khôi phục được · đã dừng tự thử PIN; kiểm tra Messenger",
        );
    }
    return "blocked";
  }
  private async login(wc: WebContents, original: Account) {
    if (wc.isDestroyed() || this.loginBusy.has(wc.id)) return;
    this.loginBusy.add(wc.id);
    try {
      const url = facebookUrl(wc.getURL());
      const a = this.account(original.id); // Credentials may have been edited after the tab was opened.
      if ((await this.restorePin(wc, a)) !== "absent") return;
      const probe = (await this.pinScript(
        wc,
        loginScript("probe"),
      )) as LoginProbe;
      if (probe === "verification") {
        this.pause("Facebook đang yêu cầu xác minh đăng nhập.");
        this.loginStatus(wc, "Cần xác minh · hoàn tất trên trình duyệt");
        if (!this.challenges.has(wc.id)) {
          this.challenges.add(wc.id);
          if (Notification.isSupported()) {
            const n = new Notification({
              title: "Buzz! Messenger cần xác minh",
              body: "Mở trình duyệt tài khoản để hoàn tất xác minh Facebook.",
            });
            n.on("click", () => this.host.show());
            n.show();
          }
        }
        return;
      }
      const authenticated =
        (
          await wc.session.cookies.get({
            name: "c_user",
            domain: ".facebook.com",
          })
        ).length > 0;
      if (authenticated && probe !== "ready" && probe !== "rejected") {
        this.loginAttempts.delete(a.id);
        this.challenges.delete(wc.id);
        this.loginStatus(wc, "Đã đăng nhập");
        // Another page in this account may have restored the shared encrypted
        // history while this verification window was waiting for its PIN form.
        const verification = [...this.entries.values()].find(
          (entry) =>
            entry.worker &&
            entry.blocking !== false &&
            entry.view.webContents === wc,
        );
        if (
          verification &&
          !wc.isLoading() &&
          (await this.pinRestored(wc, a))
        ) {
          await this.assertSession(wc, a);
          this.close(verification.meta.id);
          return;
        }
        if (
          (url.pathname === "/" || /login/.test(url.pathname)) &&
          !wc.isLoading()
        )
          await wc.loadURL(inboxUrl(a));
        return;
      }
      if (probe === "rejected") {
        this.loginStatus(
          wc,
          "Đăng nhập thất bại · kiểm tra tài khoản/mật khẩu",
        );
        this.pause();
        return;
      }
      if (probe !== "ready") return;
      if (!a.username || !a.password) {
        this.loginStatus(
          wc,
          "Chưa lưu thông tin đăng nhập · sửa tài khoản hoặc đăng nhập thủ công",
        );
        return;
      }
      const previous = this.loginAttempts.get(a.id);
      if (previous) {
        this.loginStatus(
          wc,
          Date.now() - previous.at > 30_000
            ? "Chưa đăng nhập được · kiểm tra trình duyệt hoặc thử lại"
            : "Đang đăng nhập tự động…",
        );
        return;
      }
      // Reserve per account before awaiting, so a visible tab and worker cannot submit concurrently.
      this.loginAttempts.set(a.id, { wcId: wc.id, at: Date.now() });
      const result = await this.pinScript(
        wc,
        loginScript("submit", a.username, a.password),
      );
      if (result !== "submitted") {
        this.loginAttempts.delete(a.id);
        this.loginStatus(wc, "Form chưa sẵn sàng hoặc đang được nhập thủ công");
        return;
      }
      this.loginStatus(wc, "Đang đăng nhập tự động…");
    } catch {
      // Navigation can invalidate the execution context. The readiness timer will recheck the new page.
    } finally {
      this.loginBusy.delete(wc.id);
    }
  }
  retryLogin(id: string) {
    const e = this.get(id);
    this.loginAttempts.delete(e.meta.accountId);
    this.challenges.delete(e.view.webContents.id);
    e.meta.status = "Đang kiểm tra đăng nhập…";
    e.view.webContents.reload();
    this.changed();
  }
  credentialsChanged(accountId: string) {
    this.loginAttempts.delete(accountId);
    for (const e of this.entries.values())
      if (e.meta.accountId === accountId) this.retryLogin(e.meta.id);
  }
  async open(
    accountId: string,
    url?: string,
    detached = false,
  ): Promise<string> {
    const a = this.account(accountId),
      target = facebookUrl(url || inboxUrl(a)).toString();
    const view = new WebContentsView({
      webPreferences: {
        session: await this.accountSession(a),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    const id = randomUUID();
    const entry: Entry = {
      meta: {
        id,
        accountId,
        title: a.name,
        url: target,
        detached,
        status: "Đang tải",
      },
      view,
    };
    this.entries.set(id, entry);
    const update = () => {
      entry.meta.url = view.webContents.getURL();
      if (
        entry.meta.status === "Đang tải" ||
        entry.meta.status === "Không tải được trang"
      )
        entry.meta.status = "Đang kiểm tra phiên đăng nhập…";
      this.changed();
    };
    this.protect(view.webContents, a, update);
    if (detached) this.detach(id);
    else this.select(id);
    try {
      await view.webContents.loadURL(target);
    } catch {
      entry.meta.status = "Không tải được trang";
    }
    this.changed();
    return id;
  }
  private get(id: string) {
    const e = this.entries.get(id);
    if (!e) throw new Error("Tab không tồn tại.");
    return e;
  }
  select(id: string) {
    const e = this.get(id);
    if (e.window) {
      e.window.show();
      return;
    }
    for (const other of this.entries.values())
      if (!other.window) other.view.setVisible(false);
    this.host.contentView.addChildView(e.view);
    this.selected = id;
    this.layout();
    this.changed();
  }
  setBounds(bounds: Electron.Rectangle | null) {
    this.bounds = bounds;
    this.layout();
  }
  private layout() {
    if (!this.selected) return;
    const e = this.entries.get(this.selected);
    if (!e || e.window) return;
    e.view.setVisible(Boolean(this.bounds));
    if (this.bounds) e.view.setBounds(this.bounds);
  }
  detach(id: string) {
    const e = this.get(id);
    if (e.window) {
      e.window.show();
      return;
    }
    this.host.contentView.removeChildView(e.view);
    if (this.selected === id) this.selected = null;
    const win = new BrowserWindow({
      width: 1100,
      height: 800,
      title: `${e.meta.title} — Buzz! Messenger`,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    e.window = win;
    e.meta.detached = true;
    win.contentView.addChildView(e.view);
    e.view.setVisible(true);
    const resize = () => {
      const { width, height } = win.getContentBounds();
      e.view.setBounds({ x: 0, y: 0, width, height });
    };
    resize();
    win.on("resize", resize);
    win.on("close", () => {
      if (e.worker && !e.view.webContents.isDestroyed())
        win.contentView.removeChildView(e.view);
    });
    win.on("closed", () => {
      if (!e.view.webContents.isDestroyed()) {
        if (e.worker) e.view.setVisible(false);
        else e.view.webContents.close();
      }
      this.entries.delete(id);
      for (const [key, view] of this.workers) {
        if (view === e.view && !this.workerPool.has(key)) {
          if (!view.webContents.isDestroyed()) view.webContents.close();
          this.workers.delete(key);
        }
      }
      this.changed();
    });
    this.changed();
  }
  close(id: string) {
    const e = this.get(id);
    if (e.window) e.window.close();
    else {
      this.host.contentView.removeChildView(e.view);
      e.view.webContents.close();
      this.entries.delete(id);
    }
    if (this.selected === id) this.selected = null;
    this.changed();
  }
  reload(id: string) {
    const entry = this.get(id);
    this.rateLimitedAccounts.delete(entry.meta.accountId);
    entry.view.webContents.reload();
  }
  async inspect(id: string, profile?: DOMProfile) {
    const e = this.get(id),
      a = this.account(e.meta.accountId);
    await this.assertSession(e.view.webContents, a);
    return {
      accountId: a.id,
      url: e.view.webContents.getURL(),
      ...(profile
        ? await e.view.webContents.executeJavaScript(readScript(profile))
        : await this.native(e.view.webContents, "read")),
    };
  }
  private async native(
    wc: WebContents,
    action: Parameters<typeof messengerScript>[0],
    options: NativeOptions = {},
    userGesture = false,
  ) {
    const accountId = this.pageAccounts.get(wc);
    if (accountId) this.assertNotRateLimited(accountId);
    const pageThread = (() => { try { return threadIdentity(wc.getURL()); } catch { return null; } })();
    if (this.knownGroups.has(`${accountId}:${pageThread}`)) {
      const c = this.vault.read().conversations.find(c => c.accountId === accountId && c.platformId === pageThread);
      const members = c && (this.threadInfo(c)?.group ?? c.group)?.members;
      options = { ...options, group: true, groupMembers: members?.map(({ id, name, nickname, isSelf }) => ({ id, name, nickname, isSelf })) };
    }
    // Electron otherwise replaces script exceptions with an opaque execution error.
    const result = await wc.executeJavaScript(
      `(() => {try {return {ok:true,data:${messengerScript(action, options)}};} catch(error) {return {ok:false,rateLimited: error?.rateLimited === true,error: error instanceof Error ? error.message : "Không đọc được Messenger."};}})()`,
      userGesture,
    );
    if (result.rateLimited || result.data?.rateLimited) {
      const reason = result.error ?? result.data.blockedReason;
      if (accountId) this.rateLimitedAccounts.set(accountId, reason);
      this.loginStatus(wc, reason);
      this.pause(reason);
      throw new Error(reason);
    }
    if (!result.ok) throw new Error(result.error);
    return result.data;
  }
  private assertNotRateLimited(accountId: string) {
    const reason = this.rateLimitedAccounts.get(accountId);
    if (reason) throw new Error(reason);
  }
  invalidateSync(accountId?: string) {
    if (!accountId) {
      this.pageRefreshes = new WeakMap();
      return;
    }
    for (const view of [
      ...this.monitors.values(),
      ...this.workers.values(),
      ...this.liveViews.values(),
    ])
      if (this.pageAccounts.get(view.webContents) === accountId)
        this.pageRefreshes.delete(view.webContents);
  }
  private async preparePage(wc: WebContents, url: string, samePage: boolean, maxAge = 60_000) {
    const accountId = this.pageAccounts.get(wc);
    if (accountId) this.assertNotRateLimited(accountId);
    const now = Date.now();
    const refreshedAt = this.pageRefreshes.get(wc);
    if (samePage && refreshedAt !== undefined && now - refreshedAt < maxAge)
      return;
    if (samePage) {
      const hasDraft = await wc.executeJavaScript(
        `Array.from(document.querySelectorAll('[contenteditable="true"][role="textbox"],textarea')).some(el => (el.value ?? el.textContent ?? '').trim())`,
      );
      if (hasDraft)
        throw new Error(
          "Messenger còn nội dung chưa gửi. Kiểm tra ô soạn trong trình duyệt trước khi đồng bộ lại.",
        );
    }
    await wc.loadURL(url);
    this.pageRefreshes.set(wc, now);
    await this.native(wc, "read");
  }
  private async assertSession(wc: WebContents, account: Account) {
    const cookies = await wc.session.cookies.get({
      name: "c_user",
      domain: ".facebook.com",
    });
    const userId = cookies[0]?.value;
    if (!userId)
      throw new Error("Tài khoản chưa đăng nhập Facebook trong ứng dụng.");
    const current = this.account(account.id);
    if (current.facebookUserId && current.facebookUserId !== userId)
      throw new Error(
        "Phiên Facebook không khớp tài khoản đã kết nối. Đã chặn đọc/gửi.",
      );
    if (!current.facebookUserId)
      await this.vault.mutate((s) => {
        const saved = s.accounts.find((a) => a.id === account.id)!;
        saved.facebookUserId = userId;
      });
  }
  private async withContactSearch<T>(accountId: string, cancelled: AbortSignal, operation: (wc: WebContents, signal: AbortSignal, check: () => Promise<void>) => Promise<T>, initialUrl?: string): Promise<T> {
    const signal = AbortSignal.any([cancelled, AbortSignal.timeout(35_000)]);
    signal.throwIfAborted();
    const a = this.account(accountId);
    const pageSession = await this.accountSession(a);
    signal.throwIfAborted();
    if (this.stopped) throw new Error("Ứng dụng đã dừng xử lý.");
    const win = new BrowserWindow({ show: false, width: 1100, height: 800, title: "Messenger · Tìm liên hệ — Buzz! Messenger",
      webPreferences: { session: pageSession, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    this.searchWindows.set(win, accountId);
    this.protect(win.webContents, a);
    const close = () => { this.searchWindows.delete(win); if (!win.isDestroyed()) win.destroy(); };
    signal.addEventListener("abort", close, { once: true });
    try {
      const wc = win.webContents;
      await this.assertSession(wc, a);
      signal.throwIfAborted();
      await wc.loadURL(initialUrl ?? inboxUrl(a));
      const check = async () => {
        signal.throwIfAborted();
        if (this.stopped || wc.isDestroyed()) throw new Error("Tìm kiếm đã dừng.");
        this.assertNotRateLimited(accountId);
        const probe = await this.native(wc, "status");
        if (probe.blocked) throw new Error(probe.blockedReason ?? "Cần xác minh trong cửa sổ Messenger trước khi tìm kiếm.");
      };
      const result = await operation(wc, signal, check);
      signal.throwIfAborted();
      await this.assertSession(wc, a);
      return result;
    } finally {
      signal.removeEventListener("abort", close);
      this.searchWindows.delete(win);
      close();
    }
  }
  searchContacts(accountId: string, query: string, signal: AbortSignal) {
    return this.withContactSearch(accountId, signal, (wc, cancelled, check) => searchMessengerContacts(wc, query, cancelled, check));
  }
  resolveGroupMember(c: Conversation, memberId: string, signal: AbortSignal) {
    if (this.betaMode === "off") throw new Error("Tính năng mở thành viên cần bật API Messenger beta.");
    return this.withContactSearch(c.accountId, signal, async (wc, cancelled, check) => {
      const userId = this.account(c.accountId).facebookUserId;
      if (!userId || c.kind !== "group" || !/^\d{1,30}$/.test(memberId)) throw new Error("Thành viên nhóm không hợp lệ.");
      let member;
      for (let n = 0; n < 40; n++) {
        await check();
        const r = await callMemberRead(wc, { mode: "member", threadId: c.platformId, memberId, userId });
        if (r.status === "ready" && r.member) { member = r.member; break; }
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      if (!member) throw new Error("Chưa xác nhận được thành viên này trong nhóm. Hãy tải lại danh sách.");
      // Let Messenger resolve the user link to its real private thread; the user
      // ID itself is never accepted as proof of an E2EE conversation identity.
      await wc.loadURL(`https://www.facebook.com/messages/t/${member.id}/`);
      for (let n = 0; n < 60; n++) {
        cancelled.throwIfAborted(); await check();
        let platformId: string | null = null;
        try { platformId = threadIdentity(wc.getURL()); } catch {}
        if (platformId && platformId !== c.platformId) {
          const r = await callMemberRead(wc, { mode: "direct", threadId: platformId, memberId, userId });
          if (r.status === "ready") return { platformId, url: facebookUrl(wc.getURL()).href, name: member.name, kind: "direct" as const };
        }
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      throw new Error("Messenger chưa mở được đúng chat riêng của thành viên này. Hãy thử lại.");
    }, c.url);
  }
  resolveSearchContact(accountId: string, query: string, hit: MessengerContactHit, signal: AbortSignal) {
    return this.withContactSearch(accountId, signal, async (wc, cancelled, check) => {
      const hits = await searchMessengerContacts(wc, query, cancelled, check);
      if (!hits.some(h => h.providerId === hit.providerId && h.name === hit.name)) throw new Error("Kết quả tìm kiếm đã thay đổi. Hãy tìm lại liên hệ.");
      await check();
      let navigated = false;
      const navigation = () => { navigated = true; };
      wc.on("did-navigate", navigation);
      wc.on("did-navigate-in-page", navigation);
      try {
        await wc.executeJavaScript(contactSearchScript("select", query, hit));
        const deadline = Date.now() + 10_000;
        while (Date.now() < deadline) {
          cancelled.throwIfAborted();
          let platformId: string | null = null;
          try { platformId = threadIdentity(wc.getURL(), this.account(accountId).platform); } catch {}
          if (navigated && platformId) {
            await this.assertSession(wc, this.account(accountId));
            await check();
            const read = await this.native(wc, "read");
            const name = (s: string) => s.normalize("NFC").trim().toLowerCase();
            if (read.threadId === platformId && read.selectedThreadId === platformId && name(read.name) === name(hit.name))
              return { platformId, url: facebookUrl(wc.getURL()).href, name: hit.name, avatar: hit.avatar };
          }
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        throw new Error("Chưa xác nhận được đúng hội thoại của liên hệ. Hãy tìm lại hoặc mở trong Messenger.");
      } finally {
        wc.off("did-navigate", navigation);
        wc.off("did-navigate-in-page", navigation);
      }
    });
  }
  // deep: người dùng cuộn buddy list xuống đáy → cuộn inbox xa hơn và chờ Facebook tải thêm hội thoại.
  async scanInbox(accountId: string, deep = false): Promise<InboxScan> {
    return this.serialized(`inbox:${accountId}`, async () => {
      this.assertNotRateLimited(accountId);
      const a = this.account(accountId);
      const view = await this.monitorView(a);
      const wc = view.webContents;
      await this.assertSession(wc, a);
      await this.preparePage(
        wc,
        inboxUrl(a),
        wc.getURL().includes("/messages/"),
      );
      let first:
        { threads: InboxThread[]; revision: number; more: boolean } | undefined;
      for (let n = 0; n < 12; n++) {
        try {
          if ((await this.restorePin(wc, a)) === "blocked") {
            this.showWorker(a.id, view);
            throw new Error(
              "Inbox đang yêu cầu PIN khôi phục. Kiểm tra cửa sổ Messenger.",
            );
          }
          first = await this.native(wc, "inbox");
          break;
        } catch (error) {
          this.assertNotRateLimited(accountId);
          await new Promise((r) => setTimeout(r, 250));
        }
      }
      if (!first)
        throw new Error(
          "Chưa đọc được inbox. Mở tab tài khoản để hoàn tất đăng nhập/PIN.",
        );
      await this.native(wc, "reset-inbox");
      await new Promise((r) => setTimeout(r, 150));
      const map = new Map<string, InboxThread>();
      const top = await this.native(wc, "inbox");
      for (const thread of top.threads as InboxThread[])
        map.set(thread.platformId, thread);
      // Background scans refresh the head; explicit pagination resumes its frontier.
      const offset = deep ? (this.inboxOffsets.get(accountId) ?? 0) : 0;
      if (offset && top.more) {
        await this.native(wc, "seek-inbox", { scrollTop: offset });
        await new Promise((r) => setTimeout(r, 250));
      }
      let more = true,
        nextOffset = 0,
        revision = first.revision;
      const pages = 8;
      for (let page = 0; page < pages; page++) {
        let result = await this.native(wc, "inbox");
        for (const thread of result.threads as InboxThread[])
          map.set(thread.platformId, thread);
        // Ở đáy danh sách Facebook mới tải thêm (có vòng xoay): chờ tối đa ~3s xem có thêm hội thoại không.
        if (deep && !result.more) {
          const before = map.size;
          for (let n = 0; n < 10 && !result.more; n++) {
            await new Promise((r) => setTimeout(r, 300));
            result = await this.native(wc, "inbox");
            for (const thread of result.threads as InboxThread[])
              map.set(thread.platformId, thread);
          }
          if (!result.more && map.size === before) {
            more = false;
            break;
          }
        }
        revision = result.revision;
        more = result.more;
        nextOffset = result.nextOffset;
        if (!more || page === pages - 1) break;
        if (!(await this.native(wc, "scroll-inbox"))) break;
        await new Promise((r) => setTimeout(r, 250));
      }
      this.inboxOffsets.set(accountId, Math.max(this.inboxOffsets.get(accountId) ?? 0, nextOffset));
      await this.native(wc, "reset-inbox");
      const threads = [...map.values()];
      return {
        threads,
        scannedAt: Date.now(),
        coverage: more ? "partial" : "visible",
        revision,
      };
    });
  }
  private async monitorView(a: Account) {
    let view = this.monitors.get(a.id);
    if (!view || view.webContents.isDestroyed()) {
      view = new WebContentsView({
        webPreferences: {
          session: await this.accountSession(a),
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          backgroundThrottling: false,
        },
      });
      view.setBounds({ x: 0, y: 0, width: 1100, height: 800 });
      this.protect(view.webContents, a);
      this.monitors.set(a.id, view);
    }
    return view;
  }
  // Y!M: mở trang inbox ẩn để luồng tự đăng nhập (protect → login) chạy; scanInbox chỉ đọc khi đã có phiên.
  async connect(accountId: string) {
    const view = await this.monitorView(this.account(accountId));
    let onFacebook = false;
    try {
      facebookUrl(view.webContents.getURL());
      onFacebook = true;
    } catch {}
    if (!onFacebook)
      await view.webContents.loadURL(inboxUrl()).catch(() => undefined);
  }
  private async worker(a: Account, conversationId: string) {
    this.assertNotRateLimited(a.id);
    let worker = this.workers.get(conversationId);
    if (worker?.webContents.isDestroyed()) {
      this.workers.delete(conversationId);
      worker = undefined;
    }
    if (!worker) {
      worker = new WebContentsView({
        webPreferences: {
          session: await this.accountSession(a),
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          backgroundThrottling: false,
        },
      });
      worker.setBounds({ x: 0, y: 0, width: 1100, height: 800 });
      this.protect(worker.webContents, a);
      if (this.stopped) {
        worker.webContents.close();
        throw new Error("Ứng dụng đã dừng xử lý.");
      }
      this.workers.set(conversationId, worker);
    }
    return worker.webContents;
  }
  // Browser operations are serialized only within the same conversation.
  // Separate conversations get separate pages sharing the account session.
  async withConversationTask<T>(
    c: Conversation,
    operation: () => Promise<T>,
  ): Promise<T> {
    return this.workerPool.use(
      c.id,
      c.accountId,
      async () => {
        await this.worker(this.account(c.accountId), c.id);
        return this.workers.get(c.id)!;
      },
      (view) => {
        // Keep an unresolved verification/send result available for inspection.
        if ([...this.entries.values()].some((e) => e.view === view)) return;
        if (this.workers.get(c.id) === view) this.workers.delete(c.id);
        if (!view.webContents.isDestroyed()) view.webContents.close();
      },
      operation,
    );
  }
  private serialized<T>(
    accountId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const task = (this.accountQueues.get(accountId) || Promise.resolve()).then(
      operation,
    );
    const settled = task
      .then(
        () => undefined,
        () => undefined,
      )
      .finally(() => {
        if (this.accountQueues.get(accountId) === settled)
          this.accountQueues.delete(accountId);
      });
    this.accountQueues.set(accountId, settled);
    return task;
  }
  async readConversation(
    c: Conversation,
    profile?: DOMProfile,
  ): Promise<Omit<Message, "baseline">[]> {
    return this.serialized(`thread:${c.id}`, () =>
      this.withConversationTask(c, () => this.readUnlocked(c, profile)),
    );
  }
  async readGroupMembers(c: Conversation, cursor?: string) {
    return this.serialized(`thread:${c.id}`, () => this.withConversationTask(c, async () => {
      const wc = await this.worker(this.account(c.accountId), c.id);
      await this.assertSession(wc, this.account(c.accountId));
      await this.preparePage(wc, c.url, wc.getURL() === c.url);
      const read = await this.waitForNativeRead(wc, c, "Đọc thành viên nhóm");
      const result = await this.groupRead(wc, c, read, cursor, true);
      if (result.status !== "ready" || result.kind !== "group" || !result.group) throw new Error("Chưa đọc được thành viên nhóm từ Messenger. Hãy thử lại.");
      return result.group;
    }));
  }
  async readHistory(
    c: Conversation,
    profile?: DOMProfile,
    signal?: AbortSignal,
  ) {
    if (profile)
      throw new Error(
        "Nạp sâu cần bộ đọc Messenger tích hợp. Với bộ đọc riêng, mở và cuộn lịch sử rồi bấm Nạp lịch sử.",
      );
    return this.serialized(`thread:${c.id}`, () =>
      this.historyPool.use(
        c.id,
        c.accountId,
        async () => {
          const existing = this.historyWindows.get(c.id);
          if (existing && !existing.isDestroyed()) return existing;
          const pageSession = await this.accountSession(this.account(c.accountId));
          signal?.throwIfAborted();
          if (this.stopped) throw new Error("Ứng dụng đã dừng xử lý.");
          // A detached WebContentsView never paints IntersectionObserver's
          // viewport. Messenger therefore scrolls but never fetches older rows.
          // An owning window renders while initially hidden, without focus.
          const win = new BrowserWindow({
            show: false,
            width: 1100,
            height: 800,
            title: "Messenger · Tải lịch sử — Buzz! Messenger",
            webPreferences: {
              session: pageSession,
              sandbox: true,
              contextIsolation: true,
              nodeIntegration: false,
              backgroundThrottling: false,
            },
          });
          this.protect(win.webContents, this.account(c.accountId));
          this.historyWindows.set(c.id, win);
          win.once("closed", () => {
            if (this.historyWindows.get(c.id) === win) this.historyWindows.delete(c.id);
          });
          return win;
        },
        (win) => {
          // Keep a recovery prompt available until the person closes it.
          if (!win.isDestroyed() && win.isVisible()) return;
          if (this.historyWindows.get(c.id) === win) this.historyWindows.delete(c.id);
          if (!win.isDestroyed()) win.destroy();
        },
        async (win) => {
          signal?.throwIfAborted();
          const wc = win.webContents;
          this.assertNotRateLimited(c.accountId);
          if ([...this.entries.values()].some(e => e.worker && e.blocking !== false && e.meta.accountId === c.accountId))
            throw new Error("Hoàn tất xác minh trong cửa sổ Messenger rồi đóng cửa sổ đó để nạp lại lịch sử.");
          await this.assertSession(wc, this.account(c.accountId));
          await this.preparePage(wc, c.url, wc.getURL() === c.url);
          return this.readNative(wc, c, {
            limit: Math.min(5000, c.messages.length + 100),
            signal,
          });
        },
      ),
    );
  }
  async readLiveConversation(
    c: Conversation,
    profile?: DOMProfile,
  ): Promise<Omit<Message, "baseline">[]> {
    this.assertNotRateLimited(c.accountId);
    const a = this.account(c.accountId);
    if (
      [...this.entries.values()].some(
        (entry) =>
          entry.worker &&
          entry.blocking !== false &&
          entry.meta.accountId === a.id,
      )
    )
      throw new Error(
        "Hoàn tất xác minh trong cửa sổ Messenger rồi đóng cửa sổ đó để cập nhật.",
      );
    let view = this.liveViews.get(c.id);
    if (!view || view.webContents.isDestroyed()) {
      view = new WebContentsView({
        webPreferences: {
          session: await this.accountSession(a),
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          backgroundThrottling: false,
        },
      });
      view.setBounds({ x: 0, y: 0, width: 1100, height: 800 });
      this.protect(view.webContents, a);
      this.liveViews.set(c.id, view);
    }
    const wc = view.webContents;
    await this.assertSession(wc, a);
    let currentId: string | null = null;
    try {
      currentId = threadIdentity(wc.getURL());
    } catch {}
    // Buzz!: trang live tự nhận cập nhật của Messenger; tải lại mỗi 60s làm cửa sổ chat khựng vài giây mỗi phút.
    await this.preparePage(wc, c.url, currentId === c.platformId, LIVE_RELOAD_EVERY);
    if (profile) {
      const read = await wc.executeJavaScript(readScript(profile));
      if (
        threadIdentity(wc.getURL()) !== c.platformId ||
        read.threadId !== c.platformId ||
        read.invalid
      )
        throw new Error("Bộ đọc chưa sẵn sàng cho hội thoại đang xem.");
      return read.messages.map(
        (m: Omit<Message, "baseline" | "observedAt">) => ({
          ...m,
          observedAt: Date.now(),
        }),
      );
    }
    await this.native(wc, "scroll-latest");
    const read = await this.waitForNativeRead(
      wc,
      c,
      "Cập nhật hội thoại đang xem",
    );
    // This view stays on the selected thread and receives Messenger's own live updates.
    // No history traversal or navigation through the other registered conversations.
    const enriched = await this.enrichFromBeta(wc, c, read);
    return enriched.messages.map((m) => ({ ...m, observedAt: Date.now() }));
  }
  private async readUnlocked(
    c: Conversation,
    profile?: DOMProfile,
    history?: { limit: number; signal?: AbortSignal },
  ): Promise<Omit<Message, "baseline">[]> {
    const a = this.account(c.accountId),
      wc = await this.worker(a, c.id);
    if (
      [...this.entries.values()].some(
        (e) => e.worker && e.blocking !== false && e.meta.accountId === a.id,
      )
    )
      throw new Error(
        "Hoàn tất xác minh trong cửa sổ Messenger rồi đóng cửa sổ đó để nạp lại lịch sử.",
      );
    await this.assertSession(wc, a);
    let currentId: string | null = null;
    try {
      currentId = threadIdentity(wc.getURL(), a.platform);
    } catch {
      // A new worker starts at about:blank.
    }
    await this.preparePage(wc, c.url, currentId === c.platformId);
    if (!profile) return this.readNative(wc, c, history);
    // React may commit after did-finish-load. Poll bounded identity readiness without assuming a delay is success.
    for (let attempt = 0; attempt < 6; attempt++) {
      const result = await wc.executeJavaScript(readScript(profile));
      if (threadIdentity(wc.getURL(), a.platform) !== c.platformId)
        throw new Error("URL không khớp thread.");
      if (
        result.threadId === c.platformId &&
        result.messages.length &&
        result.invalid === 0
      )
        return result.messages.map(
          (m: Omit<Message, "baseline" | "observedAt">) => ({
            ...m,
            observedAt: Date.now(),
          }),
        );
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    throw new Error("Profile chưa đọc được ID, hướng hoặc timestamp đầy đủ.");
  }
  async readAttachment(
    c: Conversation,
    messageId: string,
    attachmentId: string,
    signal?: AbortSignal,
  ): Promise<MediaPayload> {
    return this.serialized(`thread:${c.id}`, () =>
      this.withConversationTask(c, async () => {
        signal?.throwIfAborted();
        const a = this.account(c.accountId);
        // Buzz!: cửa sổ chat đang mở → dùng trang live (trình phát đã dựng sẵn); không thì mở worker.
        const live = this.liveViews.get(c.id)?.webContents;
        let onThread = false;
        try {
          onThread = Boolean(live && !live.isDestroyed() && threadIdentity(live.getURL()) === c.platformId);
        } catch {}
        const wc = onThread ? live! : await this.worker(a, c.id);
        await this.assertSession(wc, a);
        let currentThread: string | null = null;
        try {
          currentThread = threadIdentity(wc.getURL());
        } catch {}
        if (currentThread !== c.platformId) await wc.loadURL(c.url);
        let read = await waitForMessengerRead(
          async () => this.native(wc, "read"),
          { ...c, readOnly: true },
          "Đọc media",
        );
        read = await this.enrichFromBeta(wc, c, read);
        const savedMessage = c.messages.find(m => m.id === messageId);
        const sourceMessage = () => findObservedMessage(savedMessage, read.messages, messageId);
        // Messenger dựng trình phát/ ảnh sau khi trang hiện tin: chờ tại chỗ (~3s) trước khi cuộn lên tìm.
        for (let n = 0; !sourceMessage() && n < 10; n++) {
          signal?.throwIfAborted();
          await new Promise((r) => setTimeout(r, 300));
          read = await this.enrichFromBeta(wc, c, await this.native(wc, "read"));
        }
        for (
          let n = 0;
          !sourceMessage() && n < 10;
          n++
        ) {
          signal?.throwIfAborted();
          await this.native(wc, "scroll-history");
          await new Promise((r) => setTimeout(r, 250));
          read = await waitForMessengerRead(
            async () => this.native(wc, "read"),
            { ...c, readOnly: true },
            "Tìm tin chứa media",
          );
          read = await this.enrichFromBeta(wc, c, read);
        }
        const currentMessage = sourceMessage();
        if (!currentMessage) throw new Error("Không xác định được duy nhất tin chứa tệp trong Messenger.");
        const options = {
          threadId: c.platformId,
          recipient: c.name,
          messageId: currentMessage.id,
          attachmentId,
        };
        wc.setAudioMuted(true);
        // Buzz!: trang ẩn (không gắn cửa sổ) không nhận cú click chuột giả lập ở toạ độ nút phát,
        // còn element.click() thì Messenger phát ngay và lộ nguồn blob: (đã kiểm trên tài khoản thật).
        let media = await this.native(wc, "media-source", {
          ...options,
          load: true,
          nativePlayback: false,
        });
        if (media.playPoint) {
          signal?.throwIfAborted();
          await this.assertSession(wc, a);
          if (threadIdentity(wc.getURL()) !== c.platformId)
            throw new Error("Hội thoại đã thay đổi trước khi phát âm thanh.");
          if (!wc.debugger.isAttached()) wc.debugger.attach("1.3");
          for (const type of ["mousePressed", "mouseReleased"])
            await wc.debugger.sendCommand("Input.dispatchMouseEvent", {
              type,
              ...media.playPoint,
              button: "left",
              clickCount: 1,
            });
        }
        for (let n = 0; !media.source && n < 60; n++) {
          signal?.throwIfAborted();
          await new Promise((r) => setTimeout(r, 250));
          media = await this.native(wc, "media-source", options);
        }
        if (!media.source || !allowedMediaSource(media.source))
          throw new Error(
            "Messenger chưa cung cấp nguồn ảnh/âm thanh được hỗ trợ. Mở tệp trong Messenger rồi thử lại.",
          );
        signal?.throwIfAborted();
        try {
          if (media.source.startsWith("blob:")) {
            const payload = await wc.executeJavaScript(
              `(() => {const __name=(v)=>v;return (${readMediaBlob.toString()})(${JSON.stringify(media.source)},${JSON.stringify(media.kind)});})()`,
            );
            signal?.throwIfAborted();
            return payload;
          }
          const response = await wc.session.fetch(media.source, {
            redirect: "error",
            credentials: "include",
            signal: signal
              ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
              : AbortSignal.timeout(20000),
          });
          return await boundedMedia(response, media.kind, signal);
        } catch (error) {
          if (signal?.aborted) throw error;
          throw new Error(
            "Không tải được ảnh/âm thanh Messenger; tệp có thể đã hết hạn hoặc vượt 20 MB.",
          );
        }
      }),
    );
  }
  private async waitForNativeRead(
    wc: WebContents,
    c: Conversation,
    stage: string,
    options: NativeOptions = {},
    signal?: AbortSignal,
  ): Promise<MessengerRead> {
    let lastRead: MessengerRead | undefined;
    let seeking = false;
    try {
      return await waitForMessengerRead(
        async () => {
          signal?.throwIfAborted();
          let read = (await this.native(wc, "read", options)) as MessengerRead;
          if (threadIdentity(wc.getURL()) !== c.platformId)
            throw new Error(
              "Facebook chuyển sang hội thoại khác; đã chặn đọc.",
            );
          if (
            read.blocked &&
            (await this.restorePin(wc, this.account(c.accountId))) ===
              "restored"
          )
            read = (await this.native(wc, "read", options)) as MessengerRead;
          const group = await this.groupRead(wc, c, read);
          if (group.status === "ready" && group.kind === "group") {
            read = await this.native(wc, "read", options);
            read = enrichGroupRead(read, group);
          }
          // Buzz!: mọi lượt đọc qua đây đều là chỉ đọc (readOnly bên dưới) → đánh số tin trùng định danh.
          read = { ...read, messages: disambiguate(read.messages) };
          lastRead = read;
          return read;
        },
        { ...c, readOnly: true },
        stage,
        undefined,
        async (read) => {
          // Virtualized inbox rows disappear from the DOM. Reveal the row,
          // then require the same recipient/selection proof as every send.
          if (
            !read.blocked &&
            read.selectedThreadId === null &&
            read.composerPresent &&
            read.name.normalize("NFC").trim().toLocaleLowerCase() ===
              c.name.normalize("NFC").trim().toLocaleLowerCase()
          ) {
            await this.native(wc, seeking ? "scroll-inbox" : "reset-inbox");
            seeking = true;
          }
        },
      );
    } catch (error) {
      signal?.throwIfAborted();
      // React can expose a short-lived loading dialog during navigation.
      // Ordinary loading/modals still block this read/send, not every conversation.
      if (lastRead?.blocked && lastRead.recoveryRequired) {
        this.pause("Messenger đang yêu cầu xác minh hoặc khôi phục lịch sử.");
        const view = [
          ...this.workers.values(),
          ...this.liveViews.values(),
        ].find((view) => view.webContents === wc);
        this.showWorker(c.accountId, view);
        const historyWindow = this.historyWindows.get(c.id);
        if (historyWindow && !historyWindow.isDestroyed() && historyWindow.webContents === wc)
          historyWindow.show();
        throw new Error(
          `${lastRead.blockedReason ?? "Messenger cần xác minh."} Hoàn tất trong cửa sổ Messenger vừa mở, đóng cửa sổ rồi nạp lại lịch sử.`,
        );
      }
      throw error;
    }
  }
  private async readNative(
    wc: WebContents,
    c: Conversation,
    history?: { limit: number; signal?: AbortSignal },
  ): Promise<Omit<Message, "baseline">[]> {
    const capture = async (stage: string) => {
      const read = await this.waitForNativeRead(
        wc,
        c,
        stage,
        { historyLimit: history?.limit ?? 100 },
        history?.signal,
      );
      return this.enrichFromBeta(wc, c, read, history?.limit ?? 100);
    };
    await this.native(wc, "scroll-latest");
    const result = await capture("Mở hội thoại");
    const collected = new Map(result.messages.map((m) => [m.id, m]));
    // Bounded history backfill in the worker only; the person's visible browser never scrolls.
    const limit = history?.limit ?? 100;
    if ((history || !c.messages.length) && collected.size < limit)
      for (
        let n = 0, stalled = 0;
        n < (history ? Math.min(500, Math.max(60, Math.ceil(limit / 10) + 12)) : 12) && collected.size < limit;
        n++
      ) {
        history?.signal?.throwIfAborted();
        const moved = await this.native(wc, "scroll-history");
        await new Promise((r) => setTimeout(r, 250));
        const older = await capture("Tải lịch sử");
        const before = collected.size;
        const combined = new Map(older.messages.map((m) => [m.id, m]));
        for (const [id, m] of collected) combined.set(id, m);
        collected.clear();
        for (const [id, m] of combined) collected.set(id, m);
        stalled = collected.size === before ? stalled + 1 : 0;
        // At the top Messenger can still be fetching the preceding page. One
        // unmoved scroll or three 250ms samples do not establish end of history.
        if (stalled >= (moved ? 12 : 16)) break;
      }
    await this.native(wc, "scroll-latest");
    await new Promise((r) => setTimeout(r, 250));
    const latest = await capture("Hoàn tất tải lịch sử");
    for (const m of latest.messages) collected.set(m.id, m);
    // Retain DOM chronology when no absolute timestamp is available.
    return [...collected.values()]
      .slice(-limit)
      .map((m) => ({ ...m, observedAt: Date.now() }));
  }
  private showWorker(
    accountId: string,
    providedView?: WebContentsView,
    blocking = true,
  ) {
    const view = providedView;
    if (!view || view.webContents.isDestroyed()) return;
    const existing = [...this.entries.values()].find((e) => e.view === view);
    if (existing) {
      existing.window?.show();
      return;
    }
    const id = randomUUID();
    this.entries.set(id, {
      view,
      worker: true,
      blocking,
      meta: {
        id,
        accountId,
        title: `${this.account(accountId).name} · Messenger cần kiểm tra`,
        url: view.webContents.getURL(),
        detached: true,
        status: blocking
          ? this.pageStatuses.get(view.webContents) ||
            "Cần xử lý hộp thoại trong cửa sổ này"
          : "Cần kiểm tra kết quả gửi",
      },
    });
    this.detach(id);
  }
  async sendFiles(
    c: Conversation,
    files: { path: string; name: string; image: boolean }[],
    text: string,
    allowed: () => boolean,
    attempt: { started: boolean },
  ) {
    return this.serialized(`thread:${c.id}`, async () => {
      if (!allowed()) throw new Error("Đã dừng trước khi gửi tệp.");
      this.assertNotRateLimited(c.accountId);
      if ([...this.uploadWindows].some(([w, account]) => account === c.accountId && !w.isDestroyed() && w.isVisible()))
        throw new Error("Kiểm tra và đóng cửa sổ gửi tệp trước đó trước khi gửi tiếp.");
      const win = new BrowserWindow({ show: false, width: 1100, height: 800, title: "Messenger · Gửi tệp — Buzz! Messenger",
        webPreferences: { session: await this.accountSession(this.account(c.accountId)), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
      const wc = win.webContents;
      this.uploadWindows.set(win, c.accountId);
      win.once("closed", () => this.uploadWindows.delete(win));
      this.protect(wc, this.account(c.accountId));
      let keep = false;
      const options = { threadId: c.platformId, recipient: c.name, contextBound: false, text };
      const check = async (empty = false) => {
        if (!allowed() || wc.isDestroyed()) throw new Error("Tác vụ gửi tệp đã dừng.");
        await this.assertSession(wc, this.account(c.accountId));
        if (threadIdentity(wc.getURL()) !== c.platformId) throw new Error("Hội thoại đã thay đổi; dừng gửi tệp.");
        const read = await this.native(wc, "read") as MessengerRead;
        if (read.blocked || read.selectedThreadId !== c.platformId || read.name.normalize("NFC") !== c.name.normalize("NFC"))
          throw new Error("Không xác minh được người nhận tệp.");
        if (empty) await this.native(wc, "preflight", options);
        return read;
      };
      try {
        await this.assertSession(wc, this.account(c.accountId));
        await this.preparePage(wc, c.url, false);
        await this.waitForNativeRead(wc, c, "Chuẩn bị gửi tệp");
        const before = await check(true);
        const tag = randomUUID(), names = files.map(f => f.name);
        await uploadState(wc, "input", tag, names);
        if (!wc.debugger.isAttached()) wc.debugger.attach("1.3");
        const { root } = await wc.debugger.sendCommand("DOM.getDocument");
        const { nodeId } = await wc.debugger.sendCommand("DOM.querySelector", { nodeId: root.nodeId, selector: `input[data-buzz-upload="${tag}"]` });
        if (!nodeId) throw new Error("Ô đính kèm đã thay đổi; chưa tải tệp lên.");
        await check(true);
        // Upload may itself trigger a send in a future Messenger layout.
        // From this point tokens are consumed; never automatically retry.
        attempt.started = true;
        await wc.debugger.sendCommand("DOM.setFileInputFiles", { nodeId, files: files.map(f => f.path) });
        let ready = 0;
        for (let n = 0; n < 180 && ready < 2; n++) {
          await new Promise(r => setTimeout(r, 400));
          await check();
          ready = (await uploadState(wc, "ready", tag, names)).ready ? ready + 1 : 0;
        }
        if (ready < 2) throw new Error("Tệp chưa sẵn sàng gửi. Kiểm tra trong Messenger; không tự gửi lại.");
        if (text) {
          await this.native(wc, "focus", options);
          await wc.debugger.sendCommand("Input.insertText", { text });
        }
        await check();
        await this.native(wc, "click", options);
        const ids = new Set(before.messages.map(m => m.id));
        for (let n = 0; n < 30; n++) {
          await new Promise(r => setTimeout(r, 400));
          const read = await check();
          const fresh = read.messages.filter(m => m.direction === "outgoing" && !ids.has(m.id));
          const imageCount = fresh.reduce((n, m) => n + (m.attachments?.filter(a => a.kind === "image").length ?? 0), 0);
          const labels = fresh.map(m => m.text).join("\n");
          if (files.every(f => f.image ? imageCount >= files.filter(x => x.image).length : labels.includes(f.name))) return;
        }
        throw new Error("Chưa xác nhận tệp đã gửi. Kiểm tra Messenger; không tự gửi lại.");
      } catch (error) {
        if (!win.isDestroyed() && allowed()) { keep = true; win.show(); }
        throw error;
      } finally {
        if (!wc.isDestroyed() && wc.debugger.isAttached()) wc.debugger.detach();
        if (!keep && !win.isDestroyed()) win.destroy();
      }
    });
  }

  private async sendNative(
    wc: WebContents,
    c: Conversation,
    text: string,
    basedOn: string | null,
    allowed: () => boolean,
    attempt: { clicked: boolean },
    contextBound: boolean,
  ) {
    await this.assertSession(wc, this.account(c.accountId));
    if (!allowed()) throw new Error("Tác vụ gửi đã bị dừng; chưa bấm gửi.");
    if (threadIdentity(wc.getURL()) !== c.platformId)
      throw new Error("Messenger chưa mở đúng hội thoại cần gửi.");
    for (const e of this.entries.values()) {
      if (e.meta.accountId !== c.accountId || e.view.webContents.isDestroyed())
        continue;
      if (
        e.view.webContents
          .getURL()
          .match(
            /^https:\/\/(?:www\.)?facebook\.com\/messages\/(?:e2ee\/)?t\/(\d+)\/?(?:[?#].*)?$/,
          )?.[1] === c.platformId
      ) {
        await this.native(e.view.webContents, "preflight", {
          threadId: c.platformId,
          recipient: c.name,
          latest: basedOn,
          contextBound,
        });
      }
    }
    const options = {
      threadId: c.platformId,
      recipient: c.name,
      latest: basedOn,
      contextBound,
      text,
    };
    await this.native(wc, "preflight", options);
    const userId = this.account(c.accountId).facebookUserId;
    if (this.betaMode === "on" && userId && /^https:\/\/(?:www\.)?facebook\.com\/messages\/(?:e2ee\/)?t\//.test(wc.getURL())) {
      const sent = await tryMessengerBetaSend(wc, { threadId: c.platformId, userId, text }, attempt, async () => {
        await this.assertSession(wc, this.account(c.accountId));
        if (!allowed()) throw new Error("Đã dừng trước khi gửi qua API beta.");
        await this.native(wc, "preflight", options);
      });
      if (sent) {
        this.betaReads.delete(wc);
        this.betaStatus(wc, "send:maw-bridge");
        return;
      }
      this.betaStatus(wc, "send:dom-fallback-before-attempt");
      // Context may have changed during module discovery. Prove readiness again.
      await this.assertSession(wc, this.account(c.accountId));
      if (!allowed()) throw new Error("Đã dừng trước khi gửi.");
      await this.native(wc, "preflight", options);
    }
    const before = (await this.native(wc, "read")) as MessengerRead;
    if (!wc.debugger.isAttached()) wc.debugger.attach("1.3");
    await this.native(wc, "focus", options);
    if (!allowed()) throw new Error("Đã dừng trước khi nhập tin.");
    await wc.debugger.sendCommand("Input.insertText", { text });
    await this.assertSession(wc, this.account(c.accountId));
    if (!allowed() || threadIdentity(wc.getURL()) !== c.platformId)
      throw new Error("Đã dừng trước khi gửi; nội dung còn trong composer.");
    attempt.clicked = true;
    await this.native(wc, "click", options);
    const ids = new Set(before.messages.map((m) => m.id));
    // Gửi lại đúng câu vừa gửi trong cùng phút → tin mới trùng ID suy từ nội dung với tin cũ: đếm thêm một tin là đã gửi.
    const sent = (r: MessengerRead) => r.messages.filter((m) => m.direction === "outgoing" && m.text === text).length;
    const already = sent(before);
    for (let n = 0; n < 12; n++) {
      await new Promise((r) => setTimeout(r, 350));
      const echo = (await this.native(wc, "read")) as MessengerRead;
      if (
        echo.threadId !== c.platformId ||
        echo.selectedThreadId !== c.platformId ||
        echo.blocked
      )
        throw new Error("Không xác nhận được đúng hội thoại sau gửi.");
      if (
        echo.messages.some(
          (m) =>
            m.direction === "outgoing" && m.text === text && !ids.has(m.id),
        ) ||
        sent(echo) > already
      )
        return;
    }
    throw new Error(
      "Chưa xác nhận tin đã gửi. Kiểm tra Messenger; không tự gửi lại.",
    );
  }
  async send(
    c: Conversation,
    profile: DOMProfile | undefined,
    text: string,
    basedOn: string | null,
    allowed: () => boolean,
    contextBound = true,
  ): Promise<void> {
    // Buzz!: cửa sổ chat đang mở → gửi ngay trên trang live (đã ở đúng hội thoại, đã khôi phục lịch sử e2ee,
    // ô soạn sẵn sàng). Không mở worker mới: worker phải tải lại + khôi phục PIN, và xếp hàng chung 3 slot/tài khoản
    // nên lượt gửi có thể treo. Mọi kiểm tra của sendNative (người nhận, hội thoại, echo) vẫn giữ nguyên.
    const live = this.liveViews.get(c.id)?.webContents;
    let onThread = false;
    try {
      onThread = Boolean(live && !live.isDestroyed() && threadIdentity(live.getURL()) === c.platformId);
    } catch {}
    if (!profile && onThread)
      return this.serialized(`thread:${c.id}`, async () => {
        const attempt = { clicked: false };
        try {
          await this.sendNative(live!, c, text, basedOn, allowed, attempt, contextBound);
        } catch (error) {
          if (!attempt.clicked) throw new SendNotAttemptedError(error);
          throw error;
        }
      });
    return this.serialized(`thread:${c.id}`, () =>
      this.withConversationTask(c, async () => {
        const attempt = { clicked: false };
        try {
          await this.sendUnlocked(
            c,
            profile,
            text,
            basedOn,
            allowed,
            attempt,
            contextBound,
          );
        } catch (error) {
          if (!attempt.clicked) throw new SendNotAttemptedError(error);
          this.showWorker(c.accountId, this.workers.get(c.id), false);
          throw error;
        }
      }),
    );
  }
  private async sendUnlocked(
    c: Conversation,
    profile: DOMProfile | undefined,
    text: string,
    basedOn: string | null,
    allowed: () => boolean,
    attempt: { clicked: boolean },
    contextBound: boolean,
  ): Promise<void> {
    const a = this.account(c.accountId),
      wc = await this.worker(a, c.id);
    if (
      [...this.entries.values()].some(
        (e) => e.worker && e.blocking !== false && e.meta.accountId === a.id,
      )
    )
      throw new Error(
        "Cửa sổ xác minh Messenger đang mở; đã chặn gửi tự động.",
      );
    if (!allowed()) throw new Error("Đã dừng trước khi chuẩn bị gửi.");
    // The account queue may have visited another thread since Engine.observe.
    // Navigate and wait inside the same queue slot as the final send action.
    let currentId: string | null = null;
    try {
      currentId = threadIdentity(wc.getURL(), a.platform);
    } catch {}
    if (currentId !== c.platformId) await this.readUnlocked(c, profile);
    if (!profile)
      return this.sendNative(
        wc,
        c,
        text,
        basedOn,
        allowed,
        attempt,
        contextBound,
      );
    await this.assertSession(wc, a);
    if (!profile.verified)
      throw new Error("Profile tùy chỉnh chưa được kiểm chứng.");
    if (!allowed()) throw new Error("Tác vụ gửi đã bị dừng; chưa bấm gửi.");
    if (threadIdentity(wc.getURL(), a.platform) !== c.platformId)
      throw new Error("Messenger chưa mở đúng hội thoại cần gửi.");
    await wc.executeJavaScript(
      `(${sendCheck.toString()})(${JSON.stringify(profile)},${JSON.stringify(c.platformId)},${JSON.stringify(basedOn)},${JSON.stringify(text)},${JSON.stringify(contextBound)})`,
    );
    if (!allowed()) throw new Error("Đã tạm dừng.");
    // CDP input follows Chromium's own editing path; Facebook receives real input events.
    if (!wc.debugger.isAttached()) wc.debugger.attach("1.3");
    await wc.executeJavaScript(
      `document.querySelector(${JSON.stringify(profile.composerSelector)}).focus()`,
    );
    await wc.debugger.sendCommand("Input.insertText", { text });
    await this.assertSession(wc, a);
    if (!allowed() || threadIdentity(wc.getURL(), a.platform) !== c.platformId)
      throw new Error("Đã dừng trước khi gửi; nội dung còn trong composer.");
    attempt.clicked = true;
    const clicked = await wc.executeJavaScript(`(() => {
      const p=${JSON.stringify(profile)}; const root=document.querySelector(p.threadSelector);
      if(root?.getAttribute(p.threadIdAttribute)!==${JSON.stringify(c.platformId)}) return false;
      const last=Array.from(root.querySelectorAll(p.messageSelector)).at(-1)?.getAttribute(p.messageIdAttribute)??null;
      if(${JSON.stringify(contextBound)} && last!==${JSON.stringify(basedOn)}) return false;
      const button=document.querySelector(p.sendSelector); if(!button || button.disabled || button.getAttribute('aria-disabled')==='true') return false;
      button.click(); return true;
    })()`);
    if (!clicked) throw new Error("Không gửi vì trạng thái đã thay đổi.");
    // A click is not delivery: require a new outgoing echo. Uncertainty is handled by durable outbox.
    for (let i = 0; i < 8; i++) {
      const result = await wc.executeJavaScript(readScript(profile));
      if (
        result.threadId === c.platformId &&
        result.messages.some(
          (m: Message) =>
            m.direction === "outgoing" &&
            m.text === text &&
            !c.messages.some((old) => old.id === m.id),
        )
      )
        return;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(
      "Chưa xác nhận echo gửi thành công. Kiểm tra trực tiếp, không gửi lại tự động.",
    );
  }
  // ---- Buzz! Messenger ----
  // Tên + avatar của tài khoản (trang tạm, đóng ngay sau khi đọc).
  async readProfile(accountId: string): Promise<{ name?: string; avatar?: string }> {
    const a = this.account(accountId);
    const view = new WebContentsView({
      webPreferences: { session: await this.accountSession(a), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
    });
    view.setBounds({ x: 0, y: 0, width: 1100, height: 800 });
    this.protect(view.webContents, a);
    const wc = view.webContents;
    try {
      await this.assertSession(wc, a);
      const userId = this.account(accountId).facebookUserId ?? "";
      // 1. /me tự chuyển tới trang cá nhân → biết đường dẫn của mình (vd /LeNgocDoan/).
      // Facebook chuyển hướng /me bằng script → loadURL báo ERR_ABORTED (-3) dù trang đã tới nơi; bỏ qua, chờ URL đổi.
      await wc.loadURL("https://www.facebook.com/me").catch(() => undefined);
      for (let n = 0; n < 20 && /^\/me\/?$/.test(new URL(wc.getURL()).pathname); n++)
        await new Promise((r) => setTimeout(r, 250));
      const profilePath = new URL(wc.getURL()).pathname;
      // 2. Trang chủ vẫn vẽ cột trái khi chạy ẩn (trang cá nhân thì không). Dùng /home.php vì đường dẫn "/"
      //    bị luồng tự đăng nhập chuyển về inbox.
      await wc.loadURL("https://www.facebook.com/home.php").catch(() => undefined);
      let profile: { name?: string; avatar?: string } = {};
      for (let n = 0; n < 16; n++) {
        await new Promise((r) => setTimeout(r, 500));
        profile = await this.pageExecution(wc, () => wc.executeJavaScript(ownLinkScript(profilePath, userId)));
        if (profile.name && profile.avatar) break;
      }
      return profile;
    } finally {
      if (!wc.isDestroyed()) wc.close();
    }
  }
  // One user action starts at most one call, including concurrent IPC requests.
  startCall(c: Conversation, kind: CallKind): Promise<void> {
    const pending = this.callTasks.get(c.id);
    if (pending) return pending;
    const task = this.launchCall(c, kind).finally(() => this.callTasks.delete(c.id));
    this.callTasks.set(c.id, task);
    return task;
  }

  private async launchCall(c: Conversation, kind: CallKind) {
    if (this.stopped) throw new Error("Messenger đã dừng.");
    this.assertNotRateLimited(c.accountId);
    if (threadIdentity(c.url) !== c.platformId) throw new Error("Đường dẫn hội thoại không khớp người cần gọi.");
    let record = this.callEntries.get(c.id);
    let entry = record && this.entries.get(record.id);
    if (!entry?.window || entry.window.isDestroyed()) {
      const id = await this.open(c.accountId, c.url, true);
      record = { id, started: false };
      entry = this.get(id);
      this.callEntries.set(c.id, record);
      const saved = record;
      entry.window!.once("closed", () => {
        if (this.callEntries.get(c.id) === saved) this.callEntries.delete(c.id);
      });
    }
    const win = entry.window!;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    // Repeated clicks bring the existing call forward; never redial automatically.
    if (record!.started) return;
    const wc = entry.view.webContents;
    const account = this.account(c.accountId);
    const options: NativeOptions = { threadId: c.platformId, recipient: c.name, callKind: kind, contextBound: false };
    let ready = false;
    let lastError: unknown;
    for (let attempt = 0; attempt < 30; attempt++) {
      if (this.stopped || wc.isDestroyed()) throw new Error("Cửa sổ cuộc gọi đã đóng.");
      if (threadIdentity(wc.getURL()) !== c.platformId) throw new Error("Messenger đã chuyển sang hội thoại khác; không gọi.");
      try {
        await this.native(wc, "call-check", options);
        ready = true;
        break;
      } catch (error) { lastError = error; }
      // Bring virtualized inbox selection into view for the recipient proof.
      const read = await this.native(wc, "read") as MessengerRead;
      if (read.blocked) {
        if (read.recoveryRequired && await this.restorePin(wc, account) === "restored") continue;
        throw new Error(read.blockedReason ?? "Hoàn tất xác minh trong cửa sổ Messenger rồi thử gọi lại.");
      }
      if (read.selectedThreadId === null) await this.native(wc, attempt === 0 ? "reset-inbox" : "scroll-inbox");
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!ready) throw lastError ?? new Error("Messenger chưa sẵn sàng để gọi.");
    await this.assertSession(wc, account);
    await this.callWindows.requestDevices(kind);
    if (this.stopped || win.isDestroyed() || wc.isDestroyed()) throw new Error("Cửa sổ cuộc gọi đã đóng.");
    await this.assertSession(wc, account);
    this.callWindows.authorize(wc, { window: win, accountId: c.accountId, threadId: c.platformId, kind });
    // Mark before the side effect. An uncertain error must not cause a second call.
    record!.started = true;
    await this.native(wc, "start-call", options, true);
  }

  // Mở hội thoại trong cửa sổ Messenger thật để người dùng tự thao tác.
  async openConversation(c: Conversation) {
    await this.open(c.accountId, c.url, true);
  }
  // Người dùng đang xem hội thoại trong Buzz: giả lập focus cho trang live vài giây để Messenger gửi "đã xem"
  // (trang ẩn không gắn cửa sổ nên document.hasFocus() luôn false). Tắt lại ngay để tin đến sau đó, khi người dùng
  // không nhìn, không bị đánh dấu đã xem.
  async markSeen(c: Conversation) {
    const wc = this.liveViews.get(c.id)?.webContents;
    if (!wc || wc.isDestroyed()) return;
    try {
      if (threadIdentity(wc.getURL()) !== c.platformId) return;
    } catch {
      return;
    }
    if (!wc.debugger.isAttached()) wc.debugger.attach("1.3");
    await wc.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
    try {
      const state = await wc.executeJavaScript(
        `window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); ({ focus: document.hasFocus(), visibility: document.visibilityState })`,
      );
      await new Promise((r) => setTimeout(r, 3000));
      return state as { focus: boolean; visibility: string };
    } finally {
      if (!wc.isDestroyed() && wc.debugger.isAttached())
        await wc.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: false }).catch(() => undefined);
    }
  }
  // Đóng trang "live" của hội thoại khi cửa sổ chat đóng.
  unwatch(conversationId: string) {
    const view = this.liveViews.get(conversationId);
    this.liveViews.delete(conversationId);
    if (view && !view.webContents.isDestroyed()) view.webContents.close();
  }
  // Trạng thái đăng nhập mà trang inbox ẩn đang thấy (đang đăng nhập, cần xác minh, sai mật khẩu…).
  monitorStatus(accountId: string): string | undefined {
    const view = this.monitors.get(accountId);
    return view && !view.webContents.isDestroyed()
      ? this.pageStatuses.get(view.webContents)
      : undefined;
  }
  // Hiện trang Messenger ẩn của tài khoản để người dùng tự xử lý xác minh/ PIN/ captcha.
  // manual (người dùng tự mở từ menu): không coi là cửa sổ xác minh → không tự đóng khi đã đăng nhập.
  async showMessenger(accountId: string, manual = false) {
    const view = this.monitors.get(accountId);
    if (view && !view.webContents.isDestroyed()) {
      this.showWorker(accountId, view, !manual);
      return;
    }
    await this.open(accountId, undefined, true);
  }
  // Đăng xuất: đóng mọi trang của tài khoản và xóa phiên Chromium (cookie trong vault do bên gọi xóa).
  // keepSession: chỉ đóng trang (hủy lúc đang đăng nhập), giữ cookie để lần sau không phải xác minh lại.
  async signOut(accountId: string, keepSession = false) {
    for (const key of this.knownGroups) if (key.startsWith(`${accountId}:`)) this.knownGroups.delete(key);
    for (const [id, value] of this.groupReads) if (value.accountId === accountId) this.groupReads.delete(id);
    for (const [win, account] of this.searchWindows) if (account === accountId && !win.isDestroyed()) win.destroy();
    for (const [win, account] of this.uploadWindows) if (account === accountId && !win.isDestroyed()) win.destroy();
    for (const [id, win] of this.historyWindows)
      if (win.isDestroyed() || this.pageAccounts.get(win.webContents) === accountId) {
        if (!win.isDestroyed()) win.destroy();
        this.historyWindows.delete(id);
      }
    for (const e of [...this.entries.values()])
      if (e.meta.accountId === accountId) this.close(e.meta.id);
    for (const map of [this.monitors, this.workers, this.liveViews])
      for (const [key, view] of map)
        if (this.pageAccounts.get(view.webContents) === accountId || key === accountId) {
          if (!view.webContents.isDestroyed()) view.webContents.close();
          map.delete(key);
        }
    this.callWindows.close(accountId);
    this.loginAttempts.delete(accountId);
    this.rateLimitedAccounts.delete(accountId);
    this.inboxOffsets.delete(accountId);
    if (keepSession) return;
    const s = this.sessions.get(accountId);
    this.sessions.delete(accountId);
    if (s) await (await s).clearStorageData().catch(() => undefined);
  }
  shutdown() {
    this.stopped = true;
    this.knownGroups.clear();
    this.groupReads.clear();
    for (const win of this.searchWindows.keys()) if (!win.isDestroyed()) win.destroy();
    this.searchWindows.clear();
    this.workerPool.stop();
    this.historyPool.stop();
    for (const win of this.historyWindows.values()) if (!win.isDestroyed()) win.destroy();
    this.historyWindows.clear();
    for (const win of this.uploadWindows.keys()) if (!win.isDestroyed()) win.destroy();
    this.uploadWindows.clear();
    for (const timer of this.loginTimers.values()) clearInterval(timer);
    this.loginTimers.clear();
    for (const w of [
      ...this.workers.values(),
      ...this.monitors.values(),
      ...this.liveViews.values(),
    ])
      if (!w.webContents.isDestroyed()) w.webContents.close();
    for (const e of [...this.entries.values()]) this.close(e.meta.id);
    this.callWindows.close();
  }
}
