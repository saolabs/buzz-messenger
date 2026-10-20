import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { JSDOM } from "jsdom";
import { restoreBannerScript } from "../src/core/messenger-pin.ts";

const page = (html: string, url = "https://www.facebook.com/messages/e2ee/t/123/") => {
  const d = new JSDOM(html, { url, runScripts: "outside-only" });
  Object.defineProperty(d.window.Element.prototype, "getClientRects", { value: () => [{ width: 10, height: 10 }] });
  return d;
};

test("bấm nút 'Restore now' trong dải khôi phục lịch sử", () => {
  const d = page(`<div role="button" aria-label="Restore now">Restore now</div>`);
  let clicked = 0;
  d.window.document.querySelector("[role=button]")!.addEventListener("click", () => clicked++);
  assert.equal(vm.runInContext(restoreBannerScript(), d.getInternalVMContext()), "clicked");
  assert.equal(clicked, 1);
  d.window.close();
});

test("không bấm nút khác hoặc nút ẩn, không chạy ngoài Messenger", () => {
  const d = page(`<div role="button" aria-label="Restore">x</div><div aria-hidden="true"><div role="button">Khôi phục ngay</div></div>`);
  assert.equal(vm.runInContext(restoreBannerScript(), d.getInternalVMContext()), "absent");
  d.window.close();
  const other = page(`<div role="button">Restore now</div>`, "https://www.facebook.com/settings/");
  assert.equal(vm.runInContext(restoreBannerScript(), other.getInternalVMContext()), "absent");
  other.window.close();
});
