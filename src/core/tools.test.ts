import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import type { ServerMsg } from "../shared/protocol";
import { handleSessionMsg } from "./manager";
import { Session, type Client } from "./session";
import { buildToolSet } from "./tools";

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanup.splice(0).reverse()) fn();
});

function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "clay-tools-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const provider = {
    discover: async () => ({ id: "test", label: "Test", enabled: true, models: [] }),
    start: () => ({ send() {}, interrupt: async () => {}, close() {} }),
  };
  const session = Session.create("test", { provider: "test", model: "", effort: "", cwd: dir }, dir, provider);
  cleanup.push(() => session.dispose());
  const messages: ServerMsg[] = [];
  const client: Client = { id: "owner", kind: "web", send: (message) => messages.push(message) };
  session.attach(client);
  return { session, client, messages, provider, tools: buildToolSet(session) };
}

const request = { kind: "choice", prompt: "Choose a layout.", options: [{ id: "compact", label: "Compact" }] };

test("user_input sends a host request and accepts only its owner's routed reply", async () => {
  const { session, client, messages, tools } = setup();
  const pending = tools.run("user_input", { request });
  const [input] = session.toSnapshot().pendingInputs!;
  expect(messages.at(-1)).toMatchObject({ t: "user_input.request", request: { requestId: input.requestId } });
  const reply = { t: "user_input.reply" as const, requestId: input.requestId, answer: { choice: "compact" } };
  const other: Client = { id: "other", kind: "web", send() {} };
  session.attach(other);
  await handleSessionMsg(session, other, reply);
  expect(session.toSnapshot().pendingInputs).toHaveLength(1);
  await handleSessionMsg(session, client, reply);
  const result = await pending;
  expect(result.isError).toBe(false);
  expect(JSON.parse(result.text)).toEqual({ requestId: input.requestId, status: "answered", answer: reply.answer });
  expect(session.toSnapshot().pendingInputs).toEqual([]);
});

test("session interruption and owner disconnect end pending input tool calls", async () => {
  const { session, client, tools } = setup();
  const interrupted = tools.run("user_input", { request });
  await handleSessionMsg(session, client, { t: "interrupt" });
  expect(JSON.parse((await interrupted).text).status).toBe("cancelled");
  const disconnected = tools.run("user_input", { request });
  session.detach(client);
  expect(JSON.parse((await disconnected).text).status).toBe("disconnected");
  expect((await tools.run("user_input", { request })).isError).toBe(true);
});

test("selection_read returns the canvas frame's selection without changing resources", async () => {
  const { session, client, tools } = setup();
  const selection = {
    kind: "text",
    selector: "#status",
    text: "Ready",
    resourceHints: [],
    rev: 0,
    box: { x: 10, y: 20, width: 40, height: 16 },
  };
  client.send = (message) => {
    if (message.t === "frame.request") {
      expect(message.request).toEqual({ kind: "selection" });
      session.onFrameResult(message.requestId, { ok: true, value: JSON.stringify(selection) });
    }
  };
  const before = structuredClone(session.toSnapshot().canvas);
  const result = await tools.run("selection_read", {});
  expect(JSON.parse(result.text)).toEqual(selection);
  expect(session.toSnapshot().canvas).toEqual(before);
});

test("canvas_export saves standalone HTML and protects existing files and workspace boundaries", async () => {
  const { session, tools } = setup();
  const result = await tools.run("canvas_export", { format: "html", filename: "report" });
  expect(result.isError).toBe(false);
  const output = JSON.parse(result.text) as { path: string; bytes: number };
  expect(output.path).toBe(path.join(session.state.config.cwd, "report.html"));
  const saved = readFileSync(output.path);
  expect(saved.length).toBe(output.bytes);
  expect(saved.toString()).toContain("clay-export-state");
  expect((await tools.run("canvas_export", { format: "html", filename: "report" })).isError).toBe(true);
  expect(readFileSync(output.path)).toEqual(saved);
  expect((await tools.run("canvas_export", { format: "html", filename: "../outside.html" })).isError).toBe(true);
});

test("canvas_export routes PNG rendering through the desktop client hook", async () => {
  const { client, tools } = setup();
  client.renderExport = async (html, options) => {
    expect(html).toContain("clay-export-state");
    expect(options).toMatchObject({ format: "png", width: 800, height: 600 });
    return Buffer.from("rendered png");
  };
  const result = await tools.run("canvas_export", { format: "png", filename: "capture.png", width: 800, height: 600 });
  expect(result.isError).toBe(false);
  expect(readFileSync(JSON.parse(result.text).path, "utf8")).toBe("rendered png");
});

test("canvas_present commits a batch in one revision and one undo step, while keeping other modules", async () => {
  const { session, messages, tools } = setup();
  await tools.run("canvas_present", { resources: [{ name: "main.js", content: "export default () => {};" }] });
  const before = structuredClone(session.toSnapshot().canvas);
  const undo = session.toSnapshot().undo.undo;
  messages.length = 0;
  const result = await tools.run("canvas_present", {
    mode: "canvas",
    resources: [
      { name: "index.html", content: "<h1>Chart</h1>" },
      { name: "style.css", content: "h1 { color: blue }" },
    ],
  });
  expect(result.isError).toBe(false);
  expect(session.state.canvas.rev).toBe(before.rev + 1);
  expect(session.state.canvas.resources["main.js"]).toEqual(before.resources["main.js"]);
  expect(session.state.canvas.resources["index.html"].rev).toBe(session.state.canvas.resources["style.css"].rev);
  expect(messages.filter((message) => message.t.startsWith("canvas."))).toHaveLength(1);
  expect(session.toSnapshot().undo.undo).toBe(undo + 1);
  session.undo();
  expect(session.state.canvas.mode).toBe(before.mode);
  expect(Object.keys(session.state.canvas.resources)).toEqual(["main.js"]);
  session.redo();
  expect(session.state.canvas.mode).toBe("canvas");
  expect(session.state.canvas.resources["index.html"].text).toBe("<h1>Chart</h1>");
});

test("canvas_present rejects an invalid batch without changing state, and replace removes unspecified resources", async () => {
  const { session, tools } = setup();
  await tools.run("canvas_present", { resources: [{ name: "old.txt", content: "Keep" }] });
  const before = structuredClone(session.toSnapshot());
  const invalid = await tools.run("canvas_present", {
    mode: "3d",
    resources: [
      { name: "index.html", content: "New" },
      { name: "../invalid", content: "Invalid" },
    ],
  });
  expect(invalid.isError).toBe(true);
  expect(session.toSnapshot()).toEqual(before);
  expect(
    (
      await tools.run("canvas_present", {
        resources: [
          { name: "a.txt", content: "A" },
          { name: "a.txt", content: "B" },
        ],
      })
    ).isError,
  ).toBe(true);
  expect(session.toSnapshot()).toEqual(before);
  await tools.run("canvas_present", { replace: true, resources: [{ name: "index.html", content: "New" }] });
  expect(Object.keys(session.state.canvas.resources)).toEqual(["index.html"]);
  session.undo();
  expect(session.state.canvas.resources["old.txt"].text).toBe("Keep");
});

test("resource_import preserves text and binary bytes and refuses links outside the workspace", async () => {
  const { session, tools } = setup();
  const dir = session.state.config.cwd;
  writeFileSync(path.join(dir, "notes.txt"), "A café\n");
  const bytes = Buffer.from([0, 255, 12, 128]);
  writeFileSync(path.join(dir, "image.png"), bytes);
  expect((await tools.run("resource_import", { path: "notes.txt" })).isError).toBe(false);
  expect((await tools.run("resource_import", { path: "image.png" })).isError).toBe(false);
  expect(session.state.canvas.resources["notes.txt"].text).toBe("A café\n");
  expect(session.state.canvas.resources["image.png"].size).toBe(bytes.length);
  expect(Buffer.from(session.state.canvas.resources["image.png"].base64!, "base64")).toEqual(bytes);
  const outside = mkdtempSync(path.join(os.tmpdir(), "clay-outside-"));
  cleanup.push(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(path.join(outside, "secret.txt"), "Outside");
  symlinkSync(path.join(outside, "secret.txt"), path.join(dir, "link.txt"));
  const before = structuredClone(session.state.canvas);
  expect((await tools.run("resource_import", { path: "link.txt" })).isError).toBe(true);
  expect(session.state.canvas).toEqual(before);
});

test("checkpoints survive reload and restore resources, data, and chrome in one undoable step", async () => {
  const { session, tools, provider } = setup();
  await tools.run("canvas_present", { mode: "canvas", resources: [{ name: "index.html", content: "Original" }] });
  session.dataSet("value", 7, "agent");
  session.chromeSet("prompt", { width: 400 }, "agent");
  expect((await tools.run("checkpoint_create", { name: "original" })).isError).toBe(false);
  await tools.run("canvas_present", {
    mode: "html",
    resources: [
      { name: "extra.txt", content: "Extra" },
      { name: "index.html", content: "Changed" },
    ],
  });
  session.dataSet("value", 9, "agent");
  session.dataSet("extra", true, "agent");
  session.chromeSet("prompt", { width: 500 }, "agent");
  const changed = structuredClone(session.toSnapshot());
  session.flush();
  const loaded = Session.load(path.join(session.state.config.cwd, "test.json"), () => provider)!;
  cleanup.push(() => loaded.dispose());
  const loadedTools = buildToolSet(loaded);
  expect(JSON.parse((await loadedTools.run("checkpoint_list", {})).text)).toMatchObject([
    { name: "original", mode: "canvas" },
  ]);
  expect((await loadedTools.run("checkpoint_restore", { name: "original" })).isError).toBe(false);
  expect(loaded.state.canvas.mode).toBe("canvas");
  expect(Object.keys(loaded.state.canvas.resources)).toEqual(["index.html"]);
  expect(loaded.state.canvas.resources["index.html"].text).toBe("Original");
  expect(loaded.state.data).toEqual({ value: 7 });
  expect(loaded.state.chrome.prompt.width).toBe(400);
  expect(loaded.toSnapshot().undo.undo).toBe(changed.undo.undo + 1);
  loaded.undo();
  expect(loaded.state.data).toEqual(changed.data);
  expect(loaded.state.chrome).toEqual(changed.chrome);
  expect(loaded.state.canvas.resources["extra.txt"].text).toBe("Extra");
  loaded.redo();
  expect(loaded.state.data).toEqual({ value: 7 });
});

test("checkpoint creation protects existing names and bounds saved snapshots", async () => {
  const { session, tools } = setup();
  for (let index = 0; index < 20; index++) session.createCheckpoint(`state-${index}`);
  expect((await tools.run("checkpoint_create", { name: "state-0" })).isError).toBe(true);
  expect((await tools.run("checkpoint_create", { name: "state-0", overwrite: true })).isError).toBe(false);
  expect((await tools.run("checkpoint_create", { name: "state-20" })).isError).toBe(true);
  const before = structuredClone(session.toSnapshot());
  expect((await tools.run("checkpoint_restore", { name: "missing" })).isError).toBe(true);
  expect(session.toSnapshot()).toEqual(before);
  expect(session.listCheckpoints()).toHaveLength(20);
});
