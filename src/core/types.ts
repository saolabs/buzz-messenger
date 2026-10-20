// Kiểu dữ liệu Messenger lấy từ master-chat (bộ đọc DOM, vault) + kiểu cho giao diện Y!M.
export type Platform = "messenger-personal";

export type Account = {
  id: string;
  name: string;
  platform: Platform;
  username: string;
  password: string;
  recoveryPin?: string;
  autoRestorePin?: boolean;
  pinAutoFillBlocked?: boolean;
  pinRestorePending?: boolean;
  cookies: unknown[];
  facebookUserId?: string;
  inboxInitialized?: boolean;
  inboxOrder?: string[];
  // Y!M: "Remember my ID & password" / "Sign in automatically"
  remember?: boolean;
  autoSignIn?: boolean;
  // Tên hiển thị do người dùng tự đặt (như Y!M) — ưu tiên hơn tên Facebook
  displayName?: string;
  // Họ tên + avatar Facebook đọc từ cột trái trang chủ
  facebookName?: string;
  avatar?: string;
};

export type Attachment = {
  id: string;
  kind: "image" | "audio";
  // Sticker của Messenger (role=img ảnh nền) — hiện nhỏ hơn ảnh thường
  sticker?: boolean;
  source?: string;
  label?: string;
  analysis?: string;
  error?: string;
  analyzedAt?: number;
};

export type Message = {
  id: string;
  text: string;
  direction: "incoming" | "outgoing" | "system";
  timestamp: number | null;
  observedAt: number;
  baseline: boolean;
  identity?: "platform" | "fingerprint";
  precision?: "exact" | "minute";
  attachments?: Attachment[];
};

export type Conversation = {
  id: string;
  accountId: string;
  platformId: string;
  name: string;
  url: string;
  messages: Message[];
  initialized: boolean;
  discoveredAt?: number;
  lastInboxSignature?: string;
  inboxPreview?: string;
  inboxUnread?: boolean;
  avatar?: string;
  active?: boolean | null;
};

export type DOMProfile = {
  version: 1;
  platform: Platform;
  verified: boolean;
  threadSelector: string;
  threadIdAttribute: string;
  messageSelector: string;
  messageIdAttribute: string;
  textSelector: string;
  directionAttribute: string;
  incomingValue: string;
  outgoingValue: string;
  timestampAttribute: string;
  composerSelector: string;
  sendSelector: string;
  listSelector: string;
  linkSelector: string;
};

export type State = {
  version: 1;
  accounts: Account[];
  conversations: Conversation[];
};
export const emptyState = (): State => ({ version: 1, accounts: [], conversations: [] });

export type BrowserTab = {
  id: string;
  accountId: string;
  title: string;
  url: string;
  detached: boolean;
  status: string;
};

export type InboxThread = {
  platformId: string;
  name: string;
  url: string;
  unread: boolean;
  signature: string;
  preview?: string;
  avatar?: string;
  // Chấm xanh "đang hoạt động" trên avatar; null khi giao diện không cho biết.
  active?: boolean | null;
};

export type InboxScan = {
  threads: InboxThread[];
  scannedAt: number;
  coverage: "partial" | "visible";
  revision: number;
};

// ---- giao diện ----
export type Status = "online" | "busy" | "idle" | "offline";

export type ContactView = {
  id: string;
  name: string;
  status: Status;
  avatar?: string;
  preview?: string;
  unread: boolean;
};

export type SessionView = {
  phase: "signedOut" | "signingIn" | "signedIn";
  username: string;
  remember: boolean;
  autoSignIn: boolean;
  displayName?: string;
  avatar?: string;
  // ID Facebook của mình — để nhận ra mình trong thông báo hệ thống ($PARTICIPANT_FIRST_NAME(id))
  userId?: string;
  // Đã lưu PIN Messenger chưa (không bao giờ gửi chính mã PIN ra giao diện)
  hasPin: boolean;
  autoPin: boolean;
  // Trạng thái/ lỗi đăng nhập để hiện trên màn hình đăng nhập
  status?: string;
  error?: string;
};

export type SignIn = { username: string; password: string; remember: boolean; autoSignIn: boolean };

export type ConversationView = { contact: ContactView; messages: Message[]; error?: string };

export type Settings = { skin: string; lang: "vi" | "en"; zoom: number; textSize: number; tabbed: boolean };
export const ZOOMS = [1, 1.25, 1.5, 1.75, 2];
// Cỡ chữ (nhân thêm trên zoom): nhỏ / vừa / lớn / rất lớn.
export const TEXT_SIZES = [0.85, 0.92, 1, 1.1];

export type Bridge = {
  platform: string;
  minimize(): void;
  maximize(): void;
  close(): void;
  buzz(): void;
  openIm(contactId: string): void;
  detachIm(contactId: string): void;
  onImOpen(cb: (contactId: string, focus: boolean) => void): () => void;
  getSettings(): Promise<Settings & { skins: string[] }>;
  setSettings(patch: Partial<Settings>): void;
  onSettings(cb: (settings: Settings) => void): () => void;
  // Messenger thật
  session(): Promise<SessionView>;
  onSession(cb: (s: SessionView) => void): () => void;
  signIn(input: SignIn): void;
  signOut(): void;
  cancelSignIn(): void;
  showMessenger(): void;
  // pin: 6 số = lưu mới, "" = xóa, null = giữ PIN cũ và chỉ đổi lựa chọn tự nhập
  setPin(pin: string | null, auto: boolean): Promise<{ ok: boolean }>;
  setDisplayName(name: string): void;
  contacts(): Promise<ContactView[]>;
  // Buddy list cuộn tới đáy → quét inbox sâu hơn để hiện thêm người.
  loadMore(): Promise<void>;
  // Ảnh/ âm thanh trong tin (base64) — dùng khi nguồn không tải trực tiếp được.
  attachment(contactId: string, messageId: string, attachmentId: string): Promise<{ kind: "image" | "audio"; mimeType: string; data: string } | { error: string }>;
  openProfile(): void;
  // Mở đúng hội thoại trong một cửa sổ Messenger thật (gọi điện, thả cảm xúc… mà app chưa có)
  openInMessenger(contactId: string): void;
  onContacts(cb: (c: ContactView[]) => void): () => void;
  // Cửa sổ chat báo đang hiển thị những người nào để main đọc tin định kỳ.
  watch(contactIds: string[]): void;
  // Người dùng đang nhìn hội thoại (cửa sổ chat có focus, đúng tab) → đánh dấu đã xem trên Messenger.
  seen(contactId: string): void;
  conversation(contactId: string): Promise<ConversationView | null>;
  onConversation(cb: (contactId: string, view: ConversationView) => void): () => void;
  send(contactId: string, text: string): Promise<{ ok: boolean; error?: string }>;
};

declare global {
  interface Window {
    ym: Bridge;
  }
}
