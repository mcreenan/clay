export const hubServiceScript = `const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const root = process.cwd();
const home = os.homedir();
const script = path.join(root, "out/server/hub.mjs");
if (!fs.existsSync(script)) {
  throw new Error("Run the build commands in the Clay source folder first.");
}
const agents = path.join(home, "Library/LaunchAgents");
const logs = path.join(home, "Library/Logs/Clay");
const data = path.join(home, ".clay/hub");
const plist = path.join(agents, "com.clay.hub.plist");
const xml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;"
})[character]);
fs.mkdirSync(agents, { recursive: true });
fs.mkdirSync(logs, { recursive: true, mode: 0o700 });
fs.mkdirSync(data, { recursive: true, mode: 0o700 });
fs.writeFileSync(plist, \`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.clay.hub</string>
  <key>ProgramArguments</key><array>
    <string>\${xml(process.execPath)}</string>
    <string>\${xml(script)}</string>
  </array>
  <key>WorkingDirectory</key><string>\${xml(root)}</string>
  <key>EnvironmentVariables</key><dict>
    <key>HOME</key><string>\${xml(home)}</string>
    <key>PATH</key><string>\${xml(process.env.PATH || "/usr/bin:/bin:/usr/sbin:/sbin")}</string>
    <key>CLAY_HUB_DIR</key><string>\${xml(data)}</string>
    <key>HOST</key><string>0.0.0.0</string>
    <key>PORT</key><string>5318</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>Umask</key><integer>63</integer>
  <key>StandardOutPath</key><string>\${xml(path.join(logs, "hub.log"))}</string>
  <key>StandardErrorPath</key><string>\${xml(path.join(logs, "hub-error.log"))}</string>
</dict></plist>
\`, { flag: "wx", mode: 0o600 });
console.log("Created " + plist);`;

const serviceStart = 'launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.clay.hub.plist"';

export const hubSetupCommands = {
  download: `git clone https://github.com/mcreenan/caddis.git
cd caddis`,
  build: `npm install
npm run build
npm exec -- vp pack`,
  run: 'CLAY_HUB_DIR="$HOME/.clay/hub" node out/server/hub.mjs',
  install: `(\nset -e
node --input-type=commonjs <<'NODE'
${hubServiceScript}
NODE
plutil -lint "$HOME/Library/LaunchAgents/com.clay.hub.plist"
${serviceStart}
)`,
  start: serviceStart,
  stop: 'launchctl bootout "gui/$(id -u)/com.clay.hub"',
  remove: 'rm "$HOME/Library/LaunchAgents/com.clay.hub.plist"',
  logs: `tail -n 30 "$HOME/Library/Logs/Clay/hub.log"
tail -n 30 "$HOME/Library/Logs/Clay/hub-error.log"`,
  token: 'cat "$HOME/.clay/hub/token"',
};
