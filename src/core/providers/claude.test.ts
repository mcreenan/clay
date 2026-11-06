import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, expect, test, vi } from "vite-plus/test";
import type { ProviderEvent } from "./types";

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
