import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Options, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ClaudeSettings } from "../../shared/settings";
import { defaultSettings } from "../../shared/settings";
import { SessionManager } from "../manager";
import { afterEach, expect, test, vi } from "vite-plus/test";
import type { AgentProvider, ProviderEvent } from "./types";

const mock = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ query: mock.query }));
vi.mock("../tools", () => ({
  MCP_SERVER_NAME: "canvas",
  mcpToolName: (name: string) => name,
  createCanvasMcpServer: () => ({}),
}));
import { ClaudeProvider } from "./claude";

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

function startOptions(
  settings: () => ClaudeSettings = () => ({}),
  provider: AgentProvider = new ClaudeProvider(settings),
): Options {
  mock.query.mockReturnValue({
    supportedCommands: async () => [],
    close: vi.fn(),
    async *[Symbol.asyncIterator]() {},
  });
  const run = provider.start({
    config: { provider: "claude", cwd: os.tmpdir(), model: "", effort: "" },
    systemPrompt: "Canvas instructions",
    tools: { defs: [], run: async () => ({ text: "" }) },
    emit: () => {},
  });
  run.close();
  return mock.query.mock.lastCall![0].options;
}

test("Claude leaves permission mode and sandbox settings to the CLI by default", () => {
  vi.stubEnv("CLAY_PERMISSION_MODE", undefined);
  vi.stubEnv("CLAY_SANDBOX", undefined);
  const options = startOptions();
  expect(options).not.toHaveProperty("permissionMode");
  expect(options).not.toHaveProperty("sandbox");
  expect(options).not.toHaveProperty("allowDangerouslySkipPermissions");
  expect(options.settingSources).toEqual(["user", "project", "local"]);
});

test("Claude reads the current independent overrides on every run", () => {
  vi.stubEnv("CLAY_PERMISSION_MODE", undefined);
  vi.stubEnv("CLAY_SANDBOX", undefined);
  let settings: ClaudeSettings = { permissionMode: "auto" };
  const read = () => settings;
  expect(startOptions(read).permissionMode).toBe("auto");
  expect(startOptions(read)).not.toHaveProperty("sandbox");
  settings = { sandbox: false };
  expect(startOptions(read).sandbox).toEqual({ enabled: false });
  expect(startOptions(read)).not.toHaveProperty("permissionMode");
  settings = { permissionMode: "bypassPermissions", sandbox: true };
  expect(startOptions(read)).toMatchObject({
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    sandbox: { enabled: true },
  });
});

test("explicit Clay settings take precedence over environment overrides", () => {
  vi.stubEnv("CLAY_PERMISSION_MODE", "acceptEdits");
  vi.stubEnv("CLAY_SANDBOX", "0");
  expect(startOptions()).toMatchObject({ permissionMode: "acceptEdits", sandbox: { enabled: false } });
  expect(startOptions(() => ({ permissionMode: "auto", sandbox: true }))).toMatchObject({
    permissionMode: "auto",
    sandbox: { enabled: true },
  });
});

test("saved Clay overrides reach subsequent Claude runs without changing an existing run", () => {
  vi.stubEnv("CLAY_PERMISSION_MODE", undefined);
  vi.stubEnv("CLAY_SANDBOX", undefined);
  const directory = mkdtempSync(path.join(os.tmpdir(), "clay-provider-settings-"));
  const manager = new SessionManager(directory);
  const client = { id: "test", kind: "web" as const, send: vi.fn() };
  try {
    const original = startOptions(undefined, manager.providers.claude);
    const settings = defaultSettings();
    settings.providers.claude = { permissionMode: "auto", sandbox: false };
    expect(manager.handleSettings(client, { t: "settings.set", settings })).toBe(true);
    expect(client.send).toHaveBeenLastCalledWith({ t: "settings", settings, saved: true });
    expect(startOptions(undefined, manager.providers.claude)).toMatchObject({
      permissionMode: "auto",
      sandbox: { enabled: false },
    });
    expect(original).not.toHaveProperty("permissionMode");
    expect(original).not.toHaveProperty("sandbox");
    expect(manager.handleSettings(client, { t: "settings.get" })).toBe(true);
    expect(client.send).toHaveBeenLastCalledWith({ t: "settings", settings });
  } finally {
    manager.shutdown();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Claude discovers SDK commands and sends image blocks plus readable workspace files", async () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "clay-claude-input-"));
  const close = vi.fn();
  mock.query.mockReturnValue({
    supportedCommands: async () => [{ name: "review", description: "Review", argumentHint: "file" }],
    close,
    interrupt: async () => {},
    async *[Symbol.asyncIterator]() {},
  });
  const provider = new ClaudeProvider();
  const events: ProviderEvent[] = [];
  const capabilities = await provider.input(cwd);
  expect(capabilities).toEqual({
    images: true,
    files: true,
    commands: [{ name: "review", description: "Review", invocation: "/review", argumentHint: "file" }],
  });
  expect(close).toHaveBeenCalledTimes(1);
  const run = provider.start({
    config: { provider: "claude", cwd, model: "", effort: "" },
    systemPrompt: "Canvas instructions",
    tools: { defs: [], run: async () => ({ text: "" }) },
    emit: (e) => events.push(e),
  });
  try {
    const input = mock.query.mock.calls[1][0].prompt as AsyncIterable<SDKUserMessage>;
    const image = { name: "picture.png", mime: "image/png", base64: Buffer.from("picture").toString("base64") };
    run.send("/review", {
      attachments: [image, { name: "notes.txt", mime: "text/plain", base64: Buffer.from("notes").toString("base64") }],
    });
    const message = await input[Symbol.asyncIterator]().next();
    const content = message.value!.message.content as { type: string; text?: string; source?: unknown }[];
    expect(content).toEqual([
      { type: "text", text: expect.stringContaining(".clay/attachments/") },
      { type: "image", source: { type: "base64", data: image.base64, media_type: image.mime } },
    ]);
    const file = JSON.parse(content[0].text!.split("\n").at(-1)!) as string;
    expect(readFileSync(file, "utf8")).toBe("notes");
  } finally {
    run.close();
    rmSync(cwd, { recursive: true, force: true });
  }
});
