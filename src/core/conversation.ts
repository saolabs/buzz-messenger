import { randomUUID } from "node:crypto";
import type { Conversation, InboxScan, Message, State } from "./types.ts";
import { canonicalMessageId, reconcileMessageIdentities } from "./message-identity.ts";
import { sameSender } from "./groups.ts";

// Gộp tin vừa đọc từ DOM vào lịch sử (thuật toán của master-chat, bỏ phần hàng đợi AI).
// Trả về các tin mới (chưa từng thấy) để báo âm/ bật cửa sổ.
export function ingest(conversation: Conversation, observed: Omit<Message, "baseline">[]): Message[] {
  const groupUpgrade = conversation.kind === "group" && conversation.groupIdentityVersion !== 1;
  if (groupUpgrade && conversation.messages.length) conversation.groupRepairBackup ??= { createdAt: Date.now(), messages: structuredClone(conversation.messages) };
  observed = reconcileMessageIdentities(conversation, observed);
  observed = alignBySequence(conversation, observed);
  const ids = new Set(conversation.messages.map((m) => m.id));
  for (const raw of observed) {
    const saved = conversation.messages.find((m) => m.id === raw.id);
    if (!saved) continue;
    saved.text = raw.text;
    const keepFullName = !saved.sender?.id && !raw.sender?.id && saved.sender && raw.sender && saved.sender.name.length >= raw.sender.name.length && shortNameOf(raw.sender.name, saved.sender.name);
    if (raw.sender && !keepFullName && !(saved.sender?.id && !raw.sender.id && (raw.direction === "outgoing" || sameSender(saved.sender, raw.sender)))) saved.sender = raw.sender;
    // ID tạm toàn chữ số (tin vừa gửi) không được ghi đè ID thật "mid.$…" đã lưu.
    if (raw.platformMessageId && !(/^\d+$/.test(raw.platformMessageId) && saved.platformMessageId && !/^\d+$/.test(saved.platformMessageId))) saved.platformMessageId = raw.platformMessageId;
    if (raw.aliasIds?.length) saved.aliasIds = raw.aliasIds;
    if (raw.timestamp !== null && (saved.timestamp === null || (raw.platformMessageId && raw.precision === "exact" && saved.precision !== "exact"))) {
      saved.timestamp = raw.timestamp;
      saved.precision = raw.precision;
    }
    // Lần đọc mới là nguồn đúng: bỏ tệp cũ nếu không còn (vd avatar người thả cảm xúc từng bị nhận nhầm là ảnh).
    if (raw.attachments?.length) saved.attachments = raw.attachments;
    else delete saved.attachments;
  }
  const initial = !conversation.initialized || groupUpgrade;
  const fresh = observed.filter((m) => !ids.has(m.id) && (ids.add(m.id), true)).map((m) => ({ ...m, baseline: initial }));
  conversation.messages.push(...fresh);
  // Bộ đọc giữ thứ tự dòng thời gian; tin chưa rõ giờ không được nhảy ra sau tin mới nhất.
  {
    // Lần đọc chồng lấn: neo tin cũ vừa lộ ra vào trước tin mới hơn đã biết.
    const ordered = [...new Set(observed.map((m) => m.id))];
    const freshIds = new Set(fresh.map((m) => m.id));
    for (let n = 0; n < ordered.length; n++) {
      if (!freshIds.has(ordered[n])) continue;
      const next = ordered.slice(n + 1).find((id) => !freshIds.has(id));
      const previous = n > 0 ? ordered[n - 1] : undefined;
      if (!next && !previous) continue;
      const from = conversation.messages.findIndex((m) => m.id === ordered[n]);
      const [message] = conversation.messages.splice(from, 1);
      const anchor = conversation.messages.findIndex((m) => m.id === (next ?? previous));
      conversation.messages.splice(anchor + (next ? 0 : 1), 0, message);
    }
    for (let n = ordered.length - 2; n >= 0; n--) {
      const from = conversation.messages.findIndex((m) => m.id === ordered[n]);
      const before = conversation.messages.findIndex((m) => m.id === ordered[n + 1]);
      if (from > before && before >= 0) {
        const [message] = conversation.messages.splice(from, 1);
        conversation.messages.splice(before, 0, message);
      }
    }
  }
  // Stable sorting must start from DOM chronology: a whole group can share one
  // minute, including a saved row whose previously unknown timestamp just arrived.
  if (conversation.messages.every((m) => m.timestamp !== null)) conversation.messages.sort((a, b) => a.timestamp! - b.timestamp!);
  conversation.initialized = true;
  if (conversation.kind === "group") conversation.groupIdentityVersion = 1;
  return initial ? [] : fresh;
}

export const latestId = (c: Conversation) => c.messages.at(-1)?.id ?? null;

// Tin không có ID máy chủ mang ID suy từ nội dung + giờ; giờ lúc đọc được lúc không ("Thứ bảy 3:53sáng",
// "1 phút trước"…) nên cùng một tin đổi ID giữa các lượt đọc → bị thêm lại cả khối, sai thứ tự. Lượt đọc là một
// đoạn liên tục của dòng thời gian: khớp ≥ MIN_RUN tin liên tiếp (chiều + nội dung) với đoạn đã lưu thì đó là
// cùng các tin → dùng lại ID đã lưu. Không đụng tin có ID máy chủ khác nhau.
const MIN_RUN = 3;
function alignBySequence(c: Conversation, observed: Omit<Message, "baseline">[]): Omit<Message, "baseline">[] {
  const known = new Set(c.messages.flatMap((m) => [m.id, ...(m.aliasIds ?? [])]));
  if (!observed.some((m) => !m.platformMessageId && !known.has(m.id))) return observed;
  const key = (m: Pick<Message, "direction" | "text">) => `${m.direction}\u0000${m.text.normalize("NFC")}`;
  const saved = c.messages.map(key),
    seen = observed.map(key);
  let best = { at: -1, length: 0 };
  for (let at = 0; at < saved.length; at++) {
    const length = Math.min(saved.length - at, seen.length);
    if (length < MIN_RUN || length <= best.length) continue;
    let same = true;
    for (let i = 0; same && i < length; i++) same = saved[at + i] === seen[i];
    if (same) best = { at, length };
  }
  if (best.at < 0) return observed;
  return observed.map((raw, i) => {
    const old = i < best.length ? c.messages[best.at + i] : undefined;
    if (!old || old.id === raw.id || old.aliasIds?.includes(raw.id)) return raw;
    if (raw.platformMessageId && old.platformMessageId && raw.platformMessageId !== old.platformMessageId) return raw;
    old.aliasIds = [...new Set([...(old.aliasIds ?? []), raw.id])];
    return { ...raw, id: old.id };
  });
}

// A live snapshot is taken at the bottom of Messenger's timeline. A verified
// API timestamp on its final row anchors that window after older cached rows,
// including fingerprint aliases left over from changing date labels. Keep all
// cached data, and preserve positively dated newer rows if the page is stale.
export function ingestLatest(conversation: Conversation, observed: Omit<Message, "baseline">[]): Message[] {
  const fresh = ingest(conversation, observed);
  const last = observed.at(-1);
  if (!last?.platformMessageId || last.precision !== "exact" || last.timestamp === null) return fresh;
  const ordered = [...new Set(observed.map(m => canonicalMessageId(conversation, m)))];
  const current = new Map(conversation.messages.map(m => [m.id, m]));
  const seen = new Set(ordered);
  const undated: Message[] = [];
  const merged = ordered.map(id => current.get(id)!);
  for (const message of conversation.messages) {
    if (seen.has(message.id)) continue;
    if (message.timestamp === null) undated.push(message);
    else {
      const before = merged.findIndex(m => m.timestamp !== null && m.timestamp > message.timestamp!);
      merged.splice(before < 0 ? merged.length : before, 0, message);
    }
  }
  conversation.messages = [...undated, ...merged];
  return fresh;
}

// Backfilled rows are history, even when Messenger provides no absolute date.
export function ingestHistory(conversation: Conversation, observed: Omit<Message, "baseline">[]): number {
  const known = new Set(conversation.messages.map(m => m.id));
  ingest(conversation, observed);
  let added = 0;
  for (const message of conversation.messages) if (!known.has(message.id)) {
    message.baseline = true;
    added++;
  }
  return added;
}

// Có tin đến "mới thật" không: tin chưa từng lưu, chiều đến, giờ gửi (theo Messenger) từ lúc đăng nhập trở đi.
// Giờ chỉ chính xác tới phút nên so với đầu phút đăng nhập.
export function arrivedWhileOnline(messages: Message[], knownIds: Set<string>, onlineSince: number) {
  if (!onlineSince) return false;
  const from = Math.floor(onlineSince / 60_000) * 60_000;
  if (messages.some((m) => !knownIds.has(m.id) && m.direction === "incoming" && m.timestamp !== null && m.timestamp >= from)) return true;
  // Tin vừa tới thường chưa có giờ trong DOM (Messenger chỉ ghi giờ cho cả cụm tin): tin cuối cùng, chiều đến, chưa từng
  // thấy thì là tin mới. Chỉ xét tin cuối để tin cũ lộ ra khi cuộn lịch sử không bật cửa sổ.
  // Trong số tin chưa thấy có tin cũ hơn lúc đăng nhập → đây là đợt nạp lịch sử, không phải tin vừa tới.
  if (messages.some((m) => !knownIds.has(m.id) && m.timestamp !== null && m.timestamp < from)) return false;
  const last = messages.at(-1);
  return Boolean(knownIds.size && last && !knownIds.has(last.id) && last.direction === "incoming" && last.timestamp === null);
}

// Messenger hiện tên người lúc ngắn lúc đầy đủ, đổi qua lại giữa các lần tải ("Anh Tuấn" ↔ "Hoàng Anh Tuấn").
// Tên ngắn là phần đuôi (các chữ cuối) của tên đầy đủ.
export function shortNameOf(short: string, full: string) {
  const words = (s: string) => s.normalize("NFC").trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const a = words(short),
    b = words(full);
  return a.length > 0 && a.length <= b.length && a.every((w, i) => w === b[b.length - a.length + i]);
}

// Nội dung tin trong dòng xem trước: bỏ các đoạn đuôi "· 5 phút", "· 18 thg 10", "· Trả lời?", "· Trao đổi thêm?".
export const previewMessage = (preview?: string) => {
  const parts = (preview ?? "").split(/\s+·\s+|\s*·\s*$|^\s*·\s*/u);
  while (parts.length > 1 && /^(\d[^·]{0,14}|vừa xong|just now|[^·]{1,24}\?)?$/iu.test(parts.at(-1)!.trim())) parts.pop();
  return parts.join(" · ").trim();
};
// Hai dòng xem trước chỉ khác ở tên người đầu dòng (ngắn ↔ đầy đủ): "Anh Tuấn đã gửi…" ~ "Hoàng Anh Tuấn đã gửi…".
function samePreview(a: string, b: string, name: string) {
  if (a === b) return true;
  const [long, short] = a.length > b.length ? [a, b] : [b, a];
  const extra = long.slice(0, long.length - short.length).trim();
  return long.endsWith(short) && Boolean(extra) && name.normalize("NFC").toLocaleLowerCase().startsWith(extra.normalize("NFC").toLocaleLowerCase());
}
// Dòng hệ thống của mã hóa đầu cuối: Messenger đổi qua lại giữa hai câu này khi đang khôi phục lịch sử → không phải tin.
const E2EE_PLACEHOLDER = /mã hóa đầu cuối|không khôi phục được tin nhắn|end-to-end encrypt|restore messages/i;
// Nội dung xem trước dùng để so sánh; rỗng = chưa biết (dòng chưa vẽ xong, chỉ có giờ, hay dòng hệ thống).
const realPreview = (preview?: string) => {
  const text = previewMessage(preview);
  return E2EE_PLACEHOLDER.test(text) ? "" : text;
};

// Cập nhật danh sách hội thoại từ một lượt quét inbox.
// changed: cần đọc lại tin — nội dung xem trước đổi thật (không tính thời gian "· 5 phút") hoặc vừa chuyển sang chưa đọc.
// (Không dùng chữ ký của cả dòng inbox: dòng này đổi liên tục nên mỗi lượt quét đọc lại hàng loạt hội thoại.)
// hinted: riêng phần nội dung xem trước đổi (dùng khi đọc tin thất bại).
export function reconcileInbox(state: State, accountId: string, scan: InboxScan): { changed: string[]; hinted: string[] } {
  const account = state.accounts.find((a) => a.id === accountId);
  if (!account) throw new Error("Tài khoản không tồn tại.");
  const changed: string[] = [];
  const hinted: string[] = [];
  for (const thread of scan.threads) {
    let c = state.conversations.find((c) => c.accountId === accountId && c.platformId === thread.platformId);
    if (!c) {
      c = {
        id: randomUUID(),
        accountId,
        platformId: thread.platformId,
        name: thread.name,
        url: thread.url,
        messages: [],
        initialized: false,
        discoveredAt: scan.scannedAt,
      };
      state.conversations.push(c);
    } else {
      c.url = thread.url;
      if (thread.name) c.name = thread.name;
      // Preview chưa biết (xem realPreview) không phải tin mới; không thì mỗi lượt quét đọc lại cả loạt hội thoại.
      const previewChanged = Boolean(realPreview(thread.preview)) && !samePreview(realPreview(c.inboxPreview), realPreview(thread.preview), thread.name || c.name);
      if (previewChanged || (thread.unread && !c.inboxUnread)) changed.push(c.id);
      if (previewChanged) hinted.push(c.id);
    }
    c.lastInboxSignature = thread.signature;
    if (realPreview(thread.preview) || !c.inboxPreview) c.inboxPreview = thread.preview;
    c.inboxUnread = thread.unread;
    if (thread.avatar) c.avatar = thread.avatar;
    c.active = thread.active ?? null;
  }
  const seen = scan.threads.map((t) => t.platformId);
  account.inboxOrder = [...seen, ...(account.inboxOrder ?? []).filter((id) => !seen.includes(id))];
  account.inboxInitialized = true;
  return { changed, hinted };
}
