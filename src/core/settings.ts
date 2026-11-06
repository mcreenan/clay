import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { defaultSettings, settingsSchema, type AppSettings } from "../shared/settings";

export class SettingsStore {
  private value = defaultSettings();
  private readonly file: string;

  constructor(directory: string) {
    this.file = path.join(directory, "settings.json");
    if (existsSync(this.file)) {
      try {
        this.value = settingsSchema.parse(JSON.parse(readFileSync(this.file, "utf8")));
      } catch {
        console.warn("[clay] Could not read settings.json. Using default settings.");
      }
    }
  }

  get(): AppSettings {
    return structuredClone(this.value);
  }

  set(value: unknown): AppSettings {
    const settings = settingsSchema.parse(value);
    mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    writeFileSync(temporary, JSON.stringify(settings, null, 2), { mode: 0o600 });
    renameSync(temporary, this.file);
    this.value = settings;
    return this.get();
  }
}
