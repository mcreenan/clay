import {
  query,
  type Options,
  type SDKMessage,
  type SDKUserMessage,
  type SlashCommand,
} from "@anthropic-ai/claude-agent-sdk";
import os from "node:os";
import type { Effort, InputCapabilities, ModelInfo, ProviderInfo } from "../../shared/protocol";
import { CLAUDE_PERMISSION_MODES, type ClaudeSettings } from "../../shared/settings";
import { createCanvasMcpServer, MCP_SERVER_NAME, mcpToolName } from "../tools";
import { prepareInput } from "./input";
import { findExecutable, withTimeout } from "./exec";
import type { AgentProvider, AgentRun, ProviderContext } from "./types";

/**
 * Claude via the Agent SDK, driving the user's installed `claude` CLI so the
 * CLI's own login (Pro/Max subscription or `CLAUDE_CODE_OAUTH_TOKEN` from
 * `claude setup-token`) is used. We never set ANTHROPIC_API_KEY.
 */

/** Built-in tools that run without prompting; anything else follows the user's settings or is denied (no approval UI yet). */
const PREAPPROVED = ["Read", "Glob", "Grep", "WebFetch", "WebSearch", "TodoWrite"];

export function resolveClaudeExecutable(): string | undefined {
  return process.env.CLAY_CLAUDE_EXECUTABLE || findExecutable("claude");
}

function baseOptions(): Options {
  const exe = resolveClaudeExecutable();
  return {
    pathToClaudeCodeExecutable: exe,
    settingSources: ["user", "project", "local"],
    persistSession: true,
    env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: "clay/0.2" },
  };
}

/** Push-based async iterable used as the SDK's streaming input. */
class InputQueue implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = [];
  private wake?: () => void;
  private closed = false;
  push(content: SDKUserMessage["message"]["content"]) {
    this.items.push({
      type: "user",
      message: { role: "user", content },
      parent_tool_use_id: null,
    } as SDKUserMessage);
    this.wake?.();
  }
  close() {
    this.closed = true;
    this.wake?.();
  }
  async *[Symbol.asyncIterator]() {
    while (true) {
      while (this.items.length) yield this.items.shift()!;
      if (this.closed) return;
      await new Promise<void>((r) => (this.wake = r));
      this.wake = undefined;
    }
  }
}

const never: AsyncIterable<SDKUserMessage> = { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) };

function claudeInput(commands: SlashCommand[]): InputCapabilities {
  return {
    images: true,
    files: true,
    commands: commands.map((c) => ({
      name: c.name,
      description: c.description,
      invocation: `/${c.name}`,
      argumentHint: c.argumentHint,
    })),
  };
}

export class ClaudeProvider implements AgentProvider {
  constructor(private readonly settings: () => ClaudeSettings = () => ({})) {}

  async input(cwd: string): Promise<InputCapabilities> {
    const q = query({ prompt: never, options: { ...baseOptions(), cwd } });
    try {
      return claudeInput(await withTimeout(q.supportedCommands(), 15_000, "asking Claude for commands"));
    } finally {
      q.close();
    }
  }

  async discover(onUpdate?: () => void): Promise<ProviderInfo> {
    const info: ProviderInfo = { id: "claude", label: "Claude", enabled: false, models: [] };
    const exe = resolveClaudeExecutable();
    if (!exe) return { ...info, note: "claude CLI not found on PATH (set CLAY_CLAUDE_EXECUTABLE)" };
    // Ask the CLI itself which models and effort levels this login supports.
    const q = query({ prompt: never, options: { ...baseOptions(), cwd: os.homedir() } });
    // Not in the SDK's typings yet: reports the model and effort the next request would use.
    const applied = async () =>
      ((await (q as any).getSettings())?.applied ?? {}) as { model?: string; effort?: Effort | null };
    let keepOpen = false;
    try {
      const timeout = new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error("timed out asking the claude CLI for models")), 20000),
      );
      const [account, rows, current] = await Promise.race([
        Promise.all([q.accountInfo(), q.supportedModels(), applied()]),
        timeout,
      ]);
      const who = account.subscriptionType
        ? `${account.subscriptionType} subscription`
        : (account.apiKeySource ?? account.tokenSource ?? account.apiProvider ?? "unknown auth");
      const toInfo = (m: (typeof rows)[number]): ModelInfo => ({
        id: m.value === "default" ? "" : m.value,
        label: m.displayName,
        efforts: (m.supportsEffort === false ? [] : (m.supportedEffortLevels ?? [])) as Effort[],
        description: m.description,
      });
      // Offer the model the "default" row resolves to rather than the row itself.
      const def = rows.find((m) => m.value === "default");
      const twin = def && rows.find((m) => m !== def && m.resolvedModel && m.resolvedModel === def.resolvedModel);
      const models = rows.filter((m) => m !== def || !twin).map(toInfo);
      if (def && !twin) {
        const own = models.find((m) => m.id === "")!;
        own.label = def.description.split(" · ")[0] || own.label;
      }
      const defaultModel = twin ? twin.value : def ? "" : models[0]?.id;
      const first = models.find((m) => m.id === defaultModel);
      if (first && current.effort && first.efforts.includes(current.effort)) first.defaultEffort = current.effort;

      // Each model's own default effort takes a model switch to learn (~0.5s each); fill them in afterwards.
      keepOpen = true;
      void (async () => {
        try {
          for (const m of models) {
            if (m === first || !m.efforts.length) continue;
            await q.setModel(m.id || undefined);
            const e = (await applied()).effort;
            if (e && m.efforts.includes(e)) m.defaultEffort = e;
          }
          onUpdate?.();
        } catch {
        } finally {
          q.close();
        }
      })();

      return {
        ...info,
        enabled: true,
        auth: `${who}${account.email ? ` (${account.email})` : ""}`,
        models,
        defaultModel,
      };
    } catch (e: any) {
      return { ...info, note: `claude CLI did not respond: ${e?.message ?? e}` };
    } finally {
      if (!keepOpen) q.close();
    }
  }

  start(ctx: ProviderContext): AgentRun {
    const input = new InputQueue();
    const { config } = ctx;
    const canvasTools = ctx.tools.defs.map((t) => mcpToolName(t.name));
    const settings = this.settings();
    const environmentMode = CLAUDE_PERMISSION_MODES.find((mode) => mode === process.env.CLAY_PERMISSION_MODE);
    const permissionMode = settings.permissionMode ?? environmentMode;
    const sandbox =
      settings.sandbox ??
      (process.env.CLAY_SANDBOX === "0" ? false : process.env.CLAY_SANDBOX === "1" ? true : undefined);
    const q = query({
      prompt: input,
      options: {
        ...baseOptions(),
        cwd: config.cwd,
        model: config.model || undefined,
        effort: (config.effort || undefined) as Options["effort"],
        systemPrompt: ctx.systemPrompt,
        resume: ctx.resumeId,
        forkSession: ctx.resumeId ? ctx.fork : undefined,
        includePartialMessages: true,
        mcpServers: { [MCP_SERVER_NAME]: createCanvasMcpServer(ctx.tools) },
        allowedTools: [...PREAPPROVED, ...canvasTools],
        ...(permissionMode && { permissionMode }),
        ...(permissionMode === "bypassPermissions" && { allowDangerouslySkipPermissions: true }),
        ...(sandbox !== undefined && { sandbox: { enabled: sandbox } }),
      },
    });

    let closed = false;
    void q
      .supportedCommands()
      .then((commands) => {
        if (!closed) ctx.emit({ type: "input-capabilities", capabilities: claudeInput(commands) });
      })
      .catch(() => {});
    const st: StreamState = { msgId: "", streamed: new Set() };
    void (async () => {
      try {
        for await (const msg of q) handle(msg, ctx, st);
      } catch (e: any) {
        if (!closed) ctx.emit({ type: "fatal", error: e?.message ?? String(e) });
      }
    })();

    return {
      send: (text, meta) => {
        try {
          const prepared = prepareInput(config.cwd, text, meta);
          const content: Exclude<SDKUserMessage["message"]["content"], string> = [];
          if (prepared.text) content.push({ type: "text", text: prepared.text });
          for (const a of prepared.pictures)
            content.push({
              type: "image",
              source: {
                type: "base64",
                data: a.base64,
                media_type: a.mime as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
              },
            });
          input.push(content);
        } catch (e: any) {
          ctx.emit({ type: "turn-end", ok: false, error: e?.message ?? String(e) });
        }
      },
      interrupt: async () => {
        await q.interrupt();
      },
      close: () => {
        closed = true;
        input.close();
        q.close();
      },
    };
  }
}

interface StreamState {
  msgId: string;
  /** Message ids whose text arrived as stream deltas (skip their full-message copy). */
  streamed: Set<string>;
}

function handle(msg: SDKMessage, ctx: ProviderContext, st: StreamState) {
  const { emit } = ctx;
  if (msg.type === "system" && msg.subtype === "commands_changed") {
    emit({ type: "input-capabilities", capabilities: claudeInput(msg.commands) });
    return;
  }
  // Ignore subagent traffic; only the main thread is shown.
  if ("parent_tool_use_id" in msg && msg.parent_tool_use_id) return;
  switch (msg.type) {
    case "system":
      if (msg.subtype === "init") emit({ type: "session-id", id: msg.session_id });
      return;
    case "stream_event": {
      const ev = msg.event as any;
      if (ev.type === "message_start") st.msgId = ev.message.id;
      else if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
        st.streamed.add(st.msgId);
        emit({ type: "text-delta", messageId: `${st.msgId}:${ev.index}`, text: ev.delta.text });
      } else if (ev.type === "content_block_start" && ev.content_block?.type === "thinking")
        emit({ type: "thinking", messageId: `${st.msgId}:${ev.index}`, text: "" });
      else if (ev.type === "content_block_delta" && ev.delta?.type === "thinking_delta")
        emit({ type: "thinking", messageId: `${st.msgId}:${ev.index}`, text: ev.delta.thinking });
      return;
    }
    case "assistant": {
      const content = msg.message.content as any[];
      content.forEach((block, i) => {
        if (block.type === "text" && !st.streamed.has(msg.message.id))
          emit({ type: "text", messageId: `${msg.message.id}:${i}`, text: block.text });
        else if (block.type === "tool_use")
          emit({ type: "tool-start", id: block.id, name: block.name, input: block.input });
      });
      if (msg.error) emit({ type: "fatal", error: `assistant error: ${msg.error}` });
      return;
    }
    case "user": {
      const content = msg.message.content;
      if (!Array.isArray(content)) return;
      for (const block of content as any[]) {
        if (block.type !== "tool_result") continue;
        const text = Array.isArray(block.content)
          ? block.content.map((c: any) => (c.type === "text" ? c.text : `[${c.type}]`)).join("\n")
          : String(block.content ?? "");
        emit({ type: "tool-end", id: block.tool_use_id, result: text, isError: Boolean(block.is_error) });
      }
      return;
    }
    case "result":
      emit({
        type: "turn-end",
        ok: !msg.is_error && msg.subtype === "success",
        error:
          msg.subtype === "success" ? (msg.is_error ? msg.result : undefined) : msg.errors?.join("; ") || msg.subtype,
        durationMs: msg.duration_ms,
        costUsd: msg.total_cost_usd,
      });
      return;
  }
}
