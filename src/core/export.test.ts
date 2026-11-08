import vm from "node:vm";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { init, parse } from "es-module-lexer";
import { parseHTML } from "linkedom";
import type { Browser } from "playwright-core";
import { parseSync } from "vite-plus";
import { beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { emptyCanvas, type CanvasState, type Resource } from "../shared/protocol";
import { createElectronExportRenderer, exportCanvas, renderCanvasExport, type ElectronExportWindow } from "./export";

const resource = (name: string, kind: Resource["kind"], text: string): Resource => ({
  name,
  kind,
  text,
  mime: "text/plain",
  rev: 1,
  size: Buffer.byteLength(text),
  updatedAt: 0,
});
const markup = '<h1 id="title">Saved canvas</h1><img data-asset="logo.svg">';
const danger = "</ScRiPt><script>globalThis.injected = true</script><!--";
const data = { title: danger, count: 7 };
const canvas: CanvasState = {
  mode: "3d",
  rev: 1,
  resources: Object.fromEntries(
    [
      resource("index.html", "html", markup),
      resource("styles.css", "css", 'h1 { color: red } body { background-image: url("asset:logo.svg") }'),
      { ...resource("logo.svg", "asset", '<svg xmlns="http://www.w3.org/2000/svg"/>'), mime: "image/svg+xml" },
      { ...resource("binary.dat", "asset", ""), base64: "AAEC/w==", mime: "application/octet-stream", size: 4 },
      resource("lib/value.js", "js", "export const value = 7;"),
      resource(
        "main.js",
        "js",
        `
      import canvas from "canvas";
      import { value } from "./lib/value.js";
      import * as THREE from "three";
      export { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
      export default function setup(ctx) {
        ctx.root.textContent = canvas.data.get("title") + value;
        ctx.scene.add(new THREE.Group());
        ctx.data.subscribe("count", value => { ctx.state.count = value });
        ctx.onFrame(() => {});
        return () => { ctx.root.textContent = "disposed" };
      }
      export const literal = ${JSON.stringify(danger)};
      export const load = () => import("three/addons/controls/OrbitControls.js");
    `,
      ),
    ].map((item) => [item.name, item]),
  ),
};

function readDocument(html: string) {
  const { document } = parseHTML(html);
  const payload = JSON.parse(document.getElementById("clay-export-state")!.textContent!) as {
    canvas: CanvasState;
    data: Record<string, unknown>;
    frame: string;
  };
  const frame = parseHTML(payload.frame).document;
  const config = JSON.parse(frame.getElementById("clay-export-runtime")!.textContent!) as {
    modules: Record<string, string>;
    imports: Record<string, string>;
    runtime: string;
  };
  return { document, payload, frame, config };
}

describe("offline HTML export", () => {
  let html: string;
  beforeAll(async () => {
    html = await exportCanvas(canvas, data, { title: danger });
  }, 60_000);

  it("embeds resources and data without changing them or breaking script boundaries", () => {
    const { document, payload, frame } = readDocument(html);
    expect(payload.canvas).toEqual(canvas);
    expect(Buffer.from(payload.canvas.resources["binary.dat"].base64!, "base64")).toEqual(Buffer.from([0, 1, 2, 255]));
    expect(payload.data).toEqual(data);
    expect(document.title).toBe(danger);
    expect(document.querySelectorAll("script")).toHaveLength(2);
    expect(frame.querySelectorAll("script")).toHaveLength(2);
    expect(document.querySelector("script[src], link[href]")).toBeNull();
    expect(frame.querySelector("script[src], link[href]")).toBeNull();
    expect(document.getElementById("clay-export-state")!.textContent).not.toContain("<");
    expect(frame.querySelector("style[data-ac-internal]")!.textContent).toContain("#__ac_surface");
    expect(frame.querySelector('meta[http-equiv="Content-Security-Policy"]')!.getAttribute("content")).toContain(
      "connect-src blob: data:",
    );
    expect(document.querySelector("iframe")!.getAttribute("sandbox")).toBe("allow-scripts");
    new vm.Script(document.querySelectorAll("script")[1].textContent!);
    new vm.Script(frame.querySelectorAll("script")[1].textContent!);
  });

  it("embeds the runtime and a closed graph of local library imports", async () => {
    const { config } = readDocument(html);
    await init();
    for (const source of Object.values(config.modules)) {
      const [imports] = parse(source);
      for (const item of imports) if (item.specifier) expect(Object.hasOwn(config.modules, item.specifier)).toBe(true);
    }
    const code = config.modules[config.runtime];
    expect(code).toContain("setupMode");
    expect(code).toContain("applyModules");
    expect(code).toContain("makeCtx");
    expect(Object.keys(config.imports)).toEqual([
      "canvas",
      "d3",
      "idiomorph",
      "three",
      "three/addons/controls/OrbitControls.js",
      "three/addons/loaders/GLTFLoader.js",
    ]);
    expect(config.modules[config.imports.canvas]).toContain("globalThis.canvas");
    expect(config.modules[config.imports.canvas]).toContain("export default canvas");
    expect(Object.keys(config.modules)).toContain("clay-export/vendor/three/three.core.js");
  });

  it("starts the exported runtime and preserves data subscriptions without a browser", () => {
    const { config, payload } = readDocument(html);
    let code = config.modules[config.runtime];
    // The VM runs a classic script. Inject the shipped libraries in place of imports.
    const exports = parseSync("export.js", code).program.body.filter((node) => node.type === "ImportDeclaration");
    for (const node of exports.reverse()) code = code.slice(0, node.start) + code.slice(node.end);
    const { document, window: domWindow } = parseHTML(payload.frame);
    const parent = { postMessage: vi.fn() };
    const raf = vi.fn();
    class FrameTarget {
      addEventListener() {
        return undefined;
      }
      removeEventListener() {
        return undefined;
      }
    }
    class FrameCanvas {
      getContext() {
        return null;
      }
    }
    const timers = {
      setTimeout: vi.fn(),
      clearTimeout: vi.fn(),
      setInterval: vi.fn(),
      clearInterval: vi.fn(),
      requestAnimationFrame: raf,
      cancelAnimationFrame: vi.fn(),
    };
    const window = Object.assign(new FrameTarget(), timers);
    const sandbox = {
      document,
      window,
      parent,
      EventTarget: FrameTarget,
      HTMLCanvasElement: FrameCanvas,
      Element: domWindow.Element,
      Node: domWindow.Node,
      performance: { now: () => 0 },
      console: { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      innerWidth: 800,
      innerHeight: 600,
      devicePixelRatio: 1,
      ...timers,
    };
    const d3Sandbox: Record<string, unknown> = {};
    vm.runInNewContext(
      readFileSync(new URL("../../node_modules/d3/dist/d3.min.js", import.meta.url), "utf8"),
      d3Sandbox,
    );
    Object.assign(sandbox, { THREE, d3: d3Sandbox.d3, Idiomorph: {}, OrbitControls: class {} });
    vm.runInNewContext(code, sandbox);
    expect(parent.postMessage).toHaveBeenCalledWith({ ch: "clay", v: 2, type: "hello" }, "*");
    const api = (
      sandbox as typeof sandbox & {
        canvas: {
          data: {
            set: (key: string, value: unknown) => void;
            get: (key: string) => unknown;
            subscribe: (key: string, callback: (value: unknown) => void) => () => void;
          };
          THREE: { Scene: new () => unknown };
          d3: {
            scaleLinear: () => {
              domain: (range: number[]) => { range: (range: number[]) => (value: number) => number };
            };
          };
        };
      }
    ).canvas;
    const receive = vi.fn();
    const unsubscribe = api.data.subscribe("count", receive);
    api.data.set("count", 8);
    expect(api.data.get("count")).toBe(8);
    expect(receive.mock.calls.map(([value]) => value)).toEqual([undefined, 8]);
    unsubscribe();
    api.data.set("count", 9);
    expect(receive).toHaveBeenCalledTimes(2);
    expect(api.d3.scaleLinear().domain([0, 10]).range([0, 100])(5)).toBe(50);
    expect(new api.THREE.Scene()).toHaveProperty("isScene", true);
  });

  it("initializes the frame once and waits for its runtime, fonts, and images", () => {
    const { document, payload } = readDocument(html);
    const sent = vi.fn();
    const source = { postMessage: sent };
    Object.defineProperty(document.querySelector("iframe"), "contentWindow", { value: source });
    let receive!: (event: { source: unknown; data: unknown }) => void;
    const sandbox = {
      document,
      window: {
        addEventListener: (_type: string, fn: typeof receive) => {
          receive = fn;
        },
      },
    };
    vm.runInNewContext(document.querySelectorAll("script")[1].textContent!, sandbox);
    const status = (sandbox as typeof sandbox & { __clayExport: { ready: boolean; errors: string[] } }).__clayExport;
    receive({ source: {}, data: { ch: "clay-export", type: "boot" } });
    expect(sent).not.toHaveBeenCalled();
    receive({ source, data: { ch: "clay-export", type: "boot" } });
    expect(sent).toHaveBeenLastCalledWith(
      { ch: "clay", v: 2, type: "init", canvas: payload.canvas, data: payload.data },
      "*",
    );
    receive({ source, data: { ch: "clay", v: 2, type: "hello" } });
    receive({ source, data: { ch: "clay", v: 2, type: "data", key: "count", value: 8 } });
    expect(sent).toHaveBeenCalledTimes(1);
    receive({ source, data: { ch: "clay", v: 2, type: "ready" } });
    expect(status.ready).toBe(false);
    expect(sent).toHaveBeenLastCalledWith({ ch: "clay-export", type: "settle" }, "*");
    receive({ source, data: { ch: "clay-export", type: "settled" } });
    expect(status.ready).toBe(true);
    receive({ source, data: { ch: "clay", v: 2, type: "chrome", id: "c1" } });
    expect(sent.mock.lastCall?.[0].result.error).toContain("standalone export");
    receive({ source, data: { ch: "clay", v: 2, type: "applied", errors: ["main.js: setup failed"] } });
    expect(status.errors).toEqual(["main.js: setup failed"]);
    expect(document.querySelector("pre")!.textContent).toContain("main.js: setup failed");
  });

  it("rejects imports outside the local import map", async () => {
    const state = {
      ...emptyCanvas(),
      resources: { "main.js": resource("main.js", "js", 'import "https://example.com/library.js";') },
    };
    await expect(exportCanvas(state, {})).rejects.toThrow('cannot bundle import "https://example.com/library.js"');
  });

  it("reports missing runtime files", async () => {
    await expect(exportCanvas(emptyCanvas(), {}, { root: "/missing-clay-app" })).rejects.toThrow(
      "frame resource: index.html",
    );
  });

  it("uses an injected renderer and snapshots edits before the build", async () => {
    const state = emptyCanvas();
    const store = { count: 1 };
    const render = vi.fn(async (document: string) => {
      expect(readDocument(document).payload.data).toEqual({ count: 1 });
      expect(readDocument(document).payload.canvas.mode).toBe("canvas");
      return Buffer.from("png");
    });
    state.mode = "canvas";
    const result = exportCanvas(state, store, { format: "png", render, width: 640 });
    state.mode = "html";
    store.count = 2;
    expect(await result).toEqual(Buffer.from("png"));
    expect(render).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ format: "png", width: 640 }));
  }, 60_000);
});

function browserMock() {
  const page = {
    setDefaultTimeout: vi.fn(),
    emulateMedia: vi.fn(),
    setContent: vi.fn(),
    waitForFunction: vi.fn(),
    evaluate: vi.fn().mockResolvedValue([]),
    waitForTimeout: vi.fn(),
    screenshot: vi.fn().mockResolvedValue(Buffer.from("png")),
    pdf: vi.fn().mockResolvedValue(Buffer.from("pdf")),
  };
  const browser = { newPage: vi.fn().mockResolvedValue(page), close: vi.fn() };
  const launchBrowser = vi.fn().mockResolvedValue(browser as unknown as Browser);
  return { page, browser, launchBrowser };
}

describe("Chromium rendering", () => {
  it.each(["png", "pdf"] as const)(
    "renders %s offline at the requested viewport and closes the browser",
    async (format) => {
      const { page, browser, launchBrowser } = browserMock();
      const result = await renderCanvasExport("<html></html>", {
        format,
        width: 800,
        height: 600,
        settleMs: 50,
        launchBrowser,
      });
      expect(result.toString()).toBe(format);
      expect(browser.newPage).toHaveBeenCalledWith({
        viewport: { width: 800, height: 600 },
        deviceScaleFactor: 1,
        offline: true,
      });
      expect(page.waitForFunction).toHaveBeenCalled();
      expect(page.waitForTimeout).toHaveBeenCalledWith(50);
      if (format === "pdf")
        expect(page.pdf).toHaveBeenCalledWith(
          expect.objectContaining({ width: "800px", height: "600px", printBackground: true }),
        );
      expect(browser.close).toHaveBeenCalledOnce();
    },
  );

  it("fails on runtime errors instead of returning a blank image", async () => {
    const { page, browser, launchBrowser } = browserMock();
    page.evaluate.mockResolvedValue(["main.js: missing asset"]);
    await expect(renderCanvasExport("html", { format: "png", launchBrowser })).rejects.toThrow(
      "main.js: missing asset",
    );
    expect(page.screenshot).not.toHaveBeenCalled();
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it("closes the browser when the runtime does not become ready", async () => {
    const { page, browser, launchBrowser } = browserMock();
    page.waitForFunction.mockRejectedValue(new Error("runtime timed out"));
    await expect(renderCanvasExport("html", { format: "pdf", launchBrowser })).rejects.toThrow("runtime timed out");
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it("gives an actionable browser launch error and rejects invalid dimensions before launch", async () => {
    const launchBrowser = vi.fn().mockRejectedValue(new Error("No executable"));
    await expect(renderCanvasExport("html", { format: "png", launchBrowser })).rejects.toThrow(
      "Set CHROMIUM or executablePath",
    );
    launchBrowser.mockClear();
    await expect(renderCanvasExport("html", { format: "png", launchBrowser, width: 0 })).rejects.toThrow(
      "width and height",
    );
    expect(launchBrowser).not.toHaveBeenCalled();
  });
});

describe("Electron rendering hook", () => {
  function windowMock() {
    return {
      setContentSize: vi.fn(),
      loadURL: vi.fn(),
      isDestroyed: vi.fn().mockReturnValue(false),
      destroy: vi.fn(),
      webContents: {
        executeJavaScript: vi.fn().mockResolvedValue([]),
        capturePage: vi.fn().mockResolvedValue({ toPNG: () => Buffer.from("png") }),
        printToPDF: vi.fn().mockResolvedValue(Buffer.from("pdf")),
      },
    };
  }

  it.each(["png", "pdf"] as const)("renders %s without importing Electron or Playwright at runtime", async (format) => {
    const window = windowMock();
    let loadedPath = "";
    window.loadURL.mockImplementation((url: string) => {
      loadedPath = fileURLToPath(url);
      expect(readFileSync(loadedPath, "utf8")).toBe("<html>canvas</html>");
    });
    const render = createElectronExportRenderer(() => window as unknown as ElectronExportWindow);
    expect(await render("<html>canvas</html>", { format, width: 800, height: 600 })).toEqual(Buffer.from(format));
    expect(window.setContentSize).toHaveBeenCalledWith(800, 600);
    expect(window.loadURL).toHaveBeenCalledOnce();
    expect(existsSync(loadedPath)).toBe(false);
    expect(window.destroy).toHaveBeenCalledOnce();
    if (format === "pdf")
      expect(window.webContents.printToPDF).toHaveBeenCalledWith(
        expect.objectContaining({ pageSize: { width: 211667, height: 158750 } }),
      );
  });

  it("destroys its window after setup errors or a timeout", async () => {
    const window = windowMock();
    const render = createElectronExportRenderer(() => window as unknown as ElectronExportWindow);
    window.webContents.executeJavaScript.mockResolvedValue(["setup failed"]);
    await expect(render("html", { format: "png" })).rejects.toThrow("setup failed");
    expect(window.destroy).toHaveBeenCalledOnce();
    window.destroy.mockClear();
    window.loadURL.mockImplementation(() => new Promise(() => {}));
    await expect(render("html", { format: "png", timeoutMs: 5 })).rejects.toThrow("timed out in Electron");
    expect(window.destroy).toHaveBeenCalledOnce();
  });
});
