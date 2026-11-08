import { randomUUID } from "node:crypto";
import type {
  ServerMsg,
  UserInputAnswer,
  UserInputReply,
  UserInputRequest,
  UserInputResult,
  UserInputSpec,
} from "../shared/protocol";

/** Structural subset of Session.Client. No dependency on Session is needed. */
export interface InteractionClient {
  id: string;
  user?: { id: string };
}

export interface InteractionOptions {
  requestId?: string;
  ownerId?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

type PendingInput = {
  request: UserInputRequest;
  resolve: (result: UserInputResult) => void;
  cleanup: () => void;
};

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TEXT = 4000;

function validate(spec: UserInputSpec) {
  if (!spec || typeof spec.prompt !== "string" || !spec.prompt.trim() || spec.prompt.length > MAX_TEXT)
    throw new Error("Input prompt must contain 1 to 4000 characters.");
  const items = spec.kind === "choice" ? spec.options : spec.kind === "form" ? spec.fields : undefined;
  if (!Array.isArray(items) || !items.length || items.length > 10)
    throw new Error("Input must have 1 to 10 choices or fields.");
  const ids = new Set<string>();
  for (const item of items) {
    if (!item || typeof item.id !== "string" || !/^[\w-]{1,80}$/.test(item.id) || ids.has(item.id))
      throw new Error("Input ids must be unique and contain letters, numbers, underscores, or hyphens.");
    if (typeof item.label !== "string" || !item.label.trim() || item.label.length > 500)
      throw new Error("Input labels must contain 1 to 500 characters.");
    if (
      "description" in item &&
      item.description !== undefined &&
      (typeof item.description !== "string" || item.description.length > MAX_TEXT)
    )
      throw new Error("Choice descriptions must contain at most 4000 characters.");
    if (
      "placeholder" in item &&
      item.placeholder !== undefined &&
      (typeof item.placeholder !== "string" || item.placeholder.length > 500)
    )
      throw new Error("Field placeholders must contain at most 500 characters.");
    if ("required" in item && item.required !== undefined && typeof item.required !== "boolean")
      throw new Error("Field required must be a boolean.");
    ids.add(item.id);
  }
}

function checkedAnswer(request: UserInputRequest, answer: UserInputAnswer): UserInputAnswer | undefined {
  if (!answer || typeof answer !== "object") return;
  if (request.kind === "choice")
    return "choice" in answer && request.options.some((option) => option.id === answer.choice)
      ? { choice: answer.choice }
      : undefined;
  if (!("values" in answer) || !answer.values || typeof answer.values !== "object" || Array.isArray(answer.values))
    return;
  const values = answer.values;
  const valid =
    Object.keys(values).every((id) => request.fields.some((field) => field.id === id)) &&
    request.fields.every((field) => {
      const value = Object.hasOwn(values, field.id) ? values[field.id] : "";
      return typeof value === "string" && value.length <= MAX_TEXT && (!field.required || Boolean(value.trim()));
    });
  return valid ? { values: Object.fromEntries(Object.entries(values)) } : undefined;
}

/** Owns transient input promises. The parent owns routing, client membership, and persistence. */
export class SessionInteractions {
  private requests = new Map<string, PendingInput>();
  private disposed = false;

  constructor(private broadcast: (message: ServerMsg) => void) {}

  get pending(): UserInputRequest[] {
    return this.snapshot();
  }

  snapshot(): UserInputRequest[] {
    return structuredClone([...this.requests.values()].map((entry) => entry.request));
  }

  request(spec: UserInputSpec, options: InteractionOptions = {}): Promise<UserInputResult> {
    if (this.disposed) return Promise.reject(new Error("Session interactions are disposed."));
    validate(spec);
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647)
      throw new Error("Input timeout must be a positive number of milliseconds.");
    const requestId = options.requestId ?? randomUUID();
    if (!requestId || this.requests.has(requestId)) throw new Error("Input request id is empty or already pending.");
    const createdAt = Date.now();
    const request: UserInputRequest = {
      ...structuredClone(spec),
      requestId,
      createdAt,
      expiresAt: createdAt + timeoutMs,
      ...(options.ownerId && { ownerId: options.ownerId }),
    };
    if (options.signal?.aborted)
      return Promise.resolve({ requestId, status: "cancelled", reason: "Input request was aborted." });
    return new Promise((resolve, reject) => {
      const abort = () => this.cancel(requestId, "Input request was aborted.");
      const timer = setTimeout(
        () => this.finish({ requestId, status: "timeout", reason: "Input request timed out." }),
        timeoutMs,
      );
      timer.unref?.();
      this.requests.set(requestId, {
        request,
        resolve,
        cleanup: () => {
          clearTimeout(timer);
          options.signal?.removeEventListener("abort", abort);
        },
      });
      options.signal?.addEventListener("abort", abort, { once: true });
      try {
        this.broadcast({ t: "user_input.request", request: structuredClone(request) });
      } catch (error) {
        this.requests.get(requestId)?.cleanup();
        this.requests.delete(requestId);
        reject(error);
      }
    });
  }

  reply(message: UserInputReply): boolean;
  reply(client: InteractionClient | undefined, message: UserInputReply): boolean;
  reply(clientOrMessage: InteractionClient | UserInputReply | undefined, message?: UserInputReply): boolean {
    const client = message ? (clientOrMessage as InteractionClient | undefined) : undefined;
    const reply = message ?? (clientOrMessage as UserInputReply);
    if (!reply || reply.t !== "user_input.reply") return false;
    const entry = this.requests.get(reply.requestId);
    if (!entry) return false;
    const owner = entry.request.ownerId;
    if (owner && owner !== (client?.user?.id ?? client?.id)) return false;
    if (Date.now() >= entry.request.expiresAt) {
      this.finish({ requestId: reply.requestId, status: "timeout", reason: "Input request timed out." });
      return false;
    }
    if (reply.cancelled === true) return this.cancel(reply.requestId, "Cancelled by the user.");
    const answer = checkedAnswer(entry.request, reply.answer);
    if (!answer) return false;
    return this.finish({ requestId: reply.requestId, status: "answered", answer });
  }

  cancel(requestId: string, reason = "Input request was cancelled."): boolean {
    return this.finish({ requestId, status: "cancelled", reason });
  }

  cancelAll(reason?: string): void {
    for (const requestId of [...this.requests.keys()]) this.cancel(requestId, reason);
  }

  /** Call with the departing owner, or without a client when the last viewer leaves. */
  disconnect(client?: InteractionClient): void {
    const ownerId = client?.user?.id ?? client?.id;
    for (const { request } of [...this.requests.values()])
      if (!client || request.ownerId === ownerId)
        this.finish({ requestId: request.requestId, status: "disconnected", reason: "Input owner disconnected." });
  }

  dispose(): void {
    this.disposed = true;
    for (const requestId of [...this.requests.keys()])
      this.finish({ requestId, status: "disposed", reason: "Session was disposed." });
  }

  private finish(result: UserInputResult): boolean {
    const entry = this.requests.get(result.requestId);
    if (!entry) return false;
    this.requests.delete(result.requestId);
    entry.cleanup();
    entry.resolve(result);
    try {
      this.broadcast({ t: "user_input.result", result: structuredClone(result) });
    } catch {
      // A closed transport must not prevent the remaining promises from settling.
    }
    return true;
  }
}
