import { expect, test } from "vite-plus/test";
import type { ProviderInfo } from "./protocol";
import { defaultSelection } from "./settings";

const providers: ProviderInfo[] = [
  { id: "claude", label: "Claude", enabled: true, models: [{ id: "opus", label: "Opus", efforts: ["low", "high"] }] },
  { id: "codex", label: "Codex", enabled: true, models: [{ id: "gpt", label: "GPT", efforts: ["medium", "high"] }] },
];

test("new sessions use the saved provider, model and supported effort", () => {
  expect(defaultSelection(providers, { provider: "codex", model: "gpt", effort: "medium" })).toEqual({
    providerId: "codex",
    modelId: "gpt",
    effort: "medium",
  });
});

test("unavailable preferences cannot leak model or effort into a different provider", () => {
  expect(defaultSelection(providers, { provider: "removed", model: "gpt", effort: "medium" })).toEqual({
    providerId: "claude",
    modelId: "opus",
    effort: "",
  });
  expect(defaultSelection(providers, { provider: "claude", model: "old-opus", effort: "high" })).toEqual({
    providerId: "claude",
    modelId: "opus",
    effort: "",
  });
});

test("a pending preferred provider stays selected while discovery runs", () => {
  expect(
    defaultSelection([providers[0], { ...providers[1], enabled: false, pending: true, models: [] }], {
      provider: "codex",
      model: "gpt",
      effort: "medium",
    }).providerId,
  ).toBe("codex");
});
