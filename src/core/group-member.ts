import type { GroupMember } from "./types.ts";

export type MemberRequest = { mode: "member" | "direct"; threadId: string; memberId: string; userId: string; deadline: number };
export type MemberResult = { status: "ready"; member?: GroupMember } | { status: "unavailable" };

// Read only. A group membership check precedes navigation; a separate direct
// participant check verifies the resulting (possibly E2EE) thread identity.
export async function messengerMemberPage(input: MemberRequest): Promise<MemberResult> {
  const check = () => {
    if (Date.now() >= input.deadline || location.protocol !== "https:" || location.port || !["www.facebook.com", "facebook.com"].includes(location.hostname) ||
      location.pathname.match(/^\/messages\/(?:e2ee\/)?t\/(\d+)\/?$/)?.[1] !== input.threadId || !/^\d{1,30}$/.test(input.memberId)) throw new Error("context");
    const req = (globalThis as any).require;
    if (typeof req !== "function" || String(req("CurrentUser").getID()) !== input.userId) throw new Error("account");
    return req;
  };
  try {
    const req = check(), I = req("I64"), key = I.of_string(input.threadId), memberKey = I.of_string(input.memberId);
    const db = await req("LSDatabaseSingleton").getLSDatabaseSingletonPromiseOrValue(); check();
    const thread = await db.table("threads").get(key); check();
    if (!thread || I.to_string(thread.threadKey) !== input.threadId) throw new Error("thread");
    const group = req("LSMessagingThreadTypeUtil").isGroup(thread.threadType);
    if (input.mode === "member") {
      if (group !== true) throw new Error("group");
      const participants = db.table("participants").entries(undefined, "asc", { gte: [key, memberKey], lte: [key, memberKey] });
      const first = await participants.next(); check();
      const row = first.done ? undefined : first.value?.[1];
      if (!row || I.to_string(row.threadKey) !== input.threadId || I.to_string(row.contactId) !== input.memberId) throw new Error("member");
      const last = await participants.next(); check(); if (!last.done) throw new Error("member");
      const c = await db.table("contacts").get(memberKey); check();
      const decode = (raw: unknown) => {
        try { const s = typeof raw === "string" ? req("MAWVault").unvault(raw) : undefined; return typeof s === "string" ? s.normalize("NFC").trim().slice(0, 200) : ""; } catch { return ""; }
      };
      const name = decode(c?.name); if (!name) throw new Error("name");
      return { status: "ready", member: { id: input.memberId, name, nickname: decode(row.nickname) || undefined, isSelf: input.memberId === input.userId, role: "unknown" } };
    }
    if (group !== false) throw new Error("direct");
    const iterator = db.table("participants").entries(undefined, "asc", { gte: [key], lte: [key] });
    const expected = new Set([input.userId, input.memberId]), found = new Set<string>();
    for (let n = 0; n < 3; n++) {
      const next = await iterator.next(); check();
      if (next.done) return found.size === expected.size ? { status: "ready" } : { status: "unavailable" };
      const row = next.value?.[1];
      if (!row || I.to_string(row.threadKey) !== input.threadId) throw new Error("scope");
      const id = I.to_string(row.contactId);
      if (!expected.has(id) || found.has(id)) throw new Error("recipient");
      found.add(id);
    }
    return { status: "unavailable" };
  } catch { return { status: "unavailable" }; }
}
export const messengerMemberScript = (input: MemberRequest) => `(()=>{const __name=(fn)=>fn;return (${messengerMemberPage.toString()})(${JSON.stringify(input)})})()`;
