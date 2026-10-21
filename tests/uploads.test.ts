import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Uploads } from "../electron/uploads.ts";
import { MAX_UPLOAD_BYTES, validateUploadSizes } from "../src/core/uploads.ts";

test("upload sizes reject excessive counts, per-file bytes and aggregate size", () => {
  assert.throws(() => validateUploadSizes([]));
  assert.throws(() => validateUploadSizes(Array.from({ length: 11 }, () => ({ size: 1 }))));
  assert.throws(() => validateUploadSizes([{ size: MAX_UPLOAD_BYTES + 1 }]));
  assert.throws(() => validateUploadSizes([{ size: 20e6 }, { size: 20e6 }, { size: 20e6 }]));
  assert.doesNotThrow(() => validateUploadSizes([{ size: 0 }, { size: MAX_UPLOAD_BYTES }]));
});
test("upload tokens bind disk selections to their window and recipient, and cannot be reused after an attempt", async () => {
  const dir = await mkdtemp(join(tmpdir(), "buzz-uploads-"));
  try {
    const file = join(dir, "test.txt"); await writeFile(file, "offline");
    const uploads = new Uploads(), [staged] = await uploads.stage(1, "a", [file]);
    assert.equal(staged.name, "test.txt"); assert.equal("path" in staged, false);
    await assert.rejects(uploads.claim(2, "a", [staged.id]));
    await assert.rejects(uploads.claim(1, "b", [staged.id]));
    await assert.rejects(uploads.claim(1, "a", [staged.id, staged.id]));
    assert.equal((await uploads.claim(1, "a", [staged.id]))[0].path, await realpath(file));
    await assert.rejects(uploads.claim(1, "a", [staged.id]));
    uploads.finish([staged.id], false);
    await uploads.claim(1, "a", [staged.id]); uploads.finish([staged.id], true);
    await assert.rejects(uploads.claim(1, "a", [staged.id]));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("changed or removed files, directories, and discarded selections cannot be sent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "buzz-uploads-"));
  try {
    const file = join(dir, "image.png"); await writeFile(file, "fixture");
    const uploads = new Uploads(), [staged] = await uploads.stage(1, "a", [file]);
    assert.equal(staged.image, true);
    await writeFile(file, "changed content");
    await assert.rejects(uploads.claim(1, "a", [staged.id]), /thay đổi/);
    const [other] = await uploads.stage(1, "a", [file]);
    uploads.discard(2, [other.id]); await uploads.claim(1, "a", [other.id]);
    uploads.finish([other.id], false); uploads.discard(1, [other.id]);
    await assert.rejects(uploads.claim(1, "a", [other.id]));
    await mkdir(join(dir, "folder")); await assert.rejects(uploads.stage(1, "a", [join(dir, "folder")]));
    await assert.rejects(uploads.stage(1, "a", ["relative.txt"]));
    const [removed] = await uploads.stage(1, "a", [file]); await rm(file);
    await assert.rejects(uploads.claim(1, "a", [removed.id]));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
