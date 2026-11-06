import { z } from "zod";
import type { ProviderInfo } from "./protocol";

export const CLAUDE_PERMISSION_MODES = [
  "default",
  "auto",
  "acceptEdits",
  "plan",
  "dontAsk",
  "bypassPermissions",
] as const;

export const settingsSchema = z.object({
  general: z.object({ provider: z.string(), model: z.string(), effort: z.string() }),
  providers: z.object({
    claude: z.object({ permissionMode: z.enum(CLAUDE_PERMISSION_MODES).optional(), sandbox: z.boolean().optional() }),
  }),
});

export type AppSettings = z.infer<typeof settingsSchema>;
export type ClaudeSettings = AppSettings["providers"]["claude"];

export function defaultSettings(): AppSettings {
  return { general: { provider: "", model: "", effort: "" }, providers: { claude: {} } };
}

export function defaultSelection(providers: ProviderInfo[], settings = defaultSettings().general) {
  const preferred = providers.find((provider) => provider.id === settings.provider);
  const claude = providers.find((provider) => provider.id === "claude");
  const provider =
    (preferred?.enabled || preferred?.pending ? preferred : undefined) ??
    (claude?.enabled || claude?.pending ? claude : undefined) ??
    providers.find((candidate) => candidate.enabled);
  const providerId = provider?.id ?? "claude";
  const saved = !settings.provider || settings.provider === providerId;
  const model =
    saved && settings.model ? provider?.models.find((candidate) => candidate.id === settings.model) : undefined;
  const modelId = model?.id ?? provider?.defaultModel ?? provider?.models[0]?.id ?? "";
  const modelInfo = provider?.models.find((candidate) => candidate.id === modelId);
  const effort =
    saved && (!settings.model || model) && modelInfo?.efforts.includes(settings.effort) ? settings.effort : "";
  return { providerId, modelId, effort };
}
