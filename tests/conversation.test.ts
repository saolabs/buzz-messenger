import test from "node:test";
import assert from "node:assert/strict";
import { arrivedWhileOnline, ingest, latestId, reconcileInbox } from "../src/core/conversation.ts";
import { emptyState, type InboxScan, type Message } from "../src/core/types.ts";

const scan = (threads: Partial<InboxScan["threads"][number]>[]): InboxScan => ({
  scannedAt: 1,
  coverage: "visible",
  revision: 1,
  threads: threads.map((t, i) => ({ platformId: String(i), name: `N${i}`, url: `https://www.facebook.com/messages/t/${i}/`, unread: false, signature: "s", ...t })),
});
const state = () => {
  const s = emptyState();
  s.accounts.push({ id: "fb", name: "x", platform: "messenger-personal", username: "x", password: "", cookies: [] });
  return s;
};
const msg = (id: string, direction: Message["direction"] = "incoming", timestamp: number | null = null) => ({ id, text: id, direction, timestamp, observedAt: 0 });

test("inbox tạo hội thoại mới, chỉ báo thay đổi khi chữ hiển thị đổi, giữ thứ tự inbox", () => {
  const s = state();
  assert.deepEqual(reconcileInbox(s, "fb", scan([{ platformId: "a" }, { platformId: "b" }])).changed, []);
  assert.equal(s.conversations.length, 2);
  const { changed } = reconcileInbox(s, "fb", scan([{ platformId: "b", signature: "new", preview: "tin mới", avatar: "https://x.fbcdn.net/b.jpg", active: true }, { platformId: "a" }]));
  const b = s.conversations.find((c) => c.platformId === "b")!;
  assert.deepEqual(changed, [b.id]);
  assert.equal(b.avatar, "https://x.fbcdn.net/b.jpg");
  assert.equal(b.active, true);
  assert.deepEqual(s.accounts[0].inboxOrder, ["b", "a"]);
});

test("lần đọc đầu là lịch sử (không báo tin mới); lần sau chỉ trả tin chưa thấy", () => {
  const s = state();
  reconcileInbox(s, "fb", scan([{ platformId: "a" }]));
  const c = s.conversations[0];
  assert.deepEqual(ingest(c, [msg("1"), msg("2", "outgoing")]), []);
  assert.deepEqual(ingest(c, [msg("2", "outgoing"), msg("3")]).map((m) => m.id), ["3"]);
  assert.equal(latestId(c), "3");
});

test("tin cũ lộ ra khi cuộn được chèn trước tin mới hơn, không nhảy xuống cuối", () => {
  const s = state();
  reconcileInbox(s, "fb", scan([{ platformId: "a" }]));
  const c = s.conversations[0];
  ingest(c, [msg("2"), msg("3")]);
  ingest(c, [msg("1"), msg("2"), msg("3")]);
  assert.deepEqual(c.messages.map((m) => m.id), ["1", "2", "3"]);
});

test("lần đọc sau không còn tệp đính kèm thì bỏ tệp cũ", () => {
  const s = state();
  reconcileInbox(s, "fb", scan([{ platformId: "a" }]));
  const c = s.conversations[0];
  ingest(c, [{ ...msg("1"), attachments: [{ id: "x", kind: "image" as const }] }]);
  ingest(c, [msg("1")]);
  assert.equal(c.messages[0].attachments, undefined);
});

test("chỉ tin đến chưa từng thấy, có giờ gửi từ lúc đăng nhập, mới bật cửa sổ", () => {
  const online = new Date(2026, 9, 20, 22, 15, 40).getTime();
  const at = (h: number, m: number) => new Date(2026, 9, 20, h, m).getTime();
  const m = (id: string, ts: number | null, direction: Message["direction"] = "incoming") => ({ ...msg(id, direction, ts), baseline: false });
  const known = new Set(["old"]);
  // tin cũ (kể cả lần đầu mở hội thoại), tin của mình, tin không rõ giờ: không bật
  assert.equal(arrivedWhileOnline([m("a", at(21, 0)), m("b", at(22, 20), "outgoing"), m("c", null)], known, online), false);
  // tin đã lưu từ trước: không bật
  assert.equal(arrivedWhileOnline([{ ...m("old", at(22, 30)) }], known, online), false);
  // tin đến trong cùng phút đăng nhập (giờ chỉ chính xác tới phút) hoặc sau đó: bật
  assert.equal(arrivedWhileOnline([m("d", at(22, 15))], known, online), true);
  // tin cuối vừa tới chưa có giờ (Messenger ghi giờ theo cụm): bật; nằm giữa hay lần đầu mở hội thoại: không
  assert.equal(arrivedWhileOnline([m("old", at(22, 0)), m("f", null)], known, online), true);
  assert.equal(arrivedWhileOnline([m("f", null), m("old", at(22, 0))], known, online), false);
  assert.equal(arrivedWhileOnline([m("f", null)], new Set(), online), false);
  // chưa đăng nhập: không bật
  assert.equal(arrivedWhileOnline([m("e", at(22, 30))], known, 0), false);
});

test("thời gian tương đối ở cuối dòng xem trước đổi không tính là nội dung đổi", () => {
  const s = state();
  reconcileInbox(s, "fb", scan([{ platformId: "a", preview: "Hẹn mai nhé · 5 phút" }]));
  let r = reconcileInbox(s, "fb", scan([{ platformId: "a", preview: "Hẹn mai nhé · 6 phút", signature: "s2" }]));
  assert.deepEqual(r.changed, [], "chỉ thời gian đổi thì không đọc lại");
  assert.deepEqual(r.hinted, []);
  r = reconcileInbox(s, "fb", scan([{ platformId: "a", preview: "Hẹn mai nhé · 6 phút", unread: true }]));
  assert.equal(r.changed.length, 1, "chuyển sang chưa đọc thì đọc lại");
  r = reconcileInbox(s, "fb", scan([{ platformId: "a", preview: "Ok luôn · Vừa xong", signature: "s3" }]));
  assert.equal(r.hinted.length, 1);
});

test("half-rendered or e2ee-placeholder inbox preview is not a change and keeps the last preview", () => {
  const s = state();
  reconcileInbox(s, "fb", scan([{ platformId: "a", preview: "chào · 1 phút" }]));
  assert.deepEqual(reconcileInbox(s, "fb", scan([{ platformId: "a" }])).changed, []);
  assert.deepEqual(reconcileInbox(s, "fb", scan([{ platformId: "a", preview: "· 2 phút" }])).changed, []);
  assert.deepEqual(reconcileInbox(s, "fb", scan([{ platformId: "a", preview: "Không khôi phục được tin nhắn · 2 phút" }])).changed, []);
  assert.deepEqual(reconcileInbox(s, "fb", scan([{ platformId: "a", preview: "Tin nhắn và cuộc gọi được bảo mật bằng tính năng mã hóa đầu cuối. · 2 phút" }])).changed, []);
  assert.equal(s.conversations[0].inboxPreview, "chào · 1 phút");
  assert.equal(reconcileInbox(s, "fb", scan([{ platformId: "a", preview: "BUZZ!!! · 2 phút" }])).changed.length, 1);
});
