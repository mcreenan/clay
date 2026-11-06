import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  MAX_PROMPT_ATTACHMENT_BYTES,
  type InputCapabilities,
  type PromptAttachment,
  type PromptCommand,
  type PromptContent,
  type PromptTarget,
} from "../../shared/protocol";
import { isPromptImage } from "../../shared/prompt";
import { discoverInput, send } from "../controller";
import { commandMatches, fileMime } from "../prompt";
import { useUi } from "../store";
import { Icon } from "./ToolIcon";

const UNKNOWN: InputCapabilities = { commands: [], images: false, files: true };

function useInput(provider?: string, cwd?: string, to?: PromptTarget) {
  const connected = useUi((s) => s.connected);
  const sessionId = useUi((s) => s.sessionId);
  const update = useUi((s) => s.inputUpdate);
  const [capabilities, setCapabilities] = useState(UNKNOWN);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const agent = to?.agent;
  useEffect(() => {
    let active = true;
    setCapabilities({ ...UNKNOWN, images: !provider || provider === "claude" || provider === "codex" });
    setError("");
    setLoading(Boolean(provider && connected));
    if (!provider || !connected) return;
    const timer = setTimeout(() => {
      void discoverInput(provider, cwd, agent ? { agent, provider } : undefined).then(
        (value) => {
          if (active) {
            setCapabilities(value);
            setLoading(false);
          }
        },
        (e: Error) => {
          if (active) {
            setError(e.message);
            setLoading(false);
          }
        },
      );
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [provider, cwd, agent, sessionId, connected]);
  useEffect(() => {
    if (update && update.provider === provider && update.agent === agent) {
      setCapabilities(update.capabilities);
      setError("");
      setLoading(false);
    }
  }, [update, provider, agent]);
  return { capabilities, discoveryError: error, loading };
}

function readAttachment(file: File): Promise<PromptAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve({ name: file.name, mime: fileMime(file), base64: (reader.result as string).split(",")[1] });
    reader.onerror = () => reject(new Error(`Could not read ${file.name}. Attach the file again.`));
    reader.readAsDataURL(file);
  });
}

export function PromptComposer({
  text,
  onText,
  onSend,
  provider,
  cwd,
  to,
  placeholder,
  className,
  header,
  footer,
  inputRef,
  bodyRef,
  disabled = false,
  pending = false,
  busy = false,
  start = false,
  autoFocus = false,
}: {
  text: string;
  onText: (text: string) => void;
  onSend: (text: string, content: PromptContent) => void;
  provider?: string;
  cwd?: string;
  to?: PromptTarget;
  placeholder: string;
  className: string;
  header?: ReactNode;
  footer?: ReactNode;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  bodyRef?: RefObject<HTMLDivElement | null>;
  disabled?: boolean;
  pending?: boolean;
  busy?: boolean;
  start?: boolean;
  autoFocus?: boolean;
}) {
  const { capabilities, discoveryError, loading } = useInput(provider, cwd, to);
  const [attachments, setAttachments] = useState<PromptAttachment[]>([]);
  const [command, setCommand] = useState<PromptCommand>();
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [focused, setFocused] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const readingRef = useRef(false);
  const id = useId();
  const completion = commandMatches(text, caret, capabilities.commands);
  const matches = !dismissed && focused ? (completion?.matches ?? []) : [];
  const selected = Math.min(active, Math.max(matches.length - 1, 0));
  const unsupported = attachments.some((a) => (isPromptImage(a.mime) ? !capabilities.images : !capabilities.files));
  const canSend = !disabled && !pending && !reading && !unsupported && Boolean(text.trim() || attachments.length);
  const action = start ? "Start" : busy ? "Queue" : "Send";

  useLayoutEffect(() => {
    const ta = inputRef.current;
    if (!ta) return;
    ta.style.height = "0px";
    ta.style.height = `${Math.min(ta.scrollHeight, start ? 320 : 220)}px`;
    ta.style.overflowY = ta.scrollHeight > (start ? 320 : 220) ? "auto" : "hidden";
  }, [text, start, inputRef]);
  useEffect(() => {
    list.current?.children[selected]?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  useEffect(() => {
    setCommand(undefined);
    setDismissed(false);
  }, [provider, cwd, to?.agent]);

  const choose = (value: PromptCommand) => {
    if (!completion) return;
    const next = text.slice(0, completion.start) + value.invocation + " " + text.slice(completion.end);
    const position = completion.start + value.invocation.length + 1;
    onText(next);
    setCommand(value);
    setDismissed(true);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(position, position);
    });
  };
  const submit = () => {
    if (!canSend) return;
    onSend(text.trim(), {
      ...(attachments.length ? { attachments } : {}),
      ...(command && text.split(/\s+/).includes(command.invocation) ? { command } : {}),
    });
    if (!start) {
      setAttachments([]);
      setCommand(undefined);
      setError("");
    }
    setDismissed(true);
  };
  const attach = async (files: File[]) => {
    if (readingRef.current || disabled || pending || !files.length) return;
    setError("");
    if (attachments.length + files.length > MAX_ATTACHMENTS)
      return setError(`Attach up to ${MAX_ATTACHMENTS} files per message.`);
    let size = attachments.reduce((n, a) => n + (a.base64.length * 3) / 4, 0);
    for (const file of files) {
      if (!file.size) return setError(`${file.name} is empty.`);
      if (file.size > MAX_ATTACHMENT_BYTES) return setError(`${file.name} exceeds the 10 MB file limit.`);
      size += file.size;
      if (isPromptImage(fileMime(file)) ? !capabilities.images : !capabilities.files)
        return setError(
          isPromptImage(fileMime(file))
            ? "This agent does not support image input. Select another agent."
            : "This agent does not support file attachments.",
        );
    }
    if (size > MAX_PROMPT_ATTACHMENT_BYTES) return setError("Attachments exceed the 20 MB message limit.");
    readingRef.current = true;
    setReading(true);
    try {
      const added = await Promise.all(files.map(readAttachment));
      setAttachments((previous) => [...previous, ...added]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the attachment.");
    } finally {
      readingRef.current = false;
      setReading(false);
    }
  };

  return (
    <form
      className={className}
      data-testid={start ? "composer" : "prompt"}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {header}
      <div className="prompt-input" ref={bodyRef}>
        {matches.length > 0 && (
          <div
            className="command-menu"
            id={`${id}-commands`}
            role="listbox"
            aria-label="Skills and commands"
            ref={list}
          >
            {matches.map((c, i) => (
              <div
                key={`${c.invocation}:${c.path ?? ""}`}
                id={`${id}-command-${i}`}
                role="option"
                aria-selected={i === selected}
                className={`command-option${i === selected ? " active" : ""}`}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(c)}
              >
                <span className="command-name">{c.invocation}</span>
                {c.argumentHint && <span className="command-hint">{c.argumentHint}</span>}
                <span className="command-description">{c.description}</span>
              </div>
            ))}
          </div>
        )}
        <div
          className="well"
          onClick={(e) => {
            if (e.target === e.currentTarget) inputRef.current?.focus();
          }}
        >
          <textarea
            ref={inputRef}
            autoFocus={autoFocus}
            rows={start ? 2 : 1}
            value={text}
            placeholder={placeholder}
            aria-label={start ? "New agent prompt" : "Agent prompt"}
            aria-describedby={error || unsupported ? `${id}-error` : undefined}
            aria-controls={matches.length ? `${id}-commands` : undefined}
            aria-activedescendant={matches.length ? `${id}-command-${selected}` : undefined}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
            onChange={(e) => {
              onText(e.target.value);
              setCaret(e.target.selectionStart);
              setDismissed(false);
              setActive(0);
            }}
            onPaste={(e) => {
              const images = Array.from(e.clipboardData.items)
                .filter((i) => i.kind === "file")
                .map((i) => i.getAsFile())
                .filter((f): f is File => Boolean(f));
              if (images.length) {
                e.preventDefault();
                void attach(images);
              }
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "Tab" && e.shiftKey) {
                setDismissed(true);
                return;
              }
              if (matches.length && ["ArrowDown", "ArrowUp", "Tab", "Enter", "Escape"].includes(e.key)) {
                if (e.key === "Enter" && e.shiftKey) return;
                e.preventDefault();
                if (e.key === "ArrowDown" || e.key === "ArrowUp")
                  setActive((selected + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length);
                else if (e.key === "Escape") setDismissed(true);
                else choose(matches[selected]);
                return;
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              } else if (e.key === "Escape" && busy) {
                e.preventDefault();
                send({ t: "interrupt" });
              }
            }}
          />
          {busy && (
            <button
              type="button"
              className="key stop"
              title="Stop (Esc)"
              aria-label="Stop"
              onClick={() => send({ t: "interrupt" })}
            >
              <svg className="ic fill" viewBox="0 0 24 24" aria-hidden>
                <rect x="7" y="7" width="10" height="10" rx="2" />
              </svg>
            </button>
          )}
          <input
            ref={picker}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              void attach(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
          <button
            type="button"
            className="attach-button"
            title={reading ? "Reading files…" : "Attach files · 10 MB each, 20 MB total"}
            aria-label={reading ? "Reading files" : "Attach files"}
            aria-busy={reading}
            disabled={disabled || pending || reading || (!capabilities.files && !capabilities.images)}
            onClick={() => picker.current?.click()}
          >
            {reading ? (
              <span className="spinner" />
            ) : (
              <svg viewBox="0 0 20 20" aria-hidden>
                <path d="m7 10 5-5a3 3 0 0 1 4 4l-7 7a4 4 0 0 1-6-6l7-7m-1 8 5-5" />
              </svg>
            )}
          </button>
          <button
            className="key send"
            type="submit"
            title={`${action} (Enter)`}
            aria-label={action}
            disabled={!canSend}
          >
            {pending ? <span className="spinner" /> : <Icon name={busy ? "queue" : "up"} />}
          </button>
        </div>
        {attachments.length > 0 && (
          <div className="prompt-attachments" aria-label="Attachments">
            {attachments.map((a, i) => (
              <div className="prompt-attachment" key={i}>
                {isPromptImage(a.mime) && <img src={`data:${a.mime};base64,${a.base64}`} alt="" />}
                <span title={a.name}>{a.name}</span>
                <button
                  type="button"
                  aria-label={`Remove ${a.name}`}
                  disabled={reading || pending}
                  onClick={() => {
                    setAttachments((items) => items.filter((_, n) => n !== i));
                    setError("");
                  }}
                >
                  <svg viewBox="0 0 16 16" aria-hidden>
                    <path d="m4 4 8 8M12 4l-8 8" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
        {(loading || discoveryError) && (
          <div className="command-status" title={discoveryError || undefined}>
            {loading ? "Loading commands…" : "Commands unavailable"}
          </div>
        )}
        {(error || unsupported) && (
          <div className="prompt-error" id={`${id}-error`} role="alert">
            {error || "This agent cannot read an attached image. Remove the image or select another agent."}
          </div>
        )}
      </div>
      {footer}
    </form>
  );
}
