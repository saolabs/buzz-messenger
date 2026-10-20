// Copy the assets used by the app, keeping installer output out of the runtime tree.
import { access, cp, mkdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const extracted = join(root, "_extracted");
const target = join(root, "resources/ym");
const skinTypes = new Set([".png", ".gif", ".bmp", ".xml", ".ico", ".rgn"]);
const mediaTypes = new Set([".png", ".gif", ".bmp", ".xml", ".svg", ".wav"]);

for (const required of [
  "icon.png", "icon.svg", "Messenger/skins/Purple/colors.xml",
  "Messenger/Media/Smileys/emoticons.xml", "Messenger/Media/login/asleep.svg",
]) {
  try {
    await access(join(extracted, required));
  } catch {
    throw new Error(`Missing _extracted/${required}. Run npm run extract with the original installer first.`);
  }
}

await mkdir(target, { recursive: true });
for (const [directory, types] of [["skins", skinTypes], ["Media", mediaTypes]]) {
  await cp(join(extracted, "Messenger", directory), join(target, directory), {
    recursive: true,
    filter: (source) => {
      if (basename(source).startsWith(".")) return false;
      const extension = extname(source).toLowerCase();
      return !extension || types.has(extension);
    },
  });
}
for (const icon of ["icon.png", "icon.svg"]) {
  await cp(join(extracted, icon), join(target, icon));
}
console.log("Runtime assets prepared in resources/ym (skins, media, icons).");
