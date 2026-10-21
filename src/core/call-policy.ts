import type { CallKind } from "./types.ts";
import { facebookUrl, threadIdentity } from "./urls.ts";

export function facebookCallUrl(value: string): boolean {
  try {
    return /^\/(?:calls?|videocall|messages\/(?:calls?|videocall))(?:\/|$)/.test(facebookUrl(value).pathname);
  } catch { return false; }
}

export function callMediaAllowed(input: {
  kind: CallKind;
  threadId: string;
  topUrl: string;
  requestingUrl: string;
  visible: boolean;
  mediaTypes: readonly string[];
}): boolean {
  try {
    facebookUrl(input.requestingUrl);
    if (!input.visible || !input.mediaTypes.length) return false;
    if (threadIdentity(input.topUrl) !== input.threadId && !facebookCallUrl(input.topUrl)) return false;
    return input.mediaTypes.every((type) => type === "audio" || (type === "video" && input.kind === "video"));
  } catch { return false; }
}
