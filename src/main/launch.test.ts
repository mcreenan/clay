import path from "node:path";
import type { ElectronOptions } from "vite-plugin-electron";
import type { ElectronSimpleOptions } from "vite-plugin-electron/simple";
import { expect, it, vi } from "vite-plus/test";

const { electron } = vi.hoisted(() => ({ electron: vi.fn<(options: ElectronSimpleOptions) => Promise<[]>>() }));
vi.mock("vite-plugin-electron/simple", () => ({ default: electron }));

it("uses the Clay launcher when the preload build triggers a cold start", async () => {
  vi.stubEnv("VITEST", "");
  vi.stubEnv("VP_RESOLVING_CONFIG_METADATA", "");
  vi.stubEnv("ELECTRON_RUN_AS_NODE", "1");
  try {
    await import("../../vite.config");
    const options = electron.mock.calls[0][0];
    const preload = Array.isArray(options.preload) ? options.preload[0] : options.preload;
    expect(preload?.onstart).toBeDefined();

    const startup = vi.fn<Parameters<NonNullable<ElectronOptions["onstart"]>>[0]["startup"]>().mockResolvedValue(true);
    await preload!.onstart!({ startup, reload: vi.fn() });
    const [args, spawn, executable] = startup.mock.calls[0];
    expect(args).toEqual(["."]);
    expect(path.resolve(String(spawn?.cwd))).toBe(path.resolve("."));
    expect(spawn?.env?.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(executable).toBe(path.resolve("scripts/electron-path.cjs"));
  } finally {
    vi.unstubAllEnvs();
  }
});
