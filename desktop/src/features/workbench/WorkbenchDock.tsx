import * as React from "react";
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

  React.useEffect(() => {
    saveWorkbenchState(state, window.localStorage);
  }, [state]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() === "b" &&
        event.shiftKey &&
        (event.ctrlKey || event.metaKey) &&
        !event.altKey
      ) {
        event.preventDefault();
        setState((current) => ({ ...current, isOpen: !current.isOpen }));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const setActiveTab = (activeTab: WorkbenchTab) =>
    setState((current) => ({ ...current, activeTab, isOpen: true }));
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
              onClick={() =>
                setState((current) => ({ ...current, isOpen: false }))
              }
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
          <div
            aria-label={`${state.activeTab} panel`}
            className="buzz-workbench-dock-panel"
            data-panel={state.activeTab}
            role="tabpanel"
          >
            {state.activeTab === "browser" ? <BrowserPanel /> : (
              <>
                <strong>{TABS.find((tab) => tab.id === state.activeTab)?.label}</strong>
                <p>{panelDescription(state.activeTab)}</p>
              </>
            )}
          </div>
        </>
      ) : (
        <button
          aria-label="Open workbench"
          className="buzz-workbench-dock-open"
          onClick={() => setState((current) => ({ ...current, isOpen: true }))}
          type="button"
        >
          Workbench
        </button>
      )}
    </aside>
  );
}

export { DEFAULT_WORKBENCH_STATE };
