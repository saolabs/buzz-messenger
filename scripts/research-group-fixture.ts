// Offline regression check for group authors and identity. No Facebook,
// account profile, cookies or saved conversations are accessed by this script.
import assert from "node:assert/strict";
import vm from "node:vm";
import { JSDOM } from "jsdom";
import { messengerScript } from "../src/core/messenger.ts";
import { ingest } from "../src/core/conversation.ts";
import type { Conversation } from "../src/core/types.ts";

function inspect(stableIds: boolean) {
  const authors = ["Bạn", "An", "Bình"];
  const dom = new JSDOM(`<div role="grid" aria-label="Chats"><a aria-current="page" href="/messages/t/123/"><span dir="auto">Nhóm mẫu</span></a></div>
    ${authors.map((name, n) => `<div role="article" ${stableIds ? `data-message-id="synthetic-${n}"` : ""}><div role="button" aria-label="Tin nhắn do ${name} gửi lúc 10:19: Đồng ý"></div></div>`).join("")}
    <section aria-label="Cuộc trò chuyện với Nhóm mẫu"><div contenteditable="true" role="textbox" aria-label="Viết cho Nhóm mẫu"></div><button aria-label="Nhấn Enter để gửi"></button></section>`,
    { url: "https://www.facebook.com/messages/t/123/", runScripts: "outside-only" });
  Object.defineProperty(dom.window.Element.prototype, "getClientRects", { value: () => [{}] });
  try {
    const read = vm.runInContext(messengerScript("read", { group: true, now: new Date(2026, 9, 21, 11).getTime() }), dom.getInternalVMContext());
    const c: Conversation = { id: "synthetic", accountId: "fixture", platformId: "123", name: "Nhóm mẫu", kind: "group", url: "https://www.facebook.com/messages/t/123/", messages: [], initialized: false };
    ingest(c, read.messages.map((m: object) => ({ ...m, observedAt: 1 })));
    return { parsed: read.messages.length, distinctIds: new Set(read.messages.map((m: { id: string }) => m.id)).size,
      authorFieldsKept: read.messages.filter((m: object) => ["sender", "senderId", "senderName", "author"].some(k => k in m)).length,
      ambiguous: read.ambiguous, storedAfterIngest: c.messages.length };
  } finally { dom.window.close(); }
}

const fingerprint = inspect(false), platform = inspect(true);
assert.equal(fingerprint.parsed, 3);
assert.equal(fingerprint.authorFieldsKept, 3);
assert.equal(fingerprint.distinctIds, 3);
assert.equal(fingerprint.storedAfterIngest, 3);
assert.equal(platform.parsed, 3);
assert.equal(platform.storedAfterIngest, 3);
assert.equal(platform.authorFieldsKept, 3);
console.log(JSON.stringify({ fingerprint, platform, conclusion: "Group sender metadata is retained; equal incoming text/minute from different authors stays distinct." }, null, 2));
