// Both source launchers use a named macOS bundle. Never modify the Electron dependency.
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const {
  constants,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} = require("node:fs");
const path = require("node:path");
const electron = require("electron");

if (process.platform !== "darwin") {
  module.exports = electron;
} else {
  const root = path.resolve(__dirname, "..");
  const source = path.resolve(electron, "../../..");
  const directory = path.join(root, ".dev");
  const bundle = path.join(directory, "Clay.app");
  const icon = path.join(root, "build/icon.icns");
  const stamp = path.join(directory, "electron-branding");
  const fingerprint = createHash("sha256")
    .update(readFileSync(path.join(source, "Contents/Info.plist")))
    .update(readFileSync(icon))
    .update(readFileSync(__filename))
    .digest("hex");

  if (!existsSync(bundle) || !existsSync(stamp) || readFileSync(stamp, "utf8") !== fingerprint) {
    mkdirSync(directory, { recursive: true });
    rmSync(bundle, { recursive: true, force: true });
    // APFS can clone the framework without duplicating hundreds of megabytes.
    cpSync(source, bundle, {
      recursive: true,
      verbatimSymlinks: true,
      mode: constants.COPYFILE_FICLONE,
    });
    const plist = path.join(bundle, "Contents/Info.plist");
    for (const [key, value] of Object.entries({
      CFBundleName: "Clay",
      CFBundleDisplayName: "Clay",
      CFBundleIdentifier: "dev.mcreenan.clay.dev",
      CFBundleIconFile: "clay.icns",
      CFBundleExecutable: "Clay",
    })) {
      execFileSync("plutil", ["-replace", key, "-string", value, plist]);
    }
    copyFileSync(icon, path.join(bundle, "Contents/Resources/clay.icns"));
    renameSync(path.join(bundle, "Contents/MacOS/Electron"), path.join(bundle, "Contents/MacOS/Clay"));
    execFileSync("codesign", ["--force", "--deep", "--sign", "-", bundle], { stdio: "pipe" });
    writeFileSync(stamp, fingerprint);
  }

  module.exports = path.join(bundle, "Contents/MacOS/Clay");
}
