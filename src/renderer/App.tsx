import { useEffect, useRef } from "react";
import { ChromeLayer } from "./components/Chrome";
import { JoinCard, ProjectList, ProjectView } from "./components/Hub";
import { HubSetup } from "./components/HubSetup";
import { StartCard } from "./components/StartCard";
import { Settings } from "./components/Settings";
import { TitleBar, Toast } from "./components/TitleBar";
import { CanvasSelectionControls, UserInputPanel } from "./components/Interactions";
import { attachStage } from "./controller";
import { useUi } from "./store";

function Stage() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => attachStage(ref.current!), []);
  return <div ref={ref} className="stage" />;
}

export function App() {
  const { phase, connected, overlayHidden, sessionId, hubSetupOpen, settingsOpen } = useUi();
  return (
    <>
      <TitleBar />
      {/* A fresh frame per session: switching artifacts on a hub swaps the data store too. */}
      {phase === "session" && <Stage key={sessionId} />}
      {phase === "start" && <StartCard />}
      {phase === "join" && <JoinCard />}
      {phase === "projects" && <ProjectList />}
      {phase === "project" && <ProjectView />}
      {phase === "connecting" && <div className="connecting muted">Connecting…</div>}
      {phase === "session" && <ChromeLayer hidden={overlayHidden} />}
      {phase === "session" && <CanvasSelectionControls />}
      {phase === "session" && <UserInputPanel />}
      <Toast />
      {hubSetupOpen && <HubSetup />}
      {settingsOpen && <Settings />}
      {!connected && phase !== "connecting" && <div className="offline">reconnecting…</div>}
    </>
  );
}
