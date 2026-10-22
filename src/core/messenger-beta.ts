import type { NativeMessage } from "./messenger.ts";

export type BetaRequest = {
  action: "read" | "prepare-send" | "send";
  threadId: string;
  userId: string;
  text?: string;
  limit?: number;
  deadline: number;
};
export type BetaText = { id: string; text: string; direction: "incoming" | "outgoing"; timestamp: number; order?: number };
export type BetaMedia = { id: string; kind: "image"; sticker: boolean; direction: "incoming" | "outgoing"; timestamp: number; order: number };
export type BetaResult =
  | { status: "unavailable"; reason: string }
  | { status: "ready" }
  | { status: "read"; messages: BetaText[]; media?: BetaMedia[]; total: number }
  | { status: "submitted"; externalId: string }
  | { status: "uncertain" | "failed"; reason: string };

// Runs entirely in Messenger's main world. Never exports cookies, keys, JIDs or modules.
// Keep this function self-contained: its source is serialized into the embedded page.
export async function messengerBetaPage(input: BetaRequest): Promise<BetaResult> {
  let attempted = false;
  let expired = false;
  const expires = Math.min(input.deadline, Date.now() + (input.action === "read" ? 5_000 : 25_000));
  const identity = () => {
    if (location.protocol !== "https:" || !["facebook.com", "www.facebook.com"].includes(location.hostname) || location.port)
      throw new Error("origin");
    const id = location.pathname.match(/^\/messages\/(?:e2ee\/)?t\/(\d+)\/?$/)?.[1];
    if (!id || id !== input.threadId || expired || Date.now() >= expires) throw new Error("context");
    const req = (globalThis as any).require;
    if (typeof req !== "function" || String(req("CurrentUser").getID()) !== input.userId) throw new Error("account");
    return req;
  };
  const run = async (): Promise<BetaResult> => {
    try {
      const req = identity(), I = req("I64");
      const db = await req("LSDatabaseSingleton").getLSDatabaseSingletonPromiseOrValue();
      const key = I.of_string(input.threadId);
      const thread = await db.table("threads").get(key);
      if (!thread || I.to_string(thread.threadKey) !== input.threadId) throw new Error("thread");
      if (req("LSMessagingThreadTypeUtil").isArmadilloSecure(thread.threadType) !== true) throw new Error("not_secure");
      const jid = await req("MAWMiActMappingTableAPI").getChatJidForThreadKey(db.tables, key, thread.threadType);
      if (!jid) throw new Error("mapping");
      identity();

      if (input.action === "read") {
        const result = await req("MpsOverBridge").mps().loadMessages({
          config: { useMessageVisibility: true }, debug: { purpose: "load-more" },
          direction: "desc", from: [I.to_float(I.max_int), ""],
          numMessages: Math.min(200, Math.max(1, input.limit ?? 100)),
          threadId: req("MpsTypes").toThreadId(jid),
        });
        identity();
        if (result?.success !== true || !Array.isArray(result.value?.messages)) throw new Error("read");
        const converted = req("MpsMessageToLoadResponse").messageToLoadMsgsResponse(result.value.messages, undefined, { chatJid: jid });
        if (!Array.isArray(converted.msgs)) throw new Error("schema");
        const vault = req("MAWVault");
        const messages: BetaText[] = [];
        const media: BetaMedia[] = [];
        const rows = [...converted.msgs].sort((a, b) => (a.sortOrderMs ?? a.ts * 1000) - (b.sortOrderMs ?? b.ts * 1000));
        for (const [order, m] of rows.entries()) {
          if (JSON.stringify(m.chatJid) !== JSON.stringify(jid)) throw new Error("response_thread");
          // Media and system content still use the established DOM renderer.
          if (m.isAdminMessage || typeof m.isAuthorMe !== "boolean") continue;
          const id = m.externalId || m.msgId;
          const timestamp = Number.isFinite(m.ts) ? Math.round(m.ts * 1000) : m.sortOrderMs;
          if (typeof id !== "string" || !id || !Number.isSafeInteger(timestamp) || timestamp <= 0 || timestamp > Date.now() + 300_000) continue;
          const direction = m.isAuthorMe ? "outgoing" as const : "incoming" as const;
          if (m.type_ === "Image" || m.type_ === "Sticker") {
            media.push({ id, kind: "image", sticker: m.type_ === "Sticker", direction, timestamp, order });
            continue;
          }
          if (m.type_ !== "Text" || typeof m.content !== "string") continue;
          const text = vault.unvault(m.content);
          if (typeof text !== "string" || !text.trim()) continue;
          messages.push({ id, text, timestamp, direction, order });
        }
        return { status: "read", messages: messages.sort((a, b) => a.timestamp - b.timestamp), media, total: converted.msgs.length };
      }

      // Resolve every dependency before any optimistic write or network send.
      const bridge = req("MAWBridgeSendAndReceive"), external = req("MAWExternalId");
      const optimistic = req("MAWOptimisticMessageUtils"), build = req("MAWCreateOptimisticSecureMessage");
      const vault = req("MAWVault"), ephemeral = req("MAWGetEphemeralSettings");
      const reporter = req("MAWMessageSendReporter"), logger = req("sendToSentQPLLogger");
      const event = req("qpl")._(25313175, "1551");
      const source = req("LSIntEnum").ofNumber(req("LSMessagingThreadAttributionType").UNKNOWN);
      const initiatingSource = req("LSMessagingInitiatingSource").FACEBOOK_INBOX;
      if ([bridge.sendAndReceive, external.generateExternalId, optimistic.getOptimisticMessageTimestamp,
        optimistic.optimisticBumpThread, build.buildOptimisticLsMessage, vault.vault, ephemeral.getEphemeralSetting,
        reporter.MAWMessageSendReporter, logger.markSendToSentStart, db.runInTransaction].some(f => typeof f !== "function"))
        throw new Error("send_schema");
      if (input.action === "prepare-send") return { status: "ready" };
      if (typeof input.text !== "string" || !input.text.trim() || input.text.length > 5000) throw new Error("text");

      const ephemeralSetting = await ephemeral.getEphemeralSetting(jid, key);
      identity();
      const externalId = external.generateExternalId();
      if (typeof externalId !== "string" || !externalId) throw new Error("external_id");
      const ts = optimistic.getOptimisticMessageTimestamp();
      const vaulted = vault.vault(input.text);
      const instance = logger.markSendToSentStart();
      const actor = I.of_string(input.userId);
      identity();
      // From this point onward no DOM fallback or automatic retry is permitted.
      attempted = true;
      await db.runInTransaction(async (tx: any) => {
        identity();
        const row = await build.buildOptimisticLsMessage(
          db, tx, actor, undefined, vaulted, key, undefined, instance,
          undefined, externalId, I.of_float(ts), 1, undefined, undefined,
        );
        await tx.messages.add(row);
        await optimistic.optimisticBumpThread(tx, { threadKey: key });
      }, "readwrite", "ui", undefined, "buzz-beta:send");
      identity();
      const task = bridge.sendAndReceive("backend", "sendMsg", {
        args: {
          content: input.text, initiatingSource, isFirstMsg: false, isForwarded: false,
          optimisticMsg: { msgId: externalId, ts }, source,
          ...(ephemeralSetting != null ? { ephemeralSetting } : {}),
        },
        chatJid: jid, externalId, qplEventType: event, qplInstanceKey: instance,
      });
      await reporter.MAWMessageSendReporter({ chatJid: jid, externalId }, task,
        { qplEventType: event, qplInstanceKey: instance }, db, undefined, 0);
      const ack = await task;
      if (ack?.success === false) return { status: "failed", reason: "worker_rejected" };
      if (ack?.success !== true || ack.value?.externalId !== externalId || ack.value?.messageType !== "sendMsg")
        return { status: "uncertain", reason: "ack" };
      return { status: "submitted", externalId };
    } catch {
      // Runtime exceptions can include text, JIDs or source containing secrets. Do not propagate them.
      return { status: attempted ? "uncertain" : "unavailable", reason: attempted ? "runtime_after_attempt" : "runtime_contract" };
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      run(),
      new Promise<BetaResult>(resolve => {
        timer = setTimeout(() => {
          expired = true;
          resolve({ status: attempted ? "uncertain" : "unavailable", reason: "timeout" });
        }, Math.max(0, expires - Date.now()));
      }),
    ]);
  } finally { clearTimeout(timer); }
}

export function messengerBetaScript(input: BetaRequest): string {
  // tsx/esbuild may retain inferred function names using this helper.
  return `(() => { const __name = (value) => value; return (${messengerBetaPage.toString()})(${JSON.stringify(input)}); })()`;
}

// Keep DOM media and local IDs. Match dated rows first, then fill only complete
// ordered spans bounded by known server IDs or the verified end of the API
// window. A partial repeated-text window cannot borrow another occurrence's ID.
export function enrichBetaMessages(dom: NativeMessage[], api: BetaText[], media: BetaMedia[] = [], total?: number): { messages: NativeMessage[]; matched: number } {
  const signature = (m: { direction: string; text: string }) => JSON.stringify([m.direction, m.text.normalize("NFC")]);
  type Candidate = BetaText | BetaMedia;
  const domGroups = new Map<string, number[]>(), groups = new Map<string, BetaText[]>();
  dom.forEach((m, i) => domGroups.set(signature(m), [...(domGroups.get(signature(m)) ?? []), i]));
  for (const m of api) groups.set(signature(m), [...(groups.get(signature(m)) ?? []), m]);
  const dated = (m: NativeMessage, c: Candidate) => m.timestamp !== null && Math.abs(m.timestamp - c.timestamp) < 90_000;
  const compatible = (m: NativeMessage, c: Candidate) => m.direction === c.direction &&
    ("kind" in c ? Boolean(m.attachments?.some(a => a.kind === c.kind && Boolean(a.sticker) === c.sticker)) : signature(m) === signature(c));
  const proposals = new Map<number, Candidate>();
  for (const [key, indexes] of domGroups) {
    const candidates = groups.get(key);
    if (!candidates || indexes.length !== candidates.length || new Set(candidates.map(m => m.id)).size !== candidates.length) continue;
    if (indexes.every((i, n) => dom[i].text && compatible(dom[i], candidates[n]) && dated(dom[i], candidates[n])))
      indexes.forEach((i, n) => proposals.set(i, candidates[n]));
  }
  dom.forEach((m, i) => {
    if (proposals.has(i)) return;
    const candidates = media.filter(c => compatible(m, c) && dated(m, c));
    if (candidates.length === 1) proposals.set(i, candidates[0]);
  });
  const counts = new Map<string, number>();
  for (const c of proposals.values()) counts.set(c.id, (counts.get(c.id) ?? 0) + 1);
  for (const [i, c] of proposals) if (counts.get(c.id) !== 1) proposals.delete(i);
  const all = [...api, ...media];
  const byOrder = new Map(all.filter(c => c.order !== undefined).map(c => [c.order!, c]));
  const anchors = [...proposals.entries()].sort((a, b) => a[0] - b[0]);
  for (let n = 1; n < anchors.length; n++) {
    const [left, a] = anchors[n - 1], [right, b] = anchors[n];
    if (a.order === undefined || b.order === undefined || b.order - a.order !== right - left) continue;
    const span: [number, Candidate][] = [];
    for (let i = left + 1; i < right; i++) {
      const c = byOrder.get(a.order + i - left);
      if (!c || !compatible(dom[i], c) || (dom[i].timestamp !== null && !dated(dom[i], c)) || counts.has(c.id)) { span.length = 0; break; }
      span.push([i, c]);
    }
    if (span.length !== right - left - 1 || new Set(span.map(([, c]) => c.id)).size !== span.length) continue;
    for (const [i, c] of span) { proposals.set(i, c); counts.set(c.id, 1); }
  }
  // Weekday labels have no reliable absolute date. At the timeline's end we
  // can still bind them when every row after a dated anchor agrees with the
  // entire remaining API window. `total` includes unsupported/system rows so
  // missing rows, partial history and stale API snapshots cannot shorten it.
  const lastAnchor = anchors.at(-1);
  if (lastAnchor && Number.isSafeInteger(total)) {
    const [left, a] = lastAnchor;
    const length = dom.length - left - 1;
    if (a.order !== undefined && length > 0 && a.order + length === total! - 1) {
      const tail: [number, Candidate][] = [];
      for (let i = left + 1; i < dom.length; i++) {
        const c = byOrder.get(a.order + i - left);
        if (!c || !compatible(dom[i], c) || (dom[i].timestamp !== null && !dated(dom[i], c)) || counts.has(c.id)) { tail.length = 0; break; }
        tail.push([i, c]);
      }
      if (tail.length === length && new Set(tail.map(([, c]) => c.id)).size === length)
        for (const [i, c] of tail) proposals.set(i, c);
    }
  }
  return { matched: proposals.size, messages: dom.map((m, i) => {
    const c = proposals.get(i);
    return c ? { ...m, timestamp: c.timestamp, precision: "exact" as const, platformMessageId: c.id } : m;
  }) };
}
