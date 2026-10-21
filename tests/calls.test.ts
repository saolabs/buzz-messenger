import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { JSDOM } from "jsdom";
import { messengerScript } from "../src/core/messenger.ts";
import { callMediaAllowed, facebookCallUrl } from "../src/core/call-policy.ts";

function fixture(extra = "", url = "https://www.facebook.com/messages/t/123/") {
  const dom = new JSDOM(`
    <div role="grid" aria-label="Đoạn chat"><a href="/messages/t/123/" aria-current="page"><span dir="auto">Linh</span></a></div>
    <main role="main">
      <button id="video" aria-label="${"Bắt đầu cuộc gọi video".normalize("NFD")}"></button>
      <div id="voice" role="button" aria-label="Start an audio call"></div>
      <div role="article"><button aria-label="Start an audio call"></button></div>
      <div role="textbox" contenteditable="true" aria-label="Viết cho Linh"></div>
      ${extra}
    </main>`, { url, runScripts: "outside-only" });
  Object.defineProperty(dom.window.Element.prototype, "getClientRects", {
    value() { return this.closest('[hidden],[aria-hidden="true"]') ? [] : [{ width: 40, height: 20 }]; },
  });
  const clicked: string[] = [];
  dom.window.document.addEventListener("click", (e) => clicked.push((e.target as HTMLElement).id));
  const run = (action: "call-check" | "start-call", callKind: "voice" | "video") => vm.runInContext(
    messengerScript(action, { threadId: "123", recipient: "Linh", callKind, contextBound: false }), dom.getInternalVMContext(),
  );
  return { dom, clicked, run };
}

test("call preflight never clicks; voice/video select only the right unique control, including Vietnamese NFD and e2ee", () => {
  for (const path of ["t", "e2ee/t"]) {
    const f = fixture("", `https://www.facebook.com/messages/${path}/123/`);
    try {
      assert.equal(f.run("call-check", "voice"), true);
      assert.deepEqual(f.clicked, []);
      assert.equal(f.run("start-call", "voice"), true);
      assert.deepEqual(f.clicked, ["voice"]);
      f.run("start-call", "video");
      assert.deepEqual(f.clicked, ["voice", "video"]);
    } finally { f.dom.window.close(); }
  }
});

test("call click rechecks the URL, selection and recipient after a successful preflight", () => {
  for (const change of [
    (d: JSDOM) => d.reconfigure({ url: "https://www.facebook.com/messages/t/999/" }),
    (d: JSDOM) => d.window.document.querySelector('a')!.setAttribute("href", "/messages/t/999/"),
    (d: JSDOM) => d.window.document.querySelector('[role="textbox"]')!.setAttribute("aria-label", "Viết cho Mai"),
    (d: JSDOM) => d.reconfigure({ url: "https://example.com/messages/t/123/" }),
  ]) {
    const f = fixture();
    try {
      f.run("call-check", "video");
      change(f.dom);
      assert.throws(() => f.run("start-call", "video"));
      assert.deepEqual(f.clicked, []);
    } finally { f.dom.window.close(); }
  }
});

test("calls refuse disabled, hidden, duplicate controls and verification dialogs without clicking", () => {
  for (const mutate of [
    (d: Document) => d.querySelector('#voice')!.setAttribute("aria-disabled", "true"),
    (d: Document) => d.querySelector('#voice')!.setAttribute("hidden", ""),
    (d: Document) => d.querySelector('main')!.insertAdjacentHTML("beforeend", '<button aria-label="Voice call"></button>'),
    (d: Document) => d.body.insertAdjacentHTML("beforeend", '<div role="dialog" aria-label="Nhập PIN"></div>'),
  ]) {
    const f = fixture();
    try {
      mutate(f.dom.window.document);
      assert.throws(() => f.run("start-call", "voice"));
      assert.deepEqual(f.clicked, []);
    } finally { f.dom.window.close(); }
  }
});

test("media permissions belong only to visible, authorized Facebook call pages and the requested device types", () => {
  const base = { kind: "voice" as const, threadId: "123", topUrl: "https://www.facebook.com/messages/t/123/", requestingUrl: "https://www.facebook.com/", visible: true, mediaTypes: ["audio"] };
  assert.equal(callMediaAllowed(base), true);
  assert.equal(callMediaAllowed({ ...base, kind: "video", mediaTypes: ["audio", "video"] }), true);
  for (const patch of [
    { visible: false }, { mediaTypes: ["video"] }, { mediaTypes: ["audio", "video"] },
    { mediaTypes: [] }, { mediaTypes: ["unknown"] }, { mediaTypes: ["display-capture"] },
    { topUrl: "https://www.facebook.com/messages/t/999/" }, { topUrl: "https://www.facebook.com/" },
    { requestingUrl: "https://www.facebook.com.evil.test/" }, { requestingUrl: "http://www.facebook.com/" },
    { requestingUrl: "https://user:pass@www.facebook.com/" }, { requestingUrl: "https://www.facebook.com:8443/" },
  ]) assert.equal(callMediaAllowed({ ...base, ...patch }), false, JSON.stringify(patch));
  assert.equal(callMediaAllowed({ ...base, topUrl: "https://www.facebook.com/call/?id=123" }), true);
});

test("call popups allow only Facebook HTTPS call routes", () => {
  for (const path of ["/call/", "/videocall/incall/", "/messages/call/"]) assert.equal(facebookCallUrl("https://www.facebook.com" + path), true);
  for (const url of ["about:blank", "https://www.facebook.com/messages/t/123/", "https://example.com/call/", "https://www.facebook.com.evil.test/call/", "http://www.facebook.com/call/", "https://user:pass@www.facebook.com/call/"])
    assert.equal(facebookCallUrl(url), false, url);
});
