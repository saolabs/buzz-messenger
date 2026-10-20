import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize, type Emoticon } from "../src/core/emoticons.ts";

const e = (id: string, ...codes: string[]): Emoticon => ({ id, title: id, file: `${id}.gif`, codes });
const set = [e("smile", ":)", ":-)"), e("laughing", ":))"), e("grin", ":D"), e("hug", ">:D<"), e("tongue", ":P")];
const show = (s: string) => tokenize(s, set).map((t) => ("text" in t ? t.text : `[${t.emoticon.id}]`)).join("");

test("khớp mã dài nhất trước", () => {
  assert.equal(show("haha :)) ok :)"), "haha [laughing] ok [smile]");
  assert.equal(show(">:D< :D"), "[hug] [grin]");
});

test("không chuyển mã nằm trong URL", () => {
  assert.equal(show("xem http://a.vn/:P nhé :P"), "xem http://a.vn/:P nhé [tongue]");
});

test("chữ liền nhau gộp thành một token", () => {
  assert.deepEqual(tokenize("abc", set), [{ text: "abc" }]);
});
