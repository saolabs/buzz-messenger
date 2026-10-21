import type { WebContents } from "electron";
import { messengerGroupScript, type GroupRequest, type GroupSnapshot } from "../src/core/groups.ts";
import { messengerMemberScript, type MemberRequest, type MemberResult } from "../src/core/group-member.ts";

export async function callMemberRead(wc: Pick<WebContents, "executeJavaScript" | "isDestroyed">, input: Omit<MemberRequest, "deadline">): Promise<MemberResult> {
  if (wc.isDestroyed()) return { status: "unavailable" };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      wc.executeJavaScript(messengerMemberScript({ ...input, deadline: Date.now() + 2500 })).then((r: MemberResult) => r?.status === "ready" ? r : { status: "unavailable" as const }, () => ({ status: "unavailable" as const })),
      new Promise<MemberResult>(resolve => { timer = setTimeout(() => resolve({ status: "unavailable" }), 2800); }),
    ]);
  } finally { clearTimeout(timer); }
}

export async function callGroupRead(wc: Pick<WebContents, "executeJavaScript" | "isDestroyed">, input: Omit<GroupRequest, "deadline">): Promise<GroupSnapshot> {
  if (wc.isDestroyed()) return { status: "unavailable" };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      wc.executeJavaScript(messengerGroupScript({ ...input, deadline: Date.now() + 2500 })).then((r: GroupSnapshot) =>
        r?.status === "ready" && ["group", "direct"].includes(r.kind) ? r : { status: "unavailable" as const }, () => ({ status: "unavailable" as const })),
      new Promise<GroupSnapshot>(resolve => { timer = setTimeout(() => resolve({ status: "unavailable" }), 2800); }),
    ]);
  } catch { return { status: "unavailable" }; }
  finally { clearTimeout(timer); }
}
