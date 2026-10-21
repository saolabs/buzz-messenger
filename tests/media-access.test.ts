import test from "node:test";
import assert from "node:assert/strict";
import { blockedCallDevice, type MediaAccessStatus, type MediaDevice } from "../src/core/media-access.ts";

function fixture(states: Partial<Record<MediaDevice, MediaAccessStatus>>, granted = true) {
  const checked: MediaDevice[] = [];
  const asked: MediaDevice[] = [];
  return {
    checked, asked,
    status(device: MediaDevice) { checked.push(device); return states[device] ?? "not-determined"; },
    async ask(device: MediaDevice) { asked.push(device); return granted; },
  };
}

test("macOS asks for undecided devices, never asks again for granted devices or camera on voice calls", async () => {
  const video = fixture({ microphone: "granted" });
  assert.equal(await blockedCallDevice("video", "darwin", video), null);
  assert.deepEqual(video.asked, ["camera"]);
  const voice = fixture({});
  assert.equal(await blockedCallDevice("voice", "darwin", voice), null);
  assert.deepEqual(voice.checked, ["microphone"]);
  assert.deepEqual(voice.asked, ["microphone"]);
});

test("macOS denial stops immediately; existing denial/restriction never repeats the OS prompt", async () => {
  const denied = fixture({}, false);
  assert.equal(await blockedCallDevice("video", "darwin", denied), "microphone");
  assert.deepEqual(denied.asked, ["microphone"]);
  for (const state of ["denied", "restricted"] as const) {
    const f = fixture({ microphone: "granted", camera: state });
    assert.equal(await blockedCallDevice("video", "darwin", f), "camera");
    assert.deepEqual(f.asked, []);
  }
});

test("Windows detects OS blocks without invoking the macOS-only API", async () => {
  const f = fixture({ microphone: "granted", camera: "denied" });
  assert.equal(await blockedCallDevice("video", "win32", f), "camera");
  assert.deepEqual(f.asked, []);
  for (const state of ["unknown", "not-determined", "granted"] as const) {
    const f = fixture({ microphone: state });
    assert.equal(await blockedCallDevice("voice", "win32", f), null);
    assert.deepEqual(f.asked, []);
  }
});

test("Linux never calls unsupported OS permission APIs", async () => {
  const f = fixture({});
  assert.equal(await blockedCallDevice("video", "linux", f), null);
  assert.deepEqual(f.checked, []);
  assert.deepEqual(f.asked, []);
});
