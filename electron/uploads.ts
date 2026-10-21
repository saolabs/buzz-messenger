import { randomUUID } from "node:crypto";
import { stat, realpath } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";
import { validateUploadSizes, type StagedFile } from "../src/core/uploads.ts";

type Entry = StagedFile & { path: string; mtime: number; owner: number; contact: string; expires: number; claimed: boolean };
// Local selections only. Paths never cross back into the renderer or vault.
export class Uploads {
  private entries = new Map<string, Entry>();
  async stage(owner: number, contact: string, paths: string[]): Promise<StagedFile[]> {
    this.prune();
    if (!Array.isArray(paths) || !paths.length || paths.length > 10 || paths.some(p => typeof p !== "string" || !isAbsolute(p)))
      throw new Error("Danh sách tệp không hợp lệ.");
    if ([...this.entries.values()].filter(e => e.owner === owner).length + paths.length > 30)
      throw new Error("Hãy bỏ bớt tệp đang chờ gửi.");
    const entries = await Promise.all(paths.map(async p => {
      const path = await realpath(p), info = await stat(path);
      if (!info.isFile()) throw new Error("Chỉ có thể gửi tệp; không gửi cả thư mục.");
      return { id: randomUUID(), path, name: basename(path), size: info.size, mtime: info.mtimeMs,
        image: /\.(png|jpe?g|gif|webp)$/i.test(path), owner, contact, expires: Date.now() + 30 * 60_000, claimed: false };
    }));
    validateUploadSizes(entries);
    for (const e of entries) this.entries.set(e.id, e);
    return entries.map(({ id, name, size, image }) => ({ id, name, size, image }));
  }
  async claim(owner: number, contact: string, ids: string[]) {
    this.prune();
    if (!Array.isArray(ids) || new Set(ids).size !== ids.length) throw new Error("Danh sách tệp không hợp lệ.");
    const files = ids.map(id => this.entries.get(id));
    if (files.some(e => !e || e.owner !== owner || e.contact !== contact || e.claimed))
      throw new Error("Tệp đã hết hạn hoặc không thuộc hội thoại này. Chọn lại tệp.");
    const entries = files as Entry[];
    validateUploadSizes(entries);
    // Claim before awaiting disk checks, preventing overlapping sends.
    for (const e of entries) e.claimed = true;
    try {
      for (const e of entries) {
        const info = await stat(e.path);
        if (!info.isFile() || info.size !== e.size || info.mtimeMs !== e.mtime)
          throw new Error("Tệp đã thay đổi sau khi chọn. Hãy chọn lại tệp.");
      }
      return entries;
    } catch (error) { this.finish(ids, false); throw error; }
  }
  finish(ids: string[], attempted: boolean) {
    for (const id of ids) {
      const e = this.entries.get(id);
      if (attempted) this.entries.delete(id);
      else if (e) e.claimed = false;
    }
  }
  discard(owner: number, ids?: string[]) {
    for (const [id, e] of this.entries) if (e.owner === owner && !e.claimed && (!ids || ids.includes(id))) this.entries.delete(id);
  }
  clear() { this.entries.clear(); }
  private prune() { for (const [id, e] of this.entries) if (!e.claimed && e.expires <= Date.now()) this.entries.delete(id); }
}
