import { useEffect, useRef, useState } from "react";
import { hubSetupCommands } from "../../shared/hubSetup";
import { useUi } from "../store";
import "../hubSetup.css";

function Command({ label, text }: { label: string; text: string }) {
  const [result, setResult] = useState<"copied" | "failed">();
  useEffect(() => {
    if (!result) return;
    const timer = setTimeout(() => setResult(undefined), 3000);
    return () => clearTimeout(timer);
  }, [result]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setResult("copied");
    } catch {
      setResult("failed");
    }
  };
  return (
    <div className="hub-command">
      <div className="hub-command-heading">
        <span>{label}</span>
        <button type="button" onClick={copy} aria-label={`Copy ${label.toLowerCase()}`}>
          {result === "copied" ? "Copied" : "Copy"}
        </button>
      </div>
      <pre tabIndex={0} aria-label={label}>
        <code>{text}</code>
      </pre>
      <span className="hub-copy-status" role="status">
        {result === "copied" && "Copied to clipboard."}
        {result === "failed" && "Copy is not available. Select the code and copy it manually."}
      </span>
    </div>
  );
}

export function HubSetup() {
  const ref = useRef<HTMLDialogElement>(null);
  const close = () => useUi.setState({ hubSetupOpen: false });
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="hub-setup"
      aria-labelledby="hub-setup-title"
      aria-describedby="hub-setup-description"
      data-testid="hub-setup"
      onCancel={close}
      onClose={close}
      onClick={(event) => event.target === event.currentTarget && close()}
    >
      <div className="hub-setup-layout">
        <header className="hub-setup-header">
          <div>
            <h1 id="hub-setup-title">Run a hub server</h1>
            <p id="hub-setup-description">
              Share projects and artifacts with other people. Each person's agents stay on their own machine.
            </p>
          </div>
          <button type="button" className="hub-setup-close" onClick={close} autoFocus>
            Close
          </button>
        </header>
        <div className="hub-setup-body">
          <p className="hub-setup-note">
            These instructions do not start a server or change your system. Run the commands yourself.
          </p>
          <section aria-labelledby="hub-prepare-title">
            <h2 id="hub-prepare-title">Prepare the source</h2>
            <p>Install Node.js 24 or later and Git on the server. The hub does not need an agent account.</p>
            <p>Download the source. If you already have the source, open Terminal in that folder instead.</p>
            <Command label="Download the source" text={hubSetupCommands.download} />
            <p>Run these build commands in the source folder. Keep this Terminal open for the next steps.</p>
            <Command label="Build the hub" text={hubSetupCommands.build} />
          </section>
          <details open>
            <summary>Run in Terminal</summary>
            <div className="hub-setup-option">
              <p>Run this command in the source folder. Keep Terminal open while the hub runs.</p>
              <Command label="Start the hub" text={hubSetupCommands.run} />
              <p>The hub prints the access token. Press Control+C to stop the hub.</p>
            </div>
          </details>
          <details>
            <summary>Run at login on macOS</summary>
            <div className="hub-setup-option">
              <p>
                Stop any hub you started in Terminal first. Run the setup command in the source folder on your Mac. Do
                not use sudo.
              </p>
              <p>
                The command creates a user-level launchd service and starts the hub now. The hub starts each time you
                log in. It restarts if it stops. It does not run while you are logged out or your Mac is asleep.
              </p>
              <p>
                The service uses the current Node executable and source folder. Keep both in place. The command refuses
                to replace an existing service file.
              </p>
              <Command label="Create and start the service" text={hubSetupCommands.install} />
              <p>Read the output and error logs if the hub does not start.</p>
              <Command label="Read the service logs" text={hubSetupCommands.logs} />
              <Command label="Stop until the next login" text={hubSetupCommands.stop} />
              <Command label="Start after a stop" text={hubSetupCommands.start} />
              <p>To remove the service, stop it first. Then delete its service file. This keeps all hub data.</p>
              <Command label="Remove the service file" text={hubSetupCommands.remove} />
              <p>
                After a Node upgrade or a source folder move, stop the service and remove its file. Run the setup
                command again from the source folder.
              </p>
            </div>
          </details>
          <section aria-labelledby="hub-connect-title">
            <h2 id="hub-connect-title">Connect to the hub</h2>
            <p>
              On the server, open <code>http://localhost:5318</code>. On another machine, use the server's network name
              or IP address with port <code>5318</code>.
            </p>
            <p>
              In the desktop app, select <strong>Connect to a hub…</strong> on the start screen. Enter the server
              address, your name, and the access token. You can also join in a browser.
            </p>
            <p>
              Both methods above store projects, state, and the token in <code>~/.clay/hub</code>. To read the token,
              run this command on the server.
            </p>
            <Command label="Read the access token" text={hubSetupCommands.token} />
            <p className="hub-setup-warning">
              Use a trusted network or a private VPN. This prototype uses plain HTTP and a shared token. Do not expose
              port 5318 to the public internet. Share the token only with people who need access.
            </p>
          </section>
        </div>
      </div>
    </dialog>
  );
}
