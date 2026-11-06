import { useEffect, useRef, useState } from "react";
import {
  CLAUDE_PERMISSION_MODES,
  defaultSelection,
  defaultSettings,
  type AppSettings,
  type ClaudeSettings,
} from "../../shared/settings";
import { send } from "../controller";
import { useUi } from "../store";
import "../settings.css";

const PERMISSION_OPTIONS = [
  ["", "Use Claude settings"],
  ["auto", "Auto"],
  ["default", "Manual approvals"],
  ["acceptEdits", "Accept edits"],
  ["dontAsk", "Deny unless preapproved"],
  ["plan", "Plan only"],
  ["bypassPermissions", "Bypass permission checks"],
];

export function Settings() {
  const { settings, providers, connected, settingsSaving, settingsError } = useUi();
  const [draft, setDraft] = useState<AppSettings>(() => structuredClone(settings ?? defaultSettings()));
  const [section, setSection] = useState<"general" | "providers">("general");
  const ref = useRef<HTMLDialogElement>(null);
  const loaded = useRef(Boolean(settings));
  const close = () => useUi.setState({ settingsOpen: false });
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  useEffect(() => {
    if (settings && !loaded.current) {
      loaded.current = true;
      setDraft(structuredClone(settings));
    }
  }, [settings]);
  useEffect(() => {
    if (!settingsSaving) return;
    const timer = setTimeout(
      () =>
        useUi.setState({
          settingsSaving: false,
          settingsError: "Saving timed out. Check the connection and try again.",
        }),
      15_000,
    );
    return () => clearTimeout(timer);
  }, [settingsSaving]);
  const selection = defaultSelection(providers, draft.general);
  const provider = providers.find((candidate) => candidate.id === selection.providerId);
  const models = provider?.models ?? [];
  const model = models.find((candidate) => candidate.id === selection.modelId);
  const efforts = model?.efforts ?? [];
  const claude = draft.providers.claude;
  const changeGeneral = (patch: Partial<AppSettings["general"]>) =>
    setDraft((current) => ({ ...current, general: { ...current.general, ...patch } }));
  const changeClaude = (patch: Partial<ClaudeSettings>) =>
    setDraft((current) => ({
      ...current,
      providers: { ...current.providers, claude: { ...current.providers.claude, ...patch } },
    }));
  return (
    <dialog
      ref={ref}
      className="settings"
      aria-labelledby="settings-title"
      onCancel={close}
      onClose={close}
      onClick={(event) => event.target === event.currentTarget && !settingsSaving && close()}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!settings || !connected || settingsSaving) return;
          useUi.setState({ settingsSaving: true, settingsError: undefined });
          send({ t: "settings.set", settings: draft });
        }}
      >
        <header className="settings-header">
          <h1 id="settings-title">Settings</h1>
          <button
            type="button"
            className="btn"
            onClick={close}
            disabled={settingsSaving}
            autoFocus
            aria-label="Close settings"
          >
            Close
          </button>
        </header>
        <div className="settings-layout">
          <nav aria-label="Settings sections">
            <button
              type="button"
              aria-current={section === "general" ? "page" : undefined}
              onClick={() => setSection("general")}
            >
              General
            </button>
            <button
              type="button"
              aria-current={section === "providers" ? "page" : undefined}
              onClick={() => setSection("providers")}
            >
              Providers
            </button>
          </nav>
          <div className="settings-body">
            {!settings && <p role="status">Settings are available in the desktop app or a local Clay server.</p>}
            <fieldset disabled={!settings || settingsSaving}>
              {section === "general" ? (
                <section aria-labelledby="settings-general-title">
                  <h2 id="settings-general-title">General</h2>
                  <p>Choose the defaults for new local sessions. You can change them before you start.</p>
                  <label htmlFor="settings-provider">Default provider</label>
                  <select
                    id="settings-provider"
                    value={draft.general.provider}
                    onChange={(event) => changeGeneral({ provider: event.target.value, model: "", effort: "" })}
                  >
                    <option value="">Automatic</option>
                    {draft.general.provider &&
                      !providers.some((candidate) => candidate.id === draft.general.provider) && (
                        <option value={draft.general.provider}>{draft.general.provider} · unavailable</option>
                      )}
                    {providers.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.label}
                        {candidate.pending ? " · loading" : candidate.enabled ? "" : " · unavailable"}
                      </option>
                    ))}
                  </select>
                  <p className="settings-hint">
                    Automatic uses Claude when available, then another available provider.
                  </p>
                  <label htmlFor="settings-model">Default model</label>
                  <select
                    id="settings-model"
                    value={draft.general.model}
                    disabled={!models.length}
                    onChange={(event) => changeGeneral({ model: event.target.value, effort: "" })}
                  >
                    <option value="">Use provider default</option>
                    {draft.general.model && !models.some((candidate) => candidate.id === draft.general.model) && (
                      <option value={draft.general.model}>{draft.general.model} · unavailable</option>
                    )}
                    {models
                      .filter((candidate) => candidate.id)
                      .map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.label}
                        </option>
                      ))}
                  </select>
                  <label htmlFor="settings-effort">Default effort</label>
                  <select
                    id="settings-effort"
                    value={draft.general.effort}
                    disabled={!efforts.length}
                    onChange={(event) => changeGeneral({ effort: event.target.value })}
                  >
                    <option value="">Use provider default</option>
                    {draft.general.effort && !efforts.includes(draft.general.effort) && (
                      <option value={draft.general.effort}>{draft.general.effort} · unavailable</option>
                    )}
                    {efforts.map((effort) => (
                      <option key={effort} value={effort}>
                        {provider?.effortLabels?.[effort] ?? effort.charAt(0).toUpperCase() + effort.slice(1)}
                      </option>
                    ))}
                  </select>
                </section>
              ) : (
                <section aria-labelledby="settings-claude-title">
                  <h2 id="settings-claude-title">Claude</h2>
                  <p>Use Claude's own settings, or override them for agents run by this Clay instance.</p>
                  <label htmlFor="settings-permission">Permission mode</label>
                  <select
                    id="settings-permission"
                    value={claude.permissionMode ?? ""}
                    onChange={(event) =>
                      changeClaude({
                        permissionMode: CLAUDE_PERMISSION_MODES.find((mode) => mode === event.target.value),
                      })
                    }
                  >
                    {PERMISSION_OPTIONS.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <p className="settings-hint">
                    Auto uses Claude's safety checks. It can still refuse a tool call. Clay does not show approval
                    prompts.
                  </p>
                  {claude.permissionMode === "bypassPermissions" && (
                    <p className="settings-warning" role="status">
                      Permission checks will be bypassed. Use this only for work you trust.
                    </p>
                  )}
                  <label htmlFor="settings-sandbox">Command sandbox</label>
                  <select
                    id="settings-sandbox"
                    value={claude.sandbox === undefined ? "" : String(claude.sandbox)}
                    onChange={(event) =>
                      changeClaude({ sandbox: event.target.value === "" ? undefined : event.target.value === "true" })
                    }
                  >
                    <option value="">Use Claude settings</option>
                    <option value="true">Enabled</option>
                    <option value="false">Disabled</option>
                  </select>
                  {claude.sandbox === false && (
                    <p className="settings-warning" role="status">
                      Commands will run without Claude's sandbox. Permission checks still apply.
                    </p>
                  )}
                  <p className="settings-hint">
                    No Claude files are changed. Environment overrides still apply when no Clay override is selected.
                  </p>
                  <p className="settings-note">
                    Changes apply to new agent runs. Restart Clay to apply them to an existing run.
                  </p>
                </section>
              )}
            </fieldset>
          </div>
        </div>
        <footer className="settings-footer">
          <p role="alert">{settingsError}</p>
          <button type="button" className="btn" onClick={close} disabled={settingsSaving}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!settings || !connected || settingsSaving}>
            {settingsSaving ? "Saving…" : "Save changes"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
