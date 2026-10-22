import test from "node:test";
import assert from "node:assert/strict";
import { confirmPendingMessages, type PendingMessage } from "../src/core/pending-messages.ts";
import type { Message } from "../src/core/types.ts";

const pending = (key: number, knownIds = ["old"]): PendingMessage => ({ key, text: "hello", knownIds: new Set(knownIds) });
const sent = (id: string, patch: Partial<Message> = {}): Message => ({ id, text: "hello", direction: "outgoing", timestamp: null, observedAt: 1, baseline: false, ...patch });

test("an old identical message cannot acknowledge a new send", () => {
  assert.equal(confirmPendingMessages([pending(1)], [sent("old")]).length, 1);
  assert.equal(confirmPendingMessages([pending(1)], [sent("renamed", { aliasIds: ["old"] })]).length, 1);
});

test("one server echo confirms exactly one repeated send across repeated broadcasts", () => {
  const messages = [sent("old"), sent("new-one")];
  const remaining = confirmPendingMessages([pending(1), pending(2)], messages);
  assert.deepEqual(remaining.map(p => p.key), [2]);
  assert.equal(confirmPendingMessages(remaining, messages).length, 1);
  assert.deepEqual(confirmPendingMessages(remaining, [...messages, sent("new-two")]), []);
});

test("a late echo removes an uncertain send error instead of rendering a duplicate", () => {
  assert.deepEqual(confirmPendingMessages([{ ...pending(1), error: "timeout" }], [sent("confirmed")]), []);
});

test("incoming messages, backfill, other text and reused aliases do not confirm sends", () => {
  for (const patch of [{ direction: "incoming" as const }, { baseline: true }, { text: "different" }, { aliasIds: ["old"] }]) {
    const list = [pending(1)];
    const remaining = confirmPendingMessages(list, [sent("new", patch)]);
    assert.equal(remaining.length, 1);
    assert.equal(list[0].knownIds.has("new"), false, "pending snapshots must remain immutable");
  }
});
