import type { GroupInfo, GroupMember, Message } from "./types.ts";
import type { MessengerRead, NativeMessage } from "./messenger.ts";

export type GroupRequest = { threadId: string; userId: string; deadline: number; cursor?: string; oldest?: number; newest?: number; limit?: number };
export type GroupMessage = { id: string; senderId: string; name: string; nickname?: string; text?: string; timestamp: number };
export type GroupSnapshot = { status: "ready"; kind: "group" | "direct"; group?: GroupInfo; messages: GroupMessage[]; messagesComplete?: boolean } | { status: "unavailable" };

// Serialized into Messenger. Read only; every iterator has a thread-key bound.
export async function messengerGroupPage(input: GroupRequest): Promise<GroupSnapshot> {
  const check = () => {
    if (Date.now() >= input.deadline || location.protocol !== "https:" || location.port || !["www.facebook.com", "facebook.com"].includes(location.hostname) ||
      location.pathname.match(/^\/messages\/(?:e2ee\/)?t\/(\d+)\/?$/)?.[1] !== input.threadId) throw new Error("context");
    const req = (globalThis as any).require;
    if (typeof req !== "function" || String(req("CurrentUser").getID()) !== input.userId) throw new Error("account");
    return req;
  };
  try {
    const req = check(), I = req("I64"), db = await req("LSDatabaseSingleton").getLSDatabaseSingletonPromiseOrValue(), key = I.of_string(input.threadId);
    check();
    const thread = await db.table("threads").get(key);
    check();
    if (!thread || I.to_string(thread.threadKey) !== input.threadId) throw new Error("thread");
    const isGroup = req("LSMessagingThreadTypeUtil").isGroup(thread.threadType);
    if (typeof isGroup !== "boolean") throw new Error("schema");
    if (!isGroup) return { status: "ready", kind: "direct", messages: [] };
    let vault: any;
    try { vault = req("MAWVault"); } catch {}
    const decode = (value: unknown) => {
      if (typeof value !== "string" || typeof vault?.unvault !== "function") return undefined;
      try { const text = vault.unvault(value); return typeof text === "string" ? text.normalize("NFC") : undefined; } catch { return undefined; }
    };
    if (input.cursor && !/^\d+$/.test(input.cursor)) throw new Error("cursor");
    const bounds = { ...(input.cursor ? { gt: [key, I.of_string(input.cursor)] } : { gte: [key] }), lte: [key] };
    const iterator = db.table("participants").entries(undefined, "asc", bounds), members = [], profiles = new Map<string, any>();
    let complete = true;
    const safeAvatar = (raw: unknown) => {
      if (typeof raw !== "string") return undefined;
      try { const u = new URL(raw); return u.protocol === "https:" && /(^|\.)fbcdn\.net$/.test(u.hostname) ? u.href : undefined; } catch { return undefined; }
    };
    const profile = async (id: string, contactKey: any) => {
      if (profiles.has(id)) return profiles.get(id);
      check();
      const c = await db.table("contacts").get(contactKey);
      check();
      const value = { id, name: decode(c?.name)?.trim().slice(0, 200) ?? "", avatar: safeAvatar(c?.profilePictureUrl) };
      profiles.set(id, value);
      return value;
    };
    for (let n = 0; n <= 100; n++) {
      check();
      const next = await iterator.next();
      check();
      if (next.done) break;
      const row = next.value?.[1];
      if (!row || I.to_string(row.threadKey) !== input.threadId) throw new Error("scope");
      const id = I.to_string(row.contactId);
      if (!/^\d+$/.test(id) || (input.cursor && BigInt(id) <= BigInt(input.cursor))) throw new Error("scope");
      if (n === 100) { complete = false; break; }
      const c = await profile(id, row.contactId);
      const nickname = decode(row.nickname)?.trim().slice(0, 200) || undefined;
      members.push({ ...c, nickname, role: row.isAdmin === true || row.isSuperAdmin === true ? "admin" as const : row.isAdmin === false ? "member" as const : "unknown" as const, isSelf: id === input.userId });
    }
    const count = thread.memberCount == null ? undefined : Number(I.to_string(thread.memberCount));
    const group: GroupInfo = { members, complete: complete && (Boolean(input.cursor) || count === undefined || members.length >= count), updatedAt: Date.now(),
      ...(Number.isSafeInteger(count) && count! >= 0 ? { memberCount: count } : {}),
      ...(!complete && members.length ? { nextCursor: members.at(-1)!.id } : {}) };
    const messageBounds = { gte: input.oldest ? [key, I.of_float(Math.max(0, input.oldest - 90_000))] : [key],
      lte: input.newest ? [key, I.of_float(input.newest + 90_000)] : [key] };
    const messages: GroupMessage[] = [], mi = db.table("messages").entries(undefined, "desc", messageBounds);
    let messagesComplete = false;
    for (let n = 0; n < Math.min(500, Math.max(0, input.limit ?? 200)); n++) {
      check(); const next = await mi.next(); check();
      if (next.done) { messagesComplete = true; break; }
      const row = next.value?.[1];
      if (!row || I.to_string(row.threadKey) !== input.threadId) throw new Error("scope");
      if (row.isAdminMessage || typeof row.messageId !== "string" || !row.senderId) continue;
      const senderId = I.to_string(row.senderId), timestamp = Number(I.to_string(row.timestampMs));
      if (!/^\d+$/.test(senderId) || !Number.isSafeInteger(timestamp) || timestamp <= 0 || timestamp > Date.now() + 300_000) continue;
      if (!profiles.has(senderId) && profiles.size >= 150) continue;
      const c = await profile(senderId, row.senderId), member = members.find(m => m.id === senderId);
      const text = decode(row.text);
      messages.push({ id: row.messageId, senderId, name: c.name, nickname: member?.nickname, timestamp,
        ...(typeof text === "string" && text.length <= 5000 ? { text: text.normalize("NFC") } : {}) });
    }
    check();
    return { status: "ready", kind: "group", group, messages, messagesComplete };
  } catch { return { status: "unavailable" }; }
}
export const messengerGroupScript = (input: GroupRequest) => `(()=>{const __name=(fn)=>fn;return (${messengerGroupPage.toString()})(${JSON.stringify(input)})})()`;

export const sameSender = (a?: Message["sender"], b?: Message["sender"]) => !a || !b ||
  (a.id && b.id ? a.id === b.id : [a.name, a.nickname].some(name => name && [b.name, b.nickname].some(other => other && name.normalize("NFC") === other.normalize("NFC"))));

export function groupSender(sender: Message["sender"], direction: Message["direction"], members: GroupMember[] = []): Message["sender"] {
  const norm = (s: string) => s.normalize("NFC").trim().toLowerCase();
  const matches = members.filter(m => sender?.id ? m.id === sender.id : direction === "outgoing" ? m.isSelf : sender && [m.name, m.nickname].some(n => n && norm(n) === norm(sender.name)));
  return matches.length === 1 ? { id: matches[0].id, name: matches[0].name, nickname: matches[0].nickname } : sender;
}

export function enrichGroupRead(read: MessengerRead, snapshot: GroupSnapshot): MessengerRead {
  if (snapshot.status !== "ready" || snapshot.kind !== "group" || !snapshot.group || read.blocked) return read;
  const norm = (s: string) => s.normalize("NFC").trim().toLowerCase();
  const messages = read.messages.map((raw): NativeMessage => {
    const fallbackSender = groupSender(raw.sender, raw.direction, snapshot.group!.members);
    const named = (m: GroupMessage) => fallbackSender?.id ? fallbackSender.id === m.senderId :
      !!raw.sender && [m.name, m.nickname].some(name => name && norm(name) === norm(raw.sender!.name));
    const dated = (m: GroupMessage) => raw.timestamp !== null && Math.floor(raw.timestamp / 60_000) === Math.floor(m.timestamp / 60_000);
    const textual = (m: GroupMessage) => m.text !== undefined && m.text === raw.text.normalize("NFC") && dated(m);
    const exact = snapshot.messages.filter(m => m.id === (raw.platformMessageId ?? (raw.identity === "platform" ? raw.id : undefined)) && named(m));
    const candidates = exact.length ? exact : snapshot.messagesComplete ? snapshot.messages.filter(m => named(m) && textual(m)) : [];
    const selected = candidates.length === 1 ? candidates[0] : undefined;
    // Keep the old fingerprint formula; sender qualification is performed in
    // the DOM reader, including every send preflight and media lookup.
    const sender = selected ? { id: selected.senderId, name: selected.name || raw.sender?.name || "", nickname: selected.nickname } : fallbackSender;
    const aliases = [...(raw.aliasIds ?? [])];
    if (selected && snapshot.messagesComplete && raw.legacyFingerprintId && snapshot.messages.filter(textual).length === 1) aliases.push(raw.legacyFingerprintId);
    return { ...raw, sender, ...(selected ? { platformMessageId: selected.id, timestamp: selected.timestamp, precision: "exact" as const } : {}),
      ...(aliases.length ? { aliasIds: [...new Set(aliases)] } : {}) };
  });
  const counts = new Map<string, number>();
  for (const m of messages) if (m.platformMessageId) counts.set(m.platformMessageId, (counts.get(m.platformMessageId) ?? 0) + 1);
  return { ...read, messages: messages.map((m, i) => m.platformMessageId && counts.get(m.platformMessageId)! > 1 &&
    read.messages[i].platformMessageId !== m.platformMessageId && !(read.messages[i].identity === "platform" && read.messages[i].id === m.platformMessageId) ? read.messages[i] : m) };
}
