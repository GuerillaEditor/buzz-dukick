import * as React from "react";
import { invoke } from "@tauri-apps/api/core";
import { BROWSER_PRESETS, normalizeBrowserUrl } from "./browserPresets";
import { createBrowserTab, loadBrowserState, saveBrowserState, type BrowserState } from "./browserStore";

type BrowserOpenResult = { label: string; profile: string; url: string };

export function BrowserPanel() {
  const [state, setState] = React.useState<BrowserState>(() =>
    loadBrowserState(typeof window === "undefined" ? null : window.localStorage),
  );
  const active = state.tabs.find((tab) => tab.id === state.activeTabId) ?? state.tabs[0];
  const [url, setUrl] = React.useState(active.url);

  React.useEffect(() => saveBrowserState(state, window.localStorage), [state]);
  React.useEffect(() => setUrl(active.url), [active.id, active.url]);

  const open = async (nextUrl: string, profile: string) => {
    const safeUrl = normalizeBrowserUrl(nextUrl);
    const next = state.tabs.find((tab) => tab.id === state.activeTabId)
      ? { ...state, tabs: state.tabs.map((tab) => (tab.id === state.activeTabId ? { ...tab, url: safeUrl, profile: profile as typeof tab.profile } : tab)) }
      : createBrowserTab(state, { url: safeUrl, profile });
    setState(next);
    setUrl(safeUrl);
    try {
      const result = await invoke<BrowserOpenResult>("workbench_browser_open", { profile, url: safeUrl });
      setState((current) => ({ ...current, tabs: current.tabs.map((tab) => tab.id === current.activeTabId ? { ...tab, nativeLabel: result.label } : tab) }));
    } catch (error) {
      console.warn("Native browser webview unavailable", error);
    }
  };

  return (
    <section className="buzz-workbench-browser" aria-label="Browser panel">
      <div className="buzz-workbench-browser-toolbar">
        <button type="button" onClick={() => active.nativeLabel && void invoke("workbench_browser_history", { label: active.nativeLabel, direction: "back" })} aria-label="Back">Back</button>
        <button type="button" onClick={() => active.nativeLabel && void invoke("workbench_browser_history", { label: active.nativeLabel, direction: "forward" })} aria-label="Forward">Forward</button>
        <button type="button" onClick={() => active.nativeLabel && void invoke("workbench_browser_reload", { label: active.nativeLabel })} aria-label="Reload">Reload</button>
        <button type="button" onClick={() => active.nativeLabel && void invoke("workbench_browser_navigate", { label: active.nativeLabel, url: url })} aria-label="Navigate browser">Go</button>
        <input aria-label="Browser URL" value={url} onChange={(event) => setUrl(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void open(url, active.profile); }} />
        <button type="button" onClick={() => void open(url, active.profile)}>Open</button>
      </div>
      <div className="buzz-workbench-browser-presets" aria-label="Browser presets">
        {BROWSER_PRESETS.map((preset) => <button key={preset.id} type="button" onClick={() => void open(preset.url, preset.profile)}>{preset.label}</button>)}
      </div>
      <p className="buzz-workbench-browser-note">Native child webview; IPC capability is intentionally empty.</p>
    </section>
  );
}
