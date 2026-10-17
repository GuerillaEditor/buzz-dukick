import * as React from "react";
import {
  setTerminalPanelMode,
  useTerminalPanel,
} from "../terminal/terminalPanelStore";
import { BrowserPanel } from "./BrowserPanel";
import {
  DEFAULT_WORKBENCH_STATE,
  loadWorkbenchState,
  normalizeWorkbenchWidth,
  saveWorkbenchState,
  type WorkbenchState,
  type WorkbenchTab,
} from "./workbenchStore";

const TABS: ReadonlyArray<{ id: WorkbenchTab; label: string }> = [
  { id: "browser", label: "Browser" },
  { id: "terminal", label: "Terminal" },
  { id: "files", label: "Files" },
];

function panelDescription(tab: WorkbenchTab) {
  switch (tab) {
    case "browser":
      return "Native browser tabs will appear here.";
    case "terminal":
      return "Terminal sessions will appear here.";
    case "files":
      return "Read-only project files will appear here.";
  }
}

export function WorkbenchDock() {
  const [state, setState] = React.useState<WorkbenchState>(() =>
    loadWorkbenchState(
      typeof window === "undefined" ? null : window.localStorage,
    ),
  );
  const stateRef = React.useRef(state);
  stateRef.current = state;
  const terminalPanel = useTerminalPanel();
  const previousTerminalModeRef = React.useRef(terminalPanel.mode);

  React.useEffect(() => {
    saveWorkbenchState(state, window.localStorage);
  }, [state]);

  React.useEffect(() => {
    const previousMode = previousTerminalModeRef.current;
    previousTerminalModeRef.current = terminalPanel.mode;
    if (terminalPanel.mode !== "closed") {
      setState((current) => ({
        ...current,
        activeTab: "terminal",
        isOpen: true,
      }));
    } else if (
      previousMode !== "closed" &&
      stateRef.current.activeTab === "terminal"
    ) {
      setState((current) => ({ ...current, isOpen: false }));
    }
  }, [terminalPanel.mode]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() === "b" &&
        event.shiftKey &&
        (event.ctrlKey || event.metaKey) &&
        !event.altKey
      ) {
        event.preventDefault();
        const current = stateRef.current;
        const isOpen = !current.isOpen;
        setState({ ...current, isOpen });
        if (current.activeTab === "terminal") {
          setTerminalPanelMode(isOpen ? "docked" : "closed");
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const setActiveTab = (activeTab: WorkbenchTab) => {
    setTerminalPanelMode(activeTab === "terminal" ? "docked" : "closed");
    setState((current) => ({ ...current, activeTab, isOpen: true }));
  };
  const setWidth = (width: number) =>
    setState((current) => ({
      ...current,
      width: normalizeWorkbenchWidth(width),
    }));

  return (
    <aside
      aria-label="Workbench"
      className="buzz-workbench-dock"
      data-open={state.isOpen}
      data-width={state.width}
      style={{ width: state.isOpen ? `${state.width}px` : undefined }}
    >
      {state.isOpen ? (
        <>
          <header className="buzz-workbench-dock-header">
            <div
              className="buzz-workbench-dock-tabs"
              role="tablist"
              aria-label="Workbench panels"
            >
              {TABS.map((tab) => (
                <button
                  aria-selected={state.activeTab === tab.id}
                  className="buzz-workbench-dock-tab"
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  role="tab"
                  type="button"
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <button
              aria-label="Close workbench"
              className="buzz-workbench-dock-close"
              onClick={() => {
                setTerminalPanelMode("closed");
                setState((current) => ({ ...current, isOpen: false }));
              }}
              type="button"
            >
              ×
            </button>
          </header>
          <div className="buzz-workbench-dock-resize">
            <label htmlFor="buzz-workbench-width">Dock width</label>
            <input
              id="buzz-workbench-width"
              max="720"
              min="320"
              name="dock-width"
              onChange={(event) => setWidth(Number(event.target.value))}
              type="range"
              value={state.width}
            />
          </div>
        </>
      ) : (
        <button
          aria-label="Open workbench"
          className="buzz-workbench-dock-open"
          onClick={() => {
            if (state.activeTab === "terminal") setTerminalPanelMode("docked");
            setState((current) => ({ ...current, isOpen: true }));
          }}
          type="button"
        >
          Workbench
        </button>
      )}
      <div
        aria-label={`${state.activeTab} panel`}
        className="buzz-workbench-dock-panel"
        data-panel={state.activeTab}
        hidden={!state.isOpen}
        role="tabpanel"
      >
        {state.isOpen && state.activeTab === "browser" ? (
          <BrowserPanel />
        ) : null}
        <div
          className="buzz-terminal-dock-host buzz-workbench-terminal-host"
          data-terminal-dock
          hidden={state.activeTab !== "terminal"}
          id="buzz-terminal-dock-host"
        />
        {state.isOpen && state.activeTab === "files" ? (
          <>
            <strong>Files</strong>
            <p>{panelDescription("files")}</p>
          </>
        ) : null}
      </div>
    </aside>
  );
}

export { DEFAULT_WORKBENCH_STATE };
