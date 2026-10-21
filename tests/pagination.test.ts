import test from "node:test";
import assert from "node:assert/strict";
import { ingest, ingestHistory, ingestLatest } from "../src/core/conversation.ts";
import type { Conversation, Message } from "../src/core/types.ts";

const row = (id: string): Omit<Message, "baseline"> => ({ id, direction: "incoming", text: `synthetic ${id}`, timestamp: null, observedAt: 1000, identity: "platform", precision: "exact" });
test("older pages retain their DOM order, mark backfill as history, and deduplicate overlapping requests", () => {
  const c: Conversation = { id: "c", accountId: "fb", platformId: "123", name: "fixture", url: "", initialized: true, messages: [{ ...row("3"), baseline: false }, { ...row("4"), baseline: false }] };
  assert.equal(ingestHistory(c, [row("1"), row("2"), row("3")]), 2);
  assert.deepEqual(c.messages.map(m => m.id), ["1", "2", "3", "4"]);
  assert.deepEqual(c.messages.map(m => m.baseline), [true, true, false, false]);
  assert.equal(ingestHistory(c, [row("1"), row("2"), row("3")]), 0);
  ingest(c, [row("3"), row("4"), row("5")]);
  assert.equal(c.messages.at(-1)?.baseline, false, "a subsequent live arrival must remain eligible for notification");
  assert.deepEqual(c.messages.map(m => m.id), ["1", "2", "3", "4", "5"]);
});

test("backfill stays before an existing last message when all rows share the same minute", () => {
  const c: Conversation = { id: "c", accountId: "fb", platformId: "123", name: "fixture", url: "", initialized: true, messages: [{ ...row("3"), baseline: false }] };
  ingestHistory(c, ["1", "2", "3"].map(id => ({ ...row(id), timestamp: 60_000, precision: "minute" })));
  assert.deepEqual(c.messages.map(m => m.id), ["1", "2", "3"]);
  assert.equal(c.messages.at(-1)?.baseline, false);
});

test("a verified latest window stays after cached undated history without deleting or duplicating rows", () => {
  const latest = { ...row("latest"), timestamp: 180_000, platformMessageId: "server-latest" };
  const old = { ...row("old"), timestamp: 60_000, platformMessageId: "server-old" };
  const c: Conversation = { id: "c", accountId: "fb", platformId: "123", name: "fixture", url: "", initialized: true, messages: [old, latest, row("undated-history"), { ...row("dated-history"), timestamp: 120_000 }].map(m => ({ ...m, baseline: true })) };
  assert.deepEqual(ingestLatest(c, [old, latest]), []);
  assert.equal(c.messages.length, 4);
  assert.deepEqual(c.messages.map(m => m.id), ["undated-history", "old", "dated-history", "latest"]);
  assert.deepEqual(ingestLatest(c, [old, latest]), []);
  assert.equal(c.messages.at(-1)?.platformMessageId, "server-latest");
});

test("a stale live window cannot displace a newer dated message, and unverified reads cannot rebase history", () => {
  const latest = { ...row("latest"), timestamp: 180_000, platformMessageId: "server-latest" };
  const future = { ...row("newer"), timestamp: 240_000 };
  const c: Conversation = { id: "c", accountId: "fb", platformId: "123", name: "fixture", url: "", initialized: true, messages: [latest, row("undated-history"), future].map(m => ({ ...m, baseline: true })) };
  ingestLatest(c, [latest]);
  assert.equal(c.messages.at(-1)?.id, "newer");
  c.messages = [{ ...latest, baseline: true }, { ...row("undated-history"), baseline: true }];
  ingestLatest(c, [{ ...latest, platformMessageId: undefined }]);
  assert.equal(c.messages.at(-1)?.id, "undated-history");
});

test("latest reconciliation preserves undated media inside its observed window and reports a real new arrival", () => {
  const old = { ...row("old"), timestamp: 60_000 };
  const media = { ...row("media"), attachments: [{ id: "image", kind: "image" as const }] };
  const middle = { ...row("middle"), timestamp: 120_000 };
  const last = { ...row("latest"), timestamp: 180_000, platformMessageId: "server-latest" };
  const c: Conversation = { id: "c", accountId: "fb", platformId: "123", name: "fixture", url: "", initialized: true, messages: [old, media, middle, { ...row("between"), timestamp: 150_000 }].map(m => ({ ...m, baseline: true })) };
  const fresh = ingestLatest(c, [old, media, middle, last]);
  assert.deepEqual(c.messages.map(m => m.id), ["old", "media", "middle", "between", "latest"]);
  assert.equal(c.messages[1].attachments?.[0].id, "image");
  assert.deepEqual(fresh.map(m => [m.id, m.baseline]), [["latest", false]]);
});
