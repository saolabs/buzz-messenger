import type { CallKind } from "./types.ts";

export type MediaDevice = "microphone" | "camera";
export type MediaAccessStatus = "not-determined" | "granted" | "denied" | "restricted" | "unknown";

// Linux has no systemPreferences media API. Chromium and the desktop/device
// backend handle capture there; returning null does not assert capture works.
export async function blockedCallDevice(kind: CallKind, platform: string, access: {
  status(device: MediaDevice): MediaAccessStatus;
  ask(device: MediaDevice): Promise<boolean>;
}): Promise<MediaDevice | null> {
  if (platform !== "darwin" && platform !== "win32") return null;
  const devices: MediaDevice[] = kind === "video" ? ["microphone", "camera"] : ["microphone"];
  for (const device of devices) {
    const status = access.status(device);
    if (status === "denied" || status === "restricted") return device;
    if (platform === "darwin" && status !== "granted" && !await access.ask(device)) return device;
    // Windows desktop apps cannot trigger the macOS consent dialog. An unknown
    // status is left to Chromium's actual capture request, not treated as denial.
  }
  return null;
}
