import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { messengerBetaScript, enrichBetaMessages, type BetaRequest, type BetaResult } from "../src/core/messenger-beta.ts";
import { betaMode, callMessengerBeta, tryMessengerBetaSend } from "../electron/messenger-beta.ts";
import { ingest } from "../src/core/conversation.ts";
import type { NativeMessage } from "../src/core/messenger.ts";
import type { Conversation } from "../src/core/types.ts";

function fixture() {
  const jid = { user: "synthetic", server: "msgr" };
  const now = Math.floor(Date.now() / 1000);
  const state = {
    writes: 0, sends: 0, loads: 0, ephemeral: { ephemeralExpirationInSec: 60 },
    payload: undefined as any, row: undefined as any, ack: "ok",
    mapping: async () => jid as unknown,
    settings: async () => state.ephemeral as unknown,
  };
  const db = {
    table: (_: string) => ({ get: async (key: string) => ({ threadKey: key, threadType: "secure" }) }),
    tables: {},
    runInTransaction: async (fn: (tx: any) => Promise<void>) => {
      state.writes++;
      await fn({ messages: { add: async (row: any) => { state.row = row; } } });
    },
  };
  const modules: Record<string, any> = {
    CurrentUser: { getID: () => "42" },
    I64: { of_string: (x: string) => x, to_string: String, to_float: Number, of_float: (x: number) => x, max_int: Number.MAX_SAFE_INTEGER },
    LSDatabaseSingleton: { getLSDatabaseSingletonPromiseOrValue: () => db },
    LSMessagingThreadTypeUtil: { isArmadilloSecure: (type: string) => type === "secure" },
    MAWMiActMappingTableAPI: { getChatJidForThreadKey: () => state.mapping() },
    MpsTypes: { toThreadId: (x: unknown) => x },
    MpsOverBridge: { mps: () => ({ loadMessages: async (query: any) => {
      state.loads++;
      assert.equal(query.numMessages, 50);
      assert.deepEqual(JSON.parse(JSON.stringify(query.threadId)), jid);
      return { success: true, value: { messages: [
        { chatJid: jid, externalId: "two", type_: "Text", content: "vault:second", ts: now, isAuthorMe: true },
        { chatJid: jid, externalId: "one", type_: "Text", content: "vault:first", ts: now - 1, isAuthorMe: false },
        { chatJid: jid, externalId: "media", type_: "Image", ts: now, isAuthorMe: false },
      ] } };
    } }) },
    MpsMessageToLoadResponse: { messageToLoadMsgsResponse: (msgs: any[]) => ({ msgs }) },
    MAWVault: { vault: (s: string) => `vault:${s}`, unvault: (s: string) => s.replace(/^vault:/, "") },
    MAWExternalId: { generateExternalId: () => "synthetic-external-id" },
    MAWOptimisticMessageUtils: { getOptimisticMessageTimestamp: () => now * 1000, optimisticBumpThread: async () => {} },
    MAWCreateOptimisticSecureMessage: { buildOptimisticLsMessage: async (...args: any[]) => ({ actor: args[2], text: args[4], threadKey: args[5], id: args[9], timestamp: args[10] }) },
    MAWGetEphemeralSettings: { getEphemeralSetting: () => state.settings() },
    MAWMessageSendReporter: { MAWMessageSendReporter: async (_: unknown, task: Promise<unknown>) => { await task; } },
    sendToSentQPLLogger: { markSendToSentStart: () => 41 },
    qpl: { _: () => 25313175 }, LSIntEnum: { ofNumber: (n: number) => n },
    LSMessagingThreadAttributionType: { UNKNOWN: 0 }, LSMessagingInitiatingSource: { FACEBOOK_INBOX: 1 },
    MAWBridgeSendAndReceive: { sendAndReceive: async (backend: string, route: string, payload: any) => {
      state.sends++;
      state.payload = payload;
      assert.equal(backend, "backend"); assert.equal(route, "sendMsg");
      if (state.ack === "throw") throw new Error("private fixture text must not escape");
      if (state.ack === "hang") return new Promise(() => {});
      if (state.ack === "fail") return { success: false, error: { details: "private fixture text" } };
      return { success: true, value: { externalId: state.ack === "wrong-id" ? "other" : payload.externalId, messageType: "sendMsg" } };
    } },
  };
  const location = { protocol: "https:", hostname: "www.facebook.com", port: "", pathname: "/messages/e2ee/t/123/" };
  const context = vm.createContext({ location, setTimeout, clearTimeout, require: (name: string) => {
    if (!(name in modules)) throw new Error(`missing ${name}`);
    return modules[name];
  } });
  const run = (action: BetaRequest["action"], ms = 1000) => vm.runInContext(messengerBetaScript({
    action, userId: "42", threadId: "123", limit: 50, text: "synthetic text", deadline: Date.now() + ms,
  }), context) as Promise<BetaResult>;
  const freezeTime = () => {
    const frozen = Date.now();
    context.Date = class extends Date { static now() { return frozen; } };
  };
  return { state, modules, location, run, freezeTime };
}

test("MPS reads unvaulted text from the bound E2EE thread; media remains separate", async () => {
  const f = fixture(), r = await f.run("read");
  assert.equal(r.status, "read");
  if (r.status !== "read") return;
  assert.deepEqual(JSON.parse(JSON.stringify(r.messages.map(m => [m.id, m.text, m.direction]))), [["one", "first", "incoming"], ["two", "second", "outgoing"]]);
  assert.equal(r.total, 3);
  assert.equal(r.media?.[0].id, "media");
  assert.equal(f.state.writes, 0); assert.equal(f.state.sends, 0);
});

test("a secure thread on the /t route works; a legacy thread never uses the secure send API", async () => {
  const f = fixture(); f.location.pathname = "/messages/t/123/";
  assert.equal((await f.run("read")).status, "read");
  f.modules.LSMessagingThreadTypeUtil.isArmadilloSecure = () => false;
  assert.equal((await f.run("send")).status, "unavailable");
  assert.equal(f.state.writes, 0); assert.equal(f.state.sends, 0);
});

test("a worker response from another thread cannot enrich the current conversation", async () => {
  const f = fixture();
  f.modules.MpsMessageToLoadResponse.messageToLoadMsgsResponse = (msgs: any[]) => ({ msgs: msgs.map(m => ({ ...m, chatJid: "other" })) });
  assert.equal((await f.run("read")).status, "unavailable");
  assert.equal(f.state.writes, 0); assert.equal(f.state.sends, 0);
});

test("origin, thread, account and a navigation during mapping fail before reads or writes", async () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => { f.location.hostname = "facebook.com.evil.test"; },
    (f: ReturnType<typeof fixture>) => { f.location.port = "8443"; },
    (f: ReturnType<typeof fixture>) => { f.location.pathname = "/messages/e2ee/t/999/"; },
    (f: ReturnType<typeof fixture>) => { f.modules.CurrentUser.getID = () => "other"; },
    (f: ReturnType<typeof fixture>) => { f.state.mapping = async () => { f.location.pathname = "/messages/e2ee/t/999/"; return {}; }; },
  ]) {
    const f = fixture(); change(f);
    assert.equal((await f.run("send")).status, "unavailable");
    assert.equal(f.state.writes, 0); assert.equal(f.state.sends, 0);
  }
});

test("missing module contracts fall back before mutation; prepare never sends", async () => {
  const f = fixture();
  assert.equal((await f.run("prepare-send")).status, "ready");
  assert.equal(f.state.writes, 0); assert.equal(f.state.sends, 0);
  delete f.modules.MAWMessageSendReporter;
  assert.equal((await f.run("send")).status, "unavailable");
  assert.equal(f.state.writes, 0); assert.equal(f.state.sends, 0);
});

test("API send uses one optimistic write and one bridge call with matching IDs and disappearing settings", async () => {
  const f = fixture(), r = await f.run("send");
  assert.equal(r.status, "submitted");
  assert.equal(f.state.writes, 1); assert.equal(f.state.sends, 1);
  assert.equal(f.state.row.actor, "42"); assert.equal(f.state.row.threadKey, "123");
  assert.equal(f.state.row.text, "vault:synthetic text");
  assert.equal(f.state.payload.args.content, "synthetic text");
  assert.equal(f.state.payload.externalId, f.state.row.id);
  assert.equal(f.state.payload.args.optimisticMsg.msgId, f.state.row.id);
  assert.equal(f.state.payload.args.optimisticMsg.ts, f.state.row.timestamp);
  assert.deepEqual(JSON.parse(JSON.stringify(f.state.payload.args.ephemeralSetting)), f.state.ephemeral);
});

test("worker rejection, ambiguous ACK, exceptions and timeout after attempting never permit fallback", async () => {
  for (const [ack, status] of [["fail", "failed"], ["wrong-id", "uncertain"], ["throw", "uncertain"], ["hang", "uncertain"]]) {
    const f = fixture(); f.state.ack = ack;
    const r = await f.run("send", ack === "hang" ? 30 : 1000);
    assert.equal(r.status, status);
    assert.equal(f.state.sends, 1);
    assert.equal(JSON.stringify(r).includes("private fixture text"), false);
  }
});

test("a preparation timeout cannot later wake up and send after DOM fallback", async () => {
  const f = fixture();
  f.freezeTime(); // Deadline checks alone fail if the wall clock stalls or moves backwards.
  let release!: () => void;
  f.state.settings = () => new Promise(resolve => { release = () => resolve({}); });
  assert.equal((await f.run("send", 20)).status, "unavailable");
  release();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(f.state.writes, 0); assert.equal(f.state.sends, 0);
});

test("navigation while optimistic transaction is committing cannot send to a different context", async () => {
  const f = fixture();
  f.modules.MAWOptimisticMessageUtils.optimisticBumpThread = async () => { f.location.pathname = "/messages/e2ee/t/999/"; };
  assert.equal((await f.run("send")).status, "uncertain");
  assert.equal(f.state.writes, 1); assert.equal(f.state.sends, 0);
});

function stub(results: (BetaResult | Error)[]) {
  let calls = 0;
  return {
    wc: { isDestroyed: () => false, executeJavaScript: async (_: string) => {
      const r = results[calls++]; if (r instanceof Error) throw r; return r;
    } },
    calls: () => calls,
  };
}
const send = { threadId: "123", userId: "42", text: "synthetic" };
test("send controller allows DOM only for proven pre-attempt unavailability", async () => {
  for (const results of [
    [{ status: "unavailable", reason: "module" }],
    [{ status: "ready" }, { status: "unavailable", reason: "context" }],
  ] as BetaResult[][]) {
    const s = stub(results), attempt = { clicked: false };
    assert.equal(await tryMessengerBetaSend(s.wc, send, attempt, async () => {}), false);
    assert.equal(attempt.clicked, false); assert.equal(s.calls(), results.length);
  }
  for (const result of [{ status: "uncertain", reason: "timeout" }, { status: "failed", reason: "reject" }, new Error("execution context destroyed")] as (BetaResult | Error)[]) {
    const s = stub([{ status: "ready" }, result]), attempt = { clicked: false };
    await assert.rejects(tryMessengerBetaSend(s.wc, send, attempt, async () => {}));
    assert.equal(attempt.clicked, true); assert.equal(s.calls(), 2);
  }
});

test("cancellation at the final preflight makes no bridge call", async () => {
  const s = stub([{ status: "ready" }]), attempt = { clicked: false };
  await assert.rejects(tryMessengerBetaSend(s.wc, send, attempt, async () => { throw new Error("cancelled"); }));
  assert.equal(attempt.clicked, false); assert.equal(s.calls(), 1);
});

test("host execution timeout is uncertain for sends; environment can disable sends or the entire beta transport", async () => {
  const wc = { isDestroyed: () => false, executeJavaScript: (_: string): Promise<any> => new Promise(() => {}) };
  assert.equal((await callMessengerBeta(wc, { ...send, action: "send" }, 10)).status, "uncertain");
  assert.equal((await callMessengerBeta(wc, { ...send, action: "read" }, 10)).status, "unavailable");
  assert.equal(betaMode("off"), "off"); assert.equal(betaMode("read"), "read"); assert.equal(betaMode("on"), "on");
});

const domMessage = (patch: Partial<NativeMessage> = {}): NativeMessage => ({ id: "dom:one", text: "hello", direction: "incoming", timestamp: null, identity: "fingerprint", precision: "minute", ...patch });
test("enrichment preserves local IDs and media, rejects ambiguous repeated text and never inserts API-only history", () => {
  const dom = [domMessage({ timestamp: 60_000, attachments: [{ id: "image", kind: "image" }] })];
  const api = [{ id: "server", text: "hello", direction: "incoming" as const, timestamp: 60_100 }];
  const result = enrichBetaMessages(dom, [...api, { ...api[0], id: "history", text: "old" }]);
  assert.equal(result.matched, 1); assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].id, "dom:one"); assert.equal(result.messages[0].platformMessageId, "server");
  assert.deepEqual(result.messages[0].attachments, dom[0].attachments);
  assert.equal(enrichBetaMessages([domMessage(), domMessage({ id: "dom:two" })], api).matched, 0);
  assert.equal(enrichBetaMessages(dom, [api[0], { ...api[0], id: "duplicate" }]).matched, 0);
  assert.equal(enrichBetaMessages(dom, [{ ...api[0], direction: "outgoing" }]).matched, 0);
  assert.equal(enrichBetaMessages([domMessage()], api).matched, 0);
  assert.equal(enrichBetaMessages([domMessage({ timestamp: 1 })], [{ ...api[0], timestamp: 1_000_000 }]).matched, 0);
});

test("ingesting enriched messages upgrades timestamp and persists API identity without duplicating the saved DOM message", () => {
  const c: Conversation = { id: "c", accountId: "a", platformId: "123", name: "fixture", url: "", initialized: true, messages: [{ ...domMessage({ timestamp: 60_000 }), observedAt: 0, baseline: false }] };
  const result = enrichBetaMessages([domMessage({ timestamp: 60_000 })], [{ id: "server", text: "hello", direction: "incoming", timestamp: 60_100 }]);
  assert.deepEqual(ingest(c, result.messages.map(m => ({ ...m, observedAt: 1 }))), []);
  assert.equal(c.messages.length, 1); assert.equal(c.messages[0].id, "dom:one");
  assert.equal(c.messages[0].timestamp, 60_100); assert.equal(c.messages[0].precision, "exact");
  assert.equal(c.messages[0].platformMessageId, "server");
});

test("two API anchors identify undated text and a photo only when the whole intervening sequence agrees", () => {
  const dom = [domMessage({ id: "left", text: "left", timestamp: 60_000 }), domMessage({ id: "middle", text: "middle" }), domMessage({ id: "photo", text: "[Image]", attachments: [{ id: "file", kind: "image" }] }), domMessage({ id: "right", text: "right", timestamp: 180_000 })];
  const api = [{ id: "api-left", text: "left", direction: "incoming" as const, timestamp: 60_100, order: 0 }, { id: "api-middle", text: "middle", direction: "incoming" as const, timestamp: 120_000, order: 1 }, { id: "api-right", text: "right", direction: "incoming" as const, timestamp: 180_100, order: 3 }];
  const media = [{ id: "api-photo", kind: "image" as const, sticker: false, direction: "incoming" as const, timestamp: 121_000, order: 2 }];
  const result = enrichBetaMessages(dom, api, media);
  assert.equal(result.matched, 4);
  assert.deepEqual(result.messages.map(m => m.platformMessageId), ["api-left", "api-middle", "api-photo", "api-right"]);
  assert.deepEqual(result.messages[2].attachments, dom[2].attachments);
  assert.equal(enrichBetaMessages(dom, api.map(m => m.id === "api-right" ? { ...m, order: 4 } : m), media).matched, 2, "a hidden or unsupported intervening row must break alignment");
});

test("equal repeated-text occurrences keep distinct API IDs; a partial window cannot borrow their identities", () => {
  const dom = [domMessage({ id: "one", text: "ok", timestamp: 60_000 }), domMessage({ id: "two", text: "ok", timestamp: 60_000 })];
  const api = [{ id: "first", text: "ok", direction: "incoming" as const, timestamp: 60_100 }, { id: "second", text: "ok", direction: "incoming" as const, timestamp: 61_100 }];
  assert.deepEqual(enrichBetaMessages(dom, api).messages.map(m => m.platformMessageId), ["first", "second"]);
  assert.equal(enrichBetaMessages(dom.slice(1), api).matched, 0);
});

test("a complete API tail identifies weekday-labelled sent and received messages and repairs cached copies", () => {
  for (const direction of ["incoming", "outgoing"] as const) {
    const dom = [domMessage({ id: "anchor", text: "anchor", timestamp: 60_000 }),
      domMessage({ id: "weekday-label", text: "latest message", direction })];
    const api = [{ id: "api-anchor", text: "anchor", direction: "incoming" as const, timestamp: 60_100, order: 0 },
      { id: "api-latest", text: "latest message", direction, timestamp: 120_100, order: 1 }];
    const c: Conversation = { id: "c", accountId: "a", platformId: "123", name: "fixture", url: "", initialized: true,
      messages: [{ ...dom[0], platformMessageId: "api-anchor", observedAt: 0, baseline: true },
        { ...dom[1], observedAt: 100, baseline: false },
        { ...dom[1], id: "original-dated-label", platformMessageId: "api-latest", timestamp: 120_100, precision: "exact", observedAt: 0, baseline: false }] };
    const result = enrichBetaMessages(dom, api, [], 2);
    assert.equal(result.matched, 2);
    assert.equal(result.messages.at(-1)?.platformMessageId, "api-latest");
    assert.deepEqual(ingest(c, result.messages.map(m => ({ ...m, observedAt: 200 }))), []);
    assert.equal(c.messages.length, 2);
    assert.equal(c.messageRepairBackup?.messages.length, 3);
    ingest(c, dom.map(m => ({ ...m, observedAt: 300 })));
    assert.equal(c.messages.length, 2, "DOM fallback must retain the repaired identity");
  }
});

test("tail alignment requires the entire server suffix, preserves repeated sends and rejects unsupported rows", () => {
  const anchor = domMessage({ id: "anchor", text: "anchor", timestamp: 60_000 });
  const tail = [domMessage({ id: "one", text: "ok" }), domMessage({ id: "two", text: "ok" })];
  const api = [{ id: "api-anchor", text: "anchor", direction: "incoming" as const, timestamp: 60_100, order: 0 },
    { id: "api-one", text: "ok", direction: "incoming" as const, timestamp: 120_100, order: 1 },
    { id: "api-two", text: "ok", direction: "incoming" as const, timestamp: 121_100, order: 2 }];
  assert.deepEqual(enrichBetaMessages([anchor, ...tail], api, [], 3).messages.map(m => m.platformMessageId), ["api-anchor", "api-one", "api-two"]);
  for (const [dom, rows, total] of [
    [[anchor, tail[0]], api, 3],
    [[anchor, ...tail], api.slice(0, 2), 3],
    [[anchor, ...tail], api, 4],
    [[anchor, ...tail], api, undefined],
    [[...tail], api, 3],
  ] as const) {
    const result = enrichBetaMessages([...dom], [...rows], [], total);
    assert.ok(result.messages.filter(m => m.id !== "anchor").every(m => !m.platformMessageId));
  }
});
