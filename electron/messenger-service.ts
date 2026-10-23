// Lớp đồng bộ Y!M ↔ Facebook Messenger, thay cho engine AI của master-chat:
// đăng nhập, quét inbox → buddy list, đọc hội thoại đang mở, gửi tin. Không tự trả lời.
import type { BrowserWindow } from "electron";
import { randomUUID } from "node:crypto";
import type { MessengerContactHit } from "../src/core/contact-search.ts";
import type { ContactSearchResult, GroupMembersResult } from "../src/core/types.ts";
import { Browsers } from "./browser.ts";
import type { Vault } from "./vault.ts";
import { arrivedWhileOnline, ingestLatest, ingestHistory, latestId, previewMessage, reconcileInbox } from "../src/core/conversation.ts";
import type { Account, CallKind, ContactView, Conversation, ConversationView, LoadMoreResult, Message, SessionView, SignIn } from "../src/core/types.ts";
import type { MediaPayload } from "../src/core/media.ts";

// Một tài khoản Facebook cho mỗi lần đăng nhập Y!M.
const ACCOUNT = "fb";
const INBOX_EVERY = 5_000;
// Như master-chat: trang live đã ở sẵn hội thoại, mỗi lượt chỉ đọc DOM nên quét 1s vẫn nhẹ.
const WATCH_EVERY = 1_000;
// Số hội thoại (chưa mở cửa sổ) đọc cùng lúc khi inbox báo đổi.
const CHECK_PARALLEL = 3;
const CHECK_RETRIES = 6;
const SIGN_IN_TIMEOUT = 120_000;
const KEEP_MESSAGES = 5000;
const SEND_TIMEOUT = "Quá 60 giây chưa xác nhận đã gửi. Kiểm tra trong Messenger (Hội thoại → Mở trong Messenger) trước khi gửi lại.";

// Log có giờ (tới mili giây) để đo độ trễ tin đến → bật cửa sổ.
const log = (text: string) => console.log(`[buzz ${new Date().toISOString().slice(11, 23)}] ${text}`);

export type ServiceEvents = {
  session(s: SessionView): void;
  contacts(c: ContactView[]): void;
  conversation(id: string, view: ConversationView): void;
  // Tin mới đến từ hội thoại chưa mở cửa sổ → Y!M bật cửa sổ chat.
  incoming(id: string): void;
};

export class MessengerService {
  private browsers: Browsers;
  private session: SessionView = { phase: "signedOut", username: "", remember: false, autoSignIn: false, hasPin: false, autoPin: false };
  // Mốc đăng nhập: chỉ tin đến có giờ gửi từ mốc này trở đi mới tự bật cửa sổ chat.
  private onlineSince = 0;
  // Đã có ít nhất một lượt quét sau đăng nhập (tín hiệu dự phòng từ inbox chỉ dùng từ lượt thứ hai).
  private scansSinceOnline = 0;
  private loadingMore: Promise<LoadMoreResult> | null = null;
  private searchAbort?: AbortController;
  private searchOpenAbort = new AbortController();
  private searchHits = new Map<string, { query: string; hit: MessengerContactHit }>();
  private openingSearch = new Map<string, Promise<{ id?: string; error?: string }>>();
  private openingMembers = new Map<string, Promise<{ id?: string; error?: string }>>();
  private histories = new Map<string, Promise<LoadMoreResult>>();
  private watched = new Set<string>();
  private errors = new Map<string, string>();
  private timers: ReturnType<typeof setTimeout>[] = [];
  private signInRun = 0;
  private stopped = false;

  constructor(
    private vault: Vault,
    host: BrowserWindow,
    private events: ServiceEvents,
  ) {
    this.browsers = new Browsers(host, vault, () => {}, () => {});
    const a = this.account();
    if (a) this.session = { ...this.session, ...this.accountInfo(a) };
  }

  // Phần thông tin tài khoản đưa ra giao diện (không có mật khẩu, cookie, PIN).
  private accountInfo(a: Account) {
    return {
      username: a.username,
      remember: Boolean(a.remember),
      autoSignIn: Boolean(a.autoSignIn),
      // Tên tự đặt > họ tên Facebook. "Thông báo" từng bị đọc nhầm ở bản trước → bỏ qua.
      displayName: (/^(thông báo|notifications|facebook)$/i.test(a.displayName ?? "") ? undefined : a.displayName) ?? a.facebookName,
      avatar: a.avatar,
      userId: a.facebookUserId,
      hasPin: Boolean(a.recoveryPin),
      autoPin: Boolean(a.autoRestorePin),
    };
  }

  private account(): Account | undefined {
    return this.vault.read().accounts.find((a) => a.id === ACCOUNT);
  }
  private setSession(patch: Partial<SessionView>) {
    if (patch.phase && patch.phase !== "signedIn") this.resetSearch();
    if (patch.phase && patch.phase !== this.session.phase) log(`phiên: ${patch.phase}`);
    this.session = { ...this.session, ...patch };
    this.events.session(this.session);
  }
  sessionView() {
    return this.session;
  }

  // Mở app: "Sign in automatically" + đã nhớ mật khẩu → đăng nhập luôn.
  start() {
    const a = this.account();
    if (a?.remember && a.autoSignIn && a.password)
      void this.signIn({ username: a.username, password: a.password, remember: true, autoSignIn: true });
  }

  async signIn(input: SignIn) {
    this.resetSearch();
    const run = ++this.signInRun;
    const username = input.username.trim();
    const previous = this.account();
    if (previous && previous.username !== username) await this.browsers.signOut(ACCOUNT);
    await this.vault.mutate((state) => {
      const sameUser = previous?.username === username;
      if (!sameUser) state.conversations = state.conversations.filter((c) => c.accountId !== ACCOUNT);
      const next: Account = {
        ...(sameUser ? previous! : { id: ACCOUNT, platform: "messenger-personal" as const, cookies: [] }),
        id: ACCOUNT,
        name: username,
        platform: "messenger-personal",
        username,
        password: input.password,
        remember: input.remember,
        autoSignIn: input.remember && input.autoSignIn,
        cookies: sameUser ? previous!.cookies : [],
      };
      if (!sameUser) delete next.facebookUserId;
      state.accounts = [...state.accounts.filter((a) => a.id !== ACCOUNT), next];
    });
    this.setSession({ phase: "signingIn", ...this.accountInfo(this.account()!), status: "connecting", error: undefined });
    this.browsers.credentialsChanged(ACCOUNT);
    await this.browsers.connect(ACCOUNT);

    let shown = false;
    const deadline = Date.now() + SIGN_IN_TIMEOUT;
    while (run === this.signInRun && !this.stopped) {
      try {
        await this.scan();
        if (run !== this.signInRun) return;
        this.onlineSince = Date.now();
        this.scansSinceOnline = 0;
        this.setSession({ phase: "signedIn", status: undefined, error: undefined });
        this.loop(run);
        void this.refreshProfile(run);
        return;
      } catch {
        const status = this.browsers.monitorStatus(ACCOUNT) ?? "";
        if (/thất bại/i.test(status)) return this.failSignIn(run, "rejected");
        // Facebook cần người dùng tự xử lý (mã xác minh, PIN, captcha) → hiện trang Messenger một lần.
        const needsUser = /xác minh|PIN|kiểm tra/i.test(status);
        if (needsUser && !shown) {
          shown = true;
          await this.browsers.showMessenger(ACCOUNT).catch(() => undefined);
        }
        this.setSession({ status: needsUser ? "verify" : "connecting" });
        if (Date.now() > deadline) return this.failSignIn(run, "timeout");
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }
  private async failSignIn(run: number, error: "rejected" | "timeout") {
    if (run !== this.signInRun) return;
    this.signInRun++;
    await this.browsers.signOut(ACCOUNT);
    this.setSession({ phase: "signedOut", status: undefined, error });
  }

  // Họ tên + avatar Facebook từ liên kết trang cá nhân ở cột trái trang chủ (xem src/core/profile.ts).
  private async refreshProfile(run: number) {
    const profile = await this.browsers.readProfile(ACCOUNT).catch(() => ({}) as { name?: string; avatar?: string });
    if (run !== this.signInRun || (!profile.name && !profile.avatar)) return;
    await this.vault.mutate((state) => {
      const a = state.accounts.find((x) => x.id === ACCOUNT);
      if (!a) return;
      if (profile.name) a.facebookName = profile.name;
      if (profile.avatar) a.avatar = profile.avatar;
    });
    this.setSession(this.accountInfo(this.account()!));
  }

  async setDisplayName(name: string) {
    if (!this.account()) return;
    await this.vault.mutate((state) => {
      const a = state.accounts.find((x) => x.id === ACCOUNT)!;
      const clean = name.trim().slice(0, 60);
      if (clean) a.displayName = clean;
      else delete a.displayName;
    });
    this.setSession(this.accountInfo(this.account()!));
  }

  // PIN khôi phục lịch sử Messenger: lưu trong vault; bỏ cờ chặn để lần sau được tự nhập lại.
  async setPin(pin: string | null, auto: boolean) {
    if (!this.account()) return { ok: false };
    await this.vault.mutate((state) => {
      const a = state.accounts.find((x) => x.id === ACCOUNT)!;
      if (pin) a.recoveryPin = pin;
      else if (pin === "") delete a.recoveryPin;
      a.autoRestorePin = Boolean(a.recoveryPin) && auto;
      a.pinAutoFillBlocked = false;
      a.pinRestorePending = false;
    });
    this.browsers.credentialsChanged(ACCOUNT);
    this.setSession(this.accountInfo(this.account()!));
    return { ok: true };
  }

  // Nút "Hủy" lúc đang đăng nhập: dừng vòng chờ, đóng trang ẩn, giữ phiên/ cookie đã lưu.
  async cancelSignIn() {
    if (this.session.phase !== "signingIn") return;
    this.signInRun++;
    await this.browsers.signOut(ACCOUNT, true);
    this.setSession({ phase: "signedOut", status: undefined, error: undefined });
  }

  async signOut() {
    this.resetSearch();
    this.signInRun++;
    this.clearTimers();
    this.watched.clear();
    this.checks.clear();
    await this.browsers.signOut(ACCOUNT);
    // Đăng xuất Y!M = đăng xuất Facebook trong app: xóa cookie; chỉ giữ mật khẩu khi người dùng chọn "Remember".
    await this.vault.mutate((state) => {
      const a = state.accounts.find((x) => x.id === ACCOUNT);
      if (!a) return;
      a.cookies = [];
      if (!a.remember) a.password = "";
    });
    this.setSession({ phase: "signedOut", status: undefined, error: undefined });
  }

  // Thoát app: không chọn "Remember" thì không để lại mật khẩu/ phiên trên máy.
  async shutdown() {
    this.resetSearch();
    this.stopped = true;
    this.clearTimers();
    const a = this.account();
    if (a && !a.remember)
      await this.vault.mutate((state) => {
        const saved = state.accounts.find((x) => x.id === ACCOUNT);
        if (saved) {
          saved.password = "";
          saved.cookies = [];
        }
      });
    this.browsers.shutdown();
  }

  openInMessenger(id: string) {
    const c = this.conversationById(id);
    if (c) void this.browsers.openConversation(c).catch(() => undefined);
  }

  async startCall(id: string, kind: CallKind): Promise<{ ok: boolean; error?: string }> {
    if (this.stopped || this.session.phase !== "signedIn") return { ok: false, error: "Cần đăng nhập Messenger trước khi gọi." };
    const c = this.conversationById(id);
    if (!c) return { ok: false, error: "Không tìm thấy hội thoại." };
    try {
      await this.browsers.startCall(c, kind);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  showMessenger() {
    void this.browsers.showMessenger(ACCOUNT, true).catch(() => undefined);
  }

  private clearTimers() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  // Hai vòng nền: quét inbox (buddy list + phát hiện tin mới) và đọc các hội thoại đang mở cửa sổ.
  private loop(run: number) {
    const every = (ms: number, fn: () => Promise<void>) => {
      const tick = async () => {
        if (run !== this.signInRun || this.stopped) return;
        await fn().catch(() => undefined);
        if (run === this.signInRun && !this.stopped) this.timers.push(setTimeout(tick, ms));
      };
      this.timers.push(setTimeout(tick, ms));
    };
    every(INBOX_EVERY, () => this.scan());
    every(WATCH_EVERY, () => this.refreshWatched());
  }

  private async scan(deep = false) {
    const result = await this.browsers.scanInbox(ACCOUNT, deep);
    const { changed, hinted } = await this.vault.mutate((state) => reconcileInbox(state, ACCOUNT, result));
    const contacts = this.contacts();
    const json = JSON.stringify(contacts);
    if (json !== this.lastContacts) {
      this.lastContacts = json;
      this.events.contacts(contacts);
    }
    const primed = this.scansSinceOnline++ > 0;
    if (changed.length) log(`inbox: ${changed.length} hội thoại đổi, ${hinted.length} đổi nội dung`);
    // Inbox đổi (tin mới, cảm xúc, "đã xem", thời gian "· 5 phút"…) chỉ là gợi ý để đọc lại; việc bật cửa sổ
    // do read() quyết định theo giờ gửi thật của tin. Đọc ở nền (không chặn lượt quét inbox sau), tối đa
    // CHECK_PARALLEL hội thoại cùng lúc.
    for (const id of changed) if (!this.watched.has(id)) this.checks.set(id, primed && hinted.includes(id));
    this.pumpChecks();
  }
  private lastContacts = "";
  // Hội thoại chờ đọc lại → có được bật cửa sổ theo tín hiệu inbox khi đọc thất bại không.
  private checks = new Map<string, boolean>();
  private checking = 0;
  private pumpChecks() {
    while (this.checking < CHECK_PARALLEL && this.checks.size) {
      const [id, hinted] = this.checks.entries().next().value!;
      this.checks.delete(id);
      this.checking++;
      void this.check(id, hinted).finally(() => {
        this.checking--;
        this.pumpChecks();
      });
    }
  }
  private async check(id: string, hinted: boolean) {
    if (this.watched.has(id)) return log(`bỏ qua kiểm tra "${this.conversationById(id)?.name}": cửa sổ đang mở`);
    // Đọc bằng trang live: có tin mới thì bật cửa sổ và cửa sổ dùng lại luôn trang này (khỏi tải Messenger lần hai);
    // không có thì đóng trang.
    // Trang vừa mở hiện ngay tin cũ đã lưu, tin mới nhất về sau vài giây → inbox đã đổi mà chưa thấy tin tương ứng
    // thì đọc lại trên cùng trang (tối đa ~6s) thay vì kết luận "không có gì mới".
    let ok = false;
    for (let n = 0; n < CHECK_RETRIES; n++) {
      if (n) await new Promise((r) => setTimeout(r, 1000));
      ok = await this.read(id, "live");
      if (!ok || !hinted || this.opening.has(id) || this.watched.has(id) || this.previewSeen(id)) break;
      if (n === CHECK_RETRIES - 1) log(`"${this.conversationById(id)?.name}": inbox đổi nhưng chưa thấy tin tương ứng`);
    }
    if (!this.watched.has(id) && !this.opening.has(id)) this.browsers.unwatch(id);
    // Dự phòng khi đọc tin thất bại (trang mới tải hay chưa sẵn sàng): Messenger báo chưa đọc + nội dung
    // xem trước đổi thật + không phải tin mình gửi.
    const c = this.conversationById(id);
    log(`kiểm tra "${c?.name}": ${ok ? "đọc được" : `lỗi ${this.errors.get(id)?.slice(0, 120)}`}, unread=${c?.inboxUnread}, hinted=${hinted}`);
    if (!ok && hinted && c?.inboxUnread && !/^(bạn|you)\s*:/i.test(c.inboxPreview ?? "")) {
      log("bật cửa sổ theo tín hiệu inbox (đọc tin thất bại)");
      this.popup(id);
    }
  }
  // Nội dung xem trước của inbox đã có trong vài tin cuối chưa ("Bạn: …" là tin mình gửi; ảnh/ cảm xúc thì không so được).
  private previewSeen(id: string) {
    const c = this.conversationById(id);
    const preview = previewMessage(c?.inboxPreview).replace(/^(bạn|you)\s*:\s*/i, "");
    return !preview || Boolean(c?.messages.slice(-5).some((m) => m.text && preview.includes(m.text.slice(0, 40))));
  }
  // Đã báo bật cửa sổ nhưng giao diện chưa gửi watch(): giữ trang live để cửa sổ dùng lại.
  private opening = new Set<string>();
  private popup(id: string) {
    this.opening.add(id);
    setTimeout(() => {
      if (this.opening.delete(id) && !this.watched.has(id)) this.browsers.unwatch(id);
    }, 10_000);
    this.events.incoming(id);
  }

  private resetSearch() {
    this.searchAbort?.abort();
    this.searchOpenAbort.abort();
    this.searchOpenAbort = new AbortController();
    this.searchHits.clear();
  }

  async searchContacts(query: string): Promise<ContactSearchResult> {
    this.searchAbort?.abort();
    this.searchHits.clear();
    const controller = this.searchAbort = new AbortController();
    const run = this.signInRun;
    query = query.trim();
    if (!query) return { ok: true, contacts: [] };
    if (query.length > 100 || this.stopped || this.session.phase !== "signedIn") return { ok: false, contacts: [], error: "Cần đăng nhập Messenger và nhập tên tối đa 100 ký tự." };
    try {
      const hits = await this.browsers.searchContacts(ACCOUNT, query, controller.signal);
      controller.signal.throwIfAborted();
      if (run !== this.signInRun || this.session.phase !== "signedIn") throw new Error("Phiên tìm kiếm đã thay đổi.");
      const contacts = hits.map(hit => {
        const id = `search:${randomUUID()}`;
        this.searchHits.set(id, { query, hit });
        return { id, searchResult: true, name: hit.name, avatar: hit.avatar, status: "offline" as const, unread: false };
      });
      return { ok: true, contacts };
    } catch (error) {
      return { ok: false, contacts: [], error: controller.signal.aborted ? "Tìm kiếm đã dừng." : error instanceof Error ? error.message : "Không tìm được liên hệ trên Messenger." };
    }
  }

  openSearchContact(id: string) {
    const existing = this.openingSearch.get(id);
    if (existing) return existing;
    const task = this.resolveSearchContact(id).finally(() => this.openingSearch.delete(id));
    this.openingSearch.set(id, task);
    return task;
  }
  private async resolveSearchContact(id: string): Promise<{ id?: string; error?: string }> {
    const saved = this.searchHits.get(id), run = this.signInRun, signal = this.searchOpenAbort.signal;
    if (!saved || this.stopped || this.session.phase !== "signedIn") return { error: "Kết quả tìm kiếm đã hết hạn. Hãy tìm lại liên hệ." };
    try {
      const thread = await this.browsers.resolveSearchContact(ACCOUNT, saved.query, saved.hit, signal);
      const contactId = await this.vault.mutate(state => {
        signal.throwIfAborted();
        if (run !== this.signInRun || this.stopped || this.session.phase !== "signedIn") throw new Error("Phiên đăng nhập đã thay đổi.");
        let c = state.conversations.find(c => c.accountId === ACCOUNT && c.platformId === thread.platformId);
        if (!c) {
          c = { ...thread, id: randomUUID(), accountId: ACCOUNT, initialized: false, messages: [], discoveredAt: Date.now() };
          state.conversations.push(c);
        } else {
          c.url = thread.url;
          c.name = thread.name;
          if (thread.avatar) c.avatar = thread.avatar;
        }
        return c.id;
      });
      signal.throwIfAborted();
      if (run !== this.signInRun) throw new Error("Phiên đăng nhập đã thay đổi.");
      this.events.contacts(this.contacts());
      return { id: contactId };
    } catch (error) { return { error: error instanceof Error ? error.message : "Không mở được liên hệ." }; }
  }

  openGroupMember(id: string, memberId: string): Promise<{ id?: string; error?: string }> {
    const key = `${id}:${memberId}`, existing = this.openingMembers.get(key);
    if (existing) return existing;
    const task = this.resolveGroupMember(id, memberId).finally(() => this.openingMembers.delete(key));
    this.openingMembers.set(key, task);
    return task;
  }
  private async resolveGroupMember(id: string, memberId: string): Promise<{ id?: string; error?: string }> {
    const c = this.conversationById(id), run = this.signInRun, signal = this.searchOpenAbort.signal;
    if (!c || c.kind !== "group" || !/^\d{1,30}$/.test(memberId) || this.stopped || this.session.phase !== "signedIn") return { error: "Thành viên nhóm không hợp lệ." };
    const check = () => {
      signal.throwIfAborted();
      if (run !== this.signInRun || this.stopped || this.session.phase !== "signedIn") throw new Error("Phiên Messenger đã thay đổi.");
    };
    try {
      const thread = await this.browsers.resolveGroupMember(c, memberId, signal);
      check();
      const contactId = await this.vault.mutate(state => {
        check();
        let saved = state.conversations.find(x => x.accountId === ACCOUNT && x.platformId === thread.platformId);
        if (saved?.kind === "group") throw new Error("Messenger chưa xác nhận được chat riêng.");
        if (!saved) {
          saved = { ...thread, id: randomUUID(), accountId: ACCOUNT, initialized: false, messages: [], discoveredAt: Date.now() };
          state.conversations.push(saved);
        } else Object.assign(saved, thread);
        return saved.id;
      });
      check(); this.events.contacts(this.contacts());
      return { id: contactId };
    } catch (error) { return { error: error instanceof Error ? error.message : "Không mở được chat riêng." }; }
  }

  // Người dùng cuộn buddy list xuống đáy. Gộp các lần gọi chồng nhau.
  loadMore() {
    if (this.session.phase !== "signedIn") return Promise.resolve({ ok: false, added: 0, error: "Cần đăng nhập Messenger." });
    const before = this.contacts().length;
    this.loadingMore ??= this.scan(true)
      .then(() => ({ ok: true, added: Math.max(0, this.contacts().length - before) }))
      .catch((error) => ({ ok: false, added: 0, error: error instanceof Error ? error.message : "Không tải được danh bạ." }))
      .finally(() => (this.loadingMore = null));
    return this.loadingMore;
  }

  loadHistory(id: string): Promise<LoadMoreResult> {
    const existing = this.histories.get(id);
    if (existing) return existing;
    const run = this.signInRun;
    const task = (async (): Promise<LoadMoreResult> => {
      if (this.stopped || this.session.phase !== "signedIn") return { ok: false, added: 0, error: "Cần đăng nhập Messenger." };
      await this.reads.get(id);
      if (run !== this.signInRun || this.stopped || this.session.phase !== "signedIn") return { ok: false, added: 0, error: "Phiên Messenger đã thay đổi." };
      const c = this.conversationById(id);
      if (!c) return { ok: false, added: 0, error: "Không tìm thấy hội thoại." };
      if (c.messages.length >= KEEP_MESSAGES) return { ok: false, added: 0, error: "Đã nạp giới hạn 5.000 tin trong hội thoại này." };
      try {
        const observed = await this.browsers.readHistory(c);
        if (run !== this.signInRun || this.stopped) return { ok: false, added: 0, error: "Phiên Messenger đã thay đổi." };
        const added = await this.vault.mutate(state => {
          const saved = state.conversations.find(x => x.id === id && x.accountId === ACCOUNT);
          if (saved) this.applyThreadInfo(saved);
          return saved ? ingestHistory(saved, observed) : 0;
        });
        const saved = this.conversationById(id);
        if (saved) this.events.conversation(id, this.view(saved));
        return { ok: true, added };
      } catch (error) {
        return { ok: false, added: 0, error: error instanceof Error ? error.message : "Không tải được lịch sử." };
      }
    })().finally(() => { if (this.histories.get(id) === task) this.histories.delete(id); });
    this.histories.set(id, task);
    return task;
  }

  private async refreshWatched() {
    // Đang gửi trên trang live thì không đọc chen vào (lần đọc có thể tải lại trang giữa lúc gửi).
    // Mỗi hội thoại một trang riêng → đọc song song, cửa sổ này chậm không kéo cửa sổ khác.
    await Promise.all(
      [...this.watched]
        .filter((id) => !this.sending.has(id) && !this.histories.has(id))
        .map(async (id) => {
          if (await this.read(id, "live")) this.markSeenIfWanted(id);
        }),
    );
  }
  private sending = new Set<string>();

  // Đọc tin của một hội thoại, gộp vào lịch sử, báo giao diện. "worker" mở trang tạm rồi đóng,
  // "live" giữ trang trên hội thoại (cửa sổ chat đang mở) và nhận cập nhật của chính Messenger.
  // Trả về false khi không đọc được tin. Gộp các lần đọc chồng nhau trên cùng hội thoại (vòng live, watch,
  // kiểm tra inbox, sau khi gửi) để không chạy hai lượt tải/ đọc song song trên một trang.
  private reads = new Map<string, Promise<boolean>>();
  private read(id: string, mode: "worker" | "live"): Promise<boolean> {
    let task = this.reads.get(id);
    if (!task) {
      task = this.readOnce(id, mode).finally(() => this.reads.delete(id));
      this.reads.set(id, task);
    }
    return task;
  }
  private async readOnce(id: string, mode: "worker" | "live"): Promise<boolean> {
    const run = this.signInRun;
    const c = this.conversationById(id);
    if (!c) return false;
    let observed: Omit<Message, "baseline">[];
    const started = Date.now();
    try {
      observed = mode === "live" && c.initialized ? await this.browsers.readLiveConversation(c) : await this.browsers.readConversation(c);
    } catch (error) {
      if (run !== this.signInRun || this.stopped) return false;
      const message = error instanceof Error ? error.message : String(error);
      const repeated = this.errors.get(id) === message;
      this.errors.set(id, message);
      if (!repeated) log(`đọc hội thoại thất bại: ${message.slice(0, 120)}`);
      if (this.watched.has(id) && !repeated) this.events.conversation(id, this.view(this.conversationById(id)!));
      return false;
    }
    const recovered = this.errors.delete(id);
    if (run !== this.signInRun || this.stopped) return false;
    const { changed, arrived } = await this.vault.mutate((state) => {
      const saved = state.conversations.find((x) => x.id === id && x.accountId === ACCOUNT);
      if (!saved || run !== this.signInRun || this.stopped) return { changed: false, arrived: false };
      const before = JSON.stringify([saved.messages, saved.kind, saved.group]);
      const known = new Set(saved.messages.map((m) => m.id));
      const upgrading = saved.groupIdentityVersion !== 1;
      this.applyThreadInfo(saved);
      ingestLatest(saved, observed);
      if (saved.messages.length > KEEP_MESSAGES) saved.messages = saved.messages.slice(-KEEP_MESSAGES);
      return { changed: JSON.stringify([saved.messages, saved.kind, saved.group]) !== before, arrived: !(upgrading && saved.kind === "group") && arrivedWhileOnline(saved.messages, known, this.onlineSince) };
    });
    if (run !== this.signInRun || this.stopped) return false;
    const last = observed.at(-1);
    if (changed) log(`đọc "${c.name}" (${mode}${this.watched.has(id) ? ", đang mở" : ""}) ${Date.now() - started}ms: ${observed.length} tin, ${changed ? "CÓ thay đổi" : "không đổi"}, tin cuối ${last ? `${last.direction} ${last.timestamp ? new Date(last.timestamp).toISOString().slice(11, 16) : "không rõ giờ"}` : "-"}, arrived=${arrived}`);
    // Chỉ gửi giao diện khi tin thật sự đổi (vòng live 1s, mỗi lần gửi tới 500 tin qua IPC tới mọi cửa sổ).
    if (changed || recovered) this.events.conversation(id, this.view(this.conversationById(id)!));
    if (changed && this.conversationById(id)?.kind !== c.kind) this.events.contacts(this.contacts());
    // Đang online + có tin đến mới + chưa mở cửa sổ với người này → bật cửa sổ (như Y!M).
    if (arrived && !this.watched.has(id)) {
      log("bật cửa sổ: có tin đến mới");
      this.popup(id);
    }
    return true;
  }

  private conversationById(id: string): Conversation | undefined {
    return this.vault.read().conversations.find((c) => c.id === id && c.accountId === ACCOUNT);
  }
  private applyThreadInfo(c: Conversation) {
    const info = this.browsers.threadInfo(c);
    if (!info) return;
    c.kind = info.kind;
    if (info.kind === "group" && info.group && JSON.stringify({ ...c.group, updatedAt: 0 }) !== JSON.stringify({ ...info.group, updatedAt: 0 })) c.group = info.group;
  }
  async groupMembers(id: string, cursor?: string): Promise<GroupMembersResult> {
    const run = this.signInRun;
    if (this.stopped || this.session.phase !== "signedIn") return { ok: false, error: "Cần đăng nhập Messenger." };
    const c = this.conversationById(id);
    if (!c || (cursor && !/^\d+$/.test(cursor))) return { ok: false, error: "Danh sách thành viên không hợp lệ." };
    try {
      const page = await this.browsers.readGroupMembers(c, cursor);
      if (run !== this.signInRun || this.stopped || this.session.phase !== "signedIn") throw new Error("Phiên Messenger đã thay đổi.");
      const group = await this.vault.mutate(state => {
        if (run !== this.signInRun || this.stopped || this.session.phase !== "signedIn") throw new Error("Phiên Messenger đã thay đổi.");
        const saved = state.conversations.find(x => x.id === id && x.accountId === ACCOUNT);
        if (!saved) throw new Error("Hội thoại không tồn tại.");
        if (cursor) return page;
        saved.kind = "group";
        saved.group = page;
        return saved.group;
      });
      if (run !== this.signInRun || this.stopped) throw new Error("Phiên Messenger đã thay đổi.");
      const saved = this.conversationById(id);
      if (saved) this.events.conversation(id, this.view(saved));
      this.events.contacts(this.contacts());
      return { ok: true, group };
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Không đọc được thành viên nhóm." }; }
  }

  private contactView(c: Conversation): ContactView {
    return {
      id: c.id,
      name: c.name,
      kind: c.kind,
      memberCount: c.group?.memberCount,
      // Messenger chỉ cho biết "đang hoạt động"; không có thì xem như offline (không đoán).
      status: c.active ? "online" : "offline",
      avatar: c.avatar,
      preview: c.inboxPreview,
      unread: Boolean(c.inboxUnread),
    };
  }
  private view(c: Conversation): ConversationView {
    return { contact: this.contactView(c), messages: c.messages, group: c.group, error: this.errors.get(c.id) };
  }

  contacts(): ContactView[] {
    const state = this.vault.read();
    const order = state.accounts.find((a) => a.id === ACCOUNT)?.inboxOrder ?? [];
    return state.conversations
      .filter((c) => c.accountId === ACCOUNT)
      .sort((a, b) => {
        const ia = order.indexOf(a.platformId),
          ib = order.indexOf(b.platformId);
        return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib);
      })
      .map((c) => this.contactView(c));
  }

  conversation(id: string): ConversationView | null {
    const c = this.conversationById(id);
    return c ? this.view(c) : null;
  }

  // Cửa sổ chat báo những người đang hiển thị. Người mới mở → đọc ngay (lần đầu nạp ~100 tin gần nhất).
  watch(ids: string[], sender: number) {
    const next = new Set(ids);
    const mine = this.watchers.get(sender) ?? new Set<string>();
    this.watchers.set(sender, next);
    const all = new Set([...this.watchers.values()].flatMap((s) => [...s]));
    for (const id of mine) if (!all.has(id)) this.browsers.unwatch(id);
    const added = ids.filter((id) => !this.watched.has(id));
    this.watched = all;
    for (const id of added) {
      this.opening.delete(id);
      void this.read(id, this.conversationById(id)?.initialized ? "live" : "worker");
    }
  }
  private watchers = new Map<number, Set<string>>();

  // Facebook chỉ đánh dấu "đã xem" khi trang hội thoại có focus; trang live của Buzz chạy ẩn nên phải báo riêng.
  // Chỉ khi Messenger còn báo chưa đọc (khỏi gửi lặp mỗi lần cửa sổ được focus).
  // Giao diện báo lúc vừa mở tab (trước cả watch(), trang live còn đang tải) → ghi nhớ rồi làm sau lượt đọc live
  // thành công kế tiếp. Giữ 15s để kịp lượt quét inbox cập nhật "chưa đọc" khi tin vừa tới lúc đang nhìn.
  private seenWanted = new Map<string, number>();
  seen(id: string) {
    this.seenWanted.set(id, Date.now());
  }
  private markSeenIfWanted(id: string) {
    const at = this.seenWanted.get(id);
    if (at === undefined) return;
    if (Date.now() - at > 15_000) return void this.seenWanted.delete(id);
    const c = this.conversationById(id);
    if (!c?.inboxUnread) return;
    this.seenWanted.delete(id);
    void this.browsers
      .markSeen(c)
      .then((state) => log(`đánh dấu đã xem "${c.name}": ${JSON.stringify(state)}`))
      .catch((error) => log(`đánh dấu đã xem thất bại: ${error instanceof Error ? error.message : error}`));
  }

  // Ảnh/ âm thanh của một tin: lấy qua trang Messenger ẩn (nguồn blob: hoặc cần phiên đăng nhập). Có cache nhỏ.
  private media = new Map<string, Promise<MediaPayload>>();
  attachment(id: string, messageId: string, attachmentId: string): Promise<MediaPayload | { error: string }> {
    const c = this.conversationById(id);
    if (!c) return Promise.resolve({ error: "not-found" });
    const key = `${id}|${messageId}|${attachmentId}`;
    let task = this.media.get(key);
    if (!task) {
      task = this.browsers.readAttachment(c, messageId, attachmentId);
      task.catch(() => this.media.delete(key));
      this.media.set(key, task);
      // ponytail: giữ 40 tệp gần nhất trong RAM; cần nhiều hơn thì lưu đĩa có mã hóa.
      if (this.media.size > 40) this.media.delete(this.media.keys().next().value!);
    }
    return task.catch((error) => ({ error: error instanceof Error ? error.message : String(error) }));
  }

  async sendFiles(id: string, files: { path: string; name: string; image: boolean }[], text: string) {
    const c = this.conversationById(id), run = this.signInRun, attempt = { started: false };
    if (!c || this.session.phase !== "signedIn" || this.stopped) return { ok: false, attempted: false, error: "Cần đăng nhập đúng hội thoại." };
    if (this.sending.has(id)) return { ok: false, attempted: false, error: "Đang gửi tin khác. Hãy chờ hoàn tất." };
    this.sending.add(id);
    const deadline = Date.now() + 120_000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let expired = false;
    try {
      await Promise.race([
        this.browsers.sendFiles(c, files, text, () => !expired && !this.stopped && run === this.signInRun && Date.now() < deadline, attempt),
        new Promise((_, reject) => { timer = setTimeout(() => { expired = true; reject(new Error("Quá thời gian gửi tệp. Kiểm tra Messenger trước khi thử lại.")); }, 120_000); }),
      ]);
      this.sending.delete(id);
      await this.read(id, "live");
      return { ok: true, attempted: attempt.started };
    } catch (error) {
      return { ok: false, attempted: attempt.started, error: error instanceof Error ? error.message : "Không gửi được tệp." };
    } finally { if (timer) clearTimeout(timer); this.sending.delete(id); }
  }

  async send(id: string, text: string): Promise<{ ok: boolean; error?: string }> {
    const c = this.conversationById(id);
    if (!c) return { ok: false, error: "not-found" };
    this.sending.add(id);
    try {
      // contextBound=false: người dùng tự gõ nên không cần khóa theo tin cuối như khi AI soạn.
      // ponytail: giới hạn 60s để giao diện không treo; quá hạn thì báo lỗi (Messenger có thể vẫn đã nhận tin).
      await Promise.race([
        this.browsers.send(c, undefined, text, latestId(c), () => !this.stopped, false),
        new Promise((_, reject) => setTimeout(() => reject(new Error(SEND_TIMEOUT)), 60_000)),
      ]);
      this.sending.delete(id);
      await this.read(id, "live");
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      this.sending.delete(id);
    }
  }
}
