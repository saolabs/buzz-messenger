import type { WebContents } from "electron";
import { messengerBetaScript, type BetaRequest, type BetaResult } from "../src/core/messenger-beta.ts";

export type BetaMode = "on" | "read" | "off";
export const betaMode = (value = process.env.BUZZ_MESSENGER_API): BetaMode => value === "off" ? "off" : value === "read" ? "read" : "on";

export async function callMessengerBeta(
  wc: Pick<WebContents, "executeJavaScript" | "isDestroyed">,
  request: Omit<BetaRequest, "deadline">,
  timeout = request.action === "read" ? 5_500 : 26_000,
): Promise<BetaResult> {
  if (wc.isDestroyed()) return { status: "unavailable", reason: "closed" };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unknown = (): BetaResult => ({ status: request.action === "send" ? "uncertain" : "unavailable", reason: "execution" });
  try {
    return await Promise.race([
      wc.executeJavaScript(messengerBetaScript({ ...request, deadline: Date.now() + Math.max(1, timeout - 500) }))
        .then((r: BetaResult) => r && ["unavailable", "ready", "read", "submitted", "uncertain", "failed"].includes(r.status) ? r : unknown(), unknown),
      new Promise<BetaResult>(resolve => { timer = setTimeout(() => resolve(unknown()), timeout); }),
    ]);
  } catch { return unknown(); }
  finally { clearTimeout(timer); }
}

export async function tryMessengerBetaSend(
  wc: Pick<WebContents, "executeJavaScript" | "isDestroyed">,
  request: Pick<BetaRequest, "threadId" | "userId" | "text">,
  attempt: { clicked: boolean },
  beforeAttempt: () => Promise<void>,
): Promise<boolean> {
  const ready = await callMessengerBeta(wc, { ...request, action: "prepare-send" }, 6_000);
  if (ready.status !== "ready") return false;
  await beforeAttempt();
  attempt.clicked = true;
  const result = await callMessengerBeta(wc, { ...request, action: "send" });
  if (result.status === "unavailable") {
    // Only the page can prove no optimistic write/send was started.
    attempt.clicked = false;
    return false;
  }
  if (result.status === "submitted") return true;
  throw new Error(result.status === "failed"
    ? "Messenger từ chối tin gửi qua API beta. Kiểm tra hội thoại trước khi gửi lại."
    : "Chưa xác nhận kết quả gửi qua API beta. Kiểm tra Messenger; không tự gửi lại.");
}
