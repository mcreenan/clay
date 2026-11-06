import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { McpHost } from "../mcpHttp";
import { AcpProvider } from "./acp";
import { CodexProvider } from "./codex";
import type { AgentProvider, AgentRun, ProviderContext, ProviderEvent } from "./types";

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanup.splice(0).reverse()) fn();
  vi.unstubAllEnvs();
});

/** A protocol peer that records requests. It never reads credentials or contacts a model. */
function peer(kind: "codex" | "acp", images = true) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "clay-provider-test-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const log = path.join(dir, "requests.jsonl");
  const cli = path.join(dir, "agent.cjs");
  writeFileSync(
    cli,
    `#!${process.execPath}
const fs = require("node:fs");
const rl = require("node:readline").createInterface({ input: process.stdin });
const log = ${JSON.stringify(log)};
const kind = ${JSON.stringify(kind)};
const send = m => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\\n");
rl.on("line", line => {
  const m = JSON.parse(line);
  fs.appendFileSync(log, line + "\\n");
  if (m.id === undefined) return;
  let result = {};
  switch (m.method) {
    case "initialize": result = { protocolVersion: 1, agentCapabilities: { promptCapabilities: { image: ${images} }, mcpCapabilities: { http: true } } }; break;
    case "skills/list": result = { data: [{ cwd: m.params.cwds[0], skills: [{ name: "design", description: "Design", enabled: true, path: "/skills/design/SKILL.md" }] }] }; break;
    case "thread/start": result = { thread: { id: "thread-test" } }; break;
    case "turn/start": result = { turn: { id: "turn-test" } }; break;
    case "session/new": result = { sessionId: "session-test" }; break;
    case "session/prompt": result = { stopReason: "end_turn" }; break;
  }
  send({ id: m.id, result });
  if (kind === "codex" && m.method === "turn/start")
    send({ method: "turn/completed", params: { threadId: "thread-test", turn: { id: "turn-test", status: "completed" } } });
  if (kind === "acp" && m.method === "session/new")
    setTimeout(() => send({ method: "session/update", params: { sessionId: "session-test", update: {
      sessionUpdate: "available_commands_update", availableCommands: [{ name: "review", description: "Review", input: { hint: "file" } }]
    } } }), 10);
});
`,
  );
  chmodSync(cli, 0o755);
  return {
    cli,
    dir,
    requests: (): { method: string; params: any }[] =>
      readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line)),
  };
}

function run(provider: AgentProvider, cwd: string) {
  const events: ProviderEvent[] = [];
  let finish: (() => void) | undefined;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const context: ProviderContext = {
    config: { provider: "test", model: "", effort: "", cwd },
    systemPrompt: "Canvas instructions",
    tools: { defs: [], run: async () => ({ text: "" }) },
    emit: (e) => {
      events.push(e);
      if (e.type === "turn-end" || e.type === "fatal") finish?.();
    },
  };
  const instance: AgentRun = provider.start(context);
  cleanup.push(() => instance.close());
  return { instance, events, done };
}

const image = { name: "picture.png", mime: "image/png", base64: Buffer.from("picture").toString("base64") };
const file = { name: "notes.txt", mime: "text/plain", base64: Buffer.from("notes").toString("base64") };

test("Codex discovers skills and sends explicit skill, native image, and workspace file input", async () => {
  const fake = peer("codex");
  vi.stubEnv("CLAY_CODEX_EXECUTABLE", fake.cli);
  const mcp = new McpHost();
  cleanup.push(() => mcp.close());
  const provider = new CodexProvider(mcp);
  const capabilities = await provider.input(fake.dir);
  expect(capabilities.commands).toHaveLength(1);
  const r = run(provider, fake.dir);
  r.instance.send("<room>Context</room>\n$design use these", {
    attachments: [image, file],
    command: capabilities.commands[0],
  });
  await r.done;
  expect(r.events.find((e) => e.type === "fatal")).toBeUndefined();
  const request = fake.requests().find((m) => m.method === "turn/start")!;
  expect(request.params.input).toEqual([
    expect.objectContaining({ type: "text", text: expect.stringContaining(".clay/attachments/") }),
    { type: "image", url: `data:${image.mime};base64,${image.base64}` },
    { type: "skill", name: "design", path: "/skills/design/SKILL.md" },
  ]);
  const text: string = request.params.input[0].text;
  const saved = JSON.parse(text.split("\n").at(-1)!) as string;
  expect(readFileSync(saved, "utf8")).toBe("notes");
});

test("ACP discovers commands published after session creation and sends native images", async () => {
  const fake = peer("acp");
  const mcp = new McpHost();
  cleanup.push(() => mcp.close());
  const provider = new AcpProvider({ id: "test", label: "Test", command: fake.cli }, mcp);
  const capabilities = await provider.input(fake.dir);
  expect(capabilities).toMatchObject({
    images: true,
    commands: [{ name: "review", invocation: "/review", argumentHint: "file" }],
  });
  const r = run(provider, fake.dir);
  r.instance.send("Use this", { attachments: [image, file] });
  await r.done;
  expect(r.events.find((e) => e.type === "fatal")).toBeUndefined();
  const request = fake.requests().find((m) => m.method === "session/prompt")!;
  expect(request.params.prompt).toEqual([
    { type: "text", text: expect.stringContaining(".clay/attachments/") },
    { type: "image", data: image.base64, mimeType: image.mime },
  ]);
});

test("ACP refuses images when the agent does not declare image support", async () => {
  const fake = peer("acp", false);
  const mcp = new McpHost();
  cleanup.push(() => mcp.close());
  const provider = new AcpProvider({ id: "test", label: "Test", command: fake.cli }, mcp);
  const r = run(provider, fake.dir);
  r.instance.send("Use this", { attachments: [image] });
  await r.done;
  expect(r.events).toContainEqual(
    expect.objectContaining({
      type: "turn-end",
      ok: false,
      error: expect.stringContaining("does not support image input"),
    }),
  );
  expect(fake.requests().some((m) => m.method === "session/prompt")).toBe(false);
});
