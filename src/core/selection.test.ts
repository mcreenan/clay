import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { parseHTML } from "linkedom";
import { expect, test } from "vite-plus/test";
import type { CanvasSelection, FrameRequest, FrameResult, FromFrameMsg, SelectionMode } from "../shared/protocol";

const source = readFileSync(new URL("../canvas/runtime.js", import.meta.url), "utf8");
// Execute the shipped selection code, without booting graphics or a browser.
const selectionSource = source
  .split("// ======================================================================== user selection")[1]
  .split("// ======================================================================== applying canvas state")[0];
const requestSource = source.slice(
  source.indexOf("async function handleRequest(req)"),
  source.indexOf("// ======================================================================== host messages"),
);

function fixture() {
  const { window, document } = parseHTML(
    '<html><head></head><body><main><p id="duplicate">First</p><p id="duplicate">Second <img data-asset="photo.png"></p></main><div data-ac-root="chart.js"><button id="target">Chart</button></div></body></html>',
  );
  const listeners = new Map<string, ((event: Record<string, unknown>) => void)[]>();
  const messages: FromFrameMsg[] = [];
  const rect = { x: 20, y: 30, width: 140, height: 60, left: 20, top: 30, right: 160, bottom: 90, toJSON: () => ({}) };
  for (const el of document.querySelectorAll("*")) el.getBoundingClientRect = () => rect;
  let nativeRange: ReturnType<typeof textRange> | undefined;
  const textRange = () => {
    const node = document.querySelector("p")!.firstChild!;
    return {
      commonAncestorContainer: node,
      startContainer: node,
      endContainer: node,
      collapsed: false,
      getBoundingClientRect: () => rect,
      toString: () => "First",
      cloneRange() {
        return this;
      },
    };
  };
  const native = {
    get rangeCount() {
      return nativeRange ? 1 : 0;
    },
    get isCollapsed() {
      return !nativeRange;
    },
    toString: () => nativeRange?.toString() ?? "",
    getRangeAt: () => nativeRange,
    removeAllRanges: () => {
      nativeRange = undefined;
    },
  };
  Object.assign(window, { getSelection: () => native });
  Object.assign(document, {
    styleSheets: [{ ownerNode: { getAttribute: () => "site.css" }, cssRules: [{ selectorText: "p, button" }] }],
    hasFocus: () => true,
    createRange: () => ({ selectNodeContents: () => {}, getBoundingClientRect: () => rect }),
  });
  const context = createContext({
    window,
    document,
    Element: window.Element,
    HTMLInputElement: window.HTMLInputElement,
    HTMLTextAreaElement: window.HTMLTextAreaElement,
    CSS: { escape: (id: string) => id },
    NodeFilter: { SHOW_TEXT: 4 },
    scrollX: 0,
    scrollY: 0,
    innerWidth: 800,
    innerHeight: 600,
    rt: { surface: null },
    shownRev: 7,
    queue: Promise.resolve(),
    shown: {
      "index.html": { kind: "html" },
      "site.css": { kind: "css" },
      "photo.png": { kind: "asset" },
      "chart.js": { kind: "js" },
    },
    assetUrls: new Map(),
    entries: new Map(),
    post: (message: FromFrameMsg) => messages.push(message),
    orig: {
      add: (type: string, listener: (event: Record<string, unknown>) => void) => {
        listeners.set(type, [...(listeners.get(type) ?? []), listener]);
      },
      setTimeout: (callback: () => void) => callback(),
    },
  });
  runInContext(
    `${selectionSource}\n${requestSource}\nglobalThis.api = { readSelection, setSelectionMode, handleRequest };`,
    context,
  );
  const api = context.api as {
    readSelection(): CanvasSelection | null;
    setSelectionMode(mode: SelectionMode | null, clear?: boolean): void;
    handleRequest(request: FrameRequest): Promise<FrameResult>;
  };
  const dispatch = (type: string, props: Record<string, unknown> = {}) => {
    let prevented = false;
    const event = {
      button: 0,
      pointerId: 1,
      preventDefault: () => {
        prevented = true;
      },
      stopImmediatePropagation: () => {},
      ...props,
    };
    for (const listener of listeners.get(type) ?? []) listener(event);
    return prevented;
  };
  return {
    api,
    document,
    messages,
    dispatch,
    selectText: () => {
      nativeRange = textRange();
    },
  };
}

test("selection requests return JSON null until the user selects", async () => {
  const { api } = fixture();
  await expect(api.handleRequest({ kind: "selection" })).resolves.toEqual({ ok: true, value: "null" });
});

test("element selection returns a unique selector, bounds, text, and resource hints without changing markup", async () => {
  const { api, document, dispatch } = fixture();
  const before = document.documentElement.outerHTML;
  const el = document.querySelectorAll("p")[1];
  api.setSelectionMode("element");
  expect(dispatch("pointerdown", { target: el })).toBe(true);
  expect(dispatch("click", { target: el })).toBe(true);
  const result = await api.handleRequest({ kind: "selection" });
  const selected = JSON.parse(result.value!) as CanvasSelection;
  expect(selected).toMatchObject({
    kind: "element",
    text: "Second ",
    box: { x: 20, y: 30, width: 140, height: 60 },
    rev: 7,
  });
  expect(document.querySelectorAll(selected.selector)).toHaveLength(1);
  expect(document.querySelector(selected.selector)).toBe(el);
  expect(selected.resourceHints.map((hint) => hint.name)).toEqual(["index.html", "photo.png", "site.css"]);
  expect(document.documentElement.outerHTML).toBe(before);
  el.remove();
  expect(api.readSelection()).toBeNull();
});

test("module hints identify generated elements and clearing removes the current selection", () => {
  const { api, document, dispatch } = fixture();
  api.setSelectionMode("element");
  dispatch("pointerdown", { target: document.querySelector("button") });
  expect(api.readSelection()?.resourceHints.map((hint) => hint.name)).toEqual(["chart.js", "site.css"]);
  api.setSelectionMode(null, true);
  expect(api.readSelection()).toBeNull();
});

test("native text selection survives leaving select mode and clears when the user deselects it", async () => {
  const { api, selectText, dispatch } = fixture();
  api.setSelectionMode("text");
  selectText();
  dispatch("selectionchange");
  api.setSelectionMode(null);
  const result = await api.handleRequest({ kind: "selection" });
  expect(JSON.parse(result.value!)).toMatchObject({ kind: "text", text: "First", box: { x: 20, y: 30 } });
  api.setSelectionMode(null, true);
  dispatch("selectionchange");
  expect(api.readSelection()).toBeNull();
});

test("region selection normalizes reverse drags and Escape ends select mode", () => {
  const { api, document, dispatch, messages } = fixture();
  const before = document.documentElement.outerHTML;
  const el = document.querySelector("main")!;
  api.setSelectionMode("region");
  dispatch("pointerdown", { target: el, clientX: 180, clientY: 100 });
  dispatch("pointermove", { target: el, clientX: 10, clientY: 20 });
  dispatch("pointerup", { target: el, clientX: 10, clientY: 20 });
  expect(api.readSelection()).toMatchObject({ kind: "region", box: { x: 10, y: 20, width: 170, height: 80 } });
  expect(document.documentElement.outerHTML).toBe(before);
  api.setSelectionMode("element");
  expect(dispatch("keydown", { key: "Escape" })).toBe(true);
  expect(messages.at(-1)).toMatchObject({ type: "selection.state", mode: null });
});
