import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { defaultSettings } from "../shared/settings";
import { SettingsStore } from "./settings";

const directories: string[] = [];
function directory() {
  const result = mkdtempSync(path.join(os.tmpdir(), "clay-settings-"));
  directories.push(result);
  return result;
}

afterEach(() => {
  for (const entry of directories.splice(0)) rmSync(entry, { recursive: true, force: true });
  vi.restoreAllMocks();
});

test("settings inherit Claude defaults and persist explicit choices across restarts", () => {
  const root = directory();
  const store = new SettingsStore(root);
  expect(store.get()).toEqual(defaultSettings());
  const settings = defaultSettings();
  settings.general = { provider: "codex", model: "gpt", effort: "high" };
  settings.providers.claude = { permissionMode: "auto", sandbox: false };
  store.set(settings);
  expect(new SettingsStore(root).get()).toEqual(settings);
  expect(JSON.parse(readFileSync(path.join(root, "settings.json"), "utf8"))).toEqual(settings);
  store.set(defaultSettings());
  expect(new SettingsStore(root).get().providers.claude).toEqual({});
});

test("invalid settings do not replace saved settings", () => {
  const store = new SettingsStore(directory());
  expect(() => store.set({ ...defaultSettings(), providers: { claude: { permissionMode: "invalid" } } })).toThrow();
  expect(store.get()).toEqual(defaultSettings());
});

test("unreadable settings fall back to defaults without changing the file", () => {
  const root = directory();
  writeFileSync(path.join(root, "settings.json"), "invalid json");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  expect(new SettingsStore(root).get()).toEqual(defaultSettings());
  expect(readFileSync(path.join(root, "settings.json"), "utf8")).toBe("invalid json");
});
