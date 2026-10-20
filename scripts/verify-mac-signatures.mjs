import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") throw new Error("macOS signature verification must run on macOS.");
const arch = process.argv[2];
if (!["arm64", "x64"].includes(arch)) throw new Error("Specify arm64 or x64.");
const root = fileURLToPath(new URL("../", import.meta.url));
const { build: { productName } } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const app = join(root, "dist", arch === "arm64" ? "mac-arm64" : "mac", `${productName}.app`);
const verified = spawnSync("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app], { stdio: "inherit" });
if (verified.error || verified.status !== 0) throw new Error("Packaged app has an invalid code signature.");
console.log("Packaged app signature is valid. This does not establish Developer ID trust or notarization.");

// Use a disposable profile and skip Messenger; never touch a remembered session.
// The app must prove its window is visible, React rendered, IPC works and assets load.
if (process.argv.includes("--launch")) {
  const profile = mkdtempSync(join(tmpdir(), "buzz-startup-"));
  try {
    const child = spawn(join(app, "Contents/MacOS", productName), ["--smoke-test"], {
      env: { ...process.env, BUZZ_SMOKE_USER_DATA: profile },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    for (const stream of [child.stdout, child.stderr]) stream.on("data", (data) => { output = (output + data).slice(-8000); });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill("SIGKILL"); }, 45_000);
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
      child.once("close", (code, signal) => {
        clearTimeout(timer);
        const marker = output.split("\n").find((line) => line.startsWith("BUZZ_STARTUP_OK "));
        if (code !== 0 || !marker) {
          reject(new Error(`Packaged window smoke failed (${code ?? signal}).\n${output}`));
          return;
        }
        const proof = JSON.parse(marker.slice("BUZZ_STARTUP_OK ".length));
        if (!["visible", "rendered", "ipc", "assets"].every((key) => proof[key] === true)) {
          reject(new Error(`Incomplete startup proof: ${marker}`));
          return;
        }
        console.log(marker);
        resolve();
      });
    });
  } finally {
    rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
  }
}
