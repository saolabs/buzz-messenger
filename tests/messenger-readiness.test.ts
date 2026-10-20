import test from "node:test";
import assert from "node:assert/strict";
import {
  messengerReadIssue,
  waitForMessengerRead,
} from "../src/core/messenger-readiness.ts";
import type { MessengerRead } from "../src/core/messenger.ts";

const expected = { platformId: "123", name: "Roy X8Gaming" };
const ready: MessengerRead = {
  threadId: "123",
  selectedThreadId: "123",
  name: "Roy X8Gaming",
  messages: [],
  composerPresent: true,
  sendPresent: true,
  invalid: 0,
  ambiguous: 0,
  blocked: false,
  revision: 0,
};
test("history completion waits through transient selected link and recipient hydration", async () => {
  const reads = [
    { ...ready, selectedThreadId: null },
    { ...ready, name: "Previous recipient" },
    ready,
  ];
  let attempts = 0,
    delays = 0;
  const result = await waitForMessengerRead(
    async () => reads[attempts++],
    expected,
    "Hoàn tất tải lịch sử",
    async () => {
      delays++;
    },
  );
  assert.equal(result, ready);
  assert.equal(attempts, 3);
  assert.equal(delays, 2);
});
test("persistent read failures identify each actual cause without accepting an unsafe read", async () => {
  for (const [change, reason] of [
    [{ blocked: true }, /PIN/],
    [{ threadId: "999" }, /URL hội thoại/],
    [{ selectedThreadId: "999" }, /Danh sách chat/],
    [{ composerPresent: false }, /Ô soạn/],
    [{ name: "Other" }, /Tên người nhận/],
    [{ ambiguous: 2 }, /2 tin trùng/],
  ] as [Partial<MessengerRead>, RegExp][]) {
    let calls = 0;
    await assert.rejects(
      waitForMessengerRead(
        async () => {
          calls++;
          return { ...ready, ...change };
        },
        expected,
        "Hoàn tất tải lịch sử",
        async () => {},
      ),
      reason,
    );
    assert.equal(calls, 12);
  }
  assert.equal(
    messengerReadIssue({ ...ready, name: " Roy X8Gaming " }, expected),
    null,
  );
});

test("readOnly (chỉ đọc) bỏ kiểm tra dòng đang chọn và ô soạn, vẫn giữ URL hội thoại; gửi thì kiểm đủ", async () => {
  const { messengerReadIssue } = await import("../src/core/messenger-readiness.ts");
  const read = { threadId: "1", selectedThreadId: null, name: "", messages: [], composerPresent: true, sendPresent: true, invalid: 0, ambiguous: 0, blocked: false, revision: 0 };
  assert.match(messengerReadIssue(read, { platformId: "1", name: "Lan" })!, /chưa chọn đúng/);
  assert.equal(messengerReadIssue(read, { platformId: "1", name: "Lan", readOnly: true }), null);
  assert.match(messengerReadIssue({ ...read, threadId: "2" }, { platformId: "1", name: "Lan", readOnly: true })!, /URL/);
  const shown = [{ id: "m", text: "hi", direction: "incoming" as const, timestamp: null }];
  assert.equal(messengerReadIssue({ ...read, composerPresent: false, messages: shown }, { platformId: "1", name: "Lan", readOnly: true }), null);
  // Trang vừa tải, chưa vẽ gì: không được coi là "đọc được 0 tin".
  assert.match(messengerReadIssue({ ...read, composerPresent: false }, { platformId: "1", name: "Lan", readOnly: true })!, /chưa hiện tin/);
  assert.match(messengerReadIssue({ ...read, selectedThreadId: "1", name: "Lan", composerPresent: false }, { platformId: "1", name: "Lan" })!, /Ô soạn/);
});

test("chỉ đọc: tin trùng định danh được đánh số thay vì chặn đọc", async () => {
  const { disambiguate } = await import("../src/core/messenger-readiness.ts");
  assert.deepEqual(disambiguate([{ id: "a" }, { id: "b" }, { id: "a" }, { id: "a" }]).map((m) => m.id), ["a", "b", "a#2", "a#3"]);
  assert.equal(messengerReadIssue({ ...ready, ambiguous: 2 }, { ...expected, readOnly: true }), null);
  assert.match(messengerReadIssue({ ...ready, ambiguous: 2 }, expected)!, /trùng định danh/);
});
