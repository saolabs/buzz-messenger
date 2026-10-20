import type { Account, Platform } from "./types.ts";
export function facebookUrl(value: string): URL {
  const u = new URL(value);
  if (
    u.protocol !== "https:" ||
    !["www.facebook.com", "facebook.com"].includes(u.hostname) ||
    u.username ||
    u.password ||
    u.port
  )
    throw new Error("Chỉ cho phép trang HTTPS Facebook.");
  return u;
}
export function threadIdentity(
  value: string,
  platform: Platform = "messenger-personal",
): string | null {
  const u = facebookUrl(value);
  if (platform === "messenger-personal")
    return (
      u.pathname.match(/^\/messages\/(?:e2ee\/)?t\/(\d+)\/?$/)?.[1] ?? null
    );
  return null;
}
export function inboxUrl(_a?: Pick<Account, "platform">): string {
  return "https://www.facebook.com/messages/";
}
