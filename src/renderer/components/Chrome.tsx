import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { CHROME_MARGIN, CHROME_Z, effectiveProps, layoutChrome, safeCssProps, type Rect } from "../../shared/chrome";
import type { ChromeApplyResult, ChromeComponent, Effort, PromptTarget } from "../../shared/protocol";
import { TITLEBAR_H, historyMini, send, uiCommand } from "../controller";
import { useMyAgents, useSessionProvider, useUi } from "../store";
import { HistoryList, Transcript, shortTool, toolSummary } from "./History";
import { PromptComposer } from "./PromptComposer";
import { Icon } from "./ToolIcon";

/**
 * The agent-styleable chrome: the floating prompt and the history panel.
 * Every prop goes through the shared clamps (src/shared/chrome.ts) again here,
 * so whatever the core stored, the result stays usable.
 */

/** The area below the titlebar, where the canvas and the overlay live. */
export function useViewport() {
  const [vp, setVp] = useState({ w: innerWidth, h: innerHeight - TITLEBAR_H });
  useEffect(() => {
    const on = () => setVp({ w: innerWidth, h: innerHeight - TITLEBAR_H });
    addEventListener("resize", on);
    return () => removeEventListener("resize", on);
  }, []);
  return vp;
}

const SHADOW: Record<string, string> = {
  none: "0 0 #0000",
  soft: "0 18px 50px #0006",
  strong: "0 24px 70px #000b, 0 2px 8px #0008",
  glow: "0 0 30px color-mix(in srgb, var(--accent) 55%, transparent), 0 10px 30px #0006",
};

export function chromeStyle(applied: ChromeApplyResult["applied"], rect?: Rect): CSSProperties {
  const c = safeCssProps(applied);
  return {
    ...(rect ? { left: rect.x, top: rect.y, width: rect.width } : {}),
    opacity: c.opacity,
    fontFamily: c.font,
    fontSize: c.fontSize,
    // Composed in CSS so the prompt's bevel insets survive any shadow choice.
    ["--shadow" as string]: SHADOW[c.shadow],
    ["--accent" as string]: c.accent,
    ["--bg" as string]: c.background,
    ["--fg" as string]: c.foreground,
    ["--blur" as string]: `${c.blur}px`,
    ["--radius" as string]: `${c.radius}px`,
  };
}

const useApplied = (component: ChromeComponent) =>
  effectiveProps(
    component,
    useUi((s) => s.chrome[component]),
  );

interface TargetOption {
  value: string;
  label: string;
  to?: PromptTarget;
}

/** Hub: who the prompt goes to, one of my agents (per provider) or everyone. Undefined off a hub. */
function useTargets() {
  const hub = useUi((s) => Boolean(s.hub));
  const chosen = useUi((s) => s.target);
  const mine = useMyAgents();
  if (!hub) return undefined;
  const options: TargetOption[] = [
    ...mine.flatMap((a) =>
      a.providers
        .filter((p) => p.enabled)
        .map((p) => ({
          value: `${a.id}:${p.id}`,
          label: `${a.label} · ${p.label}`,
          to: { agent: a.id, provider: p.id },
        })),
    ),
    { value: "room", label: "everyone" },
  ];
  const current = options.find((o) => o.value === chosen) ?? options[0];
  const cycle = () => useUi.setState({ target: options[(options.indexOf(current) + 1) % options.length].value });
  return { options, current, cycle };
}

function AgentActivity() {
  const status = useUi((s) => s.status);
  const detail = useUi((s) => s.statusDetail);
  const history = useUi((s) => s.history);
  const cwd = useUi((s) => s.config?.cwd);
  const mini = useUi(historyMini);
  if (status === "idle") return null;

  let activity = detail ?? "";
  if (status !== "error") {
    for (let i = history.length - 1; i >= 0; i--) {
      const item = history[i];
      if (item.kind === "user" || item.kind === "turn") break;
      if (item.kind === "tool") {
        activity = [shortTool(item.name), toolSummary(item.input, cwd)].filter(Boolean).join(" · ");
        break;
      }
      if ((item.kind === "assistant" || item.kind === "thinking") && item.text.trim()) {
        activity = item.text;
        break;
      }
    }
  }
  activity = activity.replace(/\s+/g, " ").trim();
  const label = status === "error" ? "Error" : status === "tool" ? "Working…" : "Thinking…";
  return (
    <div className={`agent-activity st-${status}`} data-testid="agent-activity">
      <Icon name="brain" className="ic activity-brain" />
      <span className="activity-status" role="status">
        {label}
      </span>
      <span className="activity-detail" title={activity}>
        {activity}
      </span>
      <button
        type="button"
        className="activity-history"
        title={mini ? "Show history" : "Hide history"}
        aria-label={mini ? "Show history" : "Hide history"}
        aria-expanded={!mini}
        data-testid="activity-history-toggle"
        onClick={() => uiCommand("history")}
      >
        <Icon name="panel" />
      </button>
    </div>
  );
}

export function PromptBar() {
  const applied = useApplied("prompt");
  const status = useUi((s) => s.status);
  const config = useUi((s) => s.config);
  const connected = useUi((s) => s.connected);
  const meta = usePromptMeta();
  const targets = useTargets();
  const to = targets?.current.to;
  const { w, h } = useViewport();
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [height, setHeight] = useState<number>();
  const [text, setText] = useState("");
  useLayoutEffect(() => {
    const el = box.current!;
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight + 12));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const rect = layoutChrome("prompt", applied, w, h, height);
  const docked = applied.anchor.startsWith("bottom") && applied.y === 0;
  const busy = status === "thinking" || status === "tool";
  const hints: [string, string][] = busy
    ? [
        ["⏎", "queue"],
        ["esc", "stop"],
      ]
    : [
        ["⏎", "send"],
        ["⇧⏎", "newline"],
      ];
  return (
    <div
      className={`chrome-prompt${docked ? " docked" : ""}`}
      // Leave room above top-anchored prompts for both rows, even while hidden.
      style={chromeStyle(applied, { ...rect, y: docked ? rect.y : Math.max(rect.y, 84) })}
    >
      <AgentActivity />
      <PromptComposer
        className={`chrome-box bezel prompt-bezel st-${status}`}
        text={text}
        onText={setText}
        onSend={(value, content) => {
          send({ t: "prompt", text: value, ...content, ...(to && { to }) });
          setText("");
        }}
        provider={targets ? to?.provider : config?.provider}
        cwd={targets ? undefined : config?.cwd}
        to={to}
        inputRef={input}
        bodyRef={box}
        disabled={!connected}
        busy={busy}
        placeholder={
          targets
            ? to
              ? `Ask ${targets.current.label.split(" · ")[0]}…`
              : "Message everyone (no agent)…"
            : busy
              ? "Queue a follow-up…"
              : "Ask for a change…"
        }
        header={
          <div className="pfoot">
            {targets && (
              <button
                type="button"
                className={`ptarget${to ? "" : " room"}`}
                title={
                  targets.options.length > 1
                    ? "Click to choose who this goes to"
                    : "Connect your agent to the hub to ask it for changes"
                }
                data-testid="prompt-target"
                onClick={targets.cycle}
              >
                to {targets.current.label}
              </button>
            )}
            {meta.model && <span className="model">{meta.model}</span>}
            {meta.effort && (
              <span className="eff" title={`Effort: ${meta.effort}`}>
                <span className="bars">
                  {Array.from({ length: meta.levels }, (_, i) => (
                    <i key={i} className={i <= meta.level ? "on" : ""} />
                  ))}
                </span>
                {meta.effort}
              </span>
            )}
            <span className="hints">
              {hints.map(([k, l]) => (
                <span key={l}>
                  <kbd>{k}</kbd>
                  {l}
                </span>
              ))}
            </span>
          </div>
        }
      />
    </div>
  );
}

/** The session's model and effort, resolved to the CLI defaults when none were chosen. */
function usePromptMeta() {
  const config = useUi((s) => s.config);
  const provider = useSessionProvider();
  const id = config?.model || provider?.defaultModel || "";
  const info = provider?.models.find((m) => m.id === id);
  const efforts: Effort[] = info?.efforts ?? [];
  const effort = config?.effort || info?.defaultEffort || "";
  return {
    model: info?.label ?? id,
    effort,
    levels: Math.max(efforts.length, 1),
    level: effort ? Math.max(efforts.indexOf(effort), 0) : -1,
  };
}

export function HistoryPanel() {
  const applied = useApplied("history");
  const { history, status } = useUi();
  const [transcript, setTranscript] = useState<string>();
  const closeTranscript = useCallback(() => setTranscript(undefined), []);
  const { w, h } = useViewport();
  const rect = layoutChrome("history", applied, w, h);
  if (applied.mode === "mini") return null;
  return (
    <section
      className={`chrome-box chrome-history st-${status}`}
      data-testid="history"
      style={{ ...chromeStyle(applied, rect), height: rect.height }}
    >
      <HistoryList items={history} status={status} onTranscript={setTranscript} />
      {transcript && <Transcript items={history} groupId={transcript} onClose={closeTranscript} />}
    </section>
  );
}

/** Stays mounted while hidden so a half-typed prompt survives. */
export function ChromeLayer({ hidden }: { hidden?: boolean }) {
  return (
    <div
      className="chrome-layer"
      hidden={hidden}
      data-testid="overlay"
      style={{ zIndex: CHROME_Z, ["--margin" as string]: `${CHROME_MARGIN}px` }}
    >
      <HistoryPanel />
      <PromptBar />
    </div>
  );
}
