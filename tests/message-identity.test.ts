import test from "node:test";
import assert from "node:assert/strict";
import { ingest, ingestLatest } from "../src/core/conversation.ts";
import { findObservedMessage } from "../src/core/message-identity.ts";
import type { Conversation, Message } from "../src/core/types.ts";

const row = (id: string, text = id, patch: Partial<Message> = {}): Message => ({ id, text, direction: "incoming", timestamp: null, observedAt: 1000, baseline: true, identity: "fingerprint", precision: "minute", ...patch });
const conversation = (messages: Message[]): Conversation => ({ id: "c", accountId: "a", platformId: "123", name: "fixture", url: "", initialized: true, messages });
const bound = (id: string, text = id, timestamp = 60_000) => row(id, text, { platformMessageId: `server-${id}`, timestamp, precision: "exact" });

test("server identity merges changed DOM IDs, keeps the original local ID and recognizes aliases without API", () => {
  const c = conversation([bound("saved", "same")]);
  const next = { ...bound("new-dom", "same"), platformMessageId: "server-saved" };
  assert.deepEqual(ingest(c, [next]), []);
  assert.equal(c.messages.length, 1);
  assert.equal(c.messages[0].id, "saved");
  assert.deepEqual(c.messages[0].aliasIds, ["new-dom"]);
  ingest(c, [row("new-dom", "same")]);
  assert.equal(c.messages.length, 1);
});

test("identical content from distinct server IDs remains distinct even if DOM IDs collide", () => {
  const c = conversation([]);
  const a = bound("dom", "ok"), b = { ...a, platformMessageId: "another-server-id", timestamp: 61_000 };
  ingestLatest(c, [a, b]);
  assert.equal(c.messages.length, 2);
  assert.equal(new Set(c.messages.map(m => m.id)).size, 2);
  assert.deepEqual(c.messages.map(m => m.platformMessageId), [a.platformMessageId, b.platformMessageId]);
  ingestLatest(c, [{ ...a, id: "next-a" }, { ...b, id: "next-b" }]);
  assert.equal(c.messages.length, 2);
});

test("a duplicate server ID is coalesced while an encrypted-state backup retains the prior records", () => {
  const a = bound("a", "same"), b = { ...a, id: "b" };
  const c = conversation([a, b]);
  ingest(c, [b]);
  assert.equal(c.messages.length, 1);
  assert.equal(c.messages[0].id, "a");
  assert.equal(c.messageRepairBackup?.messages.length, 2);
  assert.ok(c.messages[0].aliasIds?.includes("b"));
});

test("a verified DOM-to-server bridge repairs a cached fallback copy and preserves its aliases", () => {
  const saved = bound("saved", "same");
  const fallback = row("fallback", "same", { aliasIds: ["older-fallback"] });
  const c = conversation([saved, fallback]);
  const before = structuredClone(c.messages);
  assert.deepEqual(ingest(c, [{ ...saved, id: fallback.id }]), []);
  assert.equal(c.messages.length, 1);
  assert.equal(c.messages[0].id, "saved");
  assert.deepEqual(c.messageRepairBackup?.messages, before);
  assert.ok(c.messages[0].aliasIds?.includes("fallback"));
  assert.ok(c.messages[0].aliasIds?.includes("older-fallback"));
  ingest(c, [row("older-fallback", "same")]);
  assert.equal(c.messages.length, 1, "a later DOM-only read must not reinsert the copy");
});

test("a later row in a history capture can bind an earlier changed fingerprint to the saved message", () => {
  const c = conversation([row("saved-dom", "same")]);
  const verified = bound("new-dom", "same");
  assert.deepEqual(ingestLatest(c, [verified, { ...verified, id: "saved-dom" }]), []);
  assert.equal(c.messages.length, 1);
  assert.equal(c.messages[0].id, "saved-dom");
  assert.equal(c.messages[0].platformMessageId, verified.platformMessageId);
});

test("two server anchors upgrade a changed direct-message fingerprint before inserting a duplicate", () => {
  const left = bound("left"), right = bound("right", "right", 180_000);
  const middle = row("old-middle", "middle", { timestamp: 120_000 });
  const c = conversation([left, middle, right]);
  const observed = [left, bound("new-middle", "middle", 120_100), right];
  assert.deepEqual(ingestLatest(c, observed), []);
  assert.deepEqual(c.messages.map(m => m.id), ["left", "old-middle", "right"]);
  assert.equal(c.messages[1].platformMessageId, "server-new-middle");
  assert.ok(c.messages[1].aliasIds?.includes("new-middle"));
  ingestLatest(c, observed);
  ingest(c, [row("new-middle", "middle")]);
  assert.equal(c.messages.length, 3);
});

test("sent and received messages stay single across history refreshes and DOM fallback", () => {
  const left = bound("left"), right = bound("right", "right", 180_000);
  const incoming = row("received", "hello", { timestamp: 120_000 });
  const outgoing = row("sent", "hello", { direction: "outgoing", timestamp: 120_000 });
  const c = conversation([left, incoming, outgoing, right]);
  const refreshed = [left, bound("received-new-dom", "hello", 120_100),
    { ...bound("sent-new-dom", "hello", 120_200), direction: "outgoing" as const }, right];
  for (let pass = 0; pass < 3; pass++) {
    assert.deepEqual(ingestLatest(c, refreshed), []);
    assert.deepEqual(ingest(c, refreshed.map(m => ({ ...m, platformMessageId: undefined }))), []);
    assert.deepEqual(c.messages.map(m => m.id), ["left", "received", "sent", "right"]);
    assert.equal(c.messages.filter(m => m.text === "hello" && m.direction === "incoming").length, 1);
    assert.equal(c.messages.filter(m => m.text === "hello" && m.direction === "outgoing").length, 1);
  }
});

test("a conflicting server ID on a cached DOM copy is never folded into another message", () => {
  const a = bound("a", "same"), b = bound("b", "same");
  const c = conversation([a, b]);
  ingest(c, [{ ...a, id: "b" }]);
  assert.equal(c.messages.length, 2);
  assert.deepEqual(c.messages.map(m => m.platformMessageId), [a.platformMessageId, b.platformMessageId]);
});

test("bounded fingerprint repair rejects partial spans, changed dates, directions and server IDs", () => {
  const left = bound("left"), right = bound("right", "right", 180_000);
  for (const patch of [{ timestamp: 60_000 }, { direction: "outgoing" as const }, { platformMessageId: "different-server" }]) {
    const c = conversation([left, row("old", "same", { timestamp: 120_000, ...patch }), right]);
    ingestLatest(c, [left, bound("new", "same", 120_100), right]);
    assert.equal(c.messages.length, 4);
  }
  const c = conversation([left, row("old", "same"), row("not-rendered"), right]);
  ingestLatest(c, [left, bound("new", "same", 120_100), right]);
  assert.equal(c.messages.length, 5);
});

test("a DOM fingerprint claimed by two different server messages cannot bridge their cached copies", () => {
  const a = bound("a", "same"), b = bound("b", "same");
  const c = conversation([a, b, row("shared-dom", "same")]);
  ingest(c, [{ ...a, id: "shared-dom" }, { ...b, id: "shared-dom" }]);
  assert.equal(c.messages.length, 3);
  assert.equal(c.messages.find(m => m.id === "shared-dom")?.platformMessageId, undefined);
});

test("legacy copied blocks and bounded media aliases are repaired without losing older history or real photos", () => {
  const image = (id: string, ts: number) => bound(id, "[Image]", ts);
  const photoA = { ...image("photo-a", 10_000), attachments: [{ id: "photo-a-file", kind: "image" as const }] };
  const text = Array.from({ length: 11 }, (_, i) => bound(`text-${i}`, `synthetic paragraph ${i}`, 60_000 + i * 1000));
  const note = bound("note", "synthetic note", 80_000);
  const photoB = { ...image("photo-b", 90_000), attachments: [{ id: "photo-b-file", kind: "image" as const }] };
  const latest = bound("latest", "new arrival", 180_000);
  const source = [photoA, ...text, note, photoB, latest];
  const copies = text.map((m, i) => row(`old-copy-${i}`, m.text));
  const noteCopy = row("old-note", note.text, { timestamp: 140_000 });
  const photoCopy = row("old-photo", photoB.text, { attachments: photoB.attachments, timestamp: 140_000 });
  const older = [row("older-1"), row("older-2"), row("older-3")];
  const c = conversation([...copies, ...older, photoA, ...text, note, photoB, noteCopy, photoCopy, latest]);
  assert.equal(c.messages.length, 31);
  assert.deepEqual(ingestLatest(c, source), []);
  assert.equal(c.messages.length, 18);
  assert.equal(c.messageRepairBackup?.messages.length, 31);
  assert.equal(c.messages.filter(m => m.attachments?.length).length, 2);
  assert.ok(c.messages.some(m => m.id === "older-1"));
  assert.equal(c.messages.at(-1)?.id, "latest");
  assert.ok(c.messages.find(m => m.id === "note")?.aliasIds?.includes("old-note"));
  assert.ok(c.messages.find(m => m.id === "photo-b")?.aliasIds?.includes("old-photo"));
  for (let frame = 0; frame < 3; frame++) {
    assert.deepEqual(ingestLatest(c, source.map(m => ({ ...m, id: `${m.id}-frame-${frame}` }))), []);
    assert.equal(c.messages.length, 18);
  }
  ingest(c, [copies[0]]);
  assert.equal(c.messages.length, 18, "an old fingerprint alias was reinserted");
});

test("stand-alone text matches and ambiguous repeated source messages are never removed", () => {
  const left = bound("left"), right = bound("right", "right", 180_000);
  const a = bound("a", "ok", 70_000), b = bound("b", "ok", 71_000);
  const c = conversation([left, a, row("uncertain-copy", "ok"), b, right]);
  ingestLatest(c, [left, a, b, right]);
  assert.equal(c.messages.length, 5);
  const other = conversation([row("old", "same"), bound("current", "same")]);
  ingestLatest(other, [bound("current", "same")]);
  assert.equal(other.messages.length, 2);
});

test("a short anonymous repeated conversation cannot be inferred to be a copied cache block", () => {
  const source = Array.from({ length: 3 }, (_, i) => bound(`current-${i}`, `A long but possibly genuinely repeated message ${i}`, 60_000 + i * 1000));
  const c = conversation([...source.map((m, i) => row(`earlier-${i}`, m.text)), ...source]);
  ingestLatest(c, source);
  assert.equal(c.messages.length, 6);
  assert.equal(c.messageRepairBackup, undefined);
});

test("media lookup follows server identity or a unique local alias and rejects ambiguous or conflicting rows", () => {
  const saved = { ...bound("saved"), aliasIds: ["old-dom"] };
  const current = { id: "new-dom", platformMessageId: saved.platformMessageId };
  assert.equal(findObservedMessage(saved, [current], saved.id), current);
  assert.equal(findObservedMessage(saved, [{ id: "old-dom" }], saved.id)?.id, "old-dom");
  assert.equal(findObservedMessage(saved, [{ id: "old-dom" }, { id: "saved" }], saved.id), undefined);
  assert.equal(findObservedMessage(saved, [{ id: "old-dom", platformMessageId: "different" }], saved.id), undefined);
});
