import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { JSDOM } from "jsdom";
import { ownLinkScript } from "../src/core/profile.ts";

const run = (html: string, path: string, uid = "") => {
  const d = new JSDOM(html, { url: "https://www.facebook.com/home.php", runScripts: "outside-only" });
  try {
    return vm.runInContext(ownLinkScript(path, uid), d.getInternalVMContext());
  } finally {
    d.window.close();
  }
};
const nav = (inner: string) => `<div role="navigation">${inner}</div>`;

test("tên + avatar lấy từ liên kết trang cá nhân ở cột trái trang chủ", () => {
  const r = run(
    nav(`<a href="https://www.facebook.com/LeNgocDoan"><svg><image xlink:href="https://scontent.xx.fbcdn.net/me.jpg"></image></svg><span>Lê Ngọc Doãn</span></a><a href="https://www.facebook.com/friends/">Bạn bè</a>`),
    "/LeNgocDoan/",
  );
  assert.equal(r.name, "Lê Ngọc Doãn");
  assert.equal(r.avatar, "https://scontent.xx.fbcdn.net/me.jpg");
});

test("nhận liên kết profile.php?id=<c_user>; bỏ liên kết người khác và ảnh ngoài Facebook", () => {
  const r = run(
    nav(`<a href="https://www.facebook.com/someone"><span>Người khác</span></a><a href="https://www.facebook.com/profile.php?id=42"><img src="https://evil.example/x.jpg"><span>Doan Le</span></a>`),
    "",
    "42",
  );
  assert.equal(r.name, "Doan Le");
  assert.equal(r.avatar, undefined);
});

test("không có liên kết của mình (hoặc chỉ là chữ giao diện) thì không đoán tên", () => {
  assert.equal(run(nav(`<a href="https://www.facebook.com/LeNgocDoan">Thông báo</a>`), "/LeNgocDoan/").name, undefined);
  assert.equal(run(`<a href="https://www.facebook.com/LeNgocDoan">Lê Ngọc Doãn</a>`, "/LeNgocDoan/").name, undefined);
});
