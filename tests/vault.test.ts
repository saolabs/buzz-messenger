import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { Vault, type SecretStorage } from "../electron/vault.ts";
import { seal, unseal } from "../src/core/crypto.ts";

// Port từ master-chat (bỏ phần dữ liệu AI): vault không bao giờ để lộ plaintext hay tự tạo lại khi hỏng.
const osKey = randomBytes(32);
const secrets: SecretStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => seal(value, osKey),
  decryptString: (value) => unseal(value, osKey),
};
async function directory(t: TestContext) {
  const dir = await mkdtemp(path.join(tmpdir(), "ym-vault-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
const account = (n: number) => ({ id: String(n), name: "x", platform: "messenger-personal" as const, username: "u", password: "secret-password-unique", cookies: [] });

test("vault roundtrip and parallel mutations preserve all data encrypted", async (t) => {
  const dir = await directory(t),
    v = new Vault(dir, secrets);
  await v.open();
  await Promise.all(Array.from({ length: 8 }, (_, n) => v.mutate((s) => void s.accounts.push(account(n)))));
  assert.equal(v.read().accounts.length, 8);
  const bytes = await readFile(path.join(dir, "data.vault"));
  assert.equal(bytes.includes(Buffer.from("secret-password-unique")), false);
  const reopened = new Vault(dir, secrets);
  await reopened.open();
  assert.equal(reopened.read().accounts.length, 8);
});

test("corrupted vault is preserved and never silently reset", async (t) => {
  const dir = await directory(t),
    v = new Vault(dir, secrets);
  await v.open();
  const target = path.join(dir, "data.vault"),
    bytes = await readFile(target);
  bytes[bytes.length - 1] ^= 1;
  await writeFile(target, bytes);
  await assert.rejects(new Vault(dir, secrets).open());
  assert.deepEqual(await readFile(target), bytes);
});

test("missing key with existing vault cannot regenerate a new key", async (t) => {
  const dir = await directory(t);
  await new Vault(dir, secrets).open();
  await rm(path.join(dir, "key.secure"));
  await assert.rejects(new Vault(dir, secrets).open(), /thiếu khóa/);
});

test("no OS encryption means no plaintext fallback", async (t) => {
  const dir = await directory(t);
  await assert.rejects(new Vault(dir, { ...secrets, isEncryptionAvailable: () => false }).open(), /plaintext/);
});

test("mutation that changes nothing skips re-encrypting and rewriting", async (t) => {
  const dir = await directory(t),
    v = new Vault(dir, secrets);
  await v.open();
  await v.mutate((s) => void s.accounts.push(account(1)));
  const target = path.join(dir, "data.vault"),
    before = await readFile(target);
  await v.mutate((s) => void (s.accounts[0].name = "x"));
  assert.deepEqual(await readFile(target), before);
  await v.mutate((s) => void (s.accounts[0].name = "y"));
  assert.notDeepEqual(await readFile(target), before);
});
