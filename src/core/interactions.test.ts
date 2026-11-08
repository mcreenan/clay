import { afterEach, expect, test, vi } from "vite-plus/test";
import type { ServerMsg, UserInputAnswer, UserInputSpec } from "../shared/protocol";
import { SessionInteractions } from "./interactions";

const choice: UserInputSpec = {
  kind: "choice",
  prompt: "Which layout?",
  options: [
    { id: "compact", label: "Compact" },
    { id: "wide", label: "Wide" },
  ],
};
const form: UserInputSpec = {
  kind: "form",
  prompt: "Set the title.",
  fields: [
    { id: "title", label: "Title", required: true },
    { id: "note", label: "Note" },
  ],
};

function setup() {
  const messages: ServerMsg[] = [];
  const interactions = new SessionInteractions((message) => messages.push(message));
  return { interactions, messages };
}

afterEach(() => vi.useRealTimers());

test("concurrent requests resolve by id and ignore duplicate and unknown replies", async () => {
  const { interactions, messages } = setup();
  const first = interactions.request(choice, { requestId: "first" });
  const second = interactions.request(form, { requestId: "second" });
  expect(messages.map((message) => message.t)).toEqual(["user_input.request", "user_input.request"]);
  const reply = { t: "user_input.reply" as const, requestId: "second", answer: { values: { title: "Report" } } };
  expect(interactions.reply(reply)).toBe(true);
  expect(interactions.reply(reply)).toBe(false);
  expect(interactions.reply({ ...reply, requestId: "unknown" })).toBe(false);
  await expect(second).resolves.toEqual({ requestId: "second", status: "answered", answer: reply.answer });
  expect(interactions.pending.map((request) => request.requestId)).toEqual(["first"]);
  interactions.reply({ t: "user_input.reply", requestId: "first", answer: { choice: "compact" } });
  await expect(first).resolves.toMatchObject({ requestId: "first", status: "answered" });
  expect(interactions.pending).toEqual([]);
  expect(messages.at(-1)).toMatchObject({ t: "user_input.result", result: { requestId: "first", status: "answered" } });
});

test("invalid answers cannot settle a request", async () => {
  const { interactions } = setup();
  const pending = interactions.request(form, { requestId: "form" });
  const invalid: UserInputAnswer[] = [
    { choice: "wide" },
    { values: {} },
    { values: { title: " " } },
    { values: { title: "Report", unknown: "value" } },
    { values: { title: "x".repeat(4001) } },
  ];
  for (const answer of invalid)
    expect(interactions.reply({ t: "user_input.reply", requestId: "form", answer })).toBe(false);
  expect(
    interactions.reply({
      t: "user_input.reply",
      requestId: "form",
      answer: { values: { title: "Report", note: "OK" } },
    }),
  ).toBe(true);
  await expect(pending).resolves.toMatchObject({ status: "answered" });
  const other = interactions.request(choice, { requestId: "choice" });
  expect(interactions.reply({ t: "user_input.reply", requestId: "choice", answer: { choice: "unknown" } })).toBe(false);
  interactions.cancel("choice");
  await expect(other).resolves.toMatchObject({ status: "cancelled" });
});

test("owner-bound requests require a matching hub user or local client", async () => {
  const { interactions } = setup();
  const pending = interactions.request(choice, { requestId: "owned", ownerId: "matt" });
  const reply = { t: "user_input.reply" as const, requestId: "owned", cancelled: true as const };
  expect(interactions.reply(reply)).toBe(false);
  expect(interactions.reply({ id: "other" }, reply)).toBe(false);
  expect(interactions.reply({ id: "matt", user: { id: "other" } }, reply)).toBe(false);
  expect(interactions.reply({ id: "socket", user: { id: "matt" } }, reply)).toBe(true);
  await expect(pending).resolves.toMatchObject({ status: "cancelled" });
  const local = interactions.request(choice, { requestId: "local", ownerId: "window" });
  expect(interactions.reply({ id: "window" }, { ...reply, requestId: "local" })).toBe(true);
  await expect(local).resolves.toMatchObject({ status: "cancelled" });
});

test("timeouts clear the request and reject replies after the deadline", async () => {
  vi.useFakeTimers();
  const { interactions, messages } = setup();
  const pending = interactions.request(choice, { requestId: "timeout", timeoutMs: 50 });
  expect(interactions.snapshot()[0].expiresAt - interactions.snapshot()[0].createdAt).toBe(50);
  vi.advanceTimersByTime(50);
  await expect(pending).resolves.toMatchObject({ status: "timeout" });
  expect(interactions.pending).toEqual([]);
  expect(messages.at(-1)).toMatchObject({ t: "user_input.result", result: { status: "timeout" } });
  expect(interactions.reply({ t: "user_input.reply", requestId: "timeout", answer: { choice: "wide" } })).toBe(false);
  const late = interactions.request(choice, { requestId: "late", timeoutMs: 50 });
  vi.setSystemTime(Date.now() + 51);
  expect(interactions.reply({ t: "user_input.reply", requestId: "late", answer: { choice: "wide" } })).toBe(false);
  await expect(late).resolves.toMatchObject({ status: "timeout" });
  expect(vi.getTimerCount()).toBe(0);
});

test("abort, explicit cancel, and cancelAll settle once and remove timers", async () => {
  vi.useFakeTimers();
  const { interactions, messages } = setup();
  const abort = new AbortController();
  const first = interactions.request(choice, { requestId: "abort", signal: abort.signal });
  const second = interactions.request(choice, { requestId: "cancel" });
  const third = interactions.request(choice, { requestId: "all" });
  abort.abort();
  expect(interactions.cancel("abort")).toBe(false);
  interactions.cancel("cancel", "Turn stopped.");
  interactions.cancelAll();
  await expect(first).resolves.toMatchObject({ status: "cancelled" });
  await expect(second).resolves.toMatchObject({ status: "cancelled", reason: "Turn stopped." });
  await expect(third).resolves.toMatchObject({ status: "cancelled" });
  expect(messages.filter((message) => message.t === "user_input.result")).toHaveLength(3);
  expect(vi.getTimerCount()).toBe(0);
  const before = messages.length;
  await expect(interactions.request(choice, { signal: AbortSignal.abort() })).resolves.toMatchObject({
    status: "cancelled",
  });
  expect(messages).toHaveLength(before);
});

test("disconnect cancels the departing owner; last-viewer disconnect and dispose settle the rest", async () => {
  const { interactions } = setup();
  const owned = interactions.request(choice, { ownerId: "matt" });
  const other = interactions.request(choice, { ownerId: "other" });
  const shared = interactions.request(choice);
  interactions.disconnect({ id: "socket", user: { id: "matt" } });
  await expect(owned).resolves.toMatchObject({ status: "disconnected" });
  expect(interactions.pending).toHaveLength(2);
  interactions.disconnect();
  await expect(other).resolves.toMatchObject({ status: "disconnected" });
  await expect(shared).resolves.toMatchObject({ status: "disconnected" });
  const final = interactions.request(choice);
  interactions.dispose();
  interactions.dispose();
  await expect(final).resolves.toMatchObject({ status: "disposed" });
  await expect(interactions.request(choice)).rejects.toThrow("disposed");
});

test("snapshots and broadcasts cannot mutate pending requests", async () => {
  const { interactions, messages } = setup();
  const spec = structuredClone(choice);
  const pending = interactions.request(spec, { requestId: "copy" });
  spec.prompt = "Changed";
  interactions.pending[0].prompt = "Changed";
  const sent = messages[0];
  if (sent.t === "user_input.request") sent.request.prompt = "Changed";
  expect(interactions.snapshot()[0].prompt).toBe("Which layout?");
  interactions.cancelAll();
  await pending;
});

test("invalid definitions and duplicate ids do not leave pending work", async () => {
  const { interactions } = setup();
  expect(() => interactions.request({ ...choice, prompt: "" })).toThrow("prompt");
  expect(() => interactions.request({ kind: "choice", prompt: "Pick", options: [] })).toThrow("1 to 10");
  expect(() =>
    interactions.request({
      kind: "form",
      prompt: "Enter",
      fields: [
        form.kind === "form" ? form.fields[0] : { id: "title", label: "Title" },
        { id: "title", label: "Again" },
      ],
    }),
  ).toThrow("unique");
  expect(() => interactions.request(choice, { timeoutMs: Number.NaN })).toThrow("timeout");
  expect(interactions.pending).toEqual([]);
  const pending = interactions.request(choice, { requestId: "duplicate" });
  expect(() => interactions.request(choice, { requestId: "duplicate" })).toThrow("already pending");
  interactions.cancelAll();
  await pending;
});

test("transport failures clean up new requests and cannot block disposal", async () => {
  vi.useFakeTimers();
  let fail = true;
  const interactions = new SessionInteractions(() => {
    if (fail) throw new Error("Transport closed");
  });
  await expect(interactions.request(choice)).rejects.toThrow("Transport closed");
  expect(interactions.pending).toEqual([]);
  expect(vi.getTimerCount()).toBe(0);
  fail = false;
  const first = interactions.request(choice);
  const second = interactions.request(choice);
  fail = true;
  interactions.dispose();
  await expect(first).resolves.toMatchObject({ status: "disposed" });
  await expect(second).resolves.toMatchObject({ status: "disposed" });
  expect(vi.getTimerCount()).toBe(0);
});
