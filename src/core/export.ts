import path from "node:path";
import os from "node:os";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { BrowserWindow } from "electron";
import { parseHTML } from "linkedom";
import { init, parse } from "es-module-lexer";
import type { Browser, LaunchOptions } from "playwright-core";
import type { CanvasState } from "../shared/protocol";
import { createFrameFiles } from "./static";

export type RenderFormat = "png" | "pdf";
export interface RenderExportOptions {
  format: RenderFormat;
  width?: number;
  height?: number;
  timeoutMs?: number;
  /** Extra time for animations or work started after setup returns. */
  settleMs?: number;
  executablePath?: string;
  channel?: string;
  /** The helper closes the returned browser. Use a dedicated browser. */
  launchBrowser?: (options: LaunchOptions) => Promise<Browser>;
}
export type ExportRenderer = (html: string, options: RenderExportOptions) => Promise<Buffer>;
export interface ExportOptions extends Omit<RenderExportOptions, "format"> {
  format?: "html" | RenderFormat;
  /** App root containing src/canvas and node_modules. */
  root?: string;
  title?: string;
  /** Extra vendored imports for computed import() calls. */
  modules?: string[];
  /** For example, createElectronExportRenderer(). */
  render?: ExportRenderer;
}

const scriptJSON = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");
const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// Playwright is optional. Packaged desktop builds use the Electron renderer.
const loadTool = <T>(name: string): Promise<T> => import(/* @vite-ignore */ name);

// Keep the original runtime in its own frame. Its parent messages then work
// without feeding data.set messages back into the same data store.
const FRAME_BOOT = `
(async () => {
  const config = JSON.parse(document.getElementById("clay-export-runtime").textContent);
  const blob = code => URL.createObjectURL(new Blob([code], {type: "text/javascript"}));
  const send = message => parent.postMessage({ch: "clay-export", ...message}, "*");
  try {
    const urls = Object.fromEntries(Object.entries(config.modules).map(([name, source]) => [name, blob(source)]));
    const imports = {...urls};
    for (const [specifier, name] of Object.entries(config.imports)) imports[specifier] = urls[name];
    const map = document.createElement("script");
    map.type = "importmap";
    map.textContent = JSON.stringify({imports});
    document.head.append(map);
    await import(urls[config.runtime]);
    window.addEventListener("message", async event => {
      if (event.source !== parent || event.data?.ch !== "clay-export" || event.data.type !== "settle") return;
      try {
        await document.fonts.ready;
        await Promise.all(Array.from(document.images, image => image.decode().catch(() => {})));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        send({type: "settled"});
      } catch (error) { send({type: "error", error: String(error)}); }
    });
    send({type: "boot"});
  } catch (error) {
    send({type: "error", error: String(error)});
  }
})();
`;

const HOST_BOOT = `
(() => {
  const payload = JSON.parse(document.getElementById("clay-export-state").textContent);
  const frame = document.getElementById("clay-export-frame");
  const status = globalThis.__clayExport = {ready: false, errors: []};
  const send = message => frame.contentWindow.postMessage(message, "*");
  const fail = message => {
    status.errors.push(message);
    const error = document.createElement("pre");
    error.textContent = "Canvas export failed: " + message;
    document.body.append(error);
  };
  window.addEventListener("message", event => {
    if (event.source !== frame.contentWindow) return;
    const message = event.data;
    if (message?.ch === "clay-export") {
      if (message.type === "boot") send({ch: "clay", v: 2, type: "init", canvas: payload.canvas, data: payload.data});
      if (message.type === "settled") status.ready = true;
      if (message.type === "error") fail(message.error);
    }
    if (message?.ch !== "clay" || message.v !== 2) return;
    if (message.type === "applied") for (const error of message.errors ?? []) fail(error);
    if (message.type === "ready") send({ch: "clay-export", type: "settle"});
    if (message.type === "chrome") send({ch: "clay", v: 2, type: "chrome.result", id: message.id,
      result: {error: "Clay chrome is not available in a standalone export."}});
  });
  frame.srcdoc = payload.frame;
})();
`;

/** Build an offline document. Stored data is copied; live DOM and ctx.state are not captured. */
export function exportCanvas(
  canvas: CanvasState,
  data: Record<string, unknown>,
  options?: ExportOptions & { format?: "html" },
): Promise<string>;
export function exportCanvas(
  canvas: CanvasState,
  data: Record<string, unknown>,
  options: ExportOptions & { format: RenderFormat },
): Promise<Buffer>;
export function exportCanvas(
  canvas: CanvasState,
  data: Record<string, unknown>,
  options: ExportOptions,
): Promise<string | Buffer>;
export async function exportCanvas(
  canvas: CanvasState,
  data: Record<string, unknown>,
  options: ExportOptions = {},
): Promise<string | Buffer> {
  const format = options.format ?? "html";
  if (!["html", "png", "pdf"].includes(format)) throw new Error(`Unsupported export format: ${format}`);
  // Snapshot before the asynchronous build. Session edits must not change an export in progress.
  const state = JSON.parse(JSON.stringify({ canvas, data })) as { canvas: CanvasState; data: Record<string, unknown> };
  const root = options.root ?? DEFAULT_ROOT;
  const files = createFrameFiles(root);
  const read = (name: string) => {
    const file = files(name);
    if (!file) throw new Error(`Canvas export cannot find frame resource: ${name}`);
    return file.body.toString();
  };
  const shell = read("index.html");
  const { document } = parseHTML(shell);
  const importMap = JSON.parse(document.querySelector('script[type="importmap"]')!.textContent!) as {
    imports: Record<string, string>;
  };
  await init();
  const modules = new Set(["three", "d3", "idiomorph", "canvas", ...(options.modules ?? [])]);
  for (const resource of Object.values(state.canvas.resources)) {
    if (resource.kind !== "js") continue;
    const [imports] = parse(resource.text ?? "", resource.name);
    for (const item of imports)
      if (
        !(item.type === "dynamic" && item.glob) &&
        item.specifier &&
        !item.specifier.startsWith(".") &&
        !item.specifier.startsWith("/")
      )
        modules.add(item.specifier);
  }
  const resolveLibrary = (specifier: string): string | undefined => {
    if (importMap.imports[specifier]) return path.posix.normalize(importMap.imports[specifier]);
    const prefix = Object.keys(importMap.imports).find((key) => key.endsWith("/") && specifier.startsWith(key));
    return prefix ? path.posix.normalize(importMap.imports[prefix] + specifier.slice(prefix.length)) : undefined;
  };
  // Stable import-map names let local modules retain cycles and shared identity.
  const alias = (name: string) => `clay-export/${name}`;
  const sources: Record<string, string> = {};
  const exposed: Record<string, string> = {};
  const pending = new Set(["runtime.js"]);
  for (const specifier of [...modules].sort()) {
    const name = resolveLibrary(specifier);
    if (!name) throw new Error(`Canvas export cannot bundle import "${specifier}". Use Clay's local import map.`);
    exposed[specifier] = alias(name);
    pending.add(name);
  }
  for (const name of pending) {
    let source = read(name);
    const [imports] = parse(source, name);
    for (const item of [...imports].reverse()) {
      if (!item.specifier || (item.type === "dynamic" && item.glob)) continue;
      const target = item.specifier.startsWith(".")
        ? path.posix.normalize(path.posix.join(path.posix.dirname(name), item.specifier))
        : resolveLibrary(item.specifier);
      if (!target) throw new Error(`Canvas export cannot resolve vendored import "${item.specifier}".`);
      pending.add(target);
      const replacement = item.type === "dynamic" ? JSON.stringify(alias(target)) : alias(target);
      source = source.slice(0, item.start) + replacement + source.slice(item.end);
    }
    sources[alias(name)] = source;
  }
  const config = { modules: sources, imports: exposed, runtime: alias("runtime.js") };
  document.querySelectorAll("script").forEach((script) => script.remove());
  const policy =
    "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob: data:; style-src 'unsafe-inline' blob: data:; img-src blob: data:; font-src blob: data:; media-src blob: data:; connect-src blob: data:; worker-src blob: data:; frame-src blob: data:";
  const csp = document.createElement("meta");
  csp.setAttribute("http-equiv", "Content-Security-Policy");
  csp.setAttribute("content", policy);
  document.head.prepend(csp);
  document.body.innerHTML = `<script id="clay-export-runtime" type="application/json">${scriptJSON(config)}</script><script>${FRAME_BOOT}</script>`;
  const payload = scriptJSON({ ...state, frame: "<!doctype html>" + document.documentElement.outerHTML });
  const title = (options.title ?? "Clay canvas").replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>html,body{margin:0;width:100%;height:100%;overflow:hidden}iframe{display:block;border:0;width:100%;height:100%}pre{position:fixed;inset:0;margin:0;padding:24px;white-space:pre-wrap;background:#faf9f6;color:#b42318;font:16px/1.7 system-ui}</style></head><body>
<iframe id="clay-export-frame" title="Canvas" sandbox="allow-scripts"></iframe>
<script id="clay-export-state" type="application/json">${payload}</script><script>${HOST_BOOT}</script></body></html>`;
  return format === "html" ? html : (options.render ?? renderCanvasExport)(html, { ...options, format });
}

function dimensions(options: RenderExportOptions) {
  const width = options.width ?? 1280;
  const height = options.height ?? 720;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const settleMs = options.settleMs ?? 0;
  if (![width, height].every((value) => Number.isInteger(value) && value > 0 && value <= 16_384))
    throw new Error("Canvas export width and height must be integers from 1 to 16384.");
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isFinite(settleMs) || settleMs < 0)
    throw new Error("Canvas export timeout must be positive, and settle time must be zero or positive.");
  return { width, height, timeoutMs, settleMs };
}

const READY = "globalThis.__clayExport && (globalThis.__clayExport.ready || globalThis.__clayExport.errors.length > 0)";
const ERRORS = "globalThis.__clayExport.errors";

/** Render one viewport. No server, browser download, or network access is required. */
export async function renderCanvasExport(html: string, options: RenderExportOptions): Promise<Buffer> {
  const { width, height, timeoutMs, settleMs } = dimensions(options);
  let browser: Browser;
  try {
    const launch =
      options.launchBrowser ??
      (async (launchOptions: LaunchOptions) => {
        const { chromium } = await loadTool<typeof import("playwright-core")>("playwright-core");
        return chromium.launch(launchOptions);
      });
    browser = await launch({
      headless: true,
      executablePath: options.executablePath ?? process.env.CHROMIUM,
      channel: options.channel,
    });
  } catch (cause) {
    throw new Error(
      "Canvas PNG/PDF export requires Chromium. Set CHROMIUM or executablePath, supply launchBrowser, or use an Electron renderer hook.",
      { cause },
    );
  }
  try {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, offline: true });
    page.setDefaultTimeout(timeoutMs);
    await page.emulateMedia({ media: "screen" });
    await page.setContent(html, { waitUntil: "load", timeout: timeoutMs });
    await page.waitForFunction(READY, undefined, { timeout: timeoutMs });
    const errors = (await page.evaluate(ERRORS)) as string[];
    if (errors.length) throw new Error(`Canvas export failed: ${errors.join("\n")}`);
    if (settleMs) await page.waitForTimeout(settleMs);
    return options.format === "png"
      ? await page.screenshot({ type: "png", animations: "allow", timeout: timeoutMs })
      : await page.pdf({
          width: `${width}px`,
          height: `${height}px`,
          printBackground: true,
          margin: { top: 0, right: 0, bottom: 0, left: 0 },
        });
  } finally {
    await browser.close();
  }
}

export type ElectronExportWindow = Pick<
  BrowserWindow,
  "loadURL" | "webContents" | "setContentSize" | "isDestroyed" | "destroy"
>;

/** The caller supplies a dedicated, hidden BrowserWindow with sandbox enabled,
 * nodeIntegration disabled and backgroundThrottling disabled. This avoids an
 * Electron runtime import and works when playwright-core is not packaged. */
export function createElectronExportRenderer(
  createWindow: () => ElectronExportWindow | Promise<ElectronExportWindow>,
): ExportRenderer {
  return async (html, options) => {
    const { width, height, timeoutMs, settleMs } = dimensions(options);
    const window = await createWindow();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let directory: string | undefined;
    try {
      // Local runtime modules can exceed Chromium's data URL size limit.
      directory = await mkdtemp(path.join(os.tmpdir(), "clay-export-"));
      const document = path.join(directory, "index.html");
      await writeFile(document, html);
      const render = async () => {
        window.setContentSize(width, height);
        await window.loadURL(pathToFileURL(document).href);
        const errors = (await window.webContents.executeJavaScript(`(async () => {
          const until = Date.now() + ${timeoutMs};
          while (!(${READY})) {
            if (Date.now() > until) throw new Error("Canvas export runtime did not become ready.");
            await new Promise(resolve => setTimeout(resolve, 20));
          }
          return ${ERRORS};
        })()`)) as string[];
        if (errors.length) throw new Error(`Canvas export failed: ${errors.join("\n")}`);
        if (settleMs) await new Promise((resolve) => setTimeout(resolve, settleMs));
        if (options.format === "png") return (await window.webContents.capturePage()).toPNG();
        return window.webContents.printToPDF({
          printBackground: true,
          pageSize: { width: Math.round((width / 96) * 25400), height: Math.round((height / 96) * 25400) },
          margins: { top: 0, right: 0, bottom: 0, left: 0 },
        });
      };
      return await Promise.race([
        render(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Canvas export timed out in Electron.")), timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      if (!window.isDestroyed()) window.destroy();
      if (directory) await rm(directory, { recursive: true, force: true });
    }
  };
}
