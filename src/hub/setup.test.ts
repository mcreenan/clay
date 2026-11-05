import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { DOMParser } from "linkedom";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { hubServiceScript, hubSetupCommands } from "../shared/hubSetup";

const folders: string[] = [];

afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function fixture(built = true) {
  const folder = realpathSync(mkdtempSync(path.join(os.tmpdir(), "clay-hub-setup-")));
  folders.push(folder);
  const home = path.join(folder, "home & 'user'");
  const root = path.join(folder, "source & 'clay'");
  const plist = path.join(home, "Library/LaunchAgents/com.clay.hub.plist");
  mkdirSync(home, { recursive: true });
  mkdirSync(root, { recursive: true });
  if (built) {
    mkdirSync(path.join(root, "out/server"), { recursive: true });
    writeFileSync(path.join(root, "out/server/hub.mjs"), "");
  }
  const run = () =>
    spawnSync(process.execPath, ["--input-type=commonjs", "-e", hubServiceScript], {
      cwd: root,
      env: { ...process.env, HOME: home, USERPROFILE: home, PATH: `/test/&<>"'/bin` },
      encoding: "utf8",
    });
  return { home, root, plist, run };
}

describe("hub service instructions", () => {
  it("creates a user service with absolute, XML-safe paths and shared hub data", () => {
    const setup = fixture();
    const result = setup.run();
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const content = readFileSync(setup.plist, "utf8");
    const document = new DOMParser().parseFromString(content, "text/xml");
    const value = (key: string) =>
      [...document.querySelectorAll("key")].find((element) => element.textContent === key)?.nextElementSibling;
    expect(value("Label")?.textContent).toBe("com.clay.hub");
    expect([...value("ProgramArguments")!.querySelectorAll("string")].map((element) => element.textContent)).toEqual([
      process.execPath,
      path.join(setup.root, "out/server/hub.mjs"),
    ]);
    expect(value("WorkingDirectory")?.textContent).toBe(setup.root);
    expect(value("HOME")?.textContent).toBe(setup.home);
    expect(value("PATH")?.textContent).toBe(`/test/&<>"'/bin`);
    expect(value("CLAY_HUB_DIR")?.textContent).toBe(path.join(setup.home, ".clay/hub"));
    expect(value("HOST")?.textContent).toBe("0.0.0.0");
    expect(value("PORT")?.textContent).toBe("5318");
    expect(value("RunAtLoad")?.tagName).toBe("true");
    expect(value("KeepAlive")?.tagName).toBe("true");
    expect(value("Umask")?.textContent).toBe("63");
    expect(value("StandardOutPath")?.textContent).toBe(path.join(setup.home, "Library/Logs/Clay/hub.log"));
    expect(value("StandardErrorPath")?.textContent).toBe(path.join(setup.home, "Library/Logs/Clay/hub-error.log"));
    expect(content).toContain("&amp;");
    expect(content).toContain("&lt;");
    expect(content).toContain("&gt;");
    expect(content).toContain("&quot;");
    expect(content).toContain("&apos;");
    if (process.platform !== "win32") {
      expect(statSync(setup.plist).mode & 0o777).toBe(0o600);
      expect(statSync(path.join(setup.home, "Library/Logs/Clay")).mode & 0o777).toBe(0o700);
      expect(statSync(path.join(setup.home, ".clay/hub")).mode & 0o777).toBe(0o700);
    }
    if (process.platform === "darwin") {
      const lint = spawnSync("/usr/bin/plutil", ["-lint", setup.plist], { encoding: "utf8" });
      expect(lint.status, lint.stdout + lint.stderr).toBe(0);
    }
    expect(hubSetupCommands.run).toContain('CLAY_HUB_DIR="$HOME/.clay/hub"');
  });

  it("refuses to overwrite an existing service file", () => {
    const setup = fixture();
    mkdirSync(path.dirname(setup.plist), { recursive: true });
    writeFileSync(setup.plist, "existing settings");
    const result = setup.run();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("EEXIST");
    expect(readFileSync(setup.plist, "utf8")).toBe("existing settings");
  });

  it("refuses to create a service outside the built source folder", () => {
    const setup = fixture(false);
    const result = setup.run();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Run the build commands in the Clay source folder first.");
    expect(existsSync(setup.plist)).toBe(false);
  });

  it("includes the tested script in a fail-fast shell command", () => {
    expect(hubSetupCommands.install).toContain(`node --input-type=commonjs <<'NODE'\n${hubServiceScript}\nNODE`);
    expect(hubSetupCommands.install).toContain("set -e");
    expect(hubSetupCommands.install).toContain(hubSetupCommands.start);
    if (process.platform !== "win32") {
      for (const command of Object.values(hubSetupCommands)) {
        const syntax = spawnSync("/bin/sh", ["-n"], { input: command, encoding: "utf8" });
        expect(syntax.status, syntax.stderr).toBe(0);
      }
    }
  });
});
