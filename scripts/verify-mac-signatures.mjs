import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
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

// Hosted CI runners have no user account or remembered Facebook session.
// Confirm the packaged executable survives startup, including Chromium/V8 JIT.
if (process.argv.includes("--launch")) {
  if (!process.env.CI) throw new Error("Run --launch only on an isolated CI runner.");
  const child = spawn(join(app, "Contents/MacOS", productName), [], { stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (data) => { output = (output + data).slice(-4000); });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.removeAllListeners("exit");
      child.kill("SIGTERM");
      console.log("Packaged app remained running through the 8-second startup check.");
      resolve();
    }, 8000);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`Packaged app exited during startup (${code ?? signal}).\n${output}`));
    });
  });
}
