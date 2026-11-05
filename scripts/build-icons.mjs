// Regenerate the checked-in Pebble assets on macOS with npm run icons.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") throw new Error("Icon generation requires macOS sips and iconutil.");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const build = path.join(root, "build");
const icons = path.join(build, "icons");
const web = path.join(root, "src/renderer/public");
const tmp = mkdtempSync(path.join(os.tmpdir(), "clay-icons-"));
const artwork = readFileSync(path.join(build, "icon.svg"), "utf8");
const sizes = [16, 24, 32, 48, 64, 96, 128, 256, 512, 1024];

const svgAtSize = (size) => artwork.replace(/width="\d+" height="\d+"/, `width="${size}" height="${size}"`);

function render(size, destination) {
  const input = path.join(tmp, "source.svg");
  writeFileSync(input, svgAtSize(size));
  execFileSync("sips", ["-s", "format", "png", input, "--out", destination], { stdio: "pipe" });
}

try {
  mkdirSync(icons, { recursive: true });
  mkdirSync(web, { recursive: true });
  for (const size of sizes) render(size, path.join(icons, `${size}x${size}.png`));
  copyFileSync(path.join(icons, "512x512.png"), path.join(build, "icon.png"));

  const iconset = path.join(tmp, "Clay.iconset");
  mkdirSync(iconset);
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const name = `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`;
      render(size * scale, path.join(iconset, name));
    }
  }
  execFileSync("iconutil", ["-c", "icns", iconset, "-o", path.join(build, "icon.icns")]);

  // Modern Windows ICO containers accept PNG payloads at each size.
  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const images = icoSizes.map((size) => readFileSync(path.join(icons, `${size}x${size}.png`)));
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach((image, i) => {
    const entry = 6 + i * 16;
    header[entry] = header[entry + 1] = icoSizes[i] % 256;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(image.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += image.length;
  });
  writeFileSync(path.join(build, "icon.ico"), Buffer.concat([header, ...images]));

  copyFileSync(path.join(build, "icon.svg"), path.join(web, "icon.svg"));
  writeFileSync(path.join(web, "favicon.svg"), svgAtSize(16));
  copyFileSync(path.join(build, "icon.ico"), path.join(web, "favicon.ico"));
  for (const size of [16, 32])
    copyFileSync(path.join(icons, `${size}x${size}.png`), path.join(web, `favicon-${size}.png`));
  copyFileSync(path.join(icons, "512x512.png"), path.join(web, "icon.png"));
  render(180, path.join(web, "apple-touch-icon.png"));
  console.log("Built Pebble icons for desktop, installers, and the browser.");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
