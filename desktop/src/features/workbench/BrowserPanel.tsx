import * as React from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  BROWSER_PRESETS_UPDATED_EVENT,
  loadBrowserPresets,
  normalizeBrowserUrl,
} from "./browserPresets";
import {
  activateBrowserTab,
  closeBrowserTab,
  createBrowserTab,
  loadBrowserState,
  saveBrowserState,
  setBrowserNativeLabel,
  type BrowserProfile,
  type BrowserState,
} from "./browserStore";

type BrowserOpenResult = { label: string; profile: string; url: string };

export function BrowserPanel() {
  const [presets, setPresets] = React.useState(() =>
    loadBrowserPresets(
      typeof window === "undefined" ? null : window.localStorage,
    ),
  );
  const [state, setState] = React.useState<BrowserState>(() =>
    loadBrowserState(
      typeof window === "undefined" ? null : window.localStorage,
    ),
  );
  const active =
    state.tabs.find((tab) => tab.id === state.activeTabId) ?? state.tabs[0];
  const [url, setUrl] = React.useState(active.url);

  React.useEffect(() => saveBrowserState(state, window.localStorage), [state]);
  React.useEffect(() => {
    const reloadPresets = () =>
      setPresets(loadBrowserPresets(window.localStorage));
    window.addEventListener(BROWSER_PRESETS_UPDATED_EVENT, reloadPresets);
    return () =>
      window.removeEventListener(BROWSER_PRESETS_UPDATED_EVENT, reloadPresets);
  }, []);
  React.useEffect(() => setUrl(active.url), [active.url]);
  React.useEffect(() => {
    void invoke("workbench_browser_activate", {
      label: active.nativeLabel ?? null,
    });
    return () => {
      void invoke("workbench_browser_activate", { label: null });
    };
  }, [active.nativeLabel]);

  const open = async (
    tabId: string,
    nextUrl: string,
    profile: BrowserProfile,
  ) => {
    const safeUrl = normalizeBrowserUrl(nextUrl);
    const currentTab = state.tabs.find((tab) => tab.id === tabId);
    const next = {
      ...state,
      activeTabId: tabId,
      tabs: state.tabs.map((tab) =>
        tab.id === tabId ? { ...tab, url: safeUrl, profile } : tab,
      ),
    };
    setState(next);
    setUrl(safeUrl);
    try {
      if (currentTab?.nativeLabel && currentTab.profile === profile) {
        await invoke("workbench_browser_navigate", {
          label: currentTab.nativeLabel,
          url: safeUrl,
        });
      } else {
        if (currentTab?.nativeLabel) {
          await invoke("workbench_browser_close", {
            label: currentTab.nativeLabel,
          });
        }
        const result = await invoke<BrowserOpenResult>(
          "workbench_browser_open",
          { profile, url: safeUrl },
        );
        setState((current) =>
          setBrowserNativeLabel(current, tabId, result.label),
        );
      }
    } catch (error) {
      console.warn("Native browser webview unavailable", error);
    }
  };

  const addTab = () => {
    const next = createBrowserTab(state, {
      profile: "default",
      url: "about:blank",
    });
    setState(next);
  };

  const closeTab = async (tabId: string) => {
    const tab = state.tabs.find((item) => item.id === tabId);
    if (tab?.nativeLabel) {
      await invoke("workbench_browser_close", { label: tab.nativeLabel }).catch(
        () => undefined,
      );
    }
    setState((current) => closeBrowserTab(current, tabId));
  };

  return (
    <section className="buzz-workbench-browser" aria-label="Browser panel">
      <div
        className="buzz-workbench-browser-tabs"
        role="tablist"
        aria-label="Browser tabs"
      >
        {state.tabs.map((tab, index) => (
          <span key={tab.id}>
            <button
              aria-selected={tab.id === state.activeTabId}
              onClick={() =>
                setState((current) => activateBrowserTab(current, tab.id))
              }
              role="tab"
              type="button"
            >
              {tab.title ?? `Browser ${index + 1}`}
            </button>
            <button
              aria-label={`Close Browser ${index + 1}`}
              onClick={() => void closeTab(tab.id)}
              type="button"
            >
              ×
            </button>
          </span>
        ))}
        <button aria-label="New browser tab" onClick={addTab} type="button">
          +
        </button>
      </div>
      <div className="buzz-workbench-browser-toolbar">
        <button
          type="button"
          onClick={() =>
            active.nativeLabel &&
            void invoke("workbench_browser_history", {
              label: active.nativeLabel,
              direction: "back",
            })
          }
          aria-label="Back"
        >
          Back
        </button>
        <button
          type="button"
          onClick={() =>
            active.nativeLabel &&
            void invoke("workbench_browser_history", {
              label: active.nativeLabel,
              direction: "forward",
            })
          }
          aria-label="Forward"
        >
          Forward
        </button>
        <button
          type="button"
          onClick={() =>
            active.nativeLabel &&
            void invoke("workbench_browser_reload", {
              label: active.nativeLabel,
            })
          }
          aria-label="Reload"
        >
          Reload
        </button>
        <button
          type="button"
          onClick={() => void open(active.id, url, active.profile)}
          aria-label="Navigate browser"
        >
          Go
        </button>
        <input
          aria-label="Browser URL"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter")
              void open(active.id, url, active.profile);
          }}
        />
        <button
          type="button"
          onClick={() => void open(active.id, url, active.profile)}
        >
          Open
        </button>
        <button
          type="button"
          onClick={() => void openUrl(normalizeBrowserUrl(url))}
        >
          External
        </button>
      </div>
      <div className="buzz-workbench-browser-presets">
        {presets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() =>
              void open(active.id, preset.url, preset.profile as BrowserProfile)
            }
          >
            {preset.label}
          </button>
        ))}
      </div>
      <p className="buzz-workbench-browser-note">
        Native child webview; IPC capability is intentionally empty.
      </p>
    </section>
  );
}
