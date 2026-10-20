// Vault mã hóa của master-chat: AES-256-GCM, khóa ngẫu nhiên được bọc bằng Keychain/DPAPI (Electron safeStorage).
// Không bao giờ ghi plaintext; thiếu khóa mà còn dữ liệu thì báo lỗi chứ không tạo vault mới đè lên.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, rename, access } from "node:fs/promises";
import path from "node:path";
import { seal, unseal } from "../src/core/crypto.ts";
import { emptyState, type State } from "../src/core/types.ts";
export type SecretStorage = {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
};
export class Vault {
  private key!: Buffer;
  private state = emptyState();
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private directory: string,
    private safeStorage: SecretStorage,
  ) {}
  async open() {
    if (!this.safeStorage.isEncryptionAvailable())
      throw new Error(
        "Không có kho khóa OS; ứng dụng từ chối lưu dữ liệu plaintext.",
      );
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const keyPath = path.join(this.directory, "key.secure");
    let wrapped: Buffer;
    try {
      wrapped = await readFile(keyPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      // A missing key must never replace an existing encrypted vault.
      try {
        await access(this.file());
        throw new Error("Vault tồn tại nhưng thiếu khóa.");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      wrapped = this.safeStorage.encryptString(
        randomBytes(32).toString("base64"),
      );
      await writeFile(keyPath, wrapped, { mode: 0o600, flag: "wx" });
    }
    this.key = Buffer.from(this.safeStorage.decryptString(wrapped), "base64");
    if (this.key.length !== 32) throw new Error("Khóa vault không hợp lệ.");
    try {
      this.state = JSON.parse(unseal(await readFile(this.file()), this.key));
      if (
        this.state.version !== 1 ||
        !Array.isArray(this.state.accounts) ||
        !Array.isArray(this.state.conversations)
      )
        throw new Error("Phiên bản vault không được hỗ trợ.");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      await this.persist(this.state);
    }
  }
  private file() {
    return path.join(this.directory, "data.vault");
  }
  // Nội dung lần ghi gần nhất: các vòng quét gọi mutate liên tục mà phần lớn không đổi gì → khỏi mã hóa + ghi đĩa lại.
  private persisted = "";
  private async persist(state: State) {
    const json = JSON.stringify(state);
    if (json === this.persisted) return;
    const target = this.file(),
      temp = `${target}.tmp`;
    await writeFile(temp, seal(json, this.key), {
      mode: 0o600,
    });
    await rename(temp, target);
    this.persisted = json;
  }
  read(): State {
    return structuredClone(this.state);
  }
  async mutate<T>(fn: (state: State) => T): Promise<T> {
    const task = this.queue.then(async () => {
      const next = structuredClone(this.state);
      const result = fn(next);
      await this.persist(next);
      this.state = next;
      return result;
    });
    this.queue = task.catch(() => undefined);
    return task;
  }
}
