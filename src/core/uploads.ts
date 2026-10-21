export const MAX_UPLOAD_FILES = 10;
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_UPLOAD_TOTAL = 50 * 1024 * 1024;

export type StagedFile = { id: string; name: string; size: number; image: boolean };
export type FileSendResult = { ok: boolean; attempted?: boolean; error?: string };
export const AUDIBLES = [
  { id: "buzz", file: "buzz.wav", name: "BUZZ!" },
  { id: "yodel", file: "RingTones/yodel.wav", name: "Yahoo!" },
  { id: "hello", file: "online.wav", name: "Hello!" },
] as const;

export function validateUploadSizes(files: { size: number }[]) {
  if (!files.length || files.length > MAX_UPLOAD_FILES) throw new Error("Chọn từ 1 đến 10 tệp mỗi lần.");
  if (files.some(f => !Number.isSafeInteger(f.size) || f.size < 0 || f.size > MAX_UPLOAD_BYTES))
    throw new Error("Mỗi tệp tối đa 25 MB.");
  if (files.reduce((sum, f) => sum + f.size, 0) > MAX_UPLOAD_TOTAL) throw new Error("Tổng tệp mỗi lần tối đa 50 MB.");
}
